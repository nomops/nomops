import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #15 匿名恢复 URL + #17 重试从失败节点续跑：
 * - $execution.resumeUrl 在任意节点参数里可用（审批流把 URL 发出去）;
 * - 公开 /webhook-waiting/:id/:token 免鉴权恢复,错令牌/已结束一律 404;
 * - retry 保留成功节点 runData（不重放触发/上游）,失败节点及下游重跑。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;

const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite', waitTrackerIntervalMs: 60_000 } as never);
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'resume@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'resume@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.shutdown();
});

async function dataOf(executionId: string) {
  const res = await request(app).get(`/api/executions/${executionId}`).set(authed()).expect(200);
  return { status: res.body.execution.status as string, runData: res.body.data?.resultData?.runData ?? {} };
}
const lastOut = (runData: Record<string, Array<{ data: { main: unknown[][] } }>>, node: string) =>
  (runData[node]!.at(-1)!.data.main[0]![0] as { json: Record<string, unknown> }).json;

describe('#15 匿名恢复 URL', () => {
  it('$execution.resumeUrl 可用;公开 URL 免鉴权恢复;错令牌/已结束 404', async () => {
    const created = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({
        name: 'approval-flow',
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Note', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { url: '={{ $execution.resumeUrl }}' } } },
          { id: 'c', name: 'Pause', type: 'nomops.wait', typeVersion: 1, position: [400, 0], parameters: { resume: 'onSignal' } },
          { id: 'd', name: 'After', type: 'nomops.set', typeVersion: 1, position: [600, 0], parameters: { fields: { approved: true } } },
        ],
        connections: {
          Start: { main: [[{ node: 'Note', type: 'main', index: 0 }]] },
          Note: { main: [[{ node: 'Pause', type: 'main', index: 0 }]] },
          Pause: { main: [[{ node: 'After', type: 'main', index: 0 }]] },
        },
      })
      .expect(201);

    const run = await request(app).post(`/api/workflows/${created.body.id}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('waiting');
    const execId = run.body.executionId as string;

    // Note 节点拿到了恢复 URL（表达式 $execution.resumeUrl）
    const snap = await dataOf(execId);
    const url = String(lastOut(snap.runData, 'Note')['url']);
    expect(url).toContain(`/webhook-waiting/${execId}/`);
    const path = new URL(url).pathname;

    // 错令牌 404（不泄露存在性）
    await request(app).post(`/webhook-waiting/${execId}/wrong-token-123`).expect(404);
    expect((await dataOf(execId)).status).toBe('waiting');

    // 正确令牌:免鉴权恢复 → 续跑到底
    const resumed = await request(app).post(path).expect(200);
    expect(resumed.body).toMatchObject({ resumed: true, executionId: execId, status: 'success' });
    const done = await dataOf(execId);
    expect(done.status).toBe('success');
    expect(lastOut(done.runData, 'After')['approved']).toBe(true);

    // 已结束再打 → 404
    await request(app).post(path).expect(404);
  });
});

describe('#17 重试从失败节点续跑', () => {
  it('成功上游不重跑(时间戳保持),修好后 retry 从失败节点续到成功;节点已删则退回全量', async () => {
    const created = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({
        name: 'retry-flow',
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Stamp', type: 'nomops.code', typeVersion: 1, position: [200, 0], parameters: { code: 'return [{ json: { stamp: Date.now() } }];' } },
          { id: 'c', name: 'Boom', type: 'nomops.code', typeVersion: 1, position: [400, 0], parameters: { code: 'throw new Error("first-run-fails")' } },
          { id: 'd', name: 'End', type: 'nomops.set', typeVersion: 1, position: [600, 0], parameters: { fields: { done: true } } },
        ],
        connections: {
          Start: { main: [[{ node: 'Stamp', type: 'main', index: 0 }]] },
          Stamp: { main: [[{ node: 'Boom', type: 'main', index: 0 }]] },
          Boom: { main: [[{ node: 'End', type: 'main', index: 0 }]] },
        },
      })
      .expect(201);

    const run = await request(app).post(`/api/workflows/${created.body.id}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('error');
    const origStamp = lastOut((await dataOf(run.body.executionId as string)).runData, 'Stamp')['stamp'];

    // 修好 Boom（改当前草稿）,retry(currently saved) → 从失败节点续跑
    await request(app)
      .patch(`/api/workflows/${created.body.id}`)
      .set(authed())
      .send({
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Stamp', type: 'nomops.code', typeVersion: 1, position: [200, 0], parameters: { code: 'return [{ json: { stamp: Date.now() } }];' } },
          { id: 'c', name: 'Boom', type: 'nomops.code', typeVersion: 1, position: [400, 0], parameters: { code: 'return items.map(it => ({ json: { ...it.json, fixed: true } }));' } },
          { id: 'd', name: 'End', type: 'nomops.set', typeVersion: 1, position: [600, 0], parameters: { fields: { done: true } } },
        ],
      })
      .expect(200);

    const retry = await request(app)
      .post(`/api/executions/${run.body.executionId}/retry`)
      .set(authed())
      .send({ useOriginal: false })
      .expect(200);
    expect(retry.body.status).toBe('success');

    const detail = await dataOf(retry.body.executionId as string);
    // 上游 Stamp 未重跑：时间戳与原执行完全一致（重跑必然产生新时间戳）
    expect(lastOut(detail.runData, 'Stamp')['stamp']).toBe(origStamp);
    // 失败节点及下游重跑成功
    expect(lastOut(detail.runData, 'Boom')['fixed']).toBe(true);
    expect(lastOut(detail.runData, 'End')['done']).toBe(true);

    // 定义里删掉失败节点 → 优雅退回全量重跑（仍 200）
    await request(app)
      .patch(`/api/workflows/${created.body.id}`)
      .set(authed())
      .send({
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Stamp', type: 'nomops.code', typeVersion: 1, position: [200, 0], parameters: { code: 'return [{ json: { stamp: Date.now() } }];' } },
        ],
        connections: { Start: { main: [[{ node: 'Stamp', type: 'main', index: 0 }]] } },
      })
      .expect(200);
    const fallback = await request(app)
      .post(`/api/executions/${run.body.executionId}/retry`)
      .set(authed())
      .send({ useOriginal: false })
      .expect(200);
    expect(fallback.body.status).toBe('success');
  });
});
