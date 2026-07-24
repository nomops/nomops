import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #40b：凭证引用索引 —— 删被引用凭证前可见引用方。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

const wfUsingCred = (name: string, credId: string) => ({
  name,
  nodes: [
    {
      id: 'h',
      name: 'HTTP',
      type: 'nomops.httpRequest',
      typeVersion: 1,
      position: [0, 0],
      parameters: { url: 'https://x.dev' },
      credentials: { httpHeaderAuth: { id: credId, name: 'MyCred' } },
    },
  ],
  connections: {},
});

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'dep@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'dep@test.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('凭证引用索引（backlog #40b）', () => {
  let credId = '';
  it('工作流引用凭证 → usage 列出引用方', async () => {
    credId = (await request(app).post('/api/credentials').set(authed()).send({ name: 'MyCred', type: 'httpHeaderAuth', data: { name: 'X-Key', value: 'v' } }).expect(201)).body.id;
    const wf = (await request(app).post('/api/workflows').set(authed()).send(wfUsingCred('uses-cred', credId)).expect(201)).body;

    const usage = (await request(app).get(`/api/credentials/${credId}/usage`).set(authed()).expect(200)).body;
    expect(usage.workflows).toHaveLength(1);
    expect(usage.workflows[0]).toMatchObject({ id: wf.id, name: 'uses-cred' });
  });

  it('保存去掉凭证引用后 → usage 不再列出', async () => {
    const wf = (await request(app).post('/api/workflows').set(authed()).send(wfUsingCred('drops-cred', credId)).expect(201)).body;
    expect((await request(app).get(`/api/credentials/${credId}/usage`).set(authed()).expect(200)).body.workflows.length).toBeGreaterThanOrEqual(2);

    // 更新该工作流,去掉凭证引用
    await request(app)
      .patch(`/api/workflows/${wf.id}`)
      .set(authed())
      .send({ nodes: [{ id: 'h', name: 'HTTP', type: 'nomops.httpRequest', typeVersion: 1, position: [0, 0], parameters: { url: 'https://x.dev' } }], connections: {} })
      .expect(200);

    const usage = (await request(app).get(`/api/credentials/${credId}/usage`).set(authed()).expect(200)).body;
    expect(usage.workflows.some((w: { id: string }) => w.id === wf.id)).toBe(false);
  });

  it('删引用凭证的工作流 → 依赖行随之清除(不残留)', async () => {
    const wf = (await request(app).post('/api/workflows').set(authed()).send(wfUsingCred('to-delete', credId)).expect(201)).body;
    const beforeCount = (await request(app).get(`/api/credentials/${credId}/usage`).set(authed()).expect(200)).body.workflows.length;
    await request(app).delete(`/api/workflows/${wf.id}`).set(authed()).expect(204);
    const afterCount = (await request(app).get(`/api/credentials/${credId}/usage`).set(authed()).expect(200)).body.workflows.length;
    expect(afterCount).toBe(beforeCount - 1);
  });
});
