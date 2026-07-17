import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * Wait 节点 + wait/resume 全链路：
 * - afterDelay：手动运行挂起为 waiting → wait-tracker 到点唤醒 → 下游继续；
 * - onSignal：无限期挂起 → POST /api/executions/:id/resume 唤醒；
 * - 非 waiting 状态 resume → 409。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite', waitTrackerIntervalMs: 60_000 } as never);
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'wait@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'wait@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.shutdown();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

const waitFlow = (name: string, resume: string, amountMs = 50) => ({
  name,
  nodes: [
    { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    {
      id: 'b',
      name: 'Pause',
      type: 'nomops.wait',
      typeVersion: 1,
      position: [200, 0],
      parameters: resume === 'afterDelay' ? { resume, amount: amountMs / 1000, unit: 'seconds' } : { resume },
    },
    { id: 'c', name: 'After', type: 'nomops.set', typeVersion: 1, position: [400, 0], parameters: { fields: { woke: true } } },
  ],
  connections: {
    Start: { main: [[{ node: 'Pause', type: 'main', index: 0 }]] },
    Pause: { main: [[{ node: 'After', type: 'main', index: 0 }]] },
  },
});

async function statusOf(executionId: string): Promise<{ status: string; runData: Record<string, unknown> }> {
  const res = await request(app).get(`/api/executions/${executionId}`).set(authed()).expect(200);
  return { status: res.body.execution.status, runData: res.body.data?.resultData?.runData ?? {} };
}

describe('wait/resume', () => {
  it('afterDelay：挂起为 waiting，wait-tracker 到点唤醒后下游继续', async () => {
    const created = await request(app).post('/api/workflows').set(authed()).send(waitFlow('wait-delay', 'afterDelay', 50)).expect(201);

    const run = await request(app).post(`/api/workflows/${created.body.id}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('waiting');

    let snap = await statusOf(run.body.executionId as string);
    expect(snap.status).toBe('waiting');
    expect(snap.runData['After']).toBeUndefined();

    // 等过唤醒时刻后手动驱动一轮 tick（测试不等真实定时器）
    await new Promise((r) => setTimeout(r, 80));
    await boot.services.waitTracker.tick();

    snap = await statusOf(run.body.executionId as string);
    expect(snap.status).toBe('success');
    const after = (snap.runData['After'] as Array<{ data: { main: unknown[][] } }>)[0]!.data.main[0]![0] as {
      json: Record<string, unknown>;
    };
    expect(after.json['woke']).toBe(true);
  });

  it('onSignal：无限期挂起，resume API 唤醒；到点扫描不误伤', async () => {
    const created = await request(app).post('/api/workflows').set(authed()).send(waitFlow('wait-signal', 'onSignal')).expect(201);

    const run = await request(app).post(`/api/workflows/${created.body.id}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('waiting');

    // waitTill 为空 → tick 不应唤醒它
    await boot.services.waitTracker.tick();
    expect((await statusOf(run.body.executionId as string)).status).toBe('waiting');

    const resumed = await request(app).post(`/api/executions/${run.body.executionId}/resume`).set(authed()).send({}).expect(200);
    expect(resumed.body.status).toBe('success');
    expect((await statusOf(run.body.executionId as string)).status).toBe('success');

    // 已完成的执行再 resume → 409
    await request(app).post(`/api/executions/${run.body.executionId}/resume`).set(authed()).send({}).expect(409);
  });
});
