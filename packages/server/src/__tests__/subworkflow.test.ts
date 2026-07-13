import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser, setupOwner } from './helpers.js';

/** 产品深化验收：子工作流嵌套执行 + 递归深度熔断 + 跨项目不可调。 */

let boot: BootstrapResult;
let app: Express;
let token: string;

const authed = () => ({ Authorization: `Bearer ${token}` });

async function createWorkflow(body: Record<string, unknown>): Promise<string> {
  const res = await request(app).post('/api/workflows').set(authed()).send(body).expect(201);
  return res.body.id as string;
}

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  token = (await setupOwner(app, 'sub@dev.dev')).token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('子工作流（ExecuteWorkflow 节点）', () => {
  it('父流把 items 交给子流，拿回子流末节点输出', async () => {
    const childId = await createWorkflow({
      name: 'child',
      nodes: [
        { id: 'a', name: 'In', type: 'nomops.noOp', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'b', name: 'Mark', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { processedBy: 'child' } } },
      ],
      connections: { In: { main: [[{ node: 'Mark', type: 'main', index: 0 }]] } },
    });

    const parentId = await createWorkflow({
      name: 'parent',
      nodes: [
        { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'b', name: 'Seed', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { order: 42 } } },
        { id: 'c', name: 'Sub', type: 'nomops.executeWorkflow', typeVersion: 1, position: [400, 0], parameters: { workflowId: childId } },
      ],
      connections: {
        Start: { main: [[{ node: 'Seed', type: 'main', index: 0 }]] },
        Seed: { main: [[{ node: 'Sub', type: 'main', index: 0 }]] },
      },
    });

    const run = await request(app).post(`/api/workflows/${parentId}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('success');

    const detail = await request(app).get(`/api/executions/${run.body.executionId}`).set(authed()).expect(200);
    const subOut = detail.body.data.resultData.runData['Sub'][0].data.main[0][0].json;
    expect(subOut).toEqual({ order: 42, processedBy: 'child' }); // 子流处理过的数据回到父流
  });

  it('自引用递归被深度熔断（不死循环）', async () => {
    // 先建占位流拿 id，再把自己的 id 填进 ExecuteWorkflow 参数
    const selfId = await createWorkflow({
      name: 'ouroboros',
      nodes: [
        { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
      ],
      connections: {},
    });
    await request(app)
      .patch(`/api/workflows/${selfId}`)
      .set(authed())
      .send({
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Self', type: 'nomops.executeWorkflow', typeVersion: 1, position: [200, 0], parameters: { workflowId: selfId } },
        ],
        connections: { Start: { main: [[{ node: 'Self', type: 'main', index: 0 }]] } },
      })
      .expect(200);

    const run = await request(app).post(`/api/workflows/${selfId}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('error');
    expect(run.body.error).toMatch(/nesting exceeds|recursion/);
  }, 20_000);

  it('跨项目子流不可调（归属边界，铁律 2）', async () => {
    const other = await inviteUser(app, token, 'other-sub@dev.dev');
    const foreignChild = await request(app)
      .post('/api/workflows')
      .set({ Authorization: `Bearer ${other.token}` })
      .send({
        name: 'foreign',
        nodes: [{ id: 'a', name: 'X', type: 'nomops.noOp', typeVersion: 1, position: [0, 0], parameters: {} }],
        connections: {},
      })
      .expect(201);

    const parentId = await createWorkflow({
      name: 'steal',
      nodes: [
        { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'b', name: 'Sub', type: 'nomops.executeWorkflow', typeVersion: 1, position: [200, 0], parameters: { workflowId: foreignChild.body.id } },
      ],
      connections: { Start: { main: [[{ node: 'Sub', type: 'main', index: 0 }]] } },
    });
    const run = await request(app).post(`/api/workflows/${parentId}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('error');
    expect(run.body.error).toMatch(/failed|not found/);
  });
});
