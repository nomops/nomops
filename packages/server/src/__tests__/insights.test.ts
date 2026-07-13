import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Execution } from '@nomops/db';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { computeInsights } from '../services/insights.js';

const now = new Date('2026-07-11T12:00:00.000Z');

function exec(status: string, opts: { started?: Date; stopped?: Date; created?: Date } = {}): Execution {
  return {
    id: Math.random().toString(36).slice(2),
    workflowId: 'w',
    status,
    mode: 'manual',
    startedAt: opts.started ?? null,
    stoppedAt: opts.stopped ?? null,
    createdAt: opts.created ?? now,
  } as Execution;
}

describe('computeInsights（纯聚合）', () => {
  it('计数、失败率、平均耗时、节省工时', () => {
    const rows = [
      exec('success', { started: new Date(now.getTime() - 1000), stopped: now }), // 1000ms
      exec('success', { started: new Date(now.getTime() - 3000), stopped: now }), // 3000ms
      exec('error'),
      exec('running'),
    ];
    const r = computeInsights(rows, now);
    expect(r.total).toBe(4);
    expect(r.success).toBe(2);
    expect(r.error).toBe(1);
    expect(r.running).toBe(1);
    expect(r.failureRate).toBeCloseTo(1 / 3); // error / (success+error)
    expect(r.avgRuntimeMs).toBe(2000);
    expect(r.estSavedMinutes).toBe(6); // 2 success × 3min
  });

  it('近 7 日趋势：7 个桶，含今天，按日期归集', () => {
    const yesterday = new Date(now.getTime() - 86_400_000);
    const rows = [
      exec('success', { created: now }),
      exec('error', { created: now }),
      exec('success', { created: yesterday }),
    ];
    const r = computeInsights(rows, now);
    expect(r.daily).toHaveLength(7);
    const today = r.daily[6]!;
    expect(today.total).toBe(2);
    expect(today.success).toBe(1);
    expect(today.error).toBe(1);
    expect(r.daily[5]!.success).toBe(1); // 昨天
  });

  it('空数据：失败率 0、平均耗时 0', () => {
    const r = computeInsights([], now);
    expect(r).toMatchObject({ total: 0, failureRate: 0, avgRuntimeMs: 0, estSavedMinutes: 0 });
    expect(r.daily).toHaveLength(7);
  });
});

describe('GET /api/insights（集成）', () => {
  let boot: BootstrapResult;
  let app: Express;
  let token: string;

  beforeAll(async () => {
    boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
    app = createApp(boot.services);
    const reg = await request(app)
      .post('/auth/register')
      .send({ email: 'ins@dev.dev', password: 'password-123' })
      .expect(201);
    token = reg.body.token;
    // 跑一个成功执行
    const wf = await request(app)
      .post('/api/workflows')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        name: 'ins-wf',
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { x: 1 } } },
        ],
        connections: { Start: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
      })
      .expect(201);
    await request(app).post(`/api/workflows/${wf.body.id}/run`).set({ Authorization: `Bearer ${token}` }).send({}).expect(200);
  });

  afterAll(async () => {
    await boot.shutdown();
  });

  it('返回当前 project 的聚合，含至少一次成功执行', async () => {
    const res = await request(app).get('/api/insights').set({ Authorization: `Bearer ${token}` }).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.success).toBeGreaterThanOrEqual(1);
    expect(res.body.daily).toHaveLength(7);
  });

  it('未登录 → 401', async () => {
    await request(app).get('/api/insights').expect(401);
  });
});
