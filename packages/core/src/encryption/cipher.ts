import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { OperationalError } from '@nomops/workflow';
import type { IEncryptionKeyProvider } from './key-provider.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM 推荐 96-bit IV
const FORMAT_VERSION = 'v1';

/**
 * AES-256-GCM 加解密。密文格式：`v1:<iv_b64>:<tag_b64>:<data_b64>`。
 * 密钥永远经 IEncryptionKeyProvider 取（铁律 5）。
 */
export class Cipher {
  constructor(private readonly keyProvider: IEncryptionKeyProvider) {}

  async encrypt(plaintext: string, context?: { projectId?: string }): Promise<string> {
    const key = await this.keyProvider.getKey(context);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      FORMAT_VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  async decrypt(payload: string, context?: { projectId?: string }): Promise<string> {
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
      throw new OperationalError('密文格式无效或版本不支持');
    }
    const [, ivB64, tagB64, dataB64] = parts;
    const key = await this.keyProvider.getKey(context);
    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64!, 'base64'));
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
