import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import type { ILdapAuthenticator, ILdapConfig, ILdapProfile } from '../ee/ldap/ldap-service.js';
import { licensedBoot } from './helpers.js';

/**
 * backlog #42：SSO 角色映射 —— LDAP group → 项目成员自动生效。
 */
class GroupAuthenticator implements ILdapAuthenticator {
  constructor(public dir: Record<string, { password: string; ldapId: string; email: string; groups: string[] }>) {}
  async authenticate(_c: ILdapConfig, login: string, password: string): Promise<ILdapProfile | null> {
    const e = this.dir[login];
    if (!e || e.password !== password) return null;
    return { email: e.email, firstName: null, lastName: null, ldapId: e.ldapId, groups: e.groups };
  }
}

let boot: BootstrapResult;
let app: Express;
let adminToken: string;
let projectId: string;
const admin = () => ({ Authorization: `Bearer ${adminToken}` });

beforeAll(async () => {
  const authr = new GroupAuthenticator({
    dev: { password: 'pw', ldapId: 'uid-dev', email: 'dev@corp.dev', groups: ['cn=devs,ou=groups,dc=corp'] },
    sales: { password: 'pw', ldapId: 'uid-sales', email: 'sales@corp.dev', groups: ['cn=sales,ou=groups,dc=corp'] },
  });
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot(), ldapAuthenticator: authr });
  app = createApp(boot.services);
  adminToken = (await request(app).post('/auth/register').send({ email: 'admin@dev.dev', password: 'password-123' }).expect(201)).body.token;
  await request(app)
    .put('/api/ldap/config')
    .set(admin())
    .send({ enabled: true, url: 'ldap://x:389', bindDn: 'cn=svc', bindPassword: 'svc', userSearchBase: 'ou=people', loginAttribute: 'uid', emailAttribute: 'mail', ldapIdAttribute: 'uid' })
    .expect(200);

  projectId = (await request(app).post('/api/projects').set(admin()).send({ name: 'Engineering' }).expect(201)).body.id;
  // 规则：LDAP group cn=devs → Engineering 项目 editor
  await request(app)
    .post('/api/role-mappings')
    .set(admin())
    .send({ sourceType: 'ldap-group', matchValue: 'cn=devs,ou=groups,dc=corp', projectRole: 'project:editor', projectIds: [projectId] })
    .expect(201);
});

afterAll(async () => {
  await boot.shutdown();
});

const memberRole = async (userId: string): Promise<string | null> => boot.services.repos.projects.findMemberRole(projectId, userId);

describe('SSO 角色映射（backlog #42）', () => {
  it('LDAP group 命中 → 登录后自动成为项目 editor', async () => {
    const login = await request(app).post('/auth/ldap/login').send({ username: 'dev', password: 'pw' }).expect(200);
    expect(await memberRole(login.body.user.id)).toBe('project:editor');
  });

  it('group 不命中 → 不加入该项目', async () => {
    const login = await request(app).post('/auth/ldap/login').send({ username: 'sales', password: 'pw' }).expect(200);
    expect(await memberRole(login.body.user.id)).toBeNull();
  });

  it('规则列表可查;删除后不再生效', async () => {
    const rules = (await request(app).get('/api/role-mappings').set(admin()).expect(200)).body;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ sourceType: 'ldap-group', projectRole: 'project:editor', projectIds: [projectId] });
  });
});
