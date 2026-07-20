import type {
  IConnections,
  INode,
  INodeTypeDescription,
  IRunExecutionData,
  IWorkflowSettings,
  JsonObject,
} from '@nomops/workflow';

/**
 * REST client。与后端的耦合只有 HTTP + 共享类型（@nomops/workflow 仅类型导入，
 * 这正是 README「三者共享同一套类型系统」的意义；运行时零依赖）。
 */

const TOKEN_KEY = 'nomops.token';
const PROJECT_KEY = 'nomops.projectId';

export interface ChatProviderRow {
  id: string;
  label: string;
  credentialType: string;
  models: string[];
  enabled: boolean;
  credentialId: string | null;
  contextWindow: number;
  lastEditedAt: string | null;
}

export interface WorkflowDependency {
  type: 'credential' | 'subWorkflow' | 'parentWorkflow' | 'errorWorkflow' | 'errorWorkflowParent';
  id: string;
  name: string;
}

export interface WorkflowRow {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
  nodes: INode[];
  connections: IConnections;
  settings: IWorkflowSettings | null;
  /** 钉住数据（nodeName → 冻结输出 items）；仅手动运行应用。 */
  pinData: Record<string, Array<{ json: JsonObject }>> | null;
  folderId: string | null;
  favorite?: boolean;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
  /** 发布/草稿分离：生产触发跑已发布版本；null = 从未发布。 */
  publishedVersionId?: string | null;
  publishedAt?: string | null;
  /** 仅详情接口返回：草稿是否领先已发布版本。 */
  publishedDirty?: boolean;
}

export interface FolderRow {
  id: string;
  projectId: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 节点类型信息：描述 + 全名 type（内置 nomops.* 与社区 <pkg>.* 一致）。 */
export type NodeTypeInfo = INodeTypeDescription & { type: string };

/** 已安装社区节点包。 */
export interface CommunityNode {
  packageName: string;
  version: string;
  nodeTypes: string[];
  installedBy: string | null;
  installedAt: string;
}

/** 版本历史列表项（元信息，不含 nodes/connections 大字段）。 */
export interface WorkflowVersionMeta {
  id: string;
  versionNumber: number;
  name: string;
  createdBy: string | null;
  createdAt: string;
}

/** 单个版本全量（含快照的 nodes/connections）。 */
export interface WorkflowVersion extends WorkflowVersionMeta {
  workflowId: string;
  projectId: string;
  nodes: INode[];
  connections: IConnections;
  settings: IWorkflowSettings | null;
}

export interface ExecutionRow {
  id: string;
  workflowId: string;
  status: string;
  mode: string;
  startedAt: string | null;
  stoppedAt: string | null;
  createdAt: string;
}

export interface RunSummary {
  executionId: string;
  status: string;
  lastNodeExecuted?: string;
  error?: string;
}

export interface CredentialView {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  updatedAt: string;
}

export interface VariableView {
  id: string;
  key: string;
  value: string;
  createdAt: string;
}

export type DataTableColumnType = 'string' | 'number' | 'boolean' | 'date';

export interface DataTableColumn {
  name: string;
  type: DataTableColumnType;
}

export interface DataTableView {
  id: string;
  name: string;
  columns: DataTableColumn[];
  rowCount: number;
  createdAt: string;
}

export interface DataTableRowView {
  id: string;
  createdAt: string;
  updatedAt: string;
  data: Record<string, unknown>;
}

export interface McpStatus {
  enabled: boolean;
  tokenConfigured: boolean;
  serverPath: string;
  workflowIds: string[];
  workflows: Array<{
    id: string;
    name: string;
    description: string | null;
    projectName: string;
    published: boolean;
    enabled: boolean;
  }>;
  clients: Array<{ name: string; version: string; lastSeen: string }>;
}

export interface TagRow {
  id: string;
  name: string;
}

export interface WorkflowMetaRow {
  workflowId: string;
  tags: TagRow[];
  statistics: {
    productionSuccess: number;
    productionError: number;
    manualRuns: number;
    lastRunAt: string | null;
  } | null;
}

export interface AuthResult {
  token: string;
  user: { id: string; email: string };
  projectId: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  type: string;
  role: string;
}

export interface MemberRow {
  userId: string;
  email: string;
  role: string;
}

export interface AuditLogRow {
  id: string;
  timestamp: string;
  userId: string | null;
  projectId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
}

export interface LicenseInfo {
  /** 套餐显示名，来自证书（社区版为 'community'）。 */
  plan: string;
  features: string[];
  /** 配额上限；-1 或缺项 = 不限。 */
  quotas: Record<string, number>;
  activated: boolean;
  /** inactive=没填 / active=生效 / expired=过期 / notYetValid=未到期 / invalid=验签不过。 */
  status: 'inactive' | 'active' | 'expired' | 'notYetValid' | 'invalid';
  validFrom?: string;
  validTo?: string;
  issuedTo?: string;
  /** status 非 active 时的原因，供设置页提示。 */
  message?: string;
}

export interface SourceControlConfig {
  connected: boolean;
  repoUrl: string; // 已掩码
  branch: string;
}
export interface SourceControlStatus extends SourceControlConfig {
  files: Array<{ path: string; status: string }>;
}

export interface ApiKeyRow {
  id: string;
  label: string;
  prefix: string;
  scope: 'all' | 'readonly';
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly context?: unknown,
  ) {
    super(message);
  }
}

