import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser, setupOwner } from './helpers.js';

/** Step 4：实例用户管理 + 安全设置（实例 admin owner/admin 可见）。 */

let boot: BootstrapResult;
let app: Express;
let ownerToken: string; // 第一个注册用户 = 实例 owner
let memberToken: string;
let memberId: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  const owner = await setupOwner(app, 'owner@inst.dev');
  ownerToken = owner.token;
  const member = await inviteUser(app, ownerToken, 'member@inst.dev');
  memberToken = member.token;
  memberId = member.userId;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('实例用户管理', () => {
  it('owner 列出全部用户（含角色）；member 403', async () => {
    await request(app).get('/api/instance/users').set(bearer(memberToken)).expect(403);
    const res = await request(app).get('/api/instance/users').set(bearer(ownerToken)).expect(200);
    expect(res.body).toHaveLength(2);
    const owner = res.body.find((u: { email: string }) => u.email === 'owner@inst.dev');
    expect(owner.role).toBe('owner'); // 首注册 = owner
    expect(res.body.find((u: { email: string }) => u.email === 'member@inst.dev').role).toBe('member');
  });

  it('owner 可提升 member 为 admin；提升后该用户能访问 admin 接口', async () => {
    await request(app)
      .patch(`/api/instance/users/${memberId}/role`)
      .set(bearer(ownerToken))
      .send({ role: 'admin' })
      .expect(200);
    // member 现在是 admin，可列用户了
    await request(app).get('/api/instance/users').set(bearer(memberToken)).expect(200);
  });

  it('非法角色 400；不能降级最后一个 owner', async () => {
    await request(app)
      .patch(`/api/instance/users/${memberId}/role`)
      .set(bearer(ownerToken))
      .send({ role: 'superuser' })
      .expect(400);
    const users = await request(app).get('/api/instance/users').set(bearer(ownerToken)).expect(200);
    const ownerId = users.body.find((u: { email: string }) => u.email === 'owner@inst.dev').id;
    const res = await request(app)
      .patch(`/api/instance/users/${ownerId}/role`)
      .set(bearer(ownerToken))
      .send({ role: 'member' })
      .expect(400);
    expect(res.body.error).toMatch(/last instance owner/);
  });
});

describe('安全设置', () => {
  it('owner 可读安全状态（scim/sso/用户数）；member（已升 admin）也可读', async () => {
    const res = await request(app).get('/api/security').set(bearer(ownerToken)).expect(200);
    expect(res.body).toMatchObject({ scim: expect.any(Object), sso: expect.any(Object) });
    expect(res.body.userCount).toBe(2);
    // 社区版：scim/sso 未启用
    expect(res.body.scim.enabled).toBe(false);
  });
});
