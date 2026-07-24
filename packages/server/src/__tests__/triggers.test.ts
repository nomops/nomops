import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
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
  // #38：调度器轮询拉大,测试手动 tick（避免自动 loop 干扰断言）
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, scheduler: { pollMs: 3_600_000, instanceId: 'trig' } });
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

describe('Cron/Schedule 触发（验收项，#38 迁到 DB 调度器）', () => {
  it('激活建 job → 到期 tick 触发,停用后不再触发', async () => {
    const id = await createWorkflow({
      name: 'cron-flow',
      nodes: [
        { id: 'a', name: 'Timer', type: 'nomops.schedule', typeVersion: 1, position: [0, 0], parameters: { mode: 'interval', intervalSeconds: 60 } },
        { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { via: 'cron' } } },
      ],
      connections: { Timer: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
    });

    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);
    const runs = () =>
      request(app)
        .get('/api/executions')
        .set(authed())
        .expect(200)
        .then((r) => (r.body as Array<{ workflowId: string; mode: string }>).filter((e) => e.workflowId === id && e.mode === 'trigger').length);

    // 拨到过期 → tick 触发一次
    const job = await boot.services.repos.scheduler.findJobByNode(id, 'Timer');
    await boot.services.repos.scheduler.updateJob(job!.id, { nextRunAt: new Date(Date.now() - 1000) });
    await boot.scheduler.tick();
    expect(await runs()).toBe(1);

    // 停用 → job.active=false → 再拨过期 + tick 也不触发
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: false }).expect(200);
    await boot.services.repos.scheduler.updateJob(job!.id, { nextRunAt: new Date(Date.now() - 1000) });
    await boot.scheduler.tick();
    expect(await runs()).toBe(1); // 未增长
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

describe('DB 调度器（验收项：双实例同一 cron 只触发一次，#38）', () => {
  it('两实例并发 tick 同一到期作业只触发一次（租约乐观锁）', async () => {
    const { SchedulerService } = await import('../services/scheduler-service.js');
    const repos = boot.services.repos;

    // 直接建一条到期作业（不经工作流,聚焦调度器去重）
    const job = await repos.scheduler.createJob({
      kind: 'workflow-schedule',
      workflowId: null,
      nodeName: null,
      config: { mode: 'interval', everySeconds: 60 },
      nextRunAt: new Date('2026-01-01T00:00:00Z'),
      maxAttempts: 1,
    });

    let fires = 0;
    const now = () => new Date('2026-01-01T00:00:05Z');
    const mk = (id: string) => new SchedulerService(repos, async () => { fires += 1; return `e-${id}`; }, { now, instanceId: id });
    const a = mk('A');
    const b = mk('B');
    const [ra, rb] = [await a.tick(), await b.tick()];

    expect(fires).toBe(1); // 双实例只触发一次
    expect(ra.fired + rb.fired).toBe(1);
    // 作业 nextRunAt 已推进
    const after = await repos.scheduler.findJobById(job.id);
    expect(after!.nextRunAt).toEqual(new Date('2026-01-01T00:01:00Z'));
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
