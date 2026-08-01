import { describe, expect, it } from 'vitest';
import { CREDENTIAL_TYPES } from '../credential-types.js';

describe('工具节点凭证元数据', () => {
  it('TOTP 与 Git 密钥字段都用 password 控件', () => {
    for (const type of ['totp', 'gitToken', 'gitSsh']) {
      const credential = CREDENTIAL_TYPES.find((item) => item.type === type);
      expect(credential).toBeDefined();
      expect(credential!.fields.some((field) => field.type === 'password' && field.required)).toBe(true);
    }
    expect(CREDENTIAL_TYPES.find((item) => item.type === 'gitToken')?.fields.find((field) => field.name === 'accessToken')?.type).toBe('password');
    expect(CREDENTIAL_TYPES.find((item) => item.type === 'gitSsh')?.fields.find((field) => field.name === 'privateKey')?.type).toBe('password');
  });
});
