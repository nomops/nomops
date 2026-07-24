import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #39a：Insights 预聚合管线 —— 删执行后 Insights 数字不变；跨项目聚合可用。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

const wf = {
  name: 'insights-wf',
  nodes: [{ id: 't', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
  connections: {},
};

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'ins@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'ins@test.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('Insights 预聚合管线（backlog #39a）', () => {
  it('执行后 Insights 计入；删执行后数字不变（与 executions 解耦）', async () => {
    const w = (await request(app).post('/api/workflows').set(authed()).send(wf).expect(201)).body;
    const run = await request(app).post(`/api/workflows/${w.id}/run`).set(authed()).send({}).expect(200);
    const execId = run.body.executionId;

    const before = (await request(app).get('/api/insights').set(authed()).expect(200)).body;
    expect(before.total).toBe(1);
    expect(before.success).toBe(1);

    // 删掉执行历史
    await request(app).delete(`/api/executions/${execId}`).set(authed()).expect(204);
    expect((await request(app).get('/api/executions').set(authed()).expect(200)).body.length).toBe(0);

    // Insights 数字不变（读 insights_raw,不受执行清理影响）
    const after = (await request(app).get('/api/insights').set(authed()).expect(200)).body;
    expect(after.total).toBe(1);
    expect(after.success).toBe(1);
  });

  it('跨项目聚合（scope=all，实例 admin）汇总各项目', async () => {
    // 再跑一个,总数应 ≥ 2；scope=all owner 可读
    const w2 = (await request(app).post('/api/workflows').set(authed()).send(wf).expect(201)).body;
    await request(app).post(`/api/workflows/${w2.id}/run`).set(authed()).send({}).expect(200);

    const all = (await request(app).get('/api/insights?scope=all').set(authed()).expect(200)).body;
    expect(all.total).toBeGreaterThanOrEqual(2);
  });
});
