import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/** 钉住数据（pin data）：手动运行应用冻结输出；生产触发（webhook）忽略；校验 pin 目标存在。 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'pin@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'pin@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.dbHandle.close();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

const manualFlow = (pin?: object | null) => ({
  name: 'pin-manual',
  nodes: [
    { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { v: 'real' } } },
  ],
  connections: { Start: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
  ...(pin !== undefined ? { pinData: pin } : {}),
});

async function lastSetOutput(executionId: string): Promise<{ json: Record<string, unknown>; task: Record<string, unknown> }> {
  const detail = await request(app).get(`/api/executions/${executionId}`).set(authed()).expect(200);
  const task = detail.body.data.resultData.runData.Set[0];
  return { json: task.data.main[0][0].json, task };
}

describe('钉住数据', () => {
  it('手动运行：pin 的节点跳过执行，输出=冻结数据，任务记录带 pinned 标记', async () => {
    const created = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send(manualFlow({ Set: [{ json: { v: 'pinned' } }] }))
      .expect(201);
    expect(created.body.pinData).toEqual({ Set: [{ json: { v: 'pinned' } }] });

    const run = await request(app).post(`/api/workflows/${created.body.id}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('success');

    const { json, task } = await lastSetOutput(run.body.executionId);
    expect(json).toEqual({ v: 'pinned' });
    expect(task['pinned']).toBe(true);

    // 清空 pin（pinData: null）→ 再跑回真实执行
    await request(app).patch(`/api/workflows/${created.body.id}`).set(authed()).send({ pinData: null }).expect(200);
    const rerun = await request(app).post(`/api/workflows/${created.body.id}/run`).set(authed()).send({}).expect(200);
    const after = await lastSetOutput(rerun.body.executionId);
    expect(after.json).toEqual({ v: 'real' });
    expect(after.task['pinned']).toBeUndefined();
  });

  it('生产触发（webhook）忽略 pin，跑真实节点', async () => {
    const flow = {
      name: 'pin-webhook',
      nodes: [
        { id: 'a', name: 'Hook', type: 'nomops.webhook', typeVersion: 1, position: [0, 0], parameters: { path: 'pin-hook', method: 'POST' } },
        { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { v: 'real' } } },
      ],
      connections: { Hook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
      pinData: { Set: [{ json: { v: 'pinned' } }] },
    };
    const created = await request(app).post('/api/workflows').set(authed()).send(flow).expect(201);
    await request(app).post(`/api/workflows/${created.body.id}/activate`).set(authed()).send({ active: true }).expect(200);

    const hit = await request(app).post('/webhook/pin-hook').send({ x: 1 }).expect(200);
    const { json, task } = await lastSetOutput(hit.body.executionId as string);
    // Set 真实执行 = 合并字段进 webhook 载荷（若 pin 生效则输出会是恰好 {v:'pinned'}）
    expect(json['v']).toBe('real');
    expect(json['body']).toEqual({ x: 1 });
    expect(task['pinned']).toBeUndefined();

    await request(app).post(`/api/workflows/${created.body.id}/activate`).set(authed()).send({ active: false }).expect(200);
  });

  it('pin 指向不存在的节点 → 400', async () => {
    await request(app)
      .post('/api/workflows')
      .set(authed())
      .send(manualFlow({ Ghost: [{ json: {} }] }))
      .expect(400);
  });
});
