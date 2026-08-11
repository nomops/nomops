import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { WebhookTestListenerService } from '../services/webhook-test-listener-service.js';

let boot: BootstrapResult;
let app: Express;
let token = '';
const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, scheduler: { pollMs: 3_600_000 }, webhookTestTtlMs: 5_000 });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'webhook-test@nomops.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'webhook-test@nomops.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('Webhook Listen for test event', () => {
  let workflowId = '';

  it('注册草稿监听 → 单次请求执行草稿并输出 test 请求结构', async () => {
    workflowId = (await request(app).post('/api/workflows').set(authed()).send({
      name: 'webhook-test-draft',
      nodes: [
        { id: 'a', name: 'Hook', type: 'nomops.webhook', typeVersion: 1, position: [0, 0], parameters: { path: 'draft-listener', method: 'GET', authentication: 'none' } },
        { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { handled: true } } },
      ],
      connections: { Hook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
    }).expect(201)).body.id;

    const listening = await request(app)
      .post(`/api/workflows/${workflowId}/webhook-test/Hook`)
      .set(authed())
      .expect(200);
    expect(listening.body).toMatchObject({ listening: true, method: 'GET' });
    expect(listening.body.testUrl).toMatch(/\/webhook-test\/draft-listener$/);
    await request(app).get('/webhook/draft-listener').expect(404); // 未发布生产路由不受影响

    const hit = await request(app)
      .get('/webhook-test/draft-listener?source=batch3')
      .set('x-test-header', 'present')
      .expect(200);
    expect(hit.body).toEqual({ message: 'Workflow was started' });
    await request(app).get('/webhook-test/draft-listener').expect(404); // 单次消费

    const executions = (await request(app).get('/api/executions').set(authed()).expect(200)).body as Array<{ id: string; workflowId: string }>;
    const execution = executions.find((row) => row.workflowId === workflowId);
    expect(execution).toBeTruthy();
    const detail = await request(app).get(`/api/executions/${execution!.id}`).set(authed()).expect(200);
    const hook = detail.body.data.resultData.runData.Hook[0].data.main[0][0].json;
    expect(hook).toMatchObject({
      params: {}, query: { source: 'batch3' }, body: {}, executionMode: 'test',
      webhookUrl: expect.stringMatching(/\/webhook-test\/draft-listener$/),
    });
    expect(hook.headers['x-test-header']).toBe('present');
    expect(detail.body.data.resultData.runData.Set[0].data.main[0][0].json.handled).toBe(true);
  });

  it('Stop Listening 立即注销', async () => {
    await request(app).post(`/api/workflows/${workflowId}/webhook-test/Hook`).set(authed()).expect(200);
    await request(app).delete(`/api/workflows/${workflowId}/webhook-test/Hook`).set(authed()).expect(204);
    await request(app).get('/webhook-test/draft-listener').expect(404);
  });

  it('监听服务到期自动清理', async () => {
    const service = new WebhookTestListenerService(10);
    service.register({ workflowId: 'wf', projectId: 'p', nodeName: 'Hook', method: 'POST', path: 'expires' });
    expect(service.peek('expires', 'POST')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.peek('expires', 'POST')).toBeNull();
    service.stopAll();
  });
});
