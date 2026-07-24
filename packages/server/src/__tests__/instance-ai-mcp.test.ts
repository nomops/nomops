import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { classifyRisk } from '../services/instance-ai-tools.js';
import { mcpToolName } from '../services/instance-ai-mcp.js';
import type { McpClient } from '../services/instance-ai-mcp.js';

/**
 * backlog #45 M5：MCP 连接 —— 助手挂一个 MCP server → 其工具进工具集。
 * 验收：挂 server → 工具可见 → 提议 MCP 工具走 HITL gate → 批准经 MCP client 执行 + 进运行树。
 * 注入假 McpClient(记调用),不打真实网络。
 */
const mcpCalls: Array<{ url: string; tool: string; args: unknown }> = [];
const fakeMcp: McpClient = {
  async listTools(url) {
    return [
      { name: 'get_weather', description: `Weather from ${url}` },
      { name: 'send_alert', description: 'Send an alert' },
    ];
  },
  async callTool(url, _config, tool, args) {
    mcpCalls.push({ url, tool, args });
    return { content: [{ type: 'text', text: `${tool} ok` }] };
  },
};

let boot: BootstrapResult;
let app: Express;
let token: string;
let threadId = '';
const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, mcpClient: fakeMcp });
  app = createApp(boot.services);
  const reg = await request(app).post('/auth/register').send({ email: 'mcp@dev.dev', password: 'password-123' }).expect(201);
  token = reg.body.token;
  threadId = (await request(app).post('/api/instance-ai/threads').set(authed()).send({ title: 'MCP' }).expect(201)).body.id;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('MCP 工具风险分级（#45 M5）', () => {
  it('MCP 工具一律 dangerous（外部,fail-safe）', () => {
    expect(classifyRisk(mcpToolName('conn-1', 'get_weather')).risk).toBe('dangerous');
    expect(classifyRisk(mcpToolName('conn-1', 'get_weather')).reason).toContain('MCP');
  });
});

describe('MCP 连接（#45 M5）', () => {
  let connId = '';

  it('挂 MCP server → 连接存工具清单（config/token 不出 API）', async () => {
    const conn = (await request(app).post(`/api/instance-ai/threads/${threadId}/mcp/connect`).set(authed()).send({
      serverName: 'Weather MCP', url: 'https://mcp.example.com/rpc', config: { token: 'super-secret-mcp-token' },
    }).expect(201)).body;
    connId = conn.id;
    expect(conn.status).toBe('connected');
    expect(conn.tools.map((t: { name: string }) => t.name)).toEqual(['get_weather', 'send_alert']);
    // 铁律 3 精神：config/token 不出 API
    expect(JSON.stringify(conn)).not.toContain('super-secret-mcp-token');
    expect(conn.config).toBeUndefined();
  });

  it('连接列表可见（跨线程,user 域）', async () => {
    const list = (await request(app).get('/api/instance-ai/mcp/connections').set(authed()).expect(200)).body;
    expect(list.some((c: { id: string }) => c.id === connId)).toBe(true);
  });

  it('提议 MCP 工具 → 走 HITL gate（dangerous → pending,未执行）', async () => {
    mcpCalls.length = 0;
    const r = (await request(app).post(`/api/instance-ai/threads/${threadId}/actions`).set(authed()).send({
      tool: mcpToolName(connId, 'get_weather'), args: { city: 'SF' },
    }).expect(200)).body;
    expect(r.status).toBe('pending');
    expect(mcpCalls).toHaveLength(0); // 挂起,未调用 MCP
  });

  it('批准 → 经 MCP client 执行 + 进运行树', async () => {
    const r = (await request(app).post(`/api/instance-ai/threads/${threadId}/actions`).set(authed()).send({
      tool: mcpToolName(connId, 'send_alert'), args: { msg: 'fire' },
    }).expect(200)).body;
    const approved = (await request(app).post(`/api/instance-ai/actions/${r.action.id}/approve`).set(authed()).expect(200)).body;
    expect(approved.status).toBe('approved');
    expect(approved.result).toMatchObject({ content: [{ type: 'text', text: 'send_alert ok' }] });

    // MCP client 被调用（url + tool + args 透传）
    expect(mcpCalls).toContainEqual({ url: 'https://mcp.example.com/rpc', tool: 'send_alert', args: { msg: 'fire' } });

    // 运行树记了这次 MCP 调用
    const runs = (await request(app).get(`/api/instance-ai/threads/${threadId}/runs`).set(authed()).expect(200)).body as Array<{ label: string; status: string }>;
    expect(runs.some((n) => n.label === mcpToolName(connId, 'send_alert') && n.status === 'success')).toBe(true);
  });

  it('别人的连接 id 提议 → 批准时 404（归属校验）', async () => {
    const r = (await request(app).post(`/api/instance-ai/threads/${threadId}/actions`).set(authed()).send({
      tool: mcpToolName('00000000-0000-0000-0000-000000000000', 'x'), args: {},
    }).expect(200)).body;
    await request(app).post(`/api/instance-ai/actions/${r.action.id}/approve`).set(authed()).expect(404);
  });

  it('断开连接 → 从列表移除', async () => {
    await request(app).delete(`/api/instance-ai/mcp/connections/${connId}`).set(authed()).expect(204);
    const list = (await request(app).get('/api/instance-ai/mcp/connections').set(authed()).expect(200)).body;
    expect(list.some((c: { id: string }) => c.id === connId)).toBe(false);
  });

  it('http(s) 以外的 url → 400', async () => {
    await request(app).post(`/api/instance-ai/threads/${threadId}/mcp/connect`).set(authed()).send({ url: 'ftp://nope' }).expect(400);
  });
});
