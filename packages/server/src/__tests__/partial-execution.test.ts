import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * 部分执行（usePreviousData + destinationNode）：
 * 完整跑一次 → 改中间节点参数 → 部分重跑到末节点 → 上游复用旧数据、脏子图重算。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'partial@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'partial@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.dbHandle.close();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

const flow = (tag: string) => ({
  name: 'partial-flow',
  nodes: [
    { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: 'b', name: 'Base', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { base: 'stable' } } },
    { id: 'c', name: 'Tag', type: 'nomops.set', typeVersion: 1, position: [400, 0], parameters: { fields: { tag } } },
    { id: 'd', name: 'End', type: 'nomops.set', typeVersion: 1, position: [600, 0], parameters: { fields: { end: true } } },
  ],
  connections: {
    Start: { main: [[{ node: 'Base', type: 'main', index: 0 }]] },
    Base: { main: [[{ node: 'Tag', type: 'main', index: 0 }]] },
    Tag: { main: [[{ node: 'End', type: 'main', index: 0 }]] },
  },
});

async function runDetail(executionId: string) {
  const res = await request(app).get(`/api/executions/${executionId}`).set(authed()).expect(200);
  return res.body.data.resultData.runData as Record<string, Array<{ data: { main: unknown[][] } }>>;
}

describe('部分执行', () => {
  it('改中间节点后 usePreviousData 重跑：上游复用、脏链重算', async () => {
    const created = await request(app).post('/api/workflows').set(authed()).send(flow('v1')).expect(201);
    const id = created.body.id as string;

    // 1) 完整跑一遍
    const full = await request(app).post(`/api/workflows/${id}/run`).set(authed()).send({}).expect(200);
    expect(full.body.status).toBe('success');

    // 2) 改 Tag 节点参数（Tag 与其下游 End 变脏；Start/Base 干净）
    await request(app)
      .patch(`/api/workflows/${id}`)
      .set(authed())
      .send({ nodes: flow('v2').nodes })
      .expect(200);

    // 3) 部分重跑到 End
    const partial = await request(app)
      .post(`/api/workflows/${id}/run`)
      .set(authed())
      .send({ destinationNode: 'End', usePreviousData: true })
      .expect(200);
    expect(partial.body.status).toBe('success');

    const runData = await runDetail(partial.body.executionId as string);
    // 上游 Start/Base：预置旧数据，只有一次运行记录
    expect(runData['Start']).toHaveLength(1);
    expect(runData['Base']).toHaveLength(1);
    // 脏链 Tag/End 重算，拿到新参数
    const endOut = runData['End']![0]!.data.main[0]![0] as { json: Record<string, unknown> };
    expect(endOut.json['tag']).toBe('v2');
    expect(endOut.json['base']).toBe('stable'); // 干净上游的数据仍在链路里
    expect(endOut.json['end']).toBe(true);
  });

  it('无历史执行时优雅退回完整运行', async () => {
    const created = await request(app).post('/api/workflows').set(authed()).send({ ...flow('x'), name: 'partial-fresh' }).expect(201);
    const run = await request(app)
      .post(`/api/workflows/${created.body.id}/run`)
      .set(authed())
      .send({ destinationNode: 'End', usePreviousData: true })
      .expect(200);
    expect(run.body.status).toBe('success');
    const runData = await runDetail(run.body.executionId as string);
    expect(runData['End']).toBeDefined();
  });
});
