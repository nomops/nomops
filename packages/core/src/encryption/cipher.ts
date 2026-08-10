import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { OperationalError } from '@nomops/workflow';
import type { IEncryptionKeyProvider } from './key-provider.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM 推荐 96-bit IV
const LEGACY_FORMAT_VERSION = 'v1';
const KEYRING_FORMAT_VERSION = 'v2';

/**
 * AES-256-GCM 加解密。密文格式：`v1:<iv_b64>:<tag_b64>:<data_b64>`。
 * 密钥永远经 IEncryptionKeyProvider 取（铁律 5）。
 */
export class Cipher {
  constructor(private readonly keyProvider: IEncryptionKeyProvider) {}

  async encrypt(plaintext: string, context?: { projectId?: string }): Promise<string> {
    const active = this.keyProvider.getActiveKey
      ? await this.keyProvider.getActiveKey(context)
      : { id: '', key: await this.keyProvider.getKey(context) };
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, active.key, iv);
    if (active.id) cipher.setAAD(Buffer.from(`${KEYRING_FORMAT_VERSION}:${active.id}`));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      ...(active.id ? [KEYRING_FORMAT_VERSION, active.id] : [LEGACY_FORMAT_VERSION]),
      iv.toString('base64'),
      tag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  async decrypt(payload: string, context?: { projectId?: string }): Promise<string> {
    const parts = payload.split(':');
    const legacy = parts.length === 4 && parts[0] === LEGACY_FORMAT_VERSION;
    const keyring = parts.length === 5 && parts[0] === KEYRING_FORMAT_VERSION;
    if (!legacy && !keyring) {
      throw new OperationalError('密文格式无效或版本不支持');
    }
    const keyId = keyring ? parts[1]! : '';
    const [ivB64, tagB64, dataB64] = keyring ? parts.slice(2) : parts.slice(1);
    const key = keyring
      ? await this.keyProvider.getKeyById?.(keyId, context).catch(() => undefined)
      : await this.keyProvider.getKey(context);
    if (!key) throw new OperationalError('凭证解密失败（密钥不存在）');
    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64!, 'base64'));
      if (keyring) decipher.setAAD(Buffer.from(`${KEYRING_FORMAT_VERSION}:${keyId}`));
      decipher.setAuthTag(Buffer.from(tagB64!, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(dataB64!, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // 不透出底层细节（可能是密钥错/密文被篡改）
      throw new OperationalError('凭证解密失败（密钥不匹配或数据损坏）');
    }
  }
}
