import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { computeCost, extractUsage } from '../services/agent-run-service.js';

/**
 * backlog #44 M2：线程化执行 + 成本核算 —— 对话触发 agent 运行 → 线程留痕 →
 * 运行详情有 token/成本 + 链到 execution。注入假 provider(返回 usage),不打真实网络。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

// 假 Anthropic：回一段文本 + usage(input 100 / output 50)
const fakeHttp = (async () => ({
  content: [{ type: 'text', text: 'Hello from the agent.' }],
  usage: { input_tokens: 100, output_tokens: 50 },
})) as (o: unknown) => Promise<unknown>;

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, httpRequest: fakeHttp });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'run@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'run@test.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('成本核算纯函数（#44 M2）', () => {
  it('extractUsage 从 runData 扫 _nmUsage', () => {
    const runData = { Agent: [{ data: { main: [[{ json: { output: 'x', _nmUsage: { inputTokens: 100, outputTokens: 50 } } }]] } }] };
    expect(extractUsage(runData)).toEqual({ inputTokens: 100, outputTokens: 50 });
  });
  it('computeCost 按 model 计价', () => {
    // claude-sonnet-5: in 3 / out 15 micros/token → 100*3 + 50*15 = 1050
    expect(computeCost('claude-sonnet-5', 100, 50)).toBe(1050);
  });
});

describe('Agent 线程化执行（#44 M2）', () => {
  let agentId = '';

  it('对话触发 agent 运行 → 线程留痕 + token/成本 + executionId', async () => {
    // 需要一个 anthropicApi 凭证供后备工作流的 ChatModel 用
    const cred = (await request(app).post('/api/credentials').set(authed()).send({ name: 'Claude', type: 'anthropicApi', data: { apiKey: 'sk-test' } }).expect(201)).body;
    agentId = (await request(app).post('/api/agents').set(authed()).send({
      name: 'Runner',
      config: { system: 'Be brief.', provider: 'anthropic', model: 'claude-sonnet-5', credentialId: cred.id },
    }).expect(201)).body.id;

    const run = (await request(app).post(`/api/agents/${agentId}/chat`).set(authed()).send({ message: 'hi there' }).expect(200)).body;
    expect(run.status).toBe('success');
    expect(run.reply).toBe('Hello from the agent.');
    expect(run.inputTokens).toBe(100);
    expect(run.outputTokens).toBe(50);
    expect(run.costMicros).toBe(1050); // 100*3 + 50*15
    expect(run.executionId).toBeTruthy();
    expect(run.threadId).toBeTruthy();

    // 该 execution 真存在(可跳详情) + mode=chat
    const exec = (await request(app).get(`/api/executions/${run.executionId}`).set(authed()).expect(200)).body;
    expect(exec.execution.mode).toBe('chat');
  });

  it('线程留痕：runs + messages 可回读', async () => {
    const threads = (await request(app).get(`/api/agents/${agentId}/threads`).set(authed()).expect(200)).body;
    expect(threads.length).toBe(1);
    const detail = (await request(app).get(`/api/agents/${agentId}/threads/${threads[0].id}`).set(authed()).expect(200)).body;
    expect(detail.runs).toHaveLength(1);
    expect(detail.runs[0]).toMatchObject({ inputTokens: 100, outputTokens: 50, costMicros: 1050, model: 'claude-sonnet-5' });
    expect(detail.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(detail.messages[1].content).toEqual({ text: 'Hello from the agent.' });
  });

  it('同一线程续跑 → 累计第二条 run', async () => {
    const threads = (await request(app).get(`/api/agents/${agentId}/threads`).set(authed()).expect(200)).body;
    await request(app).post(`/api/agents/${agentId}/chat`).set(authed()).send({ message: 'again', threadId: threads[0].id }).expect(200);
    const detail = (await request(app).get(`/api/agents/${agentId}/threads/${threads[0].id}`).set(authed()).expect(200)).body;
    expect(detail.runs).toHaveLength(2);
  });
});
