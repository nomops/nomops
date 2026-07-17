import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/** 阶段五：tags CRUD + 工作流标签映射 + 运行统计累加 + /metrics 文本端点。 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'p5@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'p5@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.shutdown();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

const simpleFlow = (name: string) => ({
  name,
  nodes: [
    { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { ok: true } } },
  ],
  connections: { Start: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
});

describe('tags', () => {
  it('CRUD + 重名 409 + 工作流标签覆盖式设置 + workflows-meta 聚合', async () => {
    const prod = await request(app).post('/api/tags').set(authed()).send({ name: 'production' }).expect(201);
    await request(app).post('/api/tags').set(authed()).send({ name: 'Production' }).expect(409); // 大小写不敏感重名
    const beta = await request(app).post('/api/tags').set(authed()).send({ name: 'beta' }).expect(201);

    const list = await request(app).get('/api/tags').set(authed()).expect(200);
    expect(list.body.map((t: { name: string }) => t.name).sort()).toEqual(['beta', 'production']);

    const wf = await request(app).post('/api/workflows').set(authed()).send(simpleFlow('tagged-flow')).expect(201);
    await request(app)
      .put(`/api/workflows/${wf.body.id}/tags`)
      .set(authed())
      .send({ tagIds: [prod.body.id, beta.body.id] })
      .expect(200);

    // 不存在的 tag → 404
    await request(app)
      .put(`/api/workflows/${wf.body.id}/tags`)
      .set(authed())
      .send({ tagIds: ['ghost-tag-id'] })
      .expect(404);

    let meta = await request(app).get('/api/workflows-meta').set(authed()).expect(200);
    let mine = meta.body.find((m: { workflowId: string }) => m.workflowId === wf.body.id);
    expect(mine.tags.map((t: { name: string }) => t.name).sort()).toEqual(['beta', 'production']);

    // 覆盖式收窄为一个
    await request(app).put(`/api/workflows/${wf.body.id}/tags`).set(authed()).send({ tagIds: [beta.body.id] }).expect(200);
    meta = await request(app).get('/api/workflows-meta').set(authed()).expect(200);
    mine = meta.body.find((m: { workflowId: string }) => m.workflowId === wf.body.id);
    expect(mine.tags.map((t: { name: string }) => t.name)).toEqual(['beta']);

    // 删标签 → 映射连带清掉
    await request(app).delete(`/api/tags/${beta.body.id}`).set(authed()).expect(204);
    meta = await request(app).get('/api/workflows-meta').set(authed()).expect(200);
    mine = meta.body.find((m: { workflowId: string }) => m.workflowId === wf.body.id);
    expect(mine.tags).toEqual([]);
  });
});

describe('workflow statistics', () => {
  it('手动运行计 manualRuns；webhook 生产运行计 productionSuccess', async () => {
    const wf = await request(app).post('/api/workflows').set(authed()).send(simpleFlow('stats-flow')).expect(201);
    await request(app).post(`/api/workflows/${wf.body.id}/run`).set(authed()).send({}).expect(200);
    await request(app).post(`/api/workflows/${wf.body.id}/run`).set(authed()).send({}).expect(200);

    // webhook 生产路径
    const hookFlow = {
      name: 'stats-hook',
      nodes: [
        { id: 'a', name: 'Hook', type: 'nomops.webhook', typeVersion: 1, position: [0, 0], parameters: { path: 'stats-hook', method: 'POST' } },
        { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { ok: true } } },
      ],
      connections: { Hook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
    };
    const hook = await request(app).post('/api/workflows').set(authed()).send(hookFlow).expect(201);
    await request(app).post(`/api/workflows/${hook.body.id}/activate`).set(authed()).send({ active: true }).expect(200);
    await request(app).post('/webhook/stats-hook').send({ x: 1 }).expect(200);
    await new Promise((r) => setTimeout(r, 100)); // fire-and-forget 累加落库

    const meta = await request(app).get('/api/workflows-meta').set(authed()).expect(200);
    const manual = meta.body.find((m: { workflowId: string }) => m.workflowId === wf.body.id);
    const prod = meta.body.find((m: { workflowId: string }) => m.workflowId === hook.body.id);
    expect(manual.statistics.manualRuns).toBe(2);
    expect(manual.statistics.productionSuccess).toBe(0);
    expect(prod.statistics.productionSuccess).toBe(1);
    expect(prod.statistics.lastRunAt).toBeTruthy();

    await request(app).post(`/api/workflows/${hook.body.id}/activate`).set(authed()).send({ active: false }).expect(200);
  });
});

describe('/metrics', () => {
  it('Prometheus 文本格式：执行分状态 + 工作流/用户计数', async () => {
    const res = await request(app).get('/metrics').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('nomops_executions_total{status="success"}');
    expect(res.text).toMatch(/nomops_workflows_total \d+/);
    expect(res.text).toMatch(/nomops_users_total \d+/);
    expect(res.text).toMatch(/nomops_process_uptime_seconds \d+/);
    // 绝不出现敏感串
    expect(res.text).not.toMatch(/password|apiKey|secret/i);
  });
});
