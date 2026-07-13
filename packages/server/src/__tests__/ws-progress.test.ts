import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { attachWebSocket } from '../ws/attach.js';
import type { IPushEvent } from '../ws/push-hub.js';

/** Phase 3 验收：WS 能收到逐节点执行进度。 */

let boot: BootstrapResult;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  const app = createApp(boot.services);
  server = createServer(app);
  attachWebSocket(server, boot.services);
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

    // 连 WS
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws?token=${token}`);
    await new Promise((resolve) => ws.once('open', resolve));
    const events: IPushEvent[] = [];
    ws.on('message', (raw) => events.push(JSON.parse(String(raw)) as IPushEvent));

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
    const { body: run } = await request(server)
      .post(`/api/workflows/${wf.id}/run`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(run.status).toBe('success');

    // 等事件送达
    await new Promise((resolve) => setTimeout(resolve, 200));
    ws.close();

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
});
