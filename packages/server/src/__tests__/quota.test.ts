import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser, setupOwner, licensedBoot } from './helpers.js';

/** Phase 6c（docs/08）验收：执行配额网关 + 套餐 + 用量。 */

const simpleWorkflow = (name: string) => ({
  name,
  nodes: [
    { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { x: 1 } } },
  ],
  connections: { Start: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
});

const webhookWorkflow = (path: string) => ({
  name: `wh-${path}`,
  nodes: [
    { id: 'a', name: 'Hook', type: 'nomops.webhook', typeVersion: 1, position: [0, 0], parameters: { path, method: 'POST' } },
  ],
  connections: {},
});

describe('企业版配额', () => {
  let boot: BootstrapResult;
  let app: Express;
  let adminToken: string; // 第一个用户 = 实例 owner
  let projectId: string;
  let workflowId: string;

  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  beforeAll(async () => {
    boot = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot() });
    await boot.leader.start();
    app = createApp(boot.services);
    const owner = await setupOwner(app, 'quota-admin@corp.dev');
    adminToken = owner.token;
    projectId = owner.projectId;
    const wf = await request(app).post('/api/workflows').set(admin()).send(simpleWorkflow('q-flow')).expect(201);
    workflowId = wf.body.id;
  });

  afterAll(async () => {
    await boot.shutdown();
  });

  it('默认 unlimited：未派发套餐前执行不受限，usage 可查', async () => {
    await request(app).post(`/api/workflows/${workflowId}/run`).set(admin()).send({}).expect(200);
    const usage = await request(app).get(`/api/projects/${projectId}/usage`).set(admin()).expect(200);
    expect(usage.body.plan).toBe('unlimited');
    expect(usage.body.limit).toBeNull();
    expect(usage.body.used).toBe(1);
    expect(usage.body.period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('派发 custom 上限 3 → 第 3 次成功、第 4 次 429 带 quota 详情（验收项）', async () => {
    const set = await request(app)
      .put(`/api/projects/${projectId}/quota`)
      .set(admin())
      .send({ plan: 'custom', monthlyExecutions: 3 })
      .expect(200);
    expect(set.body.plan).toBe('custom');
    expect(set.body.limit).toBe(3);

    // 已用 1 次，再跑 2 次到上限
    await request(app).post(`/api/workflows/${workflowId}/run`).set(admin()).send({}).expect(200);
    await request(app).post(`/api/workflows/${workflowId}/run`).set(admin()).send({}).expect(200);

    const denied = await request(app).post(`/api/workflows/${workflowId}/run`).set(admin()).send({}).expect(429);
    expect(denied.body.error).toMatch(/quota exhausted/);
    expect(denied.body.context.quota).toMatchObject({ used: 3, limit: 3, plan: 'custom' });

    // 超额未计数、未建执行行
    const usage = await request(app).get(`/api/projects/${projectId}/usage`).set(admin()).expect(200);
    expect(usage.body.used).toBe(3);
    const executions = await request(app).get('/api/executions').set(admin()).expect(200);
    expect(executions.body).toHaveLength(3);
  });

  it('webhook 超额 → 429；cron 超额 → 静默跳过无新执行行（验收项）', async () => {
    // webhook（配额已满）
    const wh = await request(app).post('/api/workflows').set(admin()).send(webhookWorkflow('q-hook')).expect(201);
    await request(app).post(`/api/workflows/${wh.body.id}/activate`).set(admin()).send({ active: true }).expect(200);
    await request(app).post('/webhook/q-hook').send({}).expect(429);

    // cron（配额已满）：激活跑一会儿，无新执行行
    const cron = await request(app)
      .post('/api/workflows')
      .set(admin())
      .send({
        name: 'q-cron',
        nodes: [
          { id: 'a', name: 'Timer', type: 'nomops.schedule', typeVersion: 1, position: [0, 0], parameters: { mode: 'interval', intervalSeconds: 0.05 } },
        ],
        connections: {},
      })
      .expect(201);
    await request(app).post(`/api/workflows/${cron.body.id}/activate`).set(admin()).send({ active: true }).expect(200);
    await new Promise((r) => setTimeout(r, 200));
    await request(app).post(`/api/workflows/${cron.body.id}/activate`).set(admin()).send({ active: false }).expect(200);

    const executions = await request(app).get('/api/executions').set(admin()).expect(200);
    expect(executions.body).toHaveLength(3); // 仍是 3，没有新行
    const usage = await request(app).get(`/api/projects/${projectId}/usage`).set(admin()).expect(200);
    expect(usage.body.used).toBe(3);
  });

  it('改派 unlimited 后立刻放行；失败执行也计数（验收项）', async () => {
    await request(app)
      .put(`/api/projects/${projectId}/quota`)
      .set(admin())
      .send({ plan: 'unlimited' })
      .expect(200);
    await request(app).post(`/api/workflows/${workflowId}/run`).set(admin()).send({}).expect(200);

    // 失败执行（Code 节点抛错）也计数
    const bad = await request(app)
      .post('/api/workflows')
      .set(admin())
      .send({
        name: 'q-fail',
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Boom', type: 'nomops.code', typeVersion: 1, position: [200, 0], parameters: { code: 'null.x; return items;' } },
        ],
        connections: { Start: { main: [[{ node: 'Boom', type: 'main', index: 0 }]] } },
      })
      .expect(201);
    const before = (await request(app).get(`/api/projects/${projectId}/usage`).set(admin()).expect(200)).body.used;
    const run = await request(app).post(`/api/workflows/${bad.body.id}/run`).set(admin()).send({}).expect(200);
    expect(run.body.status).toBe('error');
    const after = (await request(app).get(`/api/projects/${projectId}/usage`).set(admin()).expect(200)).body.used;
    expect(after).toBe(before + 1);
  });

  it('free 套餐解析为 100 上限；不同 project 计数独立', async () => {
    const res = await request(app)
      .put(`/api/projects/${projectId}/quota`)
      .set(admin())
      .send({ plan: 'free' })
      .expect(200);
    expect(res.body.limit).toBe(100);

    // 另一个用户/项目不受影响（经 owner 邀请加入）
    const other = await inviteUser(app, adminToken, 'other@corp.dev');
    const otherWf = await request(app)
      .post('/api/workflows')
      .set({ Authorization: `Bearer ${other.token}` })
      .send(simpleWorkflow('other-flow'))
      .expect(201);
    await request(app)
      .post(`/api/workflows/${otherWf.body.id}/run`)
      .set({ Authorization: `Bearer ${other.token}` })
      .send({})
      .expect(200);
    const otherUsage = await request(app)
      .get(`/api/projects/${other.projectId}/usage`)
      .set({ Authorization: `Bearer ${other.token}` })
      .expect(200);
    expect(otherUsage.body).toMatchObject({ used: 1, plan: 'unlimited' });

    // usage 是 owner 专属：other 查不了别人项目
    await request(app)
      .get(`/api/projects/${projectId}/usage`)
      .set({ Authorization: `Bearer ${other.token}` })
      .expect(403);
    // quota 派发是实例 admin 专属：other（member）403
    await request(app)
      .put(`/api/projects/${other.projectId}/quota`)
      .set({ Authorization: `Bearer ${other.token}` })
      .send({ plan: 'free' })
      .expect(403);
  });

  it('custom 缺 monthlyExecutions → 400（Zod refine）', async () => {
    await request(app)
      .put(`/api/projects/${projectId}/quota`)
      .set(admin())
      .send({ plan: 'custom' })
      .expect(400);
  });
});

