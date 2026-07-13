import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import type { CallClaude } from '../services/assistant-service.js';

/** B2 验收：AI 助手对话、凭证解析、workflow JSON 抽取+校验。callClaude 注入假实现（不打真实 API）。 */

/** 假 Claude：回一段带合法 nomops workflow JSON 的文本。 */
const fakeWithWorkflow: CallClaude = async ({ system, messages }) => {
  // 断言 system prompt 注入了节点知识
  expect(system).toContain('nomops.set');
  expect(messages[messages.length - 1]!.role).toBe('user');
  return [
    '好的，给你搭一个手动触发 → 打标的流程：',
    '```json',
    JSON.stringify({
      name: 'AI 演示流',
      nodes: [
        { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'b', name: 'Tag', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { ok: true } } },
      ],
      connections: { Start: { main: [[{ node: 'Tag', type: 'main', index: 0 }]] } },
    }),
    '```',
  ].join('\n');
};

let boot: BootstrapResult;
let app: Express;
let token: string;

async function setup(callClaude?: CallClaude) {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, callClaude });
  app = createApp(boot.services);
  const reg = await request(app).post('/auth/register').send({ email: 'ai@dev.dev', password: 'password-123' }).expect(201);
  token = reg.body.token;
}
const authed = () => ({ Authorization: `Bearer ${token}` });

afterEach(async () => {
  await boot.shutdown();
});

describe('AI 助手', () => {
  it('无 Anthropic 凭证 → 400 引导去配置', async () => {
    await setup(fakeWithWorkflow);
    const res = await request(app)
      .post('/api/assistant/chat')
      .set(authed())
      .send({ messages: [{ role: 'user', content: '帮我搭个流' }] })
      .expect(400);
    expect(res.body.error).toMatch(/Anthropic credential/);
  });

  it('配置凭证后对话 → 返回回复 + 抽取并校验的 workflow', async () => {
    await setup(fakeWithWorkflow);
    await request(app)
      .post('/api/credentials')
      .set(authed())
      .send({ name: 'claude', type: 'anthropicApi', data: { apiKey: 'sk-ant-xxx' } })
      .expect(201);

    const res = await request(app)
      .post('/api/assistant/chat')
      .set(authed())
      .send({ messages: [{ role: 'user', content: '搭一个手动触发打标的流程' }] })
      .expect(200);

    expect(res.body.reply).toContain('给你搭一个');
    expect(res.body.workflow).toMatchObject({ name: 'AI 演示流' });
    expect(res.body.workflow.nodes).toHaveLength(2);

    // workflow 建议真实可导入（用它建流并跑通）
    const created = await request(app).post('/api/workflows').set(authed()).send(res.body.workflow).expect(201);
    const run = await request(app).post(`/api/workflows/${created.body.id}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('success');
  });

  it('回复不含 JSON（纯聊天）→ workflow 为 null', async () => {
    const chatOnly: CallClaude = async () => '你可以先加一个 Webhook 节点接收数据，再问我下一步。';
    await setup(chatOnly);
    await request(app).post('/api/credentials').set(authed()).send({ name: 'c', type: 'anthropicApi', data: { apiKey: 'k' } }).expect(201);
    const res = await request(app)
      .post('/api/assistant/chat')
      .set(authed())
      .send({ messages: [{ role: 'user', content: '怎么接收数据' }] })
      .expect(200);
    expect(res.body.workflow).toBeNull();
    expect(res.body.reply).toContain('Webhook');
  });

  it('回复含非法 workflow（引用不存在的节点类型）→ workflow 为 null（结构校验拦下）', async () => {
    const badWf: CallClaude = async () =>
      '试试：\n```json\n' +
      JSON.stringify({
        name: 'bad',
        nodes: [{ id: 'a', name: 'X', type: 'nomops.doesNotExist', typeVersion: 1, position: [0, 0], parameters: {} }],
        connections: {},
      }) +
      '\n```';
    await setup(badWf);
    await request(app).post('/api/credentials').set(authed()).send({ name: 'c', type: 'anthropicApi', data: { apiKey: 'k' } }).expect(201);
    const res = await request(app)
      .post('/api/assistant/chat')
      .set(authed())
      .send({ messages: [{ role: 'user', content: '搭个流' }] })
      .expect(200);
    expect(res.body.workflow).toBeNull(); // 未知节点类型被拦下
  });

  it('未登录 → 401；messages 缺失 → 400', async () => {
    await setup(fakeWithWorkflow);
    await request(app).post('/api/assistant/chat').send({ messages: [] }).expect(401);
    await request(app).post('/api/assistant/chat').set(authed()).send({}).expect(400);
  });
});
