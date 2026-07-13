import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { setupOwner } from './helpers.js';

/**
 * 用户邀请（对标 n8n 自托管）：首个用户 = owner，公开注册此后关闭；owner/admin 邀请 →
 * 邀请链接 → 接受时才建 users 行。存 token 哈希（铁律 3），一次性消费。
 */

let boot: BootstrapResult;
let app: Express;
let ownerToken: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
/** 从邀请响应里取出明文 token。 */
const tokenOf = (inviteLink: string) => new URL(inviteLink).searchParams.get('invite')!;

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  ownerToken = (await setupOwner(app, 'owner@inv.dev')).token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('公开注册在 owner 后关闭', () => {
  it('第二次 /auth/register → 403', async () => {
    await request(app).post('/auth/register').send({ email: 'x@inv.dev', password: 'password-123' }).expect(403);
  });
});

describe('邀请权限', () => {
  it('member 不能邀请（403）', async () => {
    // 先经 owner 邀一个 member 出来
    const inv = await request(app).post('/api/instance/users/invite').set(bearer(ownerToken)).send({ email: 'm1@inv.dev' }).expect(201);
    const memberToken = (await request(app).post(`/auth/invite/${tokenOf(inv.body.inviteLink)}/accept`).send({ password: 'password-123' }).expect(201)).body.token;
    await request(app).post('/api/instance/users/invite').set(bearer(memberToken)).send({ email: 'nope@inv.dev' }).expect(403);
  });
});

describe('邀请 → 查看 → 接受 → 消费', () => {
  let link: string;
  let token: string;

  it('owner 邀请 → 201 带邀请链接；用户列表里显示为 pending', async () => {
    const res = await request(app).post('/api/instance/users/invite').set(bearer(ownerToken)).send({ email: 'invitee@inv.dev', role: 'admin' }).expect(201);
    expect(res.body.email).toBe('invitee@inv.dev');
    expect(res.body.role).toBe('admin');
    expect(typeof res.body.inviteLink).toBe('string');
    link = res.body.inviteLink;
    token = tokenOf(link);
    const users = await request(app).get('/api/instance/users').set(bearer(ownerToken)).expect(200);
    const pending = users.body.find((u: { email: string }) => u.email === 'invitee@inv.dev');
    expect(pending.pending).toBe(true);
    expect(pending.role).toBe('admin');
  });

  it('接受页预填：GET /auth/invite/:token → 邮箱 + 角色；未知 token → 404', async () => {
    const info = await request(app).get(`/auth/invite/${token}`).expect(200);
    expect(info.body).toMatchObject({ email: 'invitee@inv.dev', role: 'admin' });
    await request(app).get('/auth/invite/bogus-token').expect(404);
  });

  it('接受 → 201 建用户(带邀请角色)并直接登录；token 一次性', async () => {
    const accepted = await request(app).post(`/auth/invite/${token}/accept`).send({ password: 'password-123', firstName: 'Ivy' }).expect(201);
    expect(accepted.body.token).toBeTruthy();
    expect(accepted.body.user.email).toBe('invitee@inv.dev');
    // 已成真实用户：能登录、角色为 admin、列表里不再 pending
    const login = await request(app).post('/auth/login').send({ email: 'invitee@inv.dev', password: 'password-123' }).expect(200);
    expect(login.body.token).toBeTruthy();
    const users = await request(app).get('/api/instance/users').set(bearer(ownerToken)).expect(200);
    const row = users.body.find((u: { email: string }) => u.email === 'invitee@inv.dev');
    expect(row.pending).toBe(false);
    expect(row.role).toBe('admin');
    // token 已消费：再接受 → 400
    await request(app).post(`/auth/invite/${token}/accept`).send({ password: 'password-123' }).expect(400);
  });
});

describe('边界', () => {
  it('邀请已存在用户 → 409', async () => {
    await request(app).post('/api/instance/users/invite').set(bearer(ownerToken)).send({ email: 'owner@inv.dev' }).expect(409);
  });

  it('重复邀请同一邮箱 → 旧 token 失效（换发）', async () => {
    const first = await request(app).post('/api/instance/users/invite').set(bearer(ownerToken)).send({ email: 're@inv.dev' }).expect(201);
    const firstToken = tokenOf(first.body.inviteLink);
    const second = await request(app).post('/api/instance/users/invite').set(bearer(ownerToken)).send({ email: 're@inv.dev' }).expect(201);
    const secondToken = tokenOf(second.body.inviteLink);
    expect(secondToken).not.toBe(firstToken);
    await request(app).get(`/auth/invite/${firstToken}`).expect(404); // 旧的失效
    await request(app).get(`/auth/invite/${secondToken}`).expect(200); // 新的有效
  });

  it('撤销待接受邀请（DELETE /instance/users/:id）→ 从列表移除', async () => {
    const inv = await request(app).post('/api/instance/users/invite').set(bearer(ownerToken)).send({ email: 'revoke@inv.dev' }).expect(201);
    const users = await request(app).get('/api/instance/users').set(bearer(ownerToken)).expect(200);
    const id = users.body.find((u: { email: string }) => u.email === 'revoke@inv.dev').id;
    await request(app).delete(`/api/instance/users/${id}`).set(bearer(ownerToken)).expect(200);
    const after = await request(app).get('/api/instance/users').set(bearer(ownerToken)).expect(200);
    expect(after.body.find((u: { email: string }) => u.email === 'revoke@inv.dev')).toBeUndefined();
    // 撤销后原 token 失效
    await request(app).get(`/auth/invite/${tokenOf(inv.body.inviteLink)}`).expect(404);
  });
});
