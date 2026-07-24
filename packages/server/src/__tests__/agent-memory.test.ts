import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { cosine, embed, topKMemories } from '../services/agent-run-service.js';

/**
 * backlog #44 M3：分层记忆 + 证据链 —— 一个线程说的偏好,换个线程能被召回并注入 system;
 * 每条记忆可追溯到来源运行。用会记录 body.system 的假 provider 断言注入,不打真实网络。
 */

/* ── 检索纯函数 ── */
describe('记忆检索纯函数（#44 M3）', () => {
  it('embed 产出归一化向量', () => {
    const v = embed('hello world hello');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('cosine：相关文本 > 无关文本', () => {
    const q = embed('please reply in french language');
    const near = cosine(q, embed('my preferred reply language is french'));
    const far = cosine(q, embed('the quick brown fox jumps'));
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(0);
  });

  it('topKMemories 按相似度排序 + 过滤噪声', () => {
    const q = embed('language preference french');
    const items = [
      { content: 'french language preference', embedding: embed('french language preference') },
      { content: 'unrelated banana content', embedding: embed('unrelated banana content') },
      { content: 'i like the french language', embedding: embed('i like the french language') },
    ];
    const top = topKMemories(q, items, 2);
    expect(top).toHaveLength(2);
    expect(top[0]!.content).toContain('french');
    expect(top.map((m) => m.content)).not.toContain('unrelated banana content');
  });
});

/* ── 跨线程召回 + 证据链（集成）── */
let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

// 记录每次 provider 请求的 system,断言召回注入
const seenSystems: string[] = [];
const fakeHttp = (async (o: unknown) => {
  const body = (o as { body?: { system?: string } }).body;
  seenSystems.push(body?.system ?? '');
  return { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 5 } };
}) as (o: unknown) => Promise<unknown>;

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, httpRequest: fakeHttp });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'mem@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'mem@test.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('分层记忆 + 证据链（#44 M3）', () => {
  let agentId = '';
  let threadA = '';
  let runA = '';

  it('线程 A 说的偏好被存为 agent 域记忆', async () => {
    const cred = (await request(app).post('/api/credentials').set(authed()).send({ name: 'Claude', type: 'anthropicApi', data: { apiKey: 'sk-test' } }).expect(201)).body;
    agentId = (await request(app).post('/api/agents').set(authed()).send({
      name: 'Mnemo',
      config: { system: 'Be helpful.', provider: 'anthropic', model: 'claude-sonnet-5', credentialId: cred.id },
    }).expect(201)).body.id;

    const run = (await request(app).post(`/api/agents/${agentId}/chat`).set(authed())
      .send({ message: 'Please always reply in French, French is my preferred language.' }).expect(200)).body;
    threadA = run.threadId;
    runA = run.runId;

    const mem = (await request(app).get(`/api/agents/${agentId}/memory`).set(authed()).expect(200)).body;
    expect(mem).toHaveLength(1);
    expect(mem[0].content).toContain('French');
    expect(mem[0].scope).toBe('agent');
  });

  it('每条记忆可追溯到来源运行（证据链）', async () => {
    const mem = (await request(app).get(`/api/agents/${agentId}/memory`).set(authed()).expect(200)).body;
    expect(mem[0].observations).toHaveLength(1);
    expect(mem[0].observations[0].runId).toBe(runA);
    expect(mem[0].observations[0].evidence).toMatchObject({ source: 'user-message', threadId: threadA });
  });

  it('换一个新线程,相关 query 召回 A 的偏好并注入 system', async () => {
    seenSystems.length = 0;
    // 新线程（不传 threadId）→ 不同 thread,但同一 agent
    const run = (await request(app).post(`/api/agents/${agentId}/chat`).set(authed())
      .send({ message: 'What is my preferred reply language again?' }).expect(200)).body;
    expect(run.threadId).not.toBe(threadA); // 确实是新线程

    // 本轮 provider 收到的 system 里含召回的记忆内容
    const sys = seenSystems.join('\n');
    expect(sys).toContain('Recalled from earlier conversations');
    expect(sys).toContain('Please always reply in French');
  });
});
