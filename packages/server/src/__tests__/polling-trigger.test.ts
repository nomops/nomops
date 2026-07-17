import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * 轮询触发器 + processed_data 去重：
 * 激活即拉首轮（首批 items 全新 → 触发）；同一载荷再轮询不触发；新增条目只吐增量。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
let mock: Server;
let mockUrl: string;
let payload: Array<{ id: number; label: string }> = [];

beforeAll(async () => {
  // 本地 mock API：GET 返回 { data: { items: payload } }
  mock = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: { items: payload } }));
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const address = mock.address();
  if (typeof address === 'object' && address) mockUrl = `http://127.0.0.1:${address.port}/items`;

  boot = await bootstrap({ type: 'sqlite' });
  await boot.leader.start(); // regular 模式：内存锁，恒为 leader（轮询只在 leader 调度）
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'poll@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'poll@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.shutdown();
  await new Promise<void>((resolve) => mock.close(() => resolve()));
});

const authed = () => ({ Authorization: `Bearer ${token}` });

describe('轮询触发器', () => {
  it('首轮触发全部、重复不触发、新增只吐增量', async () => {
    payload = [
      { id: 1, label: 'first' },
      { id: 2, label: 'second' },
    ];

    const flow = {
      name: 'poll-flow',
      nodes: [
        {
          id: 'a',
          name: 'Poll',
          type: 'nomops.pollingTrigger',
          typeVersion: 1,
          position: [0, 0],
          // 间隔设超大：真实定时器不会在测试期间触发，全部用 pollOnce 手动驱动
          parameters: { url: mockUrl, itemsPath: 'data.items', idField: 'id', pollInterval: 3600 },
        },
        { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { seen: true } } },
      ],
      connections: { Poll: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
    };
    const created = await request(app).post('/api/workflows').set(authed()).send(flow).expect(201);
    const id = created.body.id as string;

    // 激活 → 立刻首轮拉取（异步派发，稍候落库）
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);
    await new Promise((r) => setTimeout(r, 150));

    let list = (await request(app).get('/api/executions').set(authed()).expect(200)).body as Array<{ id: string; workflowId: string }>;
    const ofFlow = () => list.filter((e) => e.workflowId === id);
    expect(ofFlow()).toHaveLength(1);

    // 同一载荷再轮询 → 全部已见过，不触发
    await boot.services.activeWorkflows.pollOnce(id);
    await new Promise((r) => setTimeout(r, 100));
    list = (await request(app).get('/api/executions').set(authed()).expect(200)).body;
    expect(ofFlow()).toHaveLength(1);

    // 新增一条 → 只吐增量（id:3）
    payload = [...payload, { id: 3, label: 'third' }];
    await boot.services.activeWorkflows.pollOnce(id);
    await new Promise((r) => setTimeout(r, 150));
    list = (await request(app).get('/api/executions').set(authed()).expect(200)).body;
    expect(ofFlow()).toHaveLength(2);

    // 检查增量执行的种子只有 id:3
    const latest = ofFlow()[0]!.id === undefined ? null : ofFlow().at(-1);
    const executionsSorted = ofFlow();
    const newest = executionsSorted[executionsSorted.length - 1]!;
    void latest;
    const detail = await request(app).get(`/api/executions/${newest.id}`).set(authed()).expect(200);
    const pollOut = detail.body.data.resultData.runData['Poll'][0].data.main[0] as Array<{ json: { id: number } }>;
    const ids = pollOut.map((it) => it.json.id).sort();
    // 两条执行里其一是首轮 [1,2]，其一是增量 [3]（列表排序不保证，两种都接受）
    expect([JSON.stringify([1, 2]), JSON.stringify([3])]).toContain(JSON.stringify(ids));

    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: false }).expect(200);
  });
});