export const tokenStorage = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
};

/** 当前项目上下文（docs/06 X-Project-Id 切换）。空 = 用 token 默认（personal）。 */
export const projectStorage = {
  get: (): string | null => localStorage.getItem(PROJECT_KEY),
  set: (projectId: string): void => localStorage.setItem(PROJECT_KEY, projectId),
  clear: (): void => localStorage.removeItem(PROJECT_KEY),
};

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = tokenStorage.get();
  const projectId = projectStorage.get();
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(projectId ? { 'x-project-id': projectId } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; context?: unknown };
  if (!res.ok) {
    throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status, data.context);
  }
  return data as T;
}

export const api = {
  register: (email: string, password: string, firstName?: string, lastName?: string) =>
    http<AuthResult>('POST', '/auth/register', { email, password, firstName, lastName }),
  needsSetup: () => http<{ needsSetup: boolean }>('GET', '/auth/needs-setup'),
  login: (email: string, password: string, mfaCode?: string) =>
    http<AuthResult | { mfaRequired: true }>('POST', '/auth/login', { email, password, mfaCode }),
  forgotPassword: (email: string) => http<{ ok: true }>('POST', '/auth/forgot', { email }),
  resetPassword: (token: string, password: string) =>
    http<{ ok: true }>('POST', '/auth/reset', { token, password }),
  // 邀请接受：查 token 预填邮箱 + 设口令建号并登录
  lookupInvite: (token: string) =>
    http<{ email: string; role: string }>('GET', `/auth/invite/${encodeURIComponent(token)}`),
  acceptInvite: (token: string, password: string, firstName?: string, lastName?: string) =>
    http<AuthResult>('POST', `/auth/invite/${encodeURIComponent(token)}/accept`, { password, firstName, lastName }),

  nodeTypes: () => http<NodeTypeInfo[]>('GET', '/api/node-types'),

  communityNodes: {
    list: () => http<CommunityNode[]>('GET', '/api/community-nodes'),
    install: (name: string, version?: string) =>
      http<CommunityNode>('POST', '/api/community-nodes', version ? { name, version } : { name }),
    uninstall: (name: string) =>
      http<void>('DELETE', `/api/community-nodes?name=${encodeURIComponent(name)}`),
  },

  workflows: {
    // folderId：undefined → 全部；null → 项目根；string → 指定文件夹。archived=true 只看归档。
    list: (folderId?: string | null, archived = false) => {
      const params = new URLSearchParams();
      if (folderId !== undefined) params.set('folderId', folderId === null ? 'root' : folderId);
      if (archived) params.set('archived', 'true');
      const qs = params.toString();
      return http<WorkflowRow[]>('GET', `/api/workflows${qs ? `?${qs}` : ''}`);
    },
    /* 项目依赖图（卡片依赖胶囊）：workflowId → 依赖列表 */
    dependencies: () => http<Record<string, WorkflowDependency[]>>('GET', '/api/workflows/dependencies'),
    setFavorite: (id: string, favorite: boolean) =>
      http<WorkflowRow>('POST', `/api/workflows/${id}/favorite`, { favorite }),
    archive: (id: string) => http<WorkflowRow>('POST', `/api/workflows/${id}/archive`),
    unarchive: (id: string) => http<WorkflowRow>('POST', `/api/workflows/${id}/unarchive`),
    get: (id: string) => http<WorkflowRow>('GET', `/api/workflows/${id}`),
    create: (body: { name: string; nodes: INode[]; connections: IConnections; folderId?: string | null }) =>
      http<WorkflowRow>('POST', '/api/workflows', body),
    update: (
      id: string,
      body: Partial<{
        name: string;
        description: string | null;
        nodes: INode[];
        connections: IConnections;
        pinData: Record<string, Array<{ json: JsonObject }>> | null;
      }>,
    ) =>
      http<WorkflowRow>('PATCH', `/api/workflows/${id}`, body),
    move: (id: string, folderId: string | null) =>
      http<WorkflowRow>('PATCH', `/api/workflows/${id}`, { folderId }),
    remove: (id: string) => http<void>('DELETE', `/api/workflows/${id}`),
    run: (id: string, opts: { destinationNode?: string; startNode?: string } = {}) =>
      http<RunSummary>('POST', `/api/workflows/${id}/run`, opts),
    /* 画布聊天（Chat Trigger）：消息进工作流，回最后节点的文本输出 */
    chat: (id: string, message: string, sessionId: string) =>
      http<{ executionId: string; status: string; reply: string; error?: string }>(
        'POST', `/api/workflows/${id}/chat`, { message, sessionId },
      ),
    activate: (id: string, active: boolean) =>
      http<{ id: string; active: boolean }>('POST', `/api/workflows/${id}/activate`, { active }),
    publish: (id: string) =>
      http<{ id: string; publishedVersionId: string; publishedAt: string; publishedDirty: false }>(
        'POST',
        `/api/workflows/${id}/publish`,
      ),
    versions: (id: string) =>
      http<WorkflowVersionMeta[]>('GET', `/api/workflows/${id}/versions`),
    version: (id: string, versionId: string) =>
      http<WorkflowVersion>('GET', `/api/workflows/${id}/versions/${versionId}`),
    restore: (id: string, versionId: string) =>
      http<WorkflowRow>('POST', `/api/workflows/${id}/versions/${versionId}/restore`),
  },

  folders: {
    list: () => http<FolderRow[]>('GET', '/api/folders'),
    create: (name: string, parentFolderId: string | null = null) =>
      http<FolderRow>('POST', '/api/folders', { name, parentFolderId }),
    rename: (id: string, name: string) => http<FolderRow>('PATCH', `/api/folders/${id}`, { name }),
    remove: (id: string) => http<void>('DELETE', `/api/folders/${id}`),
  },

  executions: {
    list: () => http<ExecutionRow[]>('GET', '/api/executions'),
    get: (id: string) =>
      http<{ execution: ExecutionRow; data: IRunExecutionData | null }>('GET', `/api/executions/${id}`),
    remove: (id: string) => http<void>('DELETE', `/api/executions/${id}`),
    /* useOriginal=true 用执行时的定义快照重跑，否则用当前保存的草稿 */
    retry: (id: string, useOriginal: boolean) =>
      http<RunSummary>('POST', `/api/executions/${id}/retry`, { useOriginal }),
  },

  credentials: {
    list: () => http<CredentialView[]>('GET', '/api/credentials'),
    /* 编辑：改名 + 覆写填写的字段（留空 = 保持不变；旧值绝不回显） */
    update: (id: string, body: { name?: string; data?: Record<string, unknown> }) =>
      http<CredentialView>('PATCH', `/api/credentials/${id}`, body),
    create: (body: { name: string; type: string; data: JsonObject }) =>
      http<CredentialView>('POST', '/api/credentials', body),
    test: (id: string) =>
      http<{ ok: boolean; tested: boolean; message?: string }>('POST', `/api/credentials/${id}/test`),
    remove: (id: string) => http<void>('DELETE', `/api/credentials/${id}`),
    oauthStatus: (id: string) => http<{ connected: boolean }>('GET', `/api/credentials/${id}/oauth-status`),
  },

  /** 凭证 OAuth2「Connect my account」：拿提供方授权跳转 URL，前端开弹窗完成授权。 */
  oauth2: {
    authUrl: (credentialId: string) =>
      http<{ authUrl: string }>('GET', `/api/oauth2/auth?id=${encodeURIComponent(credentialId)}`),
  },

  variables: {
    list: () => http<VariableView[]>('GET', '/api/variables'),
    create: (body: { key: string; value: string }) => http<VariableView>('POST', '/api/variables', body),
    update: (id: string, body: { key: string; value: string }) =>
      http<VariableView>('PATCH', `/api/variables/${id}`, body),
    remove: (id: string) => http<void>('DELETE', `/api/variables/${id}`),
  },

  tags: {
    list: () => http<TagRow[]>('GET', '/api/tags'),
    create: (name: string) => http<TagRow>('POST', '/api/tags', { name }),
    remove: (id: string) => http<void>('DELETE', `/api/tags/${id}`),
    setForWorkflow: (workflowId: string, tagIds: string[]) =>
      http<{ ok: true }>('PUT', `/api/workflows/${workflowId}/tags`, { tagIds }),
  },

  workflowsMeta: () => http<WorkflowMetaRow[]>('GET', '/api/workflows-meta'),

  dataTables: {
    list: () => http<DataTableView[]>('GET', '/api/data-tables'),
    get: (id: string) => http<DataTableView>('GET', `/api/data-tables/${id}`),
    create: (body: { name: string; columns?: DataTableColumn[] }) =>
      http<DataTableView>('POST', '/api/data-tables', body),
    rename: (id: string, name: string) => http<DataTableView>('PATCH', `/api/data-tables/${id}`, { name }),
    remove: (id: string) => http<void>('DELETE', `/api/data-tables/${id}`),
    addColumn: (id: string, column: DataTableColumn) =>
      http<DataTableView>('POST', `/api/data-tables/${id}/columns`, column),
    removeColumn: (id: string, name: string) =>
      http<DataTableView>('DELETE', `/api/data-tables/${id}/columns/${encodeURIComponent(name)}`),
    rows: (id: string) => http<DataTableRowView[]>('GET', `/api/data-tables/${id}/rows`),
    addRow: (id: string, data: Record<string, unknown>) =>
      http<DataTableRowView>('POST', `/api/data-tables/${id}/rows`, { data }),
    updateRow: (id: string, rowId: string, data: Record<string, unknown>) =>
      http<DataTableRowView>('PATCH', `/api/data-tables/${id}/rows/${rowId}`, { data }),
    removeRow: (id: string, rowId: string) =>
      http<void>('DELETE', `/api/data-tables/${id}/rows/${rowId}`),
  },

  projects: {
    list: () => http<ProjectRow[]>('GET', '/api/projects'),
    create: (name: string) => http<ProjectRow>('POST', '/api/projects', { name }),
    members: (id: string) => http<MemberRow[]>('GET', `/api/projects/${id}/members`),
    addMember: (id: string, email: string, role: string) =>
      http<MemberRow>('POST', `/api/projects/${id}/members`, { email, role }),
    updateMember: (id: string, userId: string, role: string) =>
      http<{ userId: string; role: string }>('PATCH', `/api/projects/${id}/members/${userId}`, { role }),
    removeMember: (id: string, userId: string) =>
      http<void>('DELETE', `/api/projects/${id}/members/${userId}`),
    usage: (id: string) =>
      http<{ period: string; used: number; limit: number | null; plan: string }>(
        'GET',
        `/api/projects/${id}/usage`,
      ),
    // 实例管理员手动设配额/套餐（企业版 quotas 功能 + owner/admin）。custom 需带 monthlyExecutions。
    setQuota: (id: string, body: { plan: string; monthlyExecutions?: number }) =>
      http<{ period: string; used: number; limit: number | null; plan: string }>(
        'PUT',
        `/api/projects/${id}/quota`,
        body,
      ),
  },

  auditLogs: {
    list: (projectId: string, limit = 100) =>
      http<AuditLogRow[]>('GET', `/api/audit-logs?projectId=${projectId}&limit=${limit}`),
  },

  license: () => http<LicenseInfo>('GET', '/api/license'),
  activateLicense: (activationKey: string) =>
    http<LicenseInfo>('POST', '/api/license/activate', { activationKey }),
  deactivateLicense: () => http<LicenseInfo>('DELETE', '/api/license'),

  sourceControl: {
    config: () => http<SourceControlConfig>('GET', '/api/source-control'),
    connect: (repoUrl: string, branch: string) =>
      http<SourceControlConfig>('PUT', '/api/source-control', { repoUrl, branch }),
    disconnect: () => http<void>('DELETE', '/api/source-control'),
    status: () => http<SourceControlStatus>('GET', '/api/source-control/status'),
    push: (message: string) =>
      http<{ committed: boolean; pushed: boolean; files: string[] }>('POST', '/api/source-control/push', { message }),
    pull: () => http<{ created: number; updated: number; skipped: string[] }>('POST', '/api/source-control/pull'),
  },

  insights: (from_?: string, to?: string) =>
    http<{
      total: number;
      success: number;
      error: number;
      running: number;
      failureRate: number;
      avgRuntimeMs: number;
      estSavedMinutes: number;
      daily: Array<{ date: string; total: number; success: number; error: number }>;
      granularity: 'hour' | 'day';
    }>('GET', `/api/insights${from_ && to ? `?from=${encodeURIComponent(from_)}&to=${encodeURIComponent(to)}` : ''}`),

  me: () =>
    http<{ id: string; email: string; firstName: string | null; lastName: string | null; role: string; mfaEnabled: boolean; projectId: string }>(
      'GET',
      '/api/me',
    ),
  /* 实例级 MCP（Settings → Instance-level MCP，Preview） */
  mcp: {
    status: () => http<McpStatus>('GET', '/api/mcp'),
    enable: () => http<McpStatus & { token: string }>('POST', '/api/mcp/enable'),
    disable: () => http<McpStatus>('POST', '/api/mcp/disable'),
    setWorkflows: (workflowIds: string[]) => http<McpStatus>('PUT', '/api/mcp/workflows', { workflowIds }),
  },

  /* Chat 设置（Settings → Chat，Preview） */
  chatSettings: {
    get: () => http<{ enabled: boolean; model: string }>('GET', '/api/chat-settings'),
    update: (body: { enabled?: boolean; model?: string }) =>
      http<{ enabled: boolean; model: string }>('PUT', '/api/chat-settings', body),
  },

  updateMe: (body: { firstName?: string; lastName?: string }) =>
    http<{ id: string; email: string; firstName: string | null; lastName: string | null }>('PATCH', '/api/me', body),
  changePassword: (currentPassword: string, newPassword: string) =>
    http<{ ok: true }>('POST', '/api/me/password', { currentPassword, newPassword }),

  sso: {
    config: () =>
      http<{ enabled: boolean; issuer: string; clientId: string; clientSecret: string }>('GET', '/api/sso/config'),
    save: (body: { enabled: boolean; issuer: string; clientId: string; clientSecret?: string }) =>
      http<{ enabled: boolean; issuer: string; clientId: string; clientSecret: string }>('PUT', '/api/sso/config', body),
  },

  billing: {
    checkout: (plan: string, months: number) =>
      http<{ orderId: string; payUrl: string }>('POST', '/api/billing/checkout', { plan, months }),
  },

  apiKeys: {
    list: () => http<ApiKeyRow[]>('GET', '/api/api-keys'),
    create: (label: string, opts: { expiresInDays?: number | null; scope?: 'all' | 'readonly' } = {}) =>
      http<{ token: string; apiKey: ApiKeyRow }>('POST', '/api/api-keys', { label, ...opts }),
    revoke: (id: string) => http<void>('DELETE', `/api/api-keys/${id}`),
  },

  mfa: {
    setup: () => http<{ secret: string; otpauthUri: string; backupCodes: string[] }>('POST', '/api/mfa/setup'),
    enable: (code: string) => http<{ ok: true }>('POST', '/api/mfa/enable', { code }),
    disable: (code: string) => http<{ ok: true }>('POST', '/api/mfa/disable', { code }),
  },

  instanceUsers: {
    list: () =>
      http<
        Array<{
          id: string;
          email: string;
          firstName?: string | null;
          lastName?: string | null;
          role: string;
          disabled: boolean;
          mfaEnabled?: boolean;
          projectCount?: number;
          pending: boolean;
          createdAt: string;
        }>
      >('GET', '/api/instance/users'),
    setRole: (id: string, role: string) =>
      http<{ id: string; role: string }>('PATCH', `/api/instance/users/${id}/role`, { role }),
    // 邀请用户（无 SMTP：返回可复制的邀请链接由 admin 转交）
    invite: (email: string, role: 'admin' | 'member') =>
      http<{ id: string; email: string; role: string; inviteLink: string }>(
        'POST',
        '/api/instance/users/invite',
        { email, role },
      ),
    // 移除用户或撤销待接受邀请（同一路由按 id 落到 users 或 invitations）
    remove: (id: string) => http<{ id: string; removed: boolean }>('DELETE', `/api/instance/users/${id}`),
  },

  security: () =>
    http<{
      scim: { enabled: boolean; tokenConfigured: boolean };
      sso: { enabled: boolean };
      userCount: number;
    }>('GET', '/api/security'),

  scimToken: () => http<{ token: string; note: string }>('POST', '/api/scim/token'),

  logStreaming: {
    list: () =>
      http<
        Array<{
          id: string;
          name: string;
          url: string;
          events: Array<'execution' | 'audit'>;
          enabled: boolean;
          secretConfigured: boolean;
          createdAt: string;
        }>
      >('GET', '/api/log-streaming/destinations'),
    create: (body: { name: string; url: string; secret?: string; events?: Array<'execution' | 'audit'> }) =>
      http<{ id: string; name: string; url: string; events: string[]; enabled: boolean; secretConfigured: boolean; createdAt: string }>(
        'POST',
        '/api/log-streaming/destinations',
        body,
      ),
    remove: (id: string) => http<void>('DELETE', `/api/log-streaming/destinations/${id}`),
    test: (id: string) => http<{ ok: boolean; status: number }>('POST', `/api/log-streaming/destinations/${id}/test`),
  },

  externalSecrets: () =>
    http<{ provider: string; available: boolean; enabled: boolean; keys: string[] }>('GET', '/api/external-secrets'),

  ldap: {
    config: () =>
      http<{
        enabled: boolean;
        url: string;
        bindDn: string;
        bindPassword: string;
        userSearchBase: string;
        loginAttribute: string;
        emailAttribute: string;
        firstNameAttribute: string;
        lastNameAttribute: string;
      }>('GET', '/api/ldap/config'),
    save: (body: {
      enabled: boolean;
      url: string;
      bindDn: string;
      bindPassword?: string;
      userSearchBase: string;
      loginAttribute: string;
      emailAttribute: string;
    }) => http<{ enabled: boolean; url: string; bindPassword: string }>('PUT', '/api/ldap/config', body),
    login: (username: string, password: string) =>
      http<AuthResult>('POST', '/auth/ldap/login', { username, password }),
  },

  assistant: {
    /* Chat provider 注册表 + 各家配置（Select model 与 Settings 数据源） */
    providers: () => http<ChatProviderRow[]>('GET', '/api/assistant/providers'),
    /* Configure provider（Settings → Chat 弹窗）：Enable / Default credential / Context window */
    updateProvider: (id: string, body: { enabled?: boolean; credentialId?: string | null; contextWindow?: number }) =>
      http<ChatProviderRow>('PATCH', `/api/assistant/providers/${id}`, body),
    chat: (
      messages: Array<{ role: 'user' | 'assistant'; content: string }>,
      opts: { credentialId?: string; system?: string; model?: string } = {},
    ) =>
      http<{
        reply: string;
        workflow: { name: string; nodes: INode[]; connections: IConnections } | null;
      }>('POST', '/api/assistant/chat', {
        messages,
        ...(opts.credentialId ? { credentialId: opts.credentialId } : {}),
        ...(opts.system ? { system: opts.system } : {}),
        ...(opts.model ? { model: opts.model } : {}),
      }),
  },

  templates: {
    list: () =>
      http<Array<{ id: string; name: string; description: string; category: string; nodeTags: string[]; setupHints: string[] }>>(
        'GET',
        '/api/templates',
      ),
    import: (id: string) => http<WorkflowRow>('POST', `/api/templates/${id}/import`),
  },

  about: () =>
    http<{
      name: string;
      version: string;
      plan: string;
      description: string;
      nodeCount: number;
      docs: string;
    }>('GET', '/api/about'),
};
