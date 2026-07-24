import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

/**
 * 助手连接外部 MCP server 的客户端（backlog #45 M5）。
 * 传输：MCP Streamable HTTP 最小子集（POST JSON-RPC 2.0，application/json）——与 nomops 自身
 * MCP server(McpService)对齐,故可回环自连做真·MCP 往返。可注入假实现（测试不打网络）。
 */

export interface McpToolSpec {
  name: string;
  description: string;
}

export interface McpClient {
  listTools(url: string, config: JsonObject): Promise<McpToolSpec[]>;
  callTool(url: string, config: JsonObject, tool: string, args: JsonObject): Promise<JsonObject>;
}

/* ── MCP 工具名约定：mcp/<connectionId>/<toolName> ── */
const MCP_PREFIX = 'mcp/';
export const isMcpTool = (tool: string): boolean => tool.startsWith(MCP_PREFIX);
export const mcpToolName = (connectionId: string, tool: string): string => `${MCP_PREFIX}${connectionId}/${tool}`;
export function parseMcpTool(tool: string): { connectionId: string; toolName: string } | null {
  if (!isMcpTool(tool)) return null;
  const rest = tool.slice(MCP_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  return { connectionId: rest.slice(0, slash), toolName: rest.slice(slash + 1) };
}

interface JsonRpcResponse {
  result?: { tools?: Array<{ name?: string; description?: string }>; content?: unknown; isError?: boolean };
  error?: { code?: number; message?: string };
}

/** 真·HTTP MCP 客户端（生产缺省）。config.token → Bearer;fetch 可注入。 */
export class HttpMcpClient implements McpClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async rpc(url: string, config: JsonObject, method: string, params?: JsonObject): Promise<JsonRpcResponse> {
    const token = String(config['token'] ?? '');
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
    });
    if (!res.ok) throw new OperationalError(`MCP server ${method} → HTTP ${res.status}`, { status: 502 });
    return (await res.json()) as JsonRpcResponse;
  }

  async listTools(url: string, config: JsonObject): Promise<McpToolSpec[]> {
    // 先握手（无状态 server 可忽略,但礼貌上报 clientInfo），再列工具
    await this.rpc(url, config, 'initialize', { clientInfo: { name: 'nomops-assistant', version: '1' } }).catch(() => undefined);
    const r = await this.rpc(url, config, 'tools/list');
    if (r.error) throw new OperationalError(`MCP tools/list error: ${r.error.message}`, { status: 502 });
    return (r.result?.tools ?? []).map((t) => ({ name: String(t.name ?? ''), description: String(t.description ?? '') })).filter((t) => t.name);
  }

  async callTool(url: string, config: JsonObject, tool: string, args: JsonObject): Promise<JsonObject> {
    const r = await this.rpc(url, config, 'tools/call', { name: tool, arguments: args });
    if (r.error) throw new OperationalError(`MCP tools/call error: ${r.error.message}`, { status: 502 });
    // MCP content → 提取文本;isError 标失败
    const content = r.result?.content;
    return { content: content as JsonObject[keyof JsonObject], ...(r.result?.isError ? { isError: true } : {}) };
  }
}
