import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { BUILTIN_TEMPLATES } from '../services/template-registry.js';

/** B1 验收：模板列表、导入建流、导入的模板真实可跑。 */

let boot: BootstrapResult;
let app: Express;
let token: string;

const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  const reg = await request(app)
    .post('/auth/register')
    .send({ email: 'tpl@dev.dev', password: 'password-123' })
    .expect(201);
  token = reg.body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('模板库 API', () => {
  it('列表返回全部内置模板摘要（不含节点 JSON）', async () => {
    const res = await request(app).get('/api/templates').set(authed()).expect(200);
    expect(res.body).toHaveLength(BUILTIN_TEMPLATES.length);
    expect(res.body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), category: expect.any(String) });
    expect(res.body[0].nodes).toBeUndefined(); // 摘要不带大 JSON
    const ai = res.body.find((entry: { id: string }) => entry.id === 'ai-summary');
    expect(ai.credentialRequirements).toEqual([
      expect.objectContaining({ id: 'anthropic-model', credentialType: 'anthropicApi' }),
    ]);
  });

  it('模板详情只返回 setup 元数据，不泄露节点 JSON', async () => {
    const res = await request(app).get('/api/templates/ai-summary').set(authed()).expect(200);
    expect(res.body.id).toBe('ai-summary');
    expect(res.body.nodes).toBeUndefined();
    expect(res.body.credentialRequirements[0].nodeNames).toEqual(['Anthropic Chat Model']);
  });

  it('导入模板 → 建出结构合法的工作流', async () => {
    const res = await request(app).post('/api/templates/welcome-order/import').set(authed()).expect(201);
    expect(res.body.name).toBe('New order notification');
    expect(res.body.nodes).toHaveLength(4);
    // 列表里可见
    const list = await request(app).get('/api/workflows').set(authed()).expect(200);
    expect(list.body.map((w: { id: string }) => w.id)).toContain(res.body.id);
  });

  it('导入「分支合并入门」并手动运行 → 成功（模板真实可跑）', async () => {
    const imported = await request(app).post('/api/templates/branch-merge-demo/import').set(authed()).expect(201);
    const run = await request(app).post(`/api/workflows/${imported.body.id}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('success');

    const detail = await request(app).get(`/api/executions/${run.body.executionId}`).set(authed()).expect(200);
    const merged = detail.body.data.resultData.runData['Merge'][0].data.main[0].map((it: { json: Record<string, unknown> }) => it.json);
    expect(merged).toEqual([
      { amount: 150, size: 'big' },
      { amount: 50, size: 'small' },
    ]);
  });

  it('凭证向导按声明类型安全绑定到模板节点', async () => {
    const credential = await request(app)
      .post('/api/credentials')
      .set(authed())
      .send({ name: 'Anthropic production', type: 'anthropicApi', data: { apiKey: 'secret-test-key' } })
      .expect(201);
    const imported = await request(app).post('/api/templates/ai-summary/import').set(authed()).expect(201);
    const configured = await request(app)
      .post('/api/templates/ai-summary/setup')
      .set(authed())
      .send({ workflowId: imported.body.id, selections: { 'anthropic-model': credential.body.id } })
      .expect(200);
    const model = configured.body.nodes.find((node: { name: string }) => node.name === 'Anthropic Chat Model');
    expect(model.credentials.anthropicApi).toEqual({
      id: credential.body.id,
      name: 'Anthropic production',
    });

    const wrongType = await request(app)
      .post('/api/credentials')
      .set(authed())
      .send({ name: 'SMTP', type: 'smtp', data: { host: 'mail.invalid' } })
      .expect(201);
    await request(app)
      .post('/api/templates/ai-summary/setup')
      .set(authed())
      .send({ workflowId: imported.body.id, selections: { 'anthropic-model': wrongType.body.id } })
      .expect(400);
  });

  it('全部模板结构合法（每个都能导入）', async () => {
    for (const t of BUILTIN_TEMPLATES) {
      if (t.id === 'welcome-order' || t.id === 'branch-merge-demo') continue; // 已单独测
      await request(app).post(`/api/templates/${t.id}/import`).set(authed()).expect(201);
    }
  });

  it('未知模板 404；未登录 401', async () => {
    await request(app).post('/api/templates/nope/import').set(authed()).expect(404);
    await request(app).get('/api/templates').expect(401);
  });
});
