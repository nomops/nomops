import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import type { CallClaude } from '../services/assistant-service.js';

/**
 * backlog #45 M1：AI 建流会话 + 临时流 —— 多轮迭代 → 草稿 revision 链 → 预览 → 回退 →
 * Apply 落正式 workflow。callClaude 注入假实现(按用户消息返回不同草稿),不打真实网络。
 * 验收：多轮改流、回退到上一轮、Apply 后成为可运行工作流。
 */

/** 假 Claude：含 "add"→3 节点草稿；含 "how"→纯聊天(无 JSON)；否则→2 节点草稿。 */
const fakeBuilder: CallClaude = async ({ system, messages }) => {
  expect(system).toContain('nomops.set'); // system 注入了节点知识
  const last = messages[messages.length - 1]!.content.toLowerCase();
  if (last.includes('how')) return '你想先接收什么数据？可以用 Webhook 或 Manual Trigger 起头。';
  const withIf = last.includes('add');
  const nodes = [
    { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: 'b', name: 'Tag', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { ok: true } } },
  ];
  const connections: Record<string, unknown> = { Start: { main: [[{ node: 'Tag', type: 'main', index: 0 }]] } };
  if (withIf) {
    nodes.push({ id: 'c', name: 'Check', type: 'nomops.if', typeVersion: 1, position: [400, 0], parameters: {} });
    connections['Tag'] = { main: [[{ node: 'Check', type: 'main', index: 0 }]] };
  }
  return [
    withIf ? '好的，加了一个 IF 判断节点：' : '给你搭一个手动触发 → 打标流程：',
    '```json',
    JSON.stringify({ name: withIf ? '带判断的流程' : '打标流程', nodes, connections }),
    '```',
  ].join('\n');
};

let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, callClaude: fakeBuilder });
  app = createApp(boot.services);
  const reg = await request(app).post('/auth/register').send({ email: 'builder@dev.dev', password: 'password-123' }).expect(201);
  token = reg.body.token;
  await request(app).post('/api/credentials').set(authed()).send({ name: 'claude', type: 'anthropicApi', data: { apiKey: 'sk-ant-xxx' } }).expect(201);
});

afterAll(async () => {
  await boot.shutdown();
});

describe('AI 建流会话（#45 M1）', () => {
  let sessionId = '';
  let rev1Id = '';
  let rev2Id = '';

  it('建会话 → active,标题取自 goal', async () => {
    const s = (await request(app).post('/api/builder/sessions').set(authed()).send({ goal: '搭一个手动触发打标的流程' }).expect(201)).body;
    sessionId = s.id;
    expect(s.status).toBe('active');
    expect(s.title).toBe('搭一个手动触发打标的流程');
    expect(s.appliedWorkflowId).toBeNull();
  });

  it('第一轮对话 → 产出草稿 revision 1（2 节点）', async () => {
    const r = (await request(app).post(`/api/builder/sessions/${sessionId}/chat`).set(authed()).send({ message: 'build it' }).expect(200)).body;
    expect(r.reply).toContain('打标流程');
    expect(r.revision).toMatchObject({ revision: 1, name: '打标流程' });
    rev1Id = r.revision.id;
  });

  it('第二轮迭代 → 草稿 revision 2（3 节点,加 IF）,currentRevision 指向新版', async () => {
    const r = (await request(app).post(`/api/builder/sessions/${sessionId}/chat`).set(authed()).send({ message: 'add an IF node' }).expect(200)).body;
    expect(r.revision.revision).toBe(2);
    rev2Id = r.revision.id;

    const detail = (await request(app).get(`/api/builder/sessions/${sessionId}`).set(authed()).expect(200)).body;
    expect(detail.revisions).toHaveLength(2);
    expect(detail.session.currentRevisionId).toBe(rev2Id);
    // 服务端权威记消息：user+assistant × 2 轮 = 4 条
    expect(detail.session.messages).toHaveLength(4);
  });

  it('纯澄清轮（无 JSON）→ 不建 revision', async () => {
    const r = (await request(app).post(`/api/builder/sessions/${sessionId}/chat`).set(authed()).send({ message: 'how do I start?' }).expect(200)).body;
    expect(r.revision).toBeNull();
    const detail = (await request(app).get(`/api/builder/sessions/${sessionId}`).set(authed()).expect(200)).body;
    expect(detail.revisions).toHaveLength(2); // 仍是 2 版
  });

  it('预览某版草稿 → 返回 nodes/connections（供 ReadOnlyCanvas）', async () => {
    const rev1 = (await request(app).get(`/api/builder/sessions/${sessionId}/revisions/${rev1Id}`).set(authed()).expect(200)).body;
    expect(rev1.nodes).toHaveLength(2);
    const rev2 = (await request(app).get(`/api/builder/sessions/${sessionId}/revisions/${rev2Id}`).set(authed()).expect(200)).body;
    expect(rev2.nodes).toHaveLength(3);
  });

  it('回退到上一轮 → currentRevision 指回 revision 1', async () => {
    const detail = (await request(app).post(`/api/builder/sessions/${sessionId}/rollback`).set(authed()).send({ revisionId: rev1Id }).expect(200)).body;
    expect(detail.session.currentRevisionId).toBe(rev1Id);
    expect(detail.revisions).toHaveLength(2); // 回退不删后来的版本
  });

  it('Apply（当前=回退后的 revision 1）→ 成为可运行工作流,会话置 applied', async () => {
    const applied = (await request(app).post(`/api/builder/sessions/${sessionId}/apply`).set(authed()).send({}).expect(201)).body;
    expect(applied.workflowId).toBeTruthy();
    expect(applied.name).toBe('打标流程');

    // 落地的正式流是 revision 1 的 2 节点,且可运行
    const wf = (await request(app).get(`/api/workflows/${applied.workflowId}`).set(authed()).expect(200)).body;
    expect(wf.nodes).toHaveLength(2);
    const run = (await request(app).post(`/api/workflows/${applied.workflowId}/run`).set(authed()).send({}).expect(200)).body;
    expect(run.status).toBe('success');

    // 会话 applied + appliedWorkflowId 记账
    const detail = (await request(app).get(`/api/builder/sessions/${sessionId}`).set(authed()).expect(200)).body;
    expect(detail.session.status).toBe('applied');
    expect(detail.session.appliedWorkflowId).toBe(applied.workflowId);
  });

  it('已 applied 的会话不能再对话/再 Apply → 409', async () => {
    await request(app).post(`/api/builder/sessions/${sessionId}/chat`).set(authed()).send({ message: 'more' }).expect(409);
    await request(app).post(`/api/builder/sessions/${sessionId}/apply`).set(authed()).send({}).expect(409);
  });

  it('归属隔离：临时流不进 workflows 列表（只有 Apply 落地的那条）', async () => {
    const list = (await request(app).get('/api/workflows').set(authed()).expect(200)).body;
    // 建流会话跑了多版草稿,但 workflows 里只应有 1 条（Apply 物化的）
    expect(list.filter((w: { name: string }) => w.name === '打标流程')).toHaveLength(1);
    expect(list.some((w: { name: string }) => w.name === '带判断的流程')).toBe(false);
  });

  it('未知会话 id → 404（归属过滤 findSession(id, projectId) 命不中即 not found）', async () => {
    await request(app).get('/api/builder/sessions/00000000-0000-0000-0000-000000000000').set(authed()).expect(404);
  });
});
