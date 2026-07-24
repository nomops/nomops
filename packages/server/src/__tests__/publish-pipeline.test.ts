import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #40a：发布史可回看 + 逐触发器激活状态（失败有状态与错误）。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

const webhookWf = (name: string, path: string) => ({
  name,
  nodes: [{ id: 'a', name: 'Hook', type: 'nomops.webhook', typeVersion: 1, position: [0, 0], parameters: { path, method: 'POST' } }],
  connections: {},
});

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  await boot.leader.start();
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'pub@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'pub@test.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('发布史（backlog #40a）', () => {
  it('发布 + 回滚都记事件史,可回看', async () => {
    const wf = (await request(app).post('/api/workflows').set(authed()).send(webhookWf('pub-1', 'p1')).expect(201)).body;
    await request(app).post(`/api/workflows/${wf.id}/publish`).set(authed()).expect(200);

    // 改一版再发布,产生两个版本
    await request(app).patch(`/api/workflows/${wf.id}`).set(authed()).send({ name: 'pub-1b' }).expect(200);
    await request(app).post(`/api/workflows/${wf.id}/publish`).set(authed()).expect(200);

    const versions = (await request(app).get(`/api/workflows/${wf.id}/versions`).set(authed()).expect(200)).body;
    // 回滚到第一个版本
    const first = versions[versions.length - 1];
    await request(app).post(`/api/workflows/${wf.id}/versions/${first.id}/restore`).set(authed()).expect(200);

    const history = (await request(app).get(`/api/workflows/${wf.id}/publish-history`).set(authed()).expect(200)).body as Array<{ action: string }>;
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history.some((h) => h.action === 'publish')).toBe(true);
    expect(history[0]!.action).toBe('rollback'); // 最新在前
  });
});

describe('逐触发器激活状态（backlog #40a）', () => {
  it('激活成功 → trigger-status active;停用 → 清空', async () => {
    const wf = (await request(app).post('/api/workflows').set(authed()).send(webhookWf('act-ok', 'ok-path')).expect(201)).body;
    await request(app).post(`/api/workflows/${wf.id}/activate`).set(authed()).send({ active: true }).expect(200);

    const st = (await request(app).get(`/api/workflows/${wf.id}/trigger-status`).set(authed()).expect(200)).body as Array<{ nodeName: string; status: string; triggerType: string }>;
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ nodeName: 'Hook', status: 'active', triggerType: 'webhook' });

    await request(app).post(`/api/workflows/${wf.id}/activate`).set(authed()).send({ active: false }).expect(200);
    expect((await request(app).get(`/api/workflows/${wf.id}/trigger-status`).set(authed()).expect(200)).body).toHaveLength(0);
  });

  it('激活失败(webhook 冲突) → 400 且 trigger-status 有 error', async () => {
    const a = (await request(app).post('/api/workflows').set(authed()).send(webhookWf('conf-a', 'shared')).expect(201)).body;
    const b = (await request(app).post('/api/workflows').set(authed()).send(webhookWf('conf-b', 'shared')).expect(201)).body;
    await request(app).post(`/api/workflows/${a.id}/activate`).set(authed()).send({ active: true }).expect(200);
    // b 用同一 path 激活 → 冲突 400
    await request(app).post(`/api/workflows/${b.id}/activate`).set(authed()).send({ active: true }).expect(400);

    const st = (await request(app).get(`/api/workflows/${b.id}/trigger-status`).set(authed()).expect(200)).body as Array<{ status: string; error: string | null }>;
    expect(st).toHaveLength(1);
    expect(st[0]!.status).toBe('error');
    expect(st[0]!.error).toMatch(/conflict/i);
  });
});
