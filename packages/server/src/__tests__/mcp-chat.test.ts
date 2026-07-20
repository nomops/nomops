import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/** 实例级 MCP（tools/list + tools/call 生产语义执行）与 Chat 设置开关。 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({
    dbConfig: { type: 'sqlite' },
    // Chat 测试用假 Claude（不出网）
    callClaude: async () => 'Hello from fake Claude',
  });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'mcp@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'mcp@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.shutdown();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

const rpc = (mcpToken: string, method: string, params?: object, id = 1) =>
  request(app)
    .post('/mcp-server/http')
    .set('Authorization', `Bearer ${mcpToken}`)
    .send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

describe('Instance-level MCP', () => {
  it('未启用 404 → 启用签发 token → tools/list → tools/call 生产执行 → 禁用回 404', async () => {
    await request(app).post('/mcp-server/http').send({ jsonrpc: '2.0', id: 1, method: 'ping' }).expect(404);

    // 建一个工作流并暴露
    const wf = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({
        name: 'MCP echo',
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { tagged: true } } },
        ],
        connections: { Start: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
      })
      .expect(201);

    const enabled = await request(app).post('/api/mcp/enable').set(authed()).expect(200);
    const mcpToken = enabled.body.token as string;
    expect(mcpToken).toMatch(/^nmcp_/);

    // 未发布的工作流不可暴露（对标基线：MCP 只跑已发布版本）
    await request(app).put('/api/mcp/workflows').set(authed()).send({ workflowIds: [wf.body.id] }).expect(400);
    await request(app).post(`/api/workflows/${wf.body.id}/publish`).set(authed()).expect(200);
    const set = await request(app).put('/api/mcp/workflows').set(authed()).send({ workflowIds: [wf.body.id] }).expect(200);
    expect(set.body.workflows.find((w: { id: string }) => w.id === wf.body.id).published).toBe(true);

    // 鉴权：错 token 401
    await rpc('nmcp_wrong', 'ping').expect(401);

    // initialize 握手 + 客户端登记
    const init = await rpc(mcpToken, 'initialize', {
      protocolVersion: '2025-03-26',
      clientInfo: { name: 'vitest-client', version: '1.0' },
      capabilities: {},
    }).expect(200);
    expect(init.body.result.serverInfo.name).toBe('nomops');

    const status = await request(app).get('/api/mcp').set(authed()).expect(200);
    expect(status.body.clients.map((c: { name: string }) => c.name)).toContain('vitest-client');

    // tools/list：暴露的工作流成为 tool
    const list = await rpc(mcpToken, 'tools/list').expect(200);
    expect(list.body.result.tools).toHaveLength(1);
    const toolName = list.body.result.tools[0].name as string;
    expect(toolName).toMatch(/^run_mcp_echo_/);

    // tools/call：生产语义执行，返回末节点输出
    const call = await rpc(mcpToken, 'tools/call', { name: toolName, arguments: { input: { from: 'mcp' } } }).expect(200);
    const items = JSON.parse(call.body.result.content[0].text as string) as Array<{ json: Record<string, unknown> }>;
    expect(items[0]?.json['tagged']).toBe(true);
    expect(items[0]?.json['from']).toBe('mcp'); // Set 合并字段，种子 json 保留

    // 执行入历史（mode=mcp）
    const execs = await request(app).get('/api/executions').set(authed()).expect(200);
    expect(execs.body.some((e: { mode: string }) => e.mode === 'mcp')).toBe(true);

    // 未知工具 → JSON-RPC error
    const bad = await rpc(mcpToken, 'tools/call', { name: 'run_ghost_00000000', arguments: {} }).expect(200);
    expect(bad.body.error.code).toBe(-32602);

    await request(app).post('/api/mcp/disable').set(authed()).expect(200);
    await rpc(mcpToken, 'ping').expect(404);
  });
});

describe('Chat 设置', () => {
  it('默认开启可聊；关掉 → /assistant/chat 403；重开恢复', async () => {
    // 铺一个 anthropicApi 凭证（假 Claude 不出网）
    await request(app)
      .post('/api/credentials')
      .set(authed())
      .send({ name: 'claude', type: 'anthropicApi', data: { apiKey: 'sk-test' } })
      .expect(201);

    let settings = await request(app).get('/api/chat-settings').set(authed()).expect(200);
    expect(settings.body.enabled).toBe(true);

    await request(app)
      .post('/api/assistant/chat')
      .set(authed())
      .send({ messages: [{ role: 'user', content: 'hi' }] })
      .expect(200);

    await request(app).put('/api/chat-settings').set(authed()).send({ enabled: false, model: 'claude-opus-4-8' }).expect(200);
    await request(app)
      .post('/api/assistant/chat')
      .set(authed())
      .send({ messages: [{ role: 'user', content: 'hi' }] })
      .expect(403);

    settings = await request(app).get('/api/chat-settings').set(authed()).expect(200);
    expect(settings.body).toEqual({ enabled: false, model: 'claude-opus-4-8' });

    await request(app).put('/api/chat-settings').set(authed()).send({ enabled: true }).expect(200);
    await request(app)
      .post('/api/assistant/chat')
      .set(authed())
      .send({ messages: [{ role: 'user', content: 'hi' }] })
      .expect(200);
  });
});
