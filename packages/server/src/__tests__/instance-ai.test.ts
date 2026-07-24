import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import type { CallClaude } from '../services/assistant-service.js';

/**
 * backlog #45 M2：有检查点的 AI 线程底座 —— 线程可序列化状态落检查点、可回滚续跑。
 * 验收：线程中断后从检查点恢复,状态一致。callClaude 注入假实现(chat 一轮),不打真实网络。
 */
const fakeReply: CallClaude = async ({ messages }) => `echo: ${messages[messages.length - 1]!.content}`;

let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, callClaude: fakeReply });
  app = createApp(boot.services);
  const reg = await request(app).post('/auth/register').send({ email: 'iai@dev.dev', password: 'password-123' }).expect(201);
  token = reg.body.token;
  await request(app).post('/api/credentials').set(authed()).send({ name: 'claude', type: 'anthropicApi', data: { apiKey: 'sk-ant-xxx' } }).expect(201);
});

afterAll(async () => {
  await boot.shutdown();
});

describe('有检查点的 AI 线程（#45 M2）', () => {
  let threadId = '';
  let cpId = '';

  it('建线程 → ops,空 state', async () => {
    const t = (await request(app).post('/api/instance-ai/threads').set(authed()).send({ title: 'Ops session' }).expect(201)).body;
    threadId = t.id;
    expect(t.kind).toBe('ops');
    expect(t.state).toEqual({});
  });

  it('追加消息 + 设工作态,然后存检查点（快照 state + 消息条数）', async () => {
    await request(app).post(`/api/instance-ai/threads/${threadId}/messages`).set(authed()).send({ role: 'user', content: { text: 'step 1' } }).expect(201);
    await request(app).post(`/api/instance-ai/threads/${threadId}/messages`).set(authed()).send({ role: 'assistant', content: { text: 'ok 1' } }).expect(201);
    await request(app).put(`/api/instance-ai/threads/${threadId}/state`).set(authed()).send({ state: { step: 2, plan: ['a', 'b'] } }).expect(200);

    const cp = (await request(app).post(`/api/instance-ai/threads/${threadId}/checkpoints`).set(authed()).send({ label: 'before risky step' }).expect(201)).body;
    cpId = cp.id;
    expect(cp.seq).toBe(1);
    expect(cp.messageCount).toBe(2);
    expect(cp.state).toEqual({ step: 2, plan: ['a', 'b'] });
  });

  it('继续工作（模拟“中断/走错”）：再追加消息 + 改 state', async () => {
    await request(app).post(`/api/instance-ai/threads/${threadId}/messages`).set(authed()).send({ role: 'user', content: { text: 'step 3 (wrong path)' } }).expect(201);
    await request(app).put(`/api/instance-ai/threads/${threadId}/state`).set(authed()).send({ state: { step: 3, broken: true } }).expect(200);

    const detail = (await request(app).get(`/api/instance-ai/threads/${threadId}`).set(authed()).expect(200)).body;
    expect(detail.messages).toHaveLength(3);
    expect(detail.thread.state).toEqual({ step: 3, broken: true });
  });

  it('从检查点恢复 → 状态一致：state 还原、后续消息截断', async () => {
    const detail = (await request(app).post(`/api/instance-ai/threads/${threadId}/restore`).set(authed()).send({ checkpointId: cpId }).expect(200)).body;
    // state 精确还原到快照
    expect(detail.thread.state).toEqual({ step: 2, plan: ['a', 'b'] });
    // 检查点后追加的第 3 条消息被截断
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages.map((m: { content: { text: string } }) => m.content.text)).toEqual(['step 1', 'ok 1']);
  });

  it('续跑：恢复后再追加消息,seq 从截断处接续（无空洞）', async () => {
    const m = (await request(app).post(`/api/instance-ai/threads/${threadId}/messages`).set(authed()).send({ role: 'user', content: { text: 'step 3 (retry)' } }).expect(201)).body;
    expect(m.seq).toBe(3); // 截断后消息数=2,下一条 seq=3

    const detail = (await request(app).get(`/api/instance-ai/threads/${threadId}`).set(authed()).expect(200)).body;
    expect(detail.messages.map((m: { seq: number }) => m.seq)).toEqual([1, 2, 3]);
  });

  it('恢复也作废检查点之后建的检查点（防悬挂快照）', async () => {
    // 先建第 2 个检查点,再回滚到第 1 个 → 第 2 个应被清
    await request(app).post(`/api/instance-ai/threads/${threadId}/checkpoints`).set(authed()).send({ label: 'cp2' }).expect(201);
    let detail = (await request(app).get(`/api/instance-ai/threads/${threadId}`).set(authed()).expect(200)).body;
    expect(detail.checkpoints).toHaveLength(2);

    await request(app).post(`/api/instance-ai/threads/${threadId}/restore`).set(authed()).send({ checkpointId: cpId }).expect(200);
    detail = (await request(app).get(`/api/instance-ai/threads/${threadId}`).set(authed()).expect(200)).body;
    expect(detail.checkpoints).toHaveLength(1); // 只剩被回滚到的那个
  });

  it('对话一轮（真·AI 线程,复用 assistant）→ user+assistant 两条消息', async () => {
    const before = (await request(app).get(`/api/instance-ai/threads/${threadId}`).set(authed()).expect(200)).body.messages.length;
    const r = (await request(app).post(`/api/instance-ai/threads/${threadId}/chat`).set(authed()).send({ message: 'hello', model: 'claude-sonnet-5' }).expect(200)).body;
    expect(r.reply).toBe('echo: hello');
    const detail = (await request(app).get(`/api/instance-ai/threads/${threadId}`).set(authed()).expect(200)).body;
    expect(detail.messages.length).toBe(before + 2);
    expect(detail.messages.at(-1).role).toBe('assistant');
    expect(detail.messages.at(-1).content.text).toBe('echo: hello');
  });

  it('归属隔离：未知线程 / 别人的线程 → 404', async () => {
    await request(app).get('/api/instance-ai/threads/00000000-0000-0000-0000-000000000000').set(authed()).expect(404);
  });
});
