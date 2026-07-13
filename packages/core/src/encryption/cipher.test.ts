import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Cipher } from './cipher.js';
import { StaticKeyProvider } from './key-provider.js';
import { Credentials } from '../credentials.js';

const cipherWith = (key: Buffer) => new Cipher(new StaticKeyProvider(key));

describe('Cipher（AES-256-GCM）', () => {
  it('加解密往返一致', async () => {
    const cipher = cipherWith(randomBytes(32));
    const secret = 'hello nomops 中文 🚀';
    const encrypted = await cipher.encrypt(secret);
    expect(encrypted).not.toContain(secret);
    expect(await cipher.decrypt(encrypted)).toBe(secret);
  });

  it('同一明文两次加密产生不同密文（随机 IV）', async () => {
    const cipher = cipherWith(randomBytes(32));
    expect(await cipher.encrypt('same')).not.toBe(await cipher.encrypt('same'));
  });

  it('密钥不对解密失败（可读错误，不透出底层）', async () => {
    const encrypted = await cipherWith(randomBytes(32)).encrypt('secret');
    await expect(cipherWith(randomBytes(32)).decrypt(encrypted)).rejects.toThrow(/凭证解密失败/);
  });

  it('密文被篡改时解密失败（GCM 校验）', async () => {
    const key = randomBytes(32);
    const encrypted = await cipherWith(key).encrypt('secret');
    const parts = encrypted.split(':');
    const data = Buffer.from(parts[3]!, 'base64');
    data[0] = data[0]! ^ 0xff;
    parts[3] = data.toString('base64');
    await expect(cipherWith(key).decrypt(parts.join(':'))).rejects.toThrow(/凭证解密失败/);
  });

  it('非 32 字节密钥被 StaticKeyProvider 拒绝', () => {
    expect(() => new StaticKeyProvider(randomBytes(16))).toThrow(/32 字节/);
  });
});

describe('Credentials（对象级封装）', () => {
  it('对象加解密往返一致，密文不含明文字段（验收项）', async () => {
    const credentials = new Credentials(cipherWith(randomBytes(32)));
    const data = { user: 'alice', password: 'p@ssw0rd-超密' };
    const encrypted = await credentials.encrypt(data);
    expect(encrypted).not.toContain('alice');
    expect(encrypted).not.toContain('p@ssw0rd');
    expect(await credentials.decrypt(encrypted)).toEqual(data);
  });
});
