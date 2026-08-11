import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request, { type Test } from 'supertest';
import type { Express } from 'express';
import { sign } from 'jsonwebtoken';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * 触发配套三节点（backlog #6）：
 * - RespondToWebhook：webhook 路由返回节点设置的自定义响应（JSON/text/noData/首 item）;
 * - ErrorTrigger：作为错误处理流的专用起点,收到失败上下文;
 * - ExecuteWorkflowTrigger：作为子工作流被调方起点,收到父流入参。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;

const authed = () => ({ Authorization: `Bearer ${token}` });

async function createWorkflow(body: Record<string, unknown>): Promise<string> {
  const res = await request(app).post('/api/workflows').set(authed()).send(body).expect(201);
  return res.body.id as string;
}

async function createCredential(type: string, name: string, data: Record<string, unknown>): Promise<string> {
  const res = await request(app).post('/api/credentials').set(authed()).send({ type, name, data }).expect(201);
  return res.body.id as string;
}

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  await boot.leader.start();
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'companion@test.dev', password: 'password-123' });
  const login = await request(app).post('/auth/login').send({ email: 'companion@test.dev', password: 'password-123' });
  token = login.body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('RespondToWebhook', () => {
  it('json 模式:webhook 返回自定义 body + 状态码', async () => {
    const id = await createWorkflow({
      name: 'respond-json',
      nodes: [
        { id: 'a', name: 'Hook', type: 'nomops.webhook', typeVersion: 1, position: [0, 0], parameters: { path: 'respond-json', method: 'POST' } },
        {
          id: 'b',
          name: 'Respond',
          type: 'nomops.respondToWebhook',
          typeVersion: 1,
          position: [200, 0],
          parameters: { respondWith: 'json', responseBody: '{"ok":true,"source":"respond-node"}', responseCode: 201 },
        },
      ],
      connections: { Hook: { main: [[{ node: 'Respond', type: 'main', index: 0 }]] } },
    });
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);

    const hit = await request(app).post('/webhook/respond-json').send({}).expect(201);
    expect(hit.body).toEqual({ ok: true, source: 'respond-node' });
  });

  it('firstIncomingItem 模式:返回进入节点的首 item json', async () => {
    const id = await createWorkflow({
      name: 'respond-item',
      nodes: [
        { id: 'a', name: 'Hook', type: 'nomops.webhook', typeVersion: 1, position: [0, 0], parameters: { path: 'respond-item', method: 'POST' } },
        { id: 'b', name: 'Shape', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { greeting: 'hi' } } },
        { id: 'c', name: 'Respond', type: 'nomops.respondToWebhook', typeVersion: 1, position: [400, 0], parameters: {} },
      ],
      connections: {
        Hook: { main: [[{ node: 'Shape', type: 'main', index: 0 }]] },
        Shape: { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
      },
    });
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);

    const hit = await request(app).post('/webhook/respond-item').send({ q: 1 }).expect(200);
    expect(hit.body.greeting).toBe('hi'); // 自定义响应,而非执行摘要
    expect(hit.body.executionId).toBeUndefined();
  });

  it('text 与 noData 模式', async () => {
    const id = await createWorkflow({
      name: 'respond-text',
      nodes: [
        { id: 'a', name: 'Hook', type: 'nomops.webhook', typeVersion: 1, position: [0, 0], parameters: { path: 'respond-text', method: 'POST' } },
        { id: 'b', name: 'Respond', type: 'nomops.respondToWebhook', typeVersion: 1, position: [200, 0], parameters: { respondWith: 'text', responseBody: 'plain-ack', responseCode: 202 } },
      ],
      connections: { Hook: { main: [[{ node: 'Respond', type: 'main', index: 0 }]] } },
    });
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);
    const hit = await request(app).post('/webhook/respond-text').send({}).expect(202);
    expect(hit.text).toBe('plain-ack');
    expect(hit.headers['content-type']).toMatch(/text\/plain/);

    const id2 = await createWorkflow({
      name: 'respond-nodata',
      nodes: [
        { id: 'a', name: 'Hook', type: 'nomops.webhook', typeVersion: 1, position: [0, 0], parameters: { path: 'respond-nodata', method: 'POST' } },
        { id: 'b', name: 'Respond', type: 'nomops.respondToWebhook', typeVersion: 1, position: [200, 0], parameters: { respondWith: 'noData', responseCode: 204 } },
      ],
      connections: { Hook: { main: [[{ node: 'Respond', type: 'main', index: 0 }]] } },
    });
    await request(app).post(`/api/workflows/${id2}/activate`).set(authed()).send({ active: true }).expect(200);
    const empty = await request(app).post('/webhook/respond-nodata').send({}).expect(204);
    expect(empty.body).toEqual({});
  });

  it('无 RespondToWebhook 的 webhook 流仍返回默认执行摘要（回归）', async () => {
    const id = await createWorkflow({
      name: 'respond-default',
      nodes: [
        { id: 'a', name: 'Hook', type: 'nomops.webhook', typeVersion: 1, position: [0, 0], parameters: { path: 'respond-default', method: 'POST' } },
        { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { done: 1 } } },
      ],
      connections: { Hook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
    });
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);
    const hit = await request(app).post('/webhook/respond-default').send({}).expect(200);
    expect(hit.body.status).toBe('success');
    expect(hit.body.executionId).toBeTruthy();
  });

  it('lastNode 模式返回末节点输出，而不是执行摘要', async () => {
    const id = await createWorkflow({
      name: 'respond-last-node',
      nodes: [
        { id: 'a', name: 'Hook', type: 'nomops.webhook', typeVersion: 1, position: [0, 0], parameters: { path: 'respond-last-node', method: 'POST', responseMode: 'lastNode' } },
        { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { result: 'finished' } } },
      ],
      connections: { Hook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
    });
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);

    const hit = await request(app).post('/webhook/respond-last-node').send({ input: 1 }).expect(200);
    expect(hit.body).toMatchObject({ result: 'finished' });
    expect(hit.body.executionId).toBeUndefined();
  });

  it('Basic/Header/JWT 四态鉴权只接受正确的加密凭证', async () => {
    const basicId = await createCredential('httpBasicAuth', 'hook-basic', { user: 'alice', password: 's3cret' });
    const headerId = await createCredential('httpHeaderAuth', 'hook-header', { name: 'X-Hook-Key', value: 'header-secret' });
    const jwtId = await createCredential('webhookJwtAuth', 'hook-jwt', { secret: 'jwt-secret-32-characters-minimum!', issuer: 'issuer-a', audience: 'hooks' });
    const cases = [
      {
        path: 'auth-basic',
        authentication: 'basic',
        credentials: { httpBasicAuth: { id: basicId, name: 'hook-basic' } },
        authorize: (r: Test) => r.set('Authorization', `Basic ${Buffer.from('alice:s3cret').toString('base64')}`),
      },
      {
        path: 'auth-header',
        authentication: 'header',
        credentials: { httpHeaderAuth: { id: headerId, name: 'hook-header' } },
        authorize: (r: Test) => r.set('X-Hook-Key', 'header-secret'),
      },
      {
        path: 'auth-jwt',
        authentication: 'jwt',
        credentials: { webhookJwtAuth: { id: jwtId, name: 'hook-jwt' } },
        authorize: (r: Test) =>
          r.set(
            'Authorization',
            `Bearer ${sign({ sub: 'caller' }, 'jwt-secret-32-characters-minimum!', { algorithm: 'HS256', issuer: 'issuer-a', audience: 'hooks' })}`,
          ),
      },
    ];

    for (const item of cases) {
      const id = await createWorkflow({
        name: item.path,
        nodes: [
          {
            id: 'a',
            name: 'Hook',
            type: 'nomops.webhook',
            typeVersion: 1,
            position: [0, 0],
            parameters: { path: item.path, method: 'POST', authentication: item.authentication },
            credentials: item.credentials,
          },
          { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { ok: true } } },
        ],
        connections: { Hook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
      });
      await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);

      await request(app).post(`/webhook/${item.path}`).send({}).expect(401);
      await item.authorize(request(app).post(`/webhook/${item.path}`).send({})).expect(200);
    }
  });

  it('ignoreBots 对链接预览 UA 返回 204 且不创建执行', async () => {
    const id = await createWorkflow({
      name: 'ignore-preview-bot',
      nodes: [
        {
          id: 'a',
          name: 'Hook',
          type: 'nomops.webhook',
          typeVersion: 1,
          position: [0, 0],
          parameters: { path: 'ignore-preview-bot', method: 'POST', options: { ignoreBots: true } },
        },
        { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { ran: true } } },
      ],
      connections: { Hook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
    });
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);
    const before = await request(app).get('/api/executions').set(authed()).expect(200);
    const ignored = await request(app)
      .post('/webhook/ignore-preview-bot')
      .set('User-Agent', 'Slackbot-LinkExpanding 1.0')
      .send({})
      .expect(204);
    expect(ignored.headers['x-nomops-webhook-ignored']).toBe('bot');
    const after = await request(app).get('/api/executions').set(authed()).expect(200);
    expect(after.body).toHaveLength(before.body.length);
  });
});

