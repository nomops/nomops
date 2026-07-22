import { createHash, randomBytes } from 'node:crypto';
import type { Repositories } from '@nomops/db';
import type { IConnections, INode } from '@nomops/workflow';
import { OperationalError, Workflow } from '@nomops/workflow';
import type { ExecutionService } from './execution-service.js';
import type { WorkflowService } from './workflow-service.js';

/**
 * 实例级 MCP（对标基线 Instance-level MCP，Preview）：
 * 把勾选的工作流暴露为 MCP tools，让 Claude Code / Cursor 等 MCP 客户端发现并执行。
 * - 传输：MCP Streamable HTTP 的最小子集（POST JSON-RPC 2.0，响应 application/json，不做 SSE 流）。
 * - 鉴权：Access token（Bearer；DB 只存 sha256 哈希，明文仅生成时回显一次——铁律 3）。
 * - 执行语义：生产（已发布版本、计配额、入执行历史，mode='mcp'）。
 */

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface McpClientInfo {
  name: string;
  version: string;
  lastSeen: string;
}

const SETTINGS = {
  enabled: 'mcp.enabled',
  tokenHash: 'mcp.tokenHash',
  workflowIds: 'mcp.workflowIds',
  redirectUrls: 'mcp.redirectUrls', // OAuth redirect 允许清单（backlog #9 持久化）
  oauthTokens: 'mcp.oauthTokens', // OAuth 签发的 access token 哈希+过期（#25）
} as const;

const PROTOCOL_VERSION = '2025-03-26';
const OAUTH_TOKEN_TTL_MS = 60 * 60 * 1000; // OAuth access token 有效期 1h
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
/** PKCE S256:base64url(sha256(verifier)) === challenge。 */
const pkceChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

interface IOAuthToken {
  hash: string;
  expiresAt: number;
}
interface IPendingAuthCode {
  codeChallenge: string;
  redirectUri: string;
  clientId: string;
  createdAt: number;
}

/** 工作流名 → MCP tool 名（小写下划线 + id 前缀防重名，稳定可寻址）。 */
const toolNameOf = (name: string, id: string): string => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'workflow';
  return `run_${slug}_${id.slice(0, 8)}`;
};

export class McpService {
  /** 连接过的客户端（initialize 时上报的 clientInfo；进程内存，重启清零）。 */
  private readonly clients = new Map<string, McpClientInfo>();

  constructor(
    private readonly repos: Repositories,
    private readonly executions: ExecutionService,
    private readonly workflows: WorkflowService,
  ) {}

  /* ── 管理面（Settings 页） ── */

  async isEnabled(): Promise<boolean> {
    return (await this.repos.settings.get(SETTINGS.enabled)) === 'true';
  }