describe('社区版：不设限但照常计数', () => {
  let boot: BootstrapResult;
  let app: Express;
  let token: string;
  let projectId: string;

  beforeAll(async () => {
    boot = await bootstrap({ dbConfig: { type: 'sqlite' }, licenseKey: null });
    app = createApp(boot.services);
    const owner = await setupOwner(app, 'comm@dev.dev');
    token = owner.token;
    projectId = owner.projectId;
  });

  afterAll(async () => {
    await boot.shutdown();
  });

  it('quota 管理 API 403 带 feature；即便库里有限额也不强制；usage 照常计数', async () => {
    const denied = await request(app)
      .put(`/api/projects/${projectId}/quota`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ plan: 'free' })
      .expect(403);
    expect(denied.body.feature).toBe('quotas');

    // 直接写库设上限 1 —— 社区版也不强制
    await boot.services.repos.quotas.upsertQuota(projectId, 'custom', 1);
    const wf = await request(app)
      .post('/api/workflows')
      .set({ Authorization: `Bearer ${token}` })
      .send(simpleWorkflow('c-flow'))
      .expect(201);
    await request(app).post(`/api/workflows/${wf.body.id}/run`).set({ Authorization: `Bearer ${token}` }).send({}).expect(200);
    await request(app).post(`/api/workflows/${wf.body.id}/run`).set({ Authorization: `Bearer ${token}` }).send({}).expect(200);

    // usage（owner 可查，无需企业版）照常计数
    const usage = await request(app)
      .get(`/api/projects/${projectId}/usage`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(usage.body.used).toBe(2);
  });
});
