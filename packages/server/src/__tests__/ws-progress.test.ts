import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { attachWebSocket } from '../ws/attach.js';
import type { IPushEvent, IPushMessage } from '../ws/push-hub.js';

/** Phase 3 验收：WS 能收到逐节点执行进度。 */

let boot: BootstrapResult;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  const app = createApp(boot.services);
  server = createServer(app);
  attachWebSocket(server, boot.services, { heartbeatIntervalMs: 50 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await boot.dbHandle.close();
});

describe('WS 执行进度推送', () => {
  it('未带 token 连接被拒（401）', async () => {
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws`);
    const error = await new Promise<Error>((resolve) => ws.once('error', resolve));
    expect(error.message).toMatch(/401/);
  });

  it('运行工作流时收到 executionStarted → before/after 每节点 → executionFinished', async () => {
    // 注册登录
    await request(server).post('/auth/register').send({ email: 'ws@test.dev', password: 'password-123' });
    const { body: login } = await request(server)
      .post('/auth/login')
      .send({ email: 'ws@test.dev', password: 'password-123' });
    const token = login.token as string;

    // 建流并运行
    const { body: wf } = await request(server)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'ws-flow',
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { x: 1 } } },
        ],
        connections: { Start: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
      });
    // 连入该 workflow 的专属频道
    const ws = new WebSocket(
      `${baseUrl.replace('http', 'ws')}/ws?token=${token}&workflowId=${encodeURIComponent(wf.id)}`,
    );
    await new Promise((resolve) => ws.once('open', resolve));
    const messages: IPushMessage[] = [];
    ws.on('message', (raw) => messages.push(JSON.parse(String(raw)) as IPushMessage));
    const { body: run } = await request(server)
      .post(`/api/workflows/${wf.id}/run`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(run.status).toBe('success');

    // 等事件送达
    await new Promise((resolve) => setTimeout(resolve, 200));
    ws.close();

    const events = messages.filter((message): message is IPushEvent => message.type !== 'heartbeat');
    const types = events.map((e) => `${e.type}${e.nodeName ? ':' + e.nodeName : ''}`);
    expect(types).toEqual([
      'executionStarted',
      'nodeExecuteBefore:Start',
      'nodeExecuteAfter:Start',
      'nodeExecuteBefore:Set',
      'nodeExecuteAfter:Set',
      'executionFinished',
    ]);
    // after 事件带输出摘要
    const setAfter = events.find((e) => e.type === 'nodeExecuteAfter' && e.nodeName === 'Set');
    expect(setAfter?.summary?.itemCount).toBe(1);
    // finished 带最终状态
    expect(events[events.length - 1]?.status).toBe('success');
  });

  it('必须声明 workflowId，且不存在或无权限的 workflow 频道被拒', async () => {
    const { body: login } = await request(server)
      .post('/auth/login')
      .send({ email: 'ws@test.dev', password: 'password-123' });
    const token = login.token as string;

    const missing = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws?token=${token}`);
    expect((await new Promise<Error>((resolve) => missing.once('error', resolve))).message).toMatch(/400/);

    const forbidden = new WebSocket(
      `${baseUrl.replace('http', 'ws')}/ws?token=${token}&workflowId=does-not-exist`,
    );
    expect((await new Promise<Error>((resolve) => forbidden.once('error', resolve))).message).toMatch(/403/);

    const { body: ownerWorkflow } = await request(server)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'private-channel', nodes: [], connections: {} })
      .expect(201);
    const ownerIdentity = boot.services.auth.verify(token);
    const invitation = await boot.services.auth.invite({
      email: 'ws-outsider@test.dev',
      role: 'member',
      invitedBy: ownerIdentity.sub,
      baseUrl,
    });
    const outsider = await boot.services.auth.acceptInvite(invitation.token, { password: 'password-123' });
    const ownerProjectId = ownerIdentity.projectId;
    const crossProject = new WebSocket(
      `${baseUrl.replace('http', 'ws')}/ws?token=${outsider.token}`
      + `&workflowId=${encodeURIComponent(ownerWorkflow.id as string)}`
      + `&projectId=${encodeURIComponent(ownerProjectId)}`,
    );
    expect((await new Promise<Error>((resolve) => crossProject.once('error', resolve))).message).toMatch(/403/);
  });

  it('按 workflow 隔离事件，并持续发送应用心跳', async () => {
    const { body: login } = await request(server)
      .post('/auth/login')
      .send({ email: 'ws@test.dev', password: 'password-123' });
    const token = login.token as string;
    const create = (name: string) => request(server)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name,
        nodes: [{ id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
        connections: {},
      });
    const [{ body: first }, { body: second }] = await Promise.all([create('channel-a'), create('channel-b')]);
    const connect = async (workflowId: string) => {
      const ws = new WebSocket(
        `${baseUrl.replace('http', 'ws')}/ws?token=${token}&workflowId=${encodeURIComponent(workflowId)}`,
      );
      await new Promise((resolve) => ws.once('open', resolve));
      return ws;
    };
    const [firstWs, secondWs] = await Promise.all([connect(first.id as string), connect(second.id as string)]);
    const firstMessages: IPushMessage[] = [];
    const secondMessages: IPushMessage[] = [];
    firstWs.on('message', (raw) => firstMessages.push(JSON.parse(String(raw)) as IPushMessage));
    secondWs.on('message', (raw) => secondMessages.push(JSON.parse(String(raw)) as IPushMessage));

    await request(server)
      .post(`/api/workflows/${first.id}/run`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 150));
    firstWs.close();
    secondWs.close();

    expect(firstMessages.some((message) => message.type === 'executionStarted')).toBe(true);
    expect(secondMessages.some((message) => message.type === 'executionStarted')).toBe(false);
    expect(firstMessages.some((message) => message.type === 'heartbeat')).toBe(true);
    expect(secondMessages.some((message) => message.type === 'heartbeat')).toBe(true);
    expect(boot.services.pushHub.sizeFor(first.id as string)).toBeLessThanOrEqual(1);
  });
});
