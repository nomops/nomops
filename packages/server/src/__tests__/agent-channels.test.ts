import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #44 M5：文件 + 外部渠道 —— agent_files(binaryStore) + agent_channels(Telegram)。
 * 验收：Telegram 发消息触发 agent、回复回渠道。telegramFetch 注入假实现,断言 setWebhook/
 * sendMessage 调用;模型 provider 也注入假实现,全程不打真实网络。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

// 假模型 provider
const fakeHttp = (async () => ({
  content: [{ type: 'text', text: 'reply from agent' }],
  usage: { input_tokens: 12, output_tokens: 4 },
})) as (o: unknown) => Promise<unknown>;

// 假 Telegram Bot API：记录 (url, body)
const telegramCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
const fakeTelegram = (async (url: unknown, init?: { body?: string }) => {
  telegramCalls.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}) as typeof fetch;

let agentId = '';
let tgCredId = '';

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, httpRequest: fakeHttp, telegramFetch: fakeTelegram });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'chan@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'chan@test.dev', password: 'password-123' }).expect(200)).body.token;
  const modelCred = (await request(app).post('/api/credentials').set(authed()).send({ name: 'Claude', type: 'anthropicApi', data: { apiKey: 'sk-test' } }).expect(201)).body;
  tgCredId = (await request(app).post('/api/credentials').set(authed()).send({ name: 'Bot', type: 'telegramApi', data: { accessToken: '123:tg-secret-token' } }).expect(201)).body.id;
  agentId = (await request(app).post('/api/agents').set(authed()).send({
    name: 'Channel Agent',
    config: { system: 'Be brief.', provider: 'anthropic', model: 'claude-sonnet-5', credentialId: modelCred.id },
  }).expect(201)).body.id;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('Agent 文件（#44 M5）', () => {
  it('上传(base64→binaryStore) → 列表(不含 binaryId) → 下载回读 → 删除', async () => {
    const payload = 'hello agent files 你好';
    const f = (await request(app).post(`/api/agents/${agentId}/files`).set(authed()).send({
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      data: Buffer.from(payload).toString('base64'),
    }).expect(201)).body;
    expect(f.fileName).toBe('notes.txt');
    expect(f.size).toBe(Buffer.byteLength(payload));
    expect(f.binaryId).toBeUndefined(); // 内部存储引用不出 API

    const list = (await request(app).get(`/api/agents/${agentId}/files`).set(authed()).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0].binaryId).toBeUndefined();

    const dl = await request(app).get(`/api/agents/${agentId}/files/${f.id}/download`).set(authed()).expect(200);
    expect(dl.headers['content-type']).toContain('text/plain');
    expect(dl.text).toBe(payload);

    await request(app).delete(`/api/agents/${agentId}/files/${f.id}`).set(authed()).expect(204);
    expect((await request(app).get(`/api/agents/${agentId}/files`).set(authed()).expect(200)).body).toHaveLength(0);
  });

  it('跨 agent 拿不到别人的文件（归属校验）', async () => {
    const f = (await request(app).post(`/api/agents/${agentId}/files`).set(authed()).send({
      fileName: 'a.txt', mimeType: 'text/plain', data: Buffer.from('x').toString('base64'),
    }).expect(201)).body;
    const other = (await request(app).post('/api/agents').set(authed()).send({ name: 'Other', config: {} }).expect(201)).body;
    await request(app).get(`/api/agents/${other.id}/files/${f.id}/download`).set(authed()).expect(404);
  });
});

describe('Telegram 渠道（#44 M5）', () => {
  let webhookUrl = '';
  let channelId = '';

  it('建渠道 → webhookUrl 带 secret + 自动 setWebhook(经注入 fetch,token 不出 API)', async () => {
    telegramCalls.length = 0;
    const c = (await request(app).post(`/api/agents/${agentId}/channels`).set(authed()).send({
      type: 'telegram', credentialId: tgCredId,
    }).expect(201)).body;
    channelId = c.id;
    webhookUrl = c.webhookUrl;
    expect(webhookUrl).toContain(`/webhook/agent-channel/${c.id}/`);
    expect(JSON.stringify(c)).not.toContain('tg-secret-token'); // 铁律 3：token 不出 API

    // 自动注册 webhook：URL 带 bot token(直连 Telegram),body 是我们的公开入口
    const setCall = telegramCalls.find((x) => x.url.includes('/setWebhook'));
    expect(setCall).toBeTruthy();
    expect(setCall!.url).toContain('123:tg-secret-token');
    expect(setCall!.body['url']).toBe(webhookUrl);
  });

  it('Telegram 发消息 → 触发 agent → 回复回渠道(sendMessage 同 chat_id)', async () => {
    telegramCalls.length = 0;
    const path = new URL(webhookUrl).pathname;
    const r = (await request(app).post(path).send({
      message: { chat: { id: 42 }, text: 'Hi from Telegram' },
    }).expect(200)).body;
    expect(r.ok).toBe(true);
    expect(r.runId).toBeTruthy();

    const send = telegramCalls.find((x) => x.url.includes('/sendMessage'));
    expect(send).toBeTruthy();
    expect(send!.body).toMatchObject({ chat_id: 42, text: 'reply from agent' });
  });

  it('同一 chat_id 复用同一线程(externalRef 映射),不同 chat_id 开新线程', async () => {
    const path = new URL(webhookUrl).pathname;
    await request(app).post(path).send({ message: { chat: { id: 42 }, text: 'again' } }).expect(200);
    await request(app).post(path).send({ message: { chat: { id: 99 }, text: 'someone else' } }).expect(200);

    const threads = (await request(app).get(`/api/agents/${agentId}/threads`).set(authed()).expect(200)).body as Array<{ id: string; channel: string }>;
    const tg = threads.filter((t) => t.channel === 'telegram');
    expect(tg).toHaveLength(2); // chat 42 + chat 99

    // chat 42 的线程累计 2 次 run
    const runs = await Promise.all(tg.map(async (t) =>
      (await request(app).get(`/api/agents/${agentId}/threads/${t.id}`).set(authed()).expect(200)).body.runs.length));
    expect(runs.sort()).toEqual([1, 2]);
  });

  it('secret 不匹配/渠道停用 → 一律 404', async () => {
    const path = new URL(webhookUrl).pathname;
    await request(app).post(path.replace(/[^/]+$/, 'wrong-secret')).send({ message: { chat: { id: 1 }, text: 'x' } }).expect(404);

    await request(app).patch(`/api/agents/${agentId}/channels/${channelId}`).set(authed()).send({ active: false }).expect(200);
    await request(app).post(path).send({ message: { chat: { id: 42 }, text: 'x' } }).expect(404);
    await request(app).patch(`/api/agents/${agentId}/channels/${channelId}`).set(authed()).send({ active: true }).expect(200);
  });

  it('非文本 update → 确认收到但不触发运行', async () => {
    telegramCalls.length = 0;
    const path = new URL(webhookUrl).pathname;
    const r = (await request(app).post(path).send({ message: { chat: { id: 42 } } }).expect(200)).body;
    expect(r.ok).toBe(true);
    expect(r.runId).toBeUndefined();
    expect(telegramCalls).toHaveLength(0);
  });
});