describe('ErrorTrigger', () => {
  it('作为错误处理流起点收到失败上下文', async () => {
    const errorFlowId = await createWorkflow({
      name: 'error-handler-flow',
      nodes: [
        { id: 'a', name: 'OnError', type: 'nomops.errorTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'b', name: 'Note', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { handled: true } } },
      ],
      connections: { OnError: { main: [[{ node: 'Note', type: 'main', index: 0 }]] } },
    });

    // 会失败的流:Code 抛错;settings.errorWorkflow 指向上面的错误流
    const failingId = await createWorkflow({
      name: 'failing-flow',
      nodes: [
        { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'b', name: 'Boom', type: 'nomops.code', typeVersion: 1, position: [200, 0], parameters: { code: 'throw new Error("kaboom")' } },
      ],
      connections: { Start: { main: [[{ node: 'Boom', type: 'main', index: 0 }]] } },
      settings: { errorWorkflow: errorFlowId },
    });

    const run = await request(app).post(`/api/workflows/${failingId}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('error');

    // fire-and-forget:轮询等错误流执行落库
    let handled: Record<string, unknown> | null = null;
    for (let i = 0; i < 100 && !handled; i++) {
      const list = await request(app).get('/api/executions').set(authed()).expect(200);
      const row = (list.body as Array<{ id: string; workflowId: string; status: string }>).find(
        (e) => e.workflowId === errorFlowId && e.status === 'success',
      );
      if (row) {
        const detail = await request(app).get(`/api/executions/${row.id}`).set(authed()).expect(200);
        handled = detail.body.data.resultData.runData['Note'][0].data.main[0][0].json;
      } else await new Promise((r) => setTimeout(r, 30));
    }
    expect(handled).toBeTruthy();
    expect(handled!['handled']).toBe(true);
    expect((handled!['error'] as { message: string }).message).toContain('kaboom');
    expect((handled!['workflow'] as { id: string }).id).toBe(failingId);
  });

  it('手动调试 ErrorTrigger 吐同构示例数据', async () => {
    const id = await createWorkflow({
      name: 'error-flow-manual',
      nodes: [{ id: 'a', name: 'OnError', type: 'nomops.errorTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
      connections: {},
    });
    const run = await request(app).post(`/api/workflows/${id}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('success');
    const detail = await request(app).get(`/api/executions/${run.body.executionId}`).set(authed()).expect(200);
    const sample = detail.body.data.resultData.runData['OnError'][0].data.main[0][0].json;
    expect(sample.error.message).toContain('Sample');
  });
});

describe('ExecuteWorkflowTrigger', () => {
  it('作为子流被调方起点收到父流入参', async () => {
    const subId = await createWorkflow({
      name: 'sub-with-trigger',
      nodes: [
        { id: 'a', name: 'FromParent', type: 'nomops.executeWorkflowTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'b', name: 'Stamp', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { sub: true } } },
      ],
      connections: { FromParent: { main: [[{ node: 'Stamp', type: 'main', index: 0 }]] } },
    });

    const parentId = await createWorkflow({
      name: 'parent-flow',
      nodes: [
        { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'b', name: 'Seed', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { fromParent: 42 } } },
        { id: 'c', name: 'CallSub', type: 'nomops.executeWorkflow', typeVersion: 1, position: [400, 0], parameters: { workflowId: subId } },
      ],
      connections: {
        Start: { main: [[{ node: 'Seed', type: 'main', index: 0 }]] },
        Seed: { main: [[{ node: 'CallSub', type: 'main', index: 0 }]] },
      },
    });

    const run = await request(app).post(`/api/workflows/${parentId}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('success');
    const detail = await request(app).get(`/api/executions/${run.body.executionId}`).set(authed()).expect(200);
    const out = detail.body.data.resultData.runData['CallSub'][0].data.main[0][0].json;
    expect(out).toEqual({ fromParent: 42, sub: true }); // 父入参穿过被调方起点,Stamp 字段合入
  });
});
