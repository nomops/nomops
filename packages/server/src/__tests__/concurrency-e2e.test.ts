import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { setupOwner } from './helpers.js';

/**
 * 并发闸门在真实 webhook 路径上的端到端行为（B7）。
 *
 * 单测证明了闸门本身的语义，这里证明它**真的接在生产入口上**——
 * 不然又是一个「实现了但没人调用」。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;

/** 每次执行 sleep 120ms 的工作流，好让并发窗口可观测。 */
const slowFlow = (path: string) => ({
  name: `slow-${path}`,
  nodes: [
    {
      id: 'a',
      name: 'Hook',
      type: 'nomops.webhook',
      typeVersion: 1,
      position: [0, 0] as [number, number],
      parameters: { path, method: 'POST' },
    },
    {
      id: 'b',
      name: 'Slow',
      type: 'nomops.code',
      typeVersion: 1,
      position: [200, 0] as [number, number],
      parameters: { code: 'await new Promise(r => setTimeout(r, 120)); return items;' },
    },
  ],
  connections: { Hook: { main: [[{ node: 'Slow', type: 'main', index: 0 }]] } },
});

beforeAll(async () => {
  boot = await bootstrap({
    dbConfig: { type: 'sqlite' },
    concurrencyLimit: 2, // 卡到 2，好观测排队
  });
  app = createApp(boot.services);
  token = (await setupOwner(app, 'owner@conc.dev')).token;

  const created = await request(app)
    .post('/api/workflows')
    .set({ Authorization: `Bearer ${token}` })
    .send(slowFlow('conc-hook'))
    .expect(201);
  await request(app)
    .post(`/api/workflows/${created.body.id}/activate`)
    .set({ Authorization: `Bearer ${token}` })
    .send({ active: true })
    .expect(200);
});

afterAll(async () => {
  await boot.shutdown();
});

describe('webhook 洪峰', () => {
  it('★并发峰值不超过上限，且一个执行都不丢', async () => {
    const stats: Array<{ active: number; waiting: number }> = [];
    const sampler = setInterval(() => stats.push(boot.services.executions.concurrencyStats()), 15);

    // 同时打 6 发，上限是 2
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => request(app).post('/webhook/conc-hook').send({ x: 1 })),
    );
    clearInterval(sampler);

    // 全部成功返回——排队不是拒绝
    for (const res of responses) expect(res.status).toBe(200);

    const peak = Math.max(...stats.map((s) => s.active));
    expect(peak).toBeLessThanOrEqual(2);
    // 确实排过队（否则这个用例什么都没证明）
    expect(Math.max(...stats.map((s) => s.waiting))).toBeGreaterThan(0);
  });

  it('洪峰过后槽位全部归还（无泄漏）', () => {
    expect(boot.services.executions.concurrencyStats()).toMatchObject({
      active: 0,
      waiting: 0,
      enabled: true,
    });
  });
});

describe('关闭闸门时零回归', () => {
  it('-1 = 不限：不计数、不排队，行为与 B7 之前一致', async () => {
    const off = await bootstrap({ dbConfig: { type: 'sqlite' }, concurrencyLimit: -1 });
    try {
      const offApp = createApp(off.services);
      const offToken = (await setupOwner(offApp, 'owner@nolimit.dev')).token;
      const created = await request(offApp)
        .post('/api/workflows')
        .set({ Authorization: `Bearer ${offToken}` })
        .send(slowFlow('nolimit-hook'))
        .expect(201);
      await request(offApp)
        .post(`/api/workflows/${created.body.id}/activate`)
        .set({ Authorization: `Bearer ${offToken}` })
        .send({ active: true })
        .expect(200);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => request(offApp).post('/webhook/nolimit-hook').send({})),
      );
      for (const res of responses) expect(res.status).toBe(200);
      expect(off.services.executions.concurrencyStats()).toMatchObject({
        enabled: false,
        active: 0,
        waiting: 0,
      });
    } finally {
      await off.shutdown();
    }
  });
});