  private async enabledWorkflowIds(): Promise<string[]> {
    const raw = await this.repos.settings.get(SETTINGS.workflowIds);
    try {
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  /** OAuth redirect 允许清单（持久化;OAuth 授权流本体未实现,清单先行）。 */
  async getRedirectUrls(): Promise<string[]> {
    const raw = await this.repos.settings.get(SETTINGS.redirectUrls);
    try {
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  async setRedirectUrls(urls: string[]): Promise<void> {
    const cleaned = urls.map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
    await this.repos.settings.set(SETTINGS.redirectUrls, JSON.stringify(cleaned));
  }

  /** D144:MCP 页可编辑工作流描述（实例 admin 面;跨项目走 unscoped,只许动 description）。 */
  async setWorkflowDescription(workflowId: string, description: string): Promise<void> {
    const row = await this.repos.workflows.findByIdUnscoped(workflowId);
    if (!row) throw new OperationalError('Workflow not found', { workflowId, status: 404 });
    await this.repos.workflows.update(workflowId, { description: description.trim() || null });
  }

  async status(): Promise<{
    enabled: boolean;
    tokenConfigured: boolean;
    serverPath: string;
    workflowIds: string[];
    redirectUrls: string[];
    workflows: Array<{
      id: string;
      name: string;
      description: string | null;
      projectName: string;
      published: boolean;
      enabled: boolean;
    }>;
    clients: McpClientInfo[];
  }> {
    const ids = new Set(await this.enabledWorkflowIds());
    const all = await this.repos.workflows.listAllUnscoped();
    return {
      enabled: await this.isEnabled(),
      tokenConfigured: Boolean(await this.repos.settings.get(SETTINGS.tokenHash)),
      serverPath: '/mcp-server/http',
      workflowIds: [...ids],
      redirectUrls: await this.getRedirectUrls(),
      workflows: all.map((w) => ({ ...w, enabled: ids.has(w.id) })),
      clients: [...this.clients.values()],
    };
  }

  /** 开启并签发 access token（重开即轮换；明文只此一次）。 */
  async enable(): Promise<{ token: string }> {
    const token = `nmcp_${randomBytes(24).toString('hex')}`;
    await this.repos.settings.set(SETTINGS.tokenHash, hashToken(token));
    await this.repos.settings.set(SETTINGS.enabled, 'true');
    return { token };
  }

  async disable(): Promise<void> {
    await this.repos.settings.set(SETTINGS.enabled, 'false');
  }

  /**
   * 覆盖式设置暴露的工作流。约束对标基线：必须**已发布**（MCP 调用跑已发布版本）。
   * 已删除的工作流 id 静默剔除（白名单可能残留孤儿——工作流删除不反向清这里）。
   */
  async setWorkflows(workflowIds: string[]): Promise<void> {
    const kept: string[] = [];
    for (const id of workflowIds) {
      const row = await this.repos.workflows.findByIdUnscoped(id);
      if (!row) continue; // 孤儿：剔除
      if (!row.publishedVersionId) {
        throw new OperationalError(`Workflow must be published before enabling MCP access: ${row.name}`, { status: 400 });
      }
      kept.push(id);
    }
    await this.repos.settings.set(SETTINGS.workflowIds, JSON.stringify(kept));
  }

  /* ── MCP 端点（/mcp-server/http） ── */

  async verifyBearer(authorization: string | undefined): Promise<boolean> {
    if (!authorization?.startsWith('Bearer ')) return false;
    const token = authorization.slice(7).trim();
    const hash = hashToken(token);
    // 静态 access token（Settings 签发）
    const stored = await this.repos.settings.get(SETTINGS.tokenHash);
    if (stored && hash === stored) return true;
    // OAuth 签发的 access token（未过期）
    const now = Date.now();
    const oauth = await this.loadOAuthTokens();
    return oauth.some((t) => t.hash === hash && t.expiresAt > now);
  }

  /* ── OAuth 2.0（授权码 + PKCE，#25） ── */

  private readonly pendingCodes = new Map<string, IPendingAuthCode>();

  private async loadOAuthTokens(): Promise<IOAuthToken[]> {
    const raw = await this.repos.settings.get(SETTINGS.oauthTokens);
    try {
      const list = raw ? (JSON.parse(raw) as IOAuthToken[]) : [];
      return list.filter((t) => t.expiresAt > Date.now()); // 顺带过滤过期
    } catch {
      return [];
    }
  }

  /** OAuth 授权服务器元数据（RFC 8414；MCP 客户端发现用）。 */
  oauthMetadata(baseUrl: string): Record<string, unknown> {
    const base = baseUrl.replace(/\/+$/, '');
    return {
      issuer: base,
      authorization_endpoint: `${base}/mcp-server/oauth/authorize`,
      token_endpoint: `${base}/mcp-server/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    };
  }

  /**
   * 授权端点：校验 MCP 已启用 + redirect_uri 在允许清单 + PKCE S256，
   * 铸授权码（10min TTL,内存态）。无交互同意屏（machine 流,honest 限制:自托管 admin 已配清单）。
   */
  async authorize(input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    state?: string;
  }): Promise<{ redirectTo: string }> {
    if (!(await this.isEnabled())) throw new OperationalError('MCP is not enabled', { status: 404 });
    if (input.codeChallengeMethod !== 'S256') {
      throw new OperationalError('Only PKCE S256 is supported', { status: 400 });
    }
    const allow = await this.getRedirectUrls();
    if (!allow.includes(input.redirectUri)) {
      throw new OperationalError('redirect_uri is not in the allowlist', { status: 400 });
    }
    if (!input.codeChallenge) throw new OperationalError('code_challenge is required', { status: 400 });

    this.gcPendingCodes();
    const code = randomBytes(24).toString('base64url');
    this.pendingCodes.set(code, {
      codeChallenge: input.codeChallenge,
      redirectUri: input.redirectUri,
      clientId: input.clientId,
      createdAt: Date.now(),
    });
    const url = new URL(input.redirectUri);
    url.searchParams.set('code', code);
    if (input.state) url.searchParams.set('state', input.state);
    return { redirectTo: url.href };
  }

  /** 令牌端点：授权码 + code_verifier(PKCE) → access token（哈希+过期存 settings）。 */
  async exchangeToken(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number }> {
    const pending = this.pendingCodes.get(input.code);
    if (!pending || Date.now() - pending.createdAt > AUTH_CODE_TTL_MS) {
      throw new OperationalError('invalid_grant: code not found or expired', { status: 400 });
    }
    this.pendingCodes.delete(input.code); // 授权码一次性
    if (pending.redirectUri !== input.redirectUri) {
      throw new OperationalError('invalid_grant: redirect_uri mismatch', { status: 400 });
    }
    if (!input.codeVerifier || pkceChallenge(input.codeVerifier) !== pending.codeChallenge) {
      throw new OperationalError('invalid_grant: PKCE verification failed', { status: 400 });
    }
    const token = `nmcp_oauth_${randomBytes(24).toString('hex')}`;
    const expiresAt = Date.now() + OAUTH_TOKEN_TTL_MS;
    const tokens = (await this.loadOAuthTokens()).concat({ hash: hashToken(token), expiresAt });
    await this.repos.settings.set(SETTINGS.oauthTokens, JSON.stringify(tokens));
    return { access_token: token, token_type: 'Bearer', expires_in: Math.floor(OAUTH_TOKEN_TTL_MS / 1000) };
  }

  private gcPendingCodes(): void {
    const now = Date.now();
    for (const [code, p] of this.pendingCodes) {
      if (now - p.createdAt > AUTH_CODE_TTL_MS) this.pendingCodes.delete(code);
    }
  }

  /** 处理一条 JSON-RPC 消息；notification 返回 null（HTTP 202/204 由路由层定）。 */
  async handleRpc(msg: JsonRpcRequest): Promise<Record<string, unknown> | null> {
    const reply = (result: unknown) => ({ jsonrpc: '2.0' as const, id: msg.id ?? null, result });
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0' as const, id: msg.id ?? null, error: { code, message } });

    switch (msg.method) {
      case 'initialize': {
        const info = (msg.params?.['clientInfo'] ?? {}) as { name?: string; version?: string };
        const name = info.name ?? 'unknown';
        const version = info.version ?? '';
        this.clients.set(`${name}@${version}`, { name, version, lastSeen: new Date().toISOString() });
        return reply({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'nomops', version: process.env['NOMOPS_VERSION'] ?? '0.9.0' },
        });
      }
      case 'notifications/initialized':
        return null;
      case 'ping':
        return reply({});
      case 'tools/list': {
        const ids = await this.enabledWorkflowIds();
        const tools = [];
        for (const id of ids) {
          const row = await this.repos.workflows.findByIdUnscoped(id);
          if (!row) continue;
          tools.push({
            name: toolNameOf(row.name, row.id),
            description: `Run the nomops workflow “${row.name}” and return its output items.`,
            inputSchema: {
              type: 'object',
              properties: {
                input: { type: 'object', description: 'JSON passed to the workflow start node as $json' },
              },
            },
          });
        }
        return reply({ tools });
      }
      case 'tools/call': {
        const toolName = String(msg.params?.['name'] ?? '');
        const args = (msg.params?.['arguments'] ?? {}) as { input?: Record<string, unknown> };
        const ids = await this.enabledWorkflowIds();
        for (const id of ids) {
          const row = await this.repos.workflows.findByIdUnscoped(id);
          if (!row || toolNameOf(row.name, row.id) !== toolName) continue;
          try {
            const output = await this.runWorkflow(row.id, args.input ?? {});
            return reply({ content: [{ type: 'text', text: JSON.stringify(output) }] });
          } catch (error) {
            return reply({ content: [{ type: 'text', text: (error as Error).message }], isError: true });
          }
        }
        return fail(-32602, `Unknown tool: ${toolName}`);
      }
      default:
        return fail(-32601, `Method not found: ${msg.method}`);
    }
  }

  /** 生产语义执行：已发布定义 + 计配额 + 入执行历史（mode='mcp'），返回末节点输出 items。 */
  private async runWorkflow(workflowId: string, input: Record<string, unknown>): Promise<unknown> {
    const row = await this.repos.workflows.findByIdUnscoped(workflowId);
    if (!row) throw new OperationalError('Workflow not found', { status: 404 });
    const production = await this.workflows.productionRow(row);
    const start = new Workflow({
      nodes: production.nodes as INode[],
      connections: production.connections as IConnections,
    }).getStartNode();
    if (!start) throw new OperationalError('Workflow has no start node', { workflowId });

    const summary = await this.executions.runTriggered(workflowId, 'mcp', [{ json: input as never }], start.name);
    if (summary.status !== 'success') {
      throw new OperationalError(`Workflow run ${summary.status}: ${summary.error ?? ''}`.trim(), { workflowId });
    }
    const data = (await this.repos.executions.getData(summary.executionId)) as {
      resultData?: { lastNodeExecuted?: string; runData?: Record<string, Array<{ data?: { main?: unknown[][] } }>> };
    } | null;
    const lastNode = data?.resultData?.lastNodeExecuted;
    const runs = lastNode ? data?.resultData?.runData?.[lastNode] : undefined;
    return runs?.[runs.length - 1]?.data?.main?.[0] ?? [];
  }
}
