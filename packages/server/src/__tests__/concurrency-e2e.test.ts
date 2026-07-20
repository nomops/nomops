import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { createServer, type Server } from 'node:http';
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

/**
 * ★慢工作流必须**真的慢**，而且不能堵住事件循环——否则并发根本无从观测。
 *
 * 走过弯路：最初用 Code 节点写 `await new Promise(r => setTimeout(r, 120))`，
 * 但 Code 节点是纯同步的（vm.runInContext 包在同步 IIFE 里，沙箱连 setTimeout
 * 都没有），那段代码是语法错误，执行**秒失败**。而 webhook 照样返回 200，
 * 于是测试一直是绿的，测的却是「闸门套在瞬间失败的执行上」。
 *
 * 现在用一个真会延迟的本地 HTTP 服务：异步、不堵事件循环、耗时可控。
 */
let slowServer: Server;
let slowUrl: string;

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
      type: 'nomops.httpRequest',
      typeVersion: 1,
      position: [200, 0] as [number, number],
      parameters: { url: slowUrl, method: 'GET' },
    },
  ],
  connections: { Hook: { main: [[{ node: 'Slow', type: 'main', index: 0 }]] } },
});

beforeAll(async () => {
  slowServer = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    }, 120);
  });
  await new Promise<void>((resolve) => slowServer.listen(0, '127.0.0.1', resolve));
  const addr = slowServer.address();
  slowUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/`;

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
  await new Promise<void>((resolve) => slowServer.close(() => resolve()));
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

    // ★执行本身也要真跑成功。少了这条,「慢工作流」哪怕秒失败测试也会绿
    const list = await request(app).get('/api/executions').set({ Authorization: `Bearer ${token}` });
    const statuses = (list.body as Array<{ status: string }>).map((e) => e.status);
    expect(statuses).toHaveLength(6);
    expect(statuses.every((st) => st === 'success')).toBe(true);

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

describe('★队列满时的拒绝路径', () => {
  it('返回 503 + Retry-After，且不留下永远不会跑的执行记录', async () => {
    const tight = await bootstrap({
      dbConfig: { type: 'sqlite' },
      concurrencyLimit: 1,
      concurrencyQueueDepth: 0, // 不排队,满即拒
    });
    try {
      const app2 = createApp(tight.services);
      const t = (await setupOwner(app2, 'owner@reject.dev')).token;
      const created = await request(app2)
        .post('/api/workflows')
        .set({ Authorization: `Bearer ${t}` })
        .send(slowFlow('reject-hook'))
        .expect(201);
      await request(app2)
        .post(`/api/workflows/${created.body.id}/activate`)
        .set({ Authorization: `Bearer ${t}` })
        .send({ active: true })
        .expect(200);

      const [first, second] = await Promise.all([
        request(app2).post('/webhook/reject-hook').send({}),
        // 稍晚一点点发,确保第一条已占住唯一槽位
        new Promise((r) => setTimeout(r, 20)).then(() =>
          request(app2).post('/webhook/reject-hook').send({}),
        ) as Promise<{ status: number; headers: Record<string, string> }>,
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(503);
      expect(second.headers['retry-after']).toBeTruthy();

      // ★关键:被拒的那条不该留下 'new' 状态的记录——'new' 是非终态,
      // 执行历史清理器不会碰它,洪峰下即成永久垃圾
      const { db, schema } = tight.dbHandle;
      const rows = await db.select({ status: schema.executions.status }).from(schema.executions);
      expect(rows).toHaveLength(1); // 只有跑成功的那条
      expect((rows as Array<{ status: string }>)[0]!.status).toBe('success');
    } finally {
      await tight.shutdown();
    }
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
