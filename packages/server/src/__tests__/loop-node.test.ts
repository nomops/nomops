import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * Loop 节点全链路（backlog #5）：真实引擎跑「Manual → Loop →(loop) Set →环回 Loop →(done) NoOp」。
 * 守的是：批次驱动的环回不死锁、处理结果聚齐后从 done 输出、
 * 节点执行上下文(contextData)在服务端执行路径上真实生效。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' } as never);
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'loop@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'loop@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.shutdown();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

describe('Loop 节点（引擎全链路）', () => {
  it('3 item×batchSize 1 → 3 轮环回,done 输出聚齐处理结果', async () => {
    const created = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({
        name: 'loop-flow',
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Batch', type: 'nomops.loop', typeVersion: 1, position: [200, 0], parameters: { batchSize: 1 } },
          { id: 'c', name: 'Mark', type: 'nomops.set', typeVersion: 1, position: [400, 0], parameters: { fields: { marked: true } } },
          { id: 'd', name: 'Done', type: 'nomops.noOp', typeVersion: 1, position: [600, 0], parameters: {} },
        ],
        connections: {
          Start: { main: [[{ node: 'Batch', type: 'main', index: 0 }]] },
          // 输出0 = done → Done;输出1 = loop → Mark → 环回 Batch
          Batch: { main: [[{ node: 'Done', type: 'main', index: 0 }], [{ node: 'Mark', type: 'main', index: 0 }]] },
          Mark: { main: [[{ node: 'Batch', type: 'main', index: 0 }]] },
        },
      })
      .expect(201);

    // Manual trigger 无种子多 item 机制,先用 Code 造 3 item?——直接经 Set 不行;
    // 引擎手动运行从触发器起,输出单 item。此处用 pin 数据钉 Start 输出为 3 item。
    await request(app)
      .patch(`/api/workflows/${created.body.id}`)
      .set(authed())
      .send({ pinData: { Start: [{ json: { id: 1 } }, { json: { id: 2 } }, { json: { id: 3 } }] } })
      .expect(200);

    const run = await request(app).post(`/api/workflows/${created.body.id}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('success');

    const detail = await request(app).get(`/api/executions/${run.body.executionId}`).set(authed()).expect(200);
    const runData = detail.body.data.resultData.runData;

    expect(runData['Batch']).toHaveLength(4); // 首帧 + 3 次环回
    expect(runData['Mark']).toHaveLength(3); // 每批 1 item × 3
    const doneItems = runData['Done'][0].data.main[0].map((it: { json: unknown }) => it.json);
    expect(doneItems).toEqual([
      { id: 1, marked: true },
      { id: 2, marked: true },
      { id: 3, marked: true },
    ]);
    // 节点执行上下文已随状态落库（收尾时 queue/processed 已重置删除）
    expect(detail.body.data.contextData).toBeDefined();
  });
});
