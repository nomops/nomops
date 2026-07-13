import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { ActiveWorkflowManager } from '../triggers/active-workflow-manager.js';
import { InMemoryLockStore, LeaderElection } from '../queue/leader.js';

/** Phase 5 验收：Webhook 触发、Cron 触发、双实例下 cron 只触发一次。 */

let boot: BootstrapResult;
let app: Express;
let token: string;

const authed = () => ({ Authorization: `Bearer ${token}` });

async function createWorkflow(body: Record<string, unknown>): Promise<string> {
  const res = await request(app).post('/api/workflows').set(authed()).send(body).expect(201);
  return res.body.id as string;
}

const webhookWorkflow = (path: string) => ({
  name: `wh-${path}`,
  nodes: [
    { id: 'a', name: 'Hook', type: 'nomops.webhook', typeVersion: 1, position: [0, 0], parameters: { path, method: 'POST' } },
    { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { via: 'webhook' } } },
  ],
  connections: { Hook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
});

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  await boot.leader.start(); // regular 模式：内存锁，恒为 leader
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'trig@test.dev', password: 'password-123' });
  const login = await request(app).post('/auth/login').send({ email: 'trig@test.dev', password: 'password-123' });
  token = login.body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('Webhook 触发（验收项）', () => {
  it('激活后外部 POST 自动触发执行；停用后 404', async () => {
    const id = await createWorkflow(webhookWorkflow('order-hook'));

    // 未激活 → 404
    await request(app).post('/webhook/order-hook').send({ amount: 9 }).expect(404);

    // 激活 → 写路由表
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);

    // 外部请求触发，payload 进入种子数据
    const hit = await request(app).post('/webhook/order-hook').send({ amount: 42 }).expect(200);
    expect(hit.body.status).toBe('success');

    const detail = await request(app)
      .get(`/api/executions/${hit.body.executionId}`)
      .set(authed())
      .expect(200);
    expect(detail.body.execution.mode).toBe('webhook');
    const hookOut = detail.body.data.resultData.runData['Hook'][0].data.main[0][0].json;
    expect(hookOut.body).toEqual({ amount: 42 });
    const setOut = detail.body.data.resultData.runData['Set'][0].data.main[0][0].json;
    expect(setOut.via).toBe('webhook');

    // 方法不匹配 → 404
    await request(app).get('/webhook/order-hook').expect(404);

    // 停用 → 路由消失
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: false }).expect(200);
    await request(app).post('/webhook/order-hook').send({}).expect(404);
  });

  it('webhook path 冲突 → 激活失败 400（activationError）', async () => {
    const first = await createWorkflow(webhookWorkflow('dup-path'));
    const second = await createWorkflow({ ...webhookWorkflow('dup-path'), name: 'wh-dup-2' });

    await request(app).post(`/api/workflows/${first}/activate`).set(authed()).send({ active: true }).expect(200);
    const conflict = await request(app)
      .post(`/api/workflows/${second}/activate`)
      .set(authed())
      .send({ active: true })
      .expect(400);
    expect(conflict.body.error).toMatch(/conflict/);

    await request(app).post(`/api/workflows/${first}/activate`).set(authed()).send({ active: false });
  });
});

describe('Cron/Schedule 触发（验收项）', () => {
  it('激活后按间隔自动触发，停用后停止', async () => {
    const id = await createWorkflow({
      name: 'cron-flow',
      nodes: [
        { id: 'a', name: 'Timer', type: 'nomops.schedule', typeVersion: 1, position: [0, 0], parameters: { mode: 'interval', intervalSeconds: 0.05 } },
        { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { via: 'cron' } } },
      ],
      connections: { Timer: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
    });

    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);
    await new Promise((r) => setTimeout(r, 250)); // 等几个 tick
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: false }).expect(200);

    const executions = await request(app).get('/api/executions').set(authed()).expect(200);
    const cronRuns = executions.body.filter(
      (e: { workflowId: string; mode: string }) => e.workflowId === id && e.mode === 'trigger',
    );
    expect(cronRuns.length).toBeGreaterThanOrEqual(2); // 250ms / 50ms ≥ 2 次

    // 停用后不再增长
    const before = cronRuns.length;
    await new Promise((r) => setTimeout(r, 200));
    const after = (await request(app).get('/api/executions').set(authed()).expect(200)).body.filter(
      (e: { workflowId: string; mode: string }) => e.workflowId === id && e.mode === 'trigger',
    ).length;
    expect(after).toBe(before);
  });

  it('无效 cron 表达式激活报错', async () => {
    const id = await createWorkflow({
      name: 'bad-cron',
      nodes: [
        { id: 'a', name: 'Timer', type: 'nomops.schedule', typeVersion: 1, position: [0, 0], parameters: { mode: 'cron', cronExpression: 'not-a-cron' } },
      ],
      connections: {},
    });
    const res = await request(app)
      .post(`/api/workflows/${id}/activate`)
      .set(authed())
      .send({ active: true })
      .expect(400);
    expect(res.body.error).toMatch(/Invalid cron expression/);
  });
});

describe('Leader 选举（验收项：双实例 cron 只触发一次）', () => {
  it('共享锁下只有一个实例成为 leader，只有 leader 起定时器', async () => {
    const store = new InMemoryLockStore();
    const electionA = new LeaderElection(store);
    const electionB = new LeaderElection(store);
    await electionA.start();
    await electionB.start();
    expect(electionA.isLeader()).toBe(true);
    expect(electionB.isLeader()).toBe(false);

    // 两个 AWM 模拟两个进程，各自查询自己的 leader 状态
    let fires = 0;
    const fakeExecutions = {
      runTriggered: async () => {
        fires += 1;
        return { executionId: 'x', status: 'success' as const };
      },
    };
    const row = {
      id: 'wf-1',
      name: 'cron',
      active: true,
      nodes: [
        { id: 'a', name: 'Timer', type: 'nomops.schedule', typeVersion: 1, position: [0, 0] as [number, number], parameters: { mode: 'interval', intervalSeconds: 0.05 } },
      ],
      connections: {},
      settings: null,
      staticData: null,
      versionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const awmA = new ActiveWorkflowManager(
      boot.services.repos,
      boot.services.nodeLoader,
      fakeExecutions as never,
      () => electionA.isLeader(),
    );
    const awmB = new ActiveWorkflowManager(
      boot.services.repos,
      boot.services.nodeLoader,
      fakeExecutions as never,
      () => electionB.isLeader(),
    );

    await awmA.add(row as never);
    await awmB.add(row as never);
    await new Promise((r) => setTimeout(r, 180));
    await awmA.shutdown();
    await awmB.shutdown();
    await electionA.stop();
    await electionB.stop();

    // 双实例 250ms 内若都跑，fires 会翻倍（≥6）；只有 leader 跑则 ~3
    expect(fires).toBeGreaterThanOrEqual(2);
    expect(fires).toBeLessThanOrEqual(4);
  });

  it('leader 退出后另一实例接任', async () => {
    const store = new InMemoryLockStore();
    const a = new LeaderElection(store);
    const b = new LeaderElection(store);
    await a.start();
    await b.start();
    expect(a.isLeader()).toBe(true);
    await a.stop(); // 释放锁
    // b 下一次 tick 才接任——直接手动触发一次竞选
    await (b as unknown as { tick(): Promise<void> }).tick();
    expect(b.isLeader()).toBe(true);
    await b.stop();
  });
});

describe('License 骨架', () => {
  it('无 key 返回 community', async () => {
    const res = await request(app).get('/api/license').set(authed()).expect(200);
    expect(res.body.plan).toBe('community');
  });
});
