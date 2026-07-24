import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { classifyRisk } from '../services/instance-ai-tools.js';

/**
 * backlog #45 M3：HITL 待确认 —— 助手危险动作先挂 pending,人确认后才执行。
 * 验收：删/改动作被拦成待确认,拒绝则不执行。安全(只读)动作直接执行。用内置 archive_workflow
 * (真·改实例状态)演示 gate;归属经线程校验。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
let threadId = '';
const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  const reg = await request(app).post('/auth/register').send({ email: 'hitl@dev.dev', password: 'password-123' }).expect(201);
  token = reg.body.token;
  threadId = (await request(app).post('/api/instance-ai/threads').set(authed()).send({ title: 'Ops' }).expect(201)).body.id;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('风险分级纯函数（#45 M3）', () => {
  it('白名单只读工具 = safe;其余(含未知) = dangerous(fail-safe)', () => {
    expect(classifyRisk('echo').risk).toBe('safe');
    expect(classifyRisk('list_workflows').risk).toBe('safe');
    expect(classifyRisk('archive_workflow').risk).toBe('dangerous');
    expect(classifyRisk('some_unknown_tool').risk).toBe('dangerous'); // fail-safe
  });
});

describe('HITL 待确认（#45 M3）', () => {
  it('安全动作(echo) → 直接执行,不挂 pending', async () => {
    const r = (await request(app).post(`/api/instance-ai/threads/${threadId}/actions`).set(authed()).send({ tool: 'echo', args: { hi: 1 } }).expect(200)).body;
    expect(r.status).toBe('executed');
    expect(r.result).toEqual({ echoed: { hi: 1 } });
    // 无待确认项
    expect((await request(app).get(`/api/instance-ai/threads/${threadId}/actions`).set(authed()).expect(200)).body.filter((a: { status: string }) => a.status === 'pending')).toHaveLength(0);
  });

  it('危险动作(archive_workflow) → 挂 pending,不执行', async () => {
    const wf = (await request(app).post('/api/workflows').set(authed()).send({
      name: 'Keep me', nodes: [{ id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }], connections: {},
    }).expect(201)).body;

    const r = (await request(app).post(`/api/instance-ai/threads/${threadId}/actions`).set(authed()).send({ tool: 'archive_workflow', args: { id: wf.id } }).expect(200)).body;
    expect(r.status).toBe('pending');
    expect(r.action.status).toBe('pending');
    expect(r.action.reason).toContain('Archives');

    // 未执行：workflow 仍未归档
    const still = (await request(app).get(`/api/workflows/${wf.id}`).set(authed()).expect(200)).body;
    expect(still.archived).toBeFalsy();
  });

  it('拒绝 → 不执行（workflow 保持原样）', async () => {
    const wf = (await request(app).post('/api/workflows').set(authed()).send({
      name: 'Reject target', nodes: [{ id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }], connections: {},
    }).expect(201)).body;
    const r = (await request(app).post(`/api/instance-ai/threads/${threadId}/actions`).set(authed()).send({ tool: 'archive_workflow', args: { id: wf.id } }).expect(200)).body;

    const rejected = (await request(app).post(`/api/instance-ai/actions/${r.action.id}/reject`).set(authed()).expect(200)).body;
    expect(rejected.status).toBe('rejected');
    expect(rejected.decidedBy).toBeTruthy();

    const still = (await request(app).get(`/api/workflows/${wf.id}`).set(authed()).expect(200)).body;
    expect(still.archived).toBeFalsy(); // 拒绝 → 没归档
  });

  it('批准 → 执行（workflow 被归档）+ 结果记账 + tool 消息', async () => {
    const wf = (await request(app).post('/api/workflows').set(authed()).send({
      name: 'Approve target', nodes: [{ id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }], connections: {},
    }).expect(201)).body;
    const r = (await request(app).post(`/api/instance-ai/threads/${threadId}/actions`).set(authed()).send({ tool: 'archive_workflow', args: { id: wf.id } }).expect(200)).body;

    const approved = (await request(app).post(`/api/instance-ai/actions/${r.action.id}/approve`).set(authed()).expect(200)).body;
    expect(approved.status).toBe('approved');
    expect(approved.result).toMatchObject({ archived: wf.id, name: 'Approve target' });

    // 真执行：workflow 已归档
    const now = (await request(app).get(`/api/workflows/${wf.id}`).set(authed()).expect(200)).body;
    expect(now.archived).toBe(true);

    // 线程留了 tool 消息（pending + approved 两条）
    const detail = (await request(app).get(`/api/instance-ai/threads/${threadId}`).set(authed()).expect(200)).body;
    const toolMsgs = detail.messages.filter((m: { role: string; content: { tool?: string } }) => m.role === 'tool' && m.content.tool === 'archive_workflow');
    expect(toolMsgs.some((m: { content: { status?: string } }) => m.content.status === 'approved')).toBe(true);
  });

  it('重复决定 → 409（幂等保护）', async () => {
    const wf = (await request(app).post('/api/workflows').set(authed()).send({
      name: 'Twice', nodes: [{ id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }], connections: {},
    }).expect(201)).body;
    const r = (await request(app).post(`/api/instance-ai/threads/${threadId}/actions`).set(authed()).send({ tool: 'archive_workflow', args: { id: wf.id } }).expect(200)).body;
    await request(app).post(`/api/instance-ai/actions/${r.action.id}/approve`).set(authed()).expect(200);
    await request(app).post(`/api/instance-ai/actions/${r.action.id}/reject`).set(authed()).expect(409);
    await request(app).post(`/api/instance-ai/actions/${r.action.id}/approve`).set(authed()).expect(409);
  });

  it('未知工具批准时 → 400（没有执行器,fail-safe 不静默）', async () => {
    const r = (await request(app).post(`/api/instance-ai/threads/${threadId}/actions`).set(authed()).send({ tool: 'rm_rf_everything', args: {} }).expect(200)).body;
    expect(r.status).toBe('pending'); // 未知 → 判危险 → 挂 pending
    await request(app).post(`/api/instance-ai/actions/${r.action.id}/approve`).set(authed()).expect(400);
  });
});
