import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import type { ILdapAuthenticator, ILdapConfig, ILdapDirectoryUser, ILdapProfile } from '../ee/ldap/ldap-service.js';
import { licensedBoot } from './helpers.js';

/**
 * backlog #36：SSO/LDAP 身份绑定 —— 改 email 后同一 LDAP 账号仍归同一 user;同步历史可查。
 */
class DirAuthenticator implements ILdapAuthenticator {
  // login → { password, ldapId, email, names }（email 可被测试改）
  constructor(public dir: Record<string, { password: string; ldapId: string; email: string; firstName: string; lastName: string }>) {}
  async authenticate(_c: ILdapConfig, login: string, password: string): Promise<ILdapProfile | null> {
    const e = this.dir[login];
    if (!e || e.password !== password) return null;
    return { email: e.email, firstName: e.firstName, lastName: e.lastName, ldapId: e.ldapId };
  }
  async listUsers(): Promise<ILdapDirectoryUser[]> {
    return Object.values(this.dir).map((e) => ({ email: e.email, firstName: e.firstName, lastName: e.lastName, ldapId: e.ldapId }));
  }
}

let boot: BootstrapResult;
let app: Express;
let adminToken: string;
let authr: DirAuthenticator;
const admin = () => ({ Authorization: `Bearer ${adminToken}` });

beforeEach(async () => {
  authr = new DirAuthenticator({
    bob: { password: 'pw', ldapId: 'uid-bob', email: 'bob@corp.dev', firstName: 'Bob', lastName: 'B' },
  });
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot(), ldapAuthenticator: authr });
  app = createApp(boot.services);
  adminToken = (await request(app).post('/auth/register').send({ email: 'admin@dev.dev', password: 'password-123' }).expect(201)).body.token;
  await request(app)
    .put('/api/ldap/config')
    .set(admin())
    .send({
      enabled: true,
      url: 'ldap://x:389',
      bindDn: 'cn=svc',
      bindPassword: 'svc',
      userSearchBase: 'ou=people',
      loginAttribute: 'uid',
      emailAttribute: 'mail',
      ldapIdAttribute: 'uid',
    })
    .expect(200);
});

afterEach(async () => {
  await boot.shutdown();
});

const userCount = async (): Promise<number> => (await request(app).get('/api/instance/users').set(admin()).expect(200)).body.length;

describe('SSO/LDAP 身份绑定（backlog #36）', () => {
  it('LDAP 登录改 email 后仍归同一 user（按 ldapId 绑定）', async () => {
    const first = (await request(app).post('/auth/ldap/login').send({ username: 'bob', password: 'pw' }).expect(200)).body;
    const before = await userCount();

    // IdP 侧改 email，同一 ldapId
    authr.dir['bob']!.email = 'bob.new@corp.dev';
    const second = (await request(app).post('/auth/ldap/login').send({ username: 'bob', password: 'pw' }).expect(200)).body;

    expect(second.user.id).toBe(first.user.id); // 同一 user
    expect(await userCount()).toBe(before); // 没多建用户
  });

  it('LDAP 同步改 email 不重复建用户（绑定感知）+ 同步历史可查', async () => {
    const s1 = (await request(app).post('/api/ldap/sync').set(admin()).expect(200)).body;
    expect(s1).toMatchObject({ scanned: 1, created: 1 });
    const afterCreate = await userCount();

    // 改 email 后再同步 → 认出是同一账号,走 update,不新建
    authr.dir['bob']!.email = 'bob.moved@corp.dev';
    const s2 = (await request(app).post('/api/ldap/sync').set(admin()).expect(200)).body;
    expect(s2).toMatchObject({ scanned: 1, created: 0, updated: 1 });
    expect(await userCount()).toBe(afterCreate); // 用户数不变

    // 同步历史可查
    const history = (await request(app).get('/api/ldap/sync-history').set(admin()).expect(200)).body;
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0]).toMatchObject({ providerType: 'ldap', status: 'success', scanned: 1 });
  });

  it('先同步建号,再 LDAP 登录归到同一 user（跨路径绑定一致）', async () => {
    await request(app).post('/api/ldap/sync').set(admin()).expect(200);
    const users = (await request(app).get('/api/instance/users').set(admin()).expect(200)).body as Array<{ id: string; email: string }>;
    const syncedId = users.find((u) => u.email === 'bob@corp.dev')!.id;
    const beforeLogin = users.length;

    // 目录改 email 后登录：仍按 ldapId 绑定归到同步建的那个 user,不重复建
    authr.dir['bob']!.email = 'bob.again@corp.dev';
    const login = (await request(app).post('/auth/ldap/login').send({ username: 'bob', password: 'pw' }).expect(200)).body;
    expect(login.user.id).toBe(syncedId);
    expect(await userCount()).toBe(beforeLogin);
  });
});
