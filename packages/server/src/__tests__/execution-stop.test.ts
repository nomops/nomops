import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * 执行停止（backlog #2）全链路：
 * - 停 waiting 执行 → canceled，wait-tracker 不再唤醒，resume 409；
 * - 停在跑执行 → 引擎节点边界收束 canceled，下游节点未执行；
 * - executeStored 前置守卫：已 canceled 的落库执行拒跑（队列排队被停的场景）；
 * - 已结束 409 / 不存在 404。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite', waitTrackerIntervalMs: 60_000 } as never);
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'stop@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'stop@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.shutdown();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

/** 忙等节点：Code 子进程空转 ms 毫秒（给 stop 留时间窗）。 */
const busyNode = (id: string, name: string, x: number, ms: number) => ({
  id,
  name,
  type: 'nomops.code',
  typeVersion: 1,
  position: [x, 0],
  parameters: { code: `const end = Date.now() + ${ms}; while (Date.now() < end) {} return items;` },
});

async function statusOf(executionId: string): Promise<{ status: string; runData: Record<string, unknown> }> {
  const res = await request(app).get(`/api/executions/${executionId}`).set(authed()).expect(200);
  return { status: res.body.execution.status, runData: res.body.data?.resultData?.runData ?? {} };
}

describe('执行停止', () => {
  it('停 waiting 执行 → canceled；tick 不唤醒；resume 409', async () => {
    const created = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({
        name: 'stop-waiting',
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Pause', type: 'nomops.wait', typeVersion: 1, position: [200, 0], parameters: { resume: 'onSignal' } },
          { id: 'c', name: 'After', type: 'nomops.set', typeVersion: 1, position: [400, 0], parameters: { fields: { woke: true } } },
        ],
        connections: {
          Start: { main: [[{ node: 'Pause', type: 'main', index: 0 }]] },
          Pause: { main: [[{ node: 'After', type: 'main', index: 0 }]] },
        },
      })
      .expect(201);

    const run = await request(app).post(`/api/workflows/${created.body.id}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('waiting');

    const stopped = await request(app).post(`/api/executions/${run.body.executionId}/stop`).set(authed()).send({}).expect(200);
    expect(stopped.body.status).toBe('canceled');
    expect((await statusOf(run.body.executionId as string)).status).toBe('canceled');

    // 已取消：定时唤醒不复活、resume 409、再停 409
    await boot.services.waitTracker.tick();
    expect((await statusOf(run.body.executionId as string)).status).toBe('canceled');
    await request(app).post(`/api/executions/${run.body.executionId}/resume`).set(authed()).send({}).expect(409);
    await request(app).post(`/api/executions/${run.body.executionId}/stop`).set(authed()).send({}).expect(409);
  });

  it('停在跑执行 → 引擎节点边界收束 canceled，下游未执行', async () => {
    const created = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({
        name: 'stop-running',
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          busyNode('b', 'Slow1', 200, 400),
          busyNode('c', 'Slow2', 400, 400),
          { id: 'd', name: 'Mark', type: 'nomops.set', typeVersion: 1, position: [600, 0], parameters: { fields: { done: true } } },
        ],
        connections: {
          Start: { main: [[{ node: 'Slow1', type: 'main', index: 0 }]] },
          Slow1: { main: [[{ node: 'Slow2', type: 'main', index: 0 }]] },
          Slow2: { main: [[{ node: 'Mark', type: 'main', index: 0 }]] },
        },
      })
      .expect(201);

    // 发起运行（.then 触发发送，不 await），轮询执行列表等它出现在跑
    // （手动运行路径不置 running，进行中状态为 new——注册表照样能停）
    const runPromise = request(app)
      .post(`/api/workflows/${created.body.id}/run`)
      .set(authed())
      .send({})
      .then((r) => r);
    let runningId: string | null = null;
    for (let i = 0; i < 200 && !runningId; i++) {
      const list = await request(app).get('/api/executions').set(authed()).expect(200);
      const row = (list.body as Array<{ id: string; status: string; workflowId: string }>).find(
        (e) => e.workflowId === created.body.id && (e.status === 'running' || e.status === 'new'),
      );
      if (row) runningId = row.id;
      else await new Promise((r) => setTimeout(r, 25));
    }
    expect(runningId).toBeTruthy();

    const stopped = await request(app).post(`/api/executions/${runningId}/stop`).set(authed()).send({}).expect(200);
    expect(stopped.body.status).toBe('canceled');

    const run = await runPromise;
    expect(run.status).toBe(200);
    expect(run.body.status).toBe('canceled');

    const snap = await statusOf(runningId!);
    expect(snap.status).toBe('canceled');
    expect(snap.runData['Mark']).toBeUndefined(); // 末端节点没跑到
  });

  it('executeStored 守卫：已 canceled 的落库执行拒跑（队列排队被停）', async () => {
    const created = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({
        name: 'stop-queued',
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Mark', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { done: true } } },
        ],
        connections: { Start: { main: [[{ node: 'Mark', type: 'main', index: 0 }]] } },
      })
      .expect(201);

    // 手工造一条排队中的执行行（模拟队列模式：入队后 worker 尚未消费）
    const row = await boot.services.repos.executions.create(
      { workflowId: created.body.id as string, status: 'new', mode: 'webhook', startedAt: new Date() },
      {
        workflowData: { name: 'stop-queued', nodes: [], connections: {} },
        data: { resultData: { runData: {} } },
      },
    );
    await boot.services.repos.executions.updateStatus(row.id, 'canceled', new Date());

    // worker 拿到后拒跑：状态保持 canceled，不会被改写成 success
    const run = await boot.services.executions.executeStored(row.id);
    expect(run.status).toBe('canceled');
    expect((await statusOf(row.id)).status).toBe('canceled');
  });

  it('不存在 → 404', async () => {
    await request(app).post('/api/executions/00000000-0000-0000-0000-000000000000/stop').set(authed()).send({}).expect(404);
  });
});
