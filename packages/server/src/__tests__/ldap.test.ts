import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import type { ILdapAuthenticator, ILdapConfig, ILdapProfile } from '../ee/ldap/ldap-service.js';
import { licensedBoot } from './helpers.js';

/**
 * B5 验收：LDAP 配置（bindPassword 不出 API）+ bind 登录 + JIT 预配 + license 门。
 * 用假 authenticator 做协议无关的逻辑验证（真实 ldapts 走网络，不在单测里打）。
 */

/** 假认证器：内置一个用户目录，验证 loginAttribute + 密码。 */
class FakeAuthenticator implements ILdapAuthenticator {
  public lastConfig: ILdapConfig | null = null;
  constructor(private readonly directory: Record<string, { password: string; profile: ILdapProfile }>) {}
  async authenticate(config: ILdapConfig, login: string, password: string): Promise<ILdapProfile | null> {
    this.lastConfig = config;
    const entry = this.directory[login];
    if (!entry || entry.password !== password) return null;
    return entry.profile;
  }
}

const directory = {
  alice: { password: 'ldap-pass', profile: { email: 'alice@corp.com', firstName: 'Alice', lastName: 'Anderson' } },
};

let boot: BootstrapResult;
let app: Express;
let adminToken: string;
let authr: FakeAuthenticator;

async function setup(enterprise: boolean) {
  authr = new FakeAuthenticator(directory);
  boot = await bootstrap({
    dbConfig: { type: 'sqlite' },
    ...(enterprise ? licensedBoot() : { licenseKey: null }),
    ldapAuthenticator: authr,
  });
  app = createApp(boot.services);
  // 第一个注册用户 = owner（实例管理员）
  const reg = await request(app).post('/auth/register').send({ email: 'admin@dev.dev', password: 'password-123' }).expect(201);
  adminToken = reg.body.token;
}
const admin = () => ({ Authorization: `Bearer ${adminToken}` });

/** 企业版下配置并启用 LDAP。 */
async function enableLdap() {
  await request(app)
    .put('/api/ldap/config')
    .set(admin())
    .send({
      enabled: true,
      url: 'ldap://ldap.corp.com:389',
      bindDn: 'cn=svc,dc=corp,dc=com',
      bindPassword: 'svc-secret',
      userSearchBase: 'ou=people,dc=corp,dc=com',
      loginAttribute: 'uid',
      emailAttribute: 'mail',
    })
    .expect(200);
}

afterEach(async () => {
  await boot.shutdown();
});

describe('LDAP 登录', () => {
  it('社区版 → 配置端点 403；登录端点 403', async () => {
    await setup(false);
    const cfg = await request(app).get('/api/ldap/config').set(admin()).expect(403);
    expect(cfg.body.feature).toBe('ldap');
    await request(app).post('/auth/ldap/login').send({ username: 'alice', password: 'ldap-pass' }).expect(403);
  });

  it('企业版：保存配置后 bindPassword 绝不出 API（掩码）', async () => {
    await setup(true);
    await enableLdap();
    const cfg = await request(app).get('/api/ldap/config').set(admin()).expect(200);
    expect(cfg.body.enabled).toBe(true);
    expect(cfg.body.url).toBe('ldap://ldap.corp.com:389');
    expect(cfg.body.bindPassword).toBe('••••••••'); // 掩码
    expect(JSON.stringify(cfg.body)).not.toContain('svc-secret'); // 铁律 3
  });

  it('未启用时 /auth/ldap/status = false；启用后 = true', async () => {
    await setup(true);
    expect((await request(app).get('/auth/ldap/status')).body.enabled).toBe(false);
    await enableLdap();
    expect((await request(app).get('/auth/ldap/status')).body.enabled).toBe(true);
  });

  it('LDAP 登录成功 → JIT 建用户并签发本系统 token', async () => {
    await setup(true);
    await enableLdap();
    const res = await request(app).post('/auth/ldap/login').send({ username: 'alice', password: 'ldap-pass' }).expect(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('alice@corp.com');
    expect(res.body.user.firstName).toBe('Alice');
    // 认证器确实拿到了解密后的 bindPassword（配置往返正确）
    expect(authr.lastConfig?.bindPassword).toBe('svc-secret');

    // JIT 用户可用签发的 token 访问 API
    await request(app).get('/api/workflows').set({ Authorization: `Bearer ${res.body.token}` }).expect(200);

    // 第二次登录复用同一用户（不重复建）
    await request(app).post('/auth/ldap/login').send({ username: 'alice', password: 'ldap-pass' }).expect(200);
    const users = await request(app).get('/api/instance/users').set(admin()).expect(200);
    expect(users.body.filter((u: { email: string }) => u.email === 'alice@corp.com')).toHaveLength(1);
  });

  it('密码错误 / 用户不存在 → 401', async () => {
    await setup(true);
    await enableLdap();
    await request(app).post('/auth/ldap/login').send({ username: 'alice', password: 'wrong' }).expect(401);
    await request(app).post('/auth/ldap/login').send({ username: 'ghost', password: 'x' }).expect(401);
  });

  it('LDAP 未启用（企业版但没配）→ 登录 403', async () => {
    await setup(true);
    await request(app).post('/auth/ldap/login').send({ username: 'alice', password: 'ldap-pass' }).expect(403);
  });

  it('保存时省略 bindPassword → 保留原密文（不清空）', async () => {
    await setup(true);
    await enableLdap();
    // 再存一次，只改 loginAttribute，不带 bindPassword
    await request(app)
      .put('/api/ldap/config')
      .set(admin())
      .send({ enabled: true, url: 'ldap://ldap.corp.com:389', loginAttribute: 'cn' })
      .expect(200);
    // 登录仍能成功（bindPassword 未丢），且认证器拿到的是原密码
    await request(app).post('/auth/ldap/login').send({ username: 'alice', password: 'ldap-pass' }).expect(200);
    expect(authr.lastConfig?.bindPassword).toBe('svc-secret');
    expect(authr.lastConfig?.loginAttribute).toBe('cn');
  });
});
