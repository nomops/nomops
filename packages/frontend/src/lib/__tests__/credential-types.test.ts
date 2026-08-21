import { describe, expect, it } from 'vitest';
import { CREDENTIAL_TYPES } from '../credential-types.js';

describe('工具节点凭证元数据', () => {
  it('Nomops 自 API 只收取隐藏的 API Key，不暴露可配置目标 URL', () => {
    const credential = CREDENTIAL_TYPES.find((item) => item.type === 'nomopsApi');
    expect(credential?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'apiKey', type: 'password', required: true }),
    ]));
    expect(credential?.fields.some((field) => /url/i.test(field.name))).toBe(false);
  });

  it('TOTP 与 Git 密钥字段都用 password 控件', () => {
    for (const type of ['totp', 'gitToken', 'gitSsh']) {
      const credential = CREDENTIAL_TYPES.find((item) => item.type === type);
      expect(credential).toBeDefined();
      expect(credential!.fields.some((field) => field.type === 'password' && field.required)).toBe(true);
    }
    expect(CREDENTIAL_TYPES.find((item) => item.type === 'gitToken')?.fields.find((field) => field.name === 'accessToken')?.type).toBe('password');
    expect(CREDENTIAL_TYPES.find((item) => item.type === 'gitSsh')?.fields.find((field) => field.name === 'privateKey')?.type).toBe('password');
  });

  it('不暴露后端尚未兑现的 OAuth2 grant、Digest 与 OAuth1', () => {
    const oauth2 = CREDENTIAL_TYPES.find((item) => item.type === 'oauth2Api');
    expect(oauth2?.fields.some((field) => field.name === 'grantType')).toBe(false);
    expect(oauth2?.fields.some((field) => field.name === 'ignoreSSL')).toBe(false);
    expect(CREDENTIAL_TYPES.some((item) => item.type === 'httpDigestAuth')).toBe(false);
    expect(CREDENTIAL_TYPES.some((item) => item.type === 'oauth1Api')).toBe(false);
  });
});
