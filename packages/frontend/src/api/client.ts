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

export interface WorkflowRow {
  id: string;
  name: string;
  active: boolean;
  nodes: INode[];
  connections: IConnections;
  settings: IWorkflowSettings | null;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FolderRow {
  id: string;
  projectId: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
  updatedAt: string;
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
  plan: 'community' | 'enterprise';
  features: string[];
}

export interface ApiKeyRow {
  id: string;
  label: string;
  prefix: string;
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
  register: (email: string, password: string) =>
    http<AuthResult>('POST', '/auth/register', { email, password }),
  login: (email: string, password: string, mfaCode?: string) =>
    http<AuthResult | { mfaRequired: true }>('POST', '/auth/login', { email, password, mfaCode }),
  forgotPassword: (email: string) => http<{ ok: true }>('POST', '/auth/forgot', { email }),
  resetPassword: (token: string, password: string) =>
    http<{ ok: true }>('POST', '/auth/reset', { token, password }),

  nodeTypes: () => http<INodeTypeDescription[]>('GET', '/api/node-types'),

  workflows: {
    // folderId：undefined → 全部；null → 项目根；string → 指定文件夹
    list: (folderId?: string | null) =>
      http<WorkflowRow[]>(
        'GET',
        folderId === undefined ? '/api/workflows' : `/api/workflows?folderId=${folderId === null ? 'root' : folderId}`,
      ),
    get: (id: string) => http<WorkflowRow>('GET', `/api/workflows/${id}`),
    create: (body: { name: string; nodes: INode[]; connections: IConnections; folderId?: string | null }) =>
      http<WorkflowRow>('POST', '/api/workflows', body),
    update: (id: string, body: Partial<{ name: string; nodes: INode[]; connections: IConnections }>) =>
      http<WorkflowRow>('PATCH', `/api/workflows/${id}`, body),
    move: (id: string, folderId: string | null) =>
      http<WorkflowRow>('PATCH', `/api/workflows/${id}`, { folderId }),
    remove: (id: string) => http<void>('DELETE', `/api/workflows/${id}`),
    run: (id: string, destinationNode?: string) =>
      http<RunSummary>('POST', `/api/workflows/${id}/run`, destinationNode ? { destinationNode } : {}),
    activate: (id: string, active: boolean) =>
      http<{ id: string; active: boolean }>('POST', `/api/workflows/${id}/activate`, { active }),
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
  },

  credentials: {
    list: () => http<CredentialView[]>('GET', '/api/credentials'),
    create: (body: { name: string; type: string; data: JsonObject }) =>
      http<CredentialView>('POST', '/api/credentials', body),
    test: (id: string) => http<{ ok: boolean; message?: string }>('POST', `/api/credentials/${id}/test`),
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

  insights: () =>
    http<{
      total: number;
      success: number;
      error: number;
      running: number;
      failureRate: number;
      avgRuntimeMs: number;
      estSavedMinutes: number;
      daily: Array<{ date: string; total: number; success: number; error: number }>;
    }>('GET', '/api/insights'),

  me: () =>
    http<{ id: string; email: string; firstName: string | null; lastName: string | null; role: string; mfaEnabled: boolean; projectId: string }>(
      'GET',
      '/api/me',
    ),

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
    create: (label: string) => http<{ token: string; apiKey: ApiKeyRow }>('POST', '/api/api-keys', { label }),
    revoke: (id: string) => http<void>('DELETE', `/api/api-keys/${id}`),
  },

  mfa: {
    setup: () => http<{ secret: string; otpauthUri: string; backupCodes: string[] }>('POST', '/api/mfa/setup'),
    enable: (code: string) => http<{ ok: true }>('POST', '/api/mfa/enable', { code }),
    disable: (code: string) => http<{ ok: true }>('POST', '/api/mfa/disable', { code }),
  },

  instanceUsers: {
    list: () =>
      http<Array<{ id: string; email: string; role: string; disabled: boolean; createdAt: string }>>(
        'GET',
        '/api/instance/users',
      ),
    setRole: (id: string, role: string) =>
      http<{ id: string; role: string }>('PATCH', `/api/instance/users/${id}/role`, { role }),
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
    chat: (messages: Array<{ role: 'user' | 'assistant'; content: string }>, credentialId?: string) =>
      http<{
        reply: string;
        workflow: { name: string; nodes: INode[]; connections: IConnections } | null;
      }>('POST', '/api/assistant/chat', { messages, ...(credentialId ? { credentialId } : {}) }),
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
