import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #45 M4：运行树 + 观察-反思记忆。
 * 验收：助手动作有调用树可看;跨线程记住经验。embedding 复用 #44 的 embedding.ts。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  const reg = await request(app).post('/auth/register').send({ email: 'm4@dev.dev', password: 'password-123' }).expect(201);
  token = reg.body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('运行树（#45 M4）', () => {
  let threadId = '';

  it('执行工具 → 运行树有根节点 + 子调用（archive_workflow 记 find/set 子步）', async () => {
    threadId = (await request(app).post('/api/instance-ai/threads').set(authed()).send({ title: 'Runs' }).expect(201)).body.id;
    const wf = (await request(app).post('/api/workflows').set(authed()).send({
      name: 'Tree target', nodes: [{ id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }], connections: {},
    }).expect(201)).body;

    // 危险动作 → 挂 pending → 批准执行（走 execToolWithTree）
    const r = (await request(app).post(`/api/instance-ai/threads/${threadId}/actions`).set(authed()).send({ tool: 'archive_workflow', args: { id: wf.id } }).expect(200)).body;
    await request(app).post(`/api/instance-ai/actions/${r.action.id}/approve`).set(authed()).expect(200);

    const runs = (await request(app).get(`/api/instance-ai/threads/${threadId}/runs`).set(authed()).expect(200)).body as Array<{ id: string; parentId: string | null; label: string; status: string; output: unknown }>;
    const root = runs.find((n) => n.parentId === null && n.label === 'archive_workflow');
    expect(root).toBeTruthy();
    expect(root!.status).toBe('success');
    // 子调用挂在根下（find_workflow + set_archived）
    const children = runs.filter((n) => n.parentId === root!.id);
    expect(children.map((c) => c.label).sort()).toEqual(['find_workflow', 'set_archived']);
    expect(children.every((c) => c.status === 'success')).toBe(true);
  });

  it('安全动作也进运行树（echo 根节点 success）', async () => {
    await request(app).post(`/api/instance-ai/threads/${threadId}/actions`).set(authed()).send({ tool: 'echo', args: { x: 1 } }).expect(200);
    const runs = (await request(app).get(`/api/instance-ai/threads/${threadId}/runs`).set(authed()).expect(200)).body;
    expect(runs.some((n: { label: string; status: string }) => n.label === 'echo' && n.status === 'success')).toBe(true);
  });

  it('失败动作 → 节点标 error（archive 不存在的 workflow）', async () => {
    const r = (await request(app).post(`/api/instance-ai/threads/${threadId}/actions`).set(authed()).send({ tool: 'archive_workflow', args: { id: 'nope-nope-nope' } }).expect(200)).body;
    await request(app).post(`/api/instance-ai/actions/${r.action.id}/approve`).set(authed()).expect(404); // 工具执行 404

    const runs = (await request(app).get(`/api/instance-ai/threads/${threadId}/runs`).set(authed()).expect(200)).body as Array<{ label: string; status: string; args?: unknown }>;
    // 该 archive 根节点标 error
    expect(runs.some((n) => n.label === 'archive_workflow' && n.status === 'error')).toBe(true);
  });
});

describe('观察-反思记忆（#45 M4）', () => {
  let threadA = '';
  let threadB = '';

  it('线程 A 记一条 instance 反思', async () => {
    threadA = (await request(app).post('/api/instance-ai/threads').set(authed()).send({ title: 'A' }).expect(201)).body.id;
    threadB = (await request(app).post('/api/instance-ai/threads').set(authed()).send({ title: 'B' }).expect(201)).body.id;
    const m = (await request(app).post(`/api/instance-ai/threads/${threadA}/memory`).set(authed()).send({
      scope: 'instance', kind: 'reflection', content: 'Deploys on Friday afternoon often cause weekend incidents; avoid them.',
    }).expect(201)).body;
    expect(m.scope).toBe('instance');
    expect(m.embedding).toBeUndefined(); // 向量不出 API
  });

  it('跨线程召回：线程 B 用相关 query 召回线程 A 的反思', async () => {
    const mems = (await request(app).get('/api/instance-ai/recall').query({ q: 'when should we avoid deploying?', threadId: threadB }).set(authed()).expect(200)).body as Array<{ content: string }>;
    expect(mems.length).toBeGreaterThan(0);
    expect(mems[0]!.content).toContain('Friday');
  });

  it('thread 域记忆只在本线程召回,不跨线程', async () => {
    await request(app).post(`/api/instance-ai/threads/${threadA}/memory`).set(authed()).send({
      scope: 'thread', kind: 'observation', content: 'Local scratchpad note about widget frobnication.',
    }).expect(201);

    // 本线程 A：召回得到
    const inA = (await request(app).get('/api/instance-ai/recall').query({ q: 'widget frobnication note', threadId: threadA }).set(authed()).expect(200)).body as Array<{ content: string }>;
    expect(inA.some((m) => m.content.includes('frobnication'))).toBe(true);
    // 线程 B：thread 域的召不到
    const inB = (await request(app).get('/api/instance-ai/recall').query({ q: 'widget frobnication note', threadId: threadB }).set(authed()).expect(200)).body as Array<{ content: string }>;
    expect(inB.some((m) => m.content.includes('frobnication'))).toBe(false);
  });
});
