import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #31b：评测子系统端到端 —— Evaluation Trigger + data table 逐行跑工作流，
 * Evaluation 节点记分,test_run 聚合指标 + 每行 test_case_run 落库。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;

const authed = () => ({ Authorization: `Bearer ${token}` });

/** 建工作流：EvaluationTrigger(绑定 tableId) → Evaluation(setMetrics)。 */
function evalWorkflow(name: string, dataTableId: string) {
  return {
    name,
    nodes: [
      {
        id: 't',
        name: 'On evaluation',
        type: 'nomops.evaluationTrigger',
        typeVersion: 1,
        position: [0, 0],
        parameters: { dataTableId, limit: 0 },
      },
      {
        id: 'e',
        name: 'Score',
        type: 'nomops.evaluation',
        typeVersion: 1,
        position: [220, 0],
        parameters: {
          operation: 'setMetrics',
          metrics: { value: '={{ $json.n }}', passed: '={{ $json.n >= $json.threshold }}' },
        },
      },
    ],
    connections: { 'On evaluation': { main: [[{ node: 'Score', type: 'main', index: 0 }]] } },
  };
}

async function makeDataset(): Promise<string> {
  const table = (await request(app).post('/api/data-tables').set(authed()).send({ name: `cases-${Math.random()}` }).expect(201)).body;
  await request(app).post(`/api/data-tables/${table.id}/columns`).set(authed()).send({ name: 'n', type: 'number' }).expect(201);
  await request(app).post(`/api/data-tables/${table.id}/columns`).set(authed()).send({ name: 'threshold', type: 'number' }).expect(201);
  for (const n of [10, 2, 8]) {
    await request(app).post(`/api/data-tables/${table.id}/rows`).set(authed()).send({ data: { n, threshold: 5 } }).expect(201);
  }
  return table.id as string;
}

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'eval@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'eval@test.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.dbHandle.close();
});

describe('评测子系统（backlog #31）', () => {
  it('逐行跑 + 指标聚合 + 用例落库', async () => {
    const tableId = await makeDataset();
    const wf = (await request(app).post('/api/workflows').set(authed()).send(evalWorkflow('eval-wf', tableId)).expect(201)).body;

    const run = (await request(app).post(`/api/workflows/${wf.id}/test-runs`).set(authed()).send({}).expect(201)).body;
    expect(run.status).toBe('completed');
    expect(run.totalCases).toBe(3);
    expect(run.ranCases).toBe(3);
    // passed: n>=5 → [10,2,8] → true,false,true → 2 通过
    expect(run.passedCases).toBe(2);
    // 聚合均值：value=(10+2+8)/3=6.667；passed=(1+0+1)/3=0.667
    expect(run.metrics.value).toBeCloseTo(20 / 3, 5);
    expect(run.metrics.passed).toBeCloseTo(2 / 3, 5);

    // 详情：3 行用例，各带 metrics + 输入快照 + 关联执行
    const detail = (await request(app).get(`/api/test-runs/${run.id}`).set(authed()).expect(200)).body;
    expect(detail.cases).toHaveLength(3);
    expect(detail.cases[0]).toMatchObject({ rowIndex: 0, status: 'success', input: { n: 10, threshold: 5 } });
    expect(detail.cases[0].metrics).toEqual({ value: 10, passed: 1 });
    expect(detail.cases[1].metrics).toEqual({ value: 2, passed: 0 });
    expect(typeof detail.cases[0].executionId).toBe('string');

    // 历史列表
    const list = (await request(app).get(`/api/workflows/${wf.id}/test-runs`).set(authed()).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(run.id);

    // 删除
    await request(app).delete(`/api/test-runs/${run.id}`).set(authed()).expect(204);
    expect((await request(app).get(`/api/workflows/${wf.id}/test-runs`).set(authed()).expect(200)).body).toHaveLength(0);
  });

  it('dataTableId 覆盖 + limit 限行', async () => {
    const tableId = await makeDataset();
    // 工作流 trigger 不绑定数据集，靠请求体覆盖
    const wf = (await request(app).post('/api/workflows').set(authed()).send(evalWorkflow('eval-override', '')).expect(201)).body;
    const run = (await request(app).post(`/api/workflows/${wf.id}/test-runs`).set(authed()).send({ dataTableId: tableId, limit: 2 }).expect(201)).body;
    expect(run.totalCases).toBe(2);
    expect(run.ranCases).toBe(2);
  });

  it('无 Evaluation Trigger → 400', async () => {
    const wf = (
      await request(app)
        .post('/api/workflows')
        .set(authed())
        .send({
          name: 'no-trigger',
          nodes: [{ id: 'a', name: 'Manual', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
          connections: {},
        })
        .expect(201)
    ).body;
    await request(app).post(`/api/workflows/${wf.id}/test-runs`).set(authed()).send({}).expect(400);
  });

  it('未绑定数据集且无覆盖 → 400', async () => {
    const wf = (await request(app).post('/api/workflows').set(authed()).send(evalWorkflow('no-dataset', '')).expect(201)).body;
    await request(app).post(`/api/workflows/${wf.id}/test-runs`).set(authed()).send({}).expect(400);
  });

  it('数据集不存在 → 404', async () => {
    const wf = (await request(app).post('/api/workflows').set(authed()).send(evalWorkflow('bad-dataset', '')).expect(201)).body;
    await request(app).post(`/api/workflows/${wf.id}/test-runs`).set(authed()).send({ dataTableId: 'does-not-exist' }).expect(404);
  });
});
