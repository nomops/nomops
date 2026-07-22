import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import type { ILdapAuthenticator, ILdapConfig, ILdapDirectoryUser, ILdapProfile } from '../ee/ldap/ldap-service.js';
import { licensedBoot } from './helpers.js';

/**
 * 设置页本地态字段贯通（backlog #9）：
 * - OIDC prompt/acrValues/additionalScopes 落库回读 + scopes 逗号拒收;
 * - LDAP 扩展字段落库回读 + userFilter/allowUnauthorizedCerts 进认证器 + 同步 preview/run;
 * - MCP OAuth redirect 允许清单持久化（非 http(s) 清洗掉）。
 */
class FakeAuthenticator implements ILdapAuthenticator {
  public lastConfig: ILdapConfig | null = null;
  constructor(
    private readonly directory: Record<string, { password: string; profile: ILdapProfile }>,
    private readonly listing: ILdapDirectoryUser[] = [],
  ) {}
  async authenticate(config: ILdapConfig, login: string, password: string): Promise<ILdapProfile | null> {
    this.lastConfig = config;
    const entry = this.directory[login];
    if (!entry || entry.password !== password) return null;
    return entry.profile;
  }
  async listUsers(config: ILdapConfig): Promise<ILdapDirectoryUser[]> {
    this.lastConfig = config;
    return this.listing;
  }
}

let boot: BootstrapResult;
let app: Express;
let adminToken: string;
let authr: FakeAuthenticator;

async function setup(listing: ILdapDirectoryUser[] = []) {
  authr = new FakeAuthenticator(
    { alice: { password: 'ldap-pass', profile: { email: 'alice@corp.com', firstName: 'Alice', lastName: 'A' } } },
    listing,
  );
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot(), ldapAuthenticator: authr });
  app = createApp(boot.services);
  const reg = await request(app).post('/auth/register').send({ email: 'admin@dev.dev', password: 'password-123' }).expect(201);
  adminToken = reg.body.token;
}
const admin = () => ({ Authorization: `Bearer ${adminToken}` });

afterEach(async () => {
  await boot.shutdown();
});

describe('OIDC 扩展字段', () => {
  it('prompt/acrValues/additionalScopes 落库回读;逗号分隔 scopes 400', async () => {
    await setup();
    await request(app)
      .put('/api/sso/config')
      .set(admin())
      .send({
        enabled: false,
        issuer: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecret: 's3cret',
        prompt: 'consent',
        acrValues: 'mfa pwd',
        additionalScopes: 'groups roles',
      })
      .expect(200);

    const cfg = await request(app).get('/api/sso/config').set(admin()).expect(200);
    expect(cfg.body.prompt).toBe('consent');
    expect(cfg.body.acrValues).toBe('mfa pwd');
    expect(cfg.body.additionalScopes).toBe('groups roles');
    expect(cfg.body.clientSecret).toBe('••••••••'); // 掩码不回明文

    await request(app)
      .put('/api/sso/config')
      .set(admin())
      .send({ enabled: false, issuer: 'https://idp.example.com', clientId: 'c', additionalScopes: 'groups,roles' })
      .expect(400);
  });
});

describe('LDAP 扩展字段 + 同步', () => {
  const ldapBody = {
    enabled: true,
    url: 'ldap://ldap.corp.com:389',
    bindDn: 'cn=svc,dc=corp,dc=com',
    bindPassword: 'svc-secret',
    userSearchBase: 'ou=people,dc=corp,dc=com',
    loginAttribute: 'uid',
    emailAttribute: 'mail',
    loginLabel: 'Corp Login',
    allowUnauthorizedCerts: true,
    userFilter: '(objectClass=person)',
    ldapIdAttribute: 'employeeId',
    pageSize: 25,
    searchTimeout: 30,
    enforceEmailUniqueness: false,
  };

  it('扩展字段落库回读,且登录时进认证器 config', async () => {
    await setup();
    await request(app).put('/api/ldap/config').set(admin()).send(ldapBody).expect(200);

    const cfg = await request(app).get('/api/ldap/config').set(admin()).expect(200);
    expect(cfg.body.loginLabel).toBe('Corp Login');
    expect(cfg.body.allowUnauthorizedCerts).toBe(true);
    expect(cfg.body.userFilter).toBe('(objectClass=person)');
    expect(cfg.body.ldapIdAttribute).toBe('employeeId');
    expect(cfg.body.pageSize).toBe(25);
    expect(cfg.body.searchTimeout).toBe(30);
    expect(cfg.body.enforceEmailUniqueness).toBe(false);

    // 登录路径拿到的 config 带扩展字段（userFilter/证书豁免真正进 ldapts 选项）
    await request(app).post('/auth/ldap/login').send({ username: 'alice', password: 'ldap-pass' }).expect(200);
    expect(authr.lastConfig?.userFilter).toBe('(objectClass=person)');
    expect(authr.lastConfig?.allowUnauthorizedCerts).toBe(true);
  });

  it('同步:preview 对账不写库,run 创建/更新本地用户', async () => {
    await setup([
      { ldapId: 'e1', email: 'new@corp.com', firstName: 'New', lastName: 'User' },
      { ldapId: 'e2', email: 'admin@dev.dev', firstName: 'Renamed', lastName: 'Admin' }, // 已存在,姓名有差异
    ]);
    await request(app).put('/api/ldap/config').set(admin()).send(ldapBody).expect(200);

    const preview = await request(app).post('/api/ldap/sync/preview').set(admin()).expect(200);
    const byEmail = Object.fromEntries(preview.body.rows.map((r: { email: string; action: string }) => [r.email, r.action]));
    expect(byEmail['new@corp.com']).toBe('create');
    expect(byEmail['admin@dev.dev']).toBe('update');
    // preview 不写库
    expect(await boot.services.repos.users.findByEmail('new@corp.com')).toBeNull();

    const run = await request(app).post('/api/ldap/sync').set(admin()).expect(200);
    expect(run.body).toEqual({ created: 1, updated: 1, unchanged: 0 });
    const created = await boot.services.repos.users.findByEmail('new@corp.com');
    expect(created).toBeTruthy();
    expect(created!.firstName).toBe('New');
    const renamed = await boot.services.repos.users.findByEmail('admin@dev.dev');
    expect(renamed!.firstName).toBe('Renamed');

    // 再跑一次:全部 unchanged,幂等
    const again = await request(app).post('/api/ldap/sync').set(admin()).expect(200);
    expect(again.body).toEqual({ created: 0, updated: 0, unchanged: 2 });
  });
});

describe('MCP redirect 允许清单', () => {
  it('持久化 + 非 http(s) 清洗 + status 回读', async () => {
    await setup();
    const res = await request(app)
      .put('/api/mcp/redirect-urls')
      .set(admin())
      .send({ redirectUrls: ['https://app.example.com/callback', ' http://localhost:3000/cb ', 'ftp://bad', ''] })
      .expect(200);
    expect(res.body.redirectUrls).toEqual(['https://app.example.com/callback', 'http://localhost:3000/cb']);

    const status = await request(app).get('/api/mcp').set(admin()).expect(200);
    expect(status.body.redirectUrls).toEqual(['https://app.example.com/callback', 'http://localhost:3000/cb']);

    await request(app).put('/api/mcp/redirect-urls').set(admin()).send({ redirectUrls: 'nope' }).expect(400);
  });
});
