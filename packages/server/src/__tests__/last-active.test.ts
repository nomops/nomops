import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * Last Active（backlog #30 / D146）：鉴权请求打点 lastActiveAt（60s 节流）,
 * instance/users 暴露给 admin;pending 邀请无活跃时刻。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  const reg = await request(app).post('/auth/register').send({ email: 'owner@la.dev', password: 'password-123' }).expect(201);
  token = reg.body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

describe('Last Active', () => {
  it('鉴权请求后 lastActiveAt 被写入并出现在 instance/users', async () => {
    // 打一个鉴权请求触发打点
    await request(app).get('/api/workflows').set(authed()).expect(200);
    // 打点是 fire-and-forget,给它落定
    await new Promise((r) => setTimeout(r, 40));

    const users = await request(app).get('/api/instance/users').set(authed()).expect(200);
    const me = (users.body as Array<{ email: string; lastActiveAt: string | null; pending: boolean }>).find(
      (u) => u.email === 'owner@la.dev',
    );
    expect(me).toBeTruthy();
    expect(me!.lastActiveAt).toBeTruthy();
    expect(Date.now() - new Date(me!.lastActiveAt!).getTime()).toBeLessThan(10_000);
  });

  it('60s 节流:同一用户短时间多次请求只写一次 DB', async () => {
    const invoked: number[] = [];
    const orig = boot.services.repos.users.touchLastActive.bind(boot.services.repos.users);
    // 直接验节流语义:连打两次,第二次落在 60s 窗口内 → 不再更新时间戳
    await orig('owner@la.dev-nonexistent-check', 1_000_000_000); // 先占一个 key 的窗口
    const before = await boot.services.repos.users.findByEmail('owner@la.dev');
    const t0 = before!.lastActiveAt!.getTime();
    // 立刻再打点(默认 now)——距上次 touch <60s → 不写
    await boot.services.repos.users.touchLastActive(before!.id);
    const after = await boot.services.repos.users.findByEmail('owner@la.dev');
    expect(after!.lastActiveAt!.getTime()).toBe(t0);
    void invoked;
  });

  it('pending 邀请 lastActiveAt 为 null', async () => {
    const inv = await request(app)
      .post('/api/instance/users/invite')
      .set(authed())
      .send({ email: 'pending@la.dev', role: 'member' })
      .expect(201);
    void inv;
    const users = await request(app).get('/api/instance/users').set(authed()).expect(200);
    const pending = (users.body as Array<{ email: string; lastActiveAt: string | null; pending: boolean }>).find(
      (u) => u.email === 'pending@la.dev',
    );
    expect(pending!.pending).toBe(true);
    expect(pending!.lastActiveAt).toBeNull();
  });
});
