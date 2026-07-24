import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { IConnections, INode, IPinData, IWorkflowSettings, JsonObject } from '@nomops/workflow';

/**
 * PostgreSQL 方言 schema（docs/02-DATA-MODEL.md 第一节）。
 * 与 sqlite.ts 保持表名/列名一致；schema-parity 测试守护漂移。
 */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  role: text('role').notNull().default('member'),
  disabled: boolean('disabled').notNull().default(false), // SCIM deactivate（docs/07）
  // 两步验证（TOTP）：secret 待确认时存在但 enabled=false；备份码存 sha256 哈希数组。
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  mfaSecret: text('mfa_secret'),
  mfaBackupCodes: jsonb('mfa_backup_codes').$type<string[]>(),
  // 最近活跃时刻（每次鉴权请求节流更新;Users 列表显示 Last Active，D146）
  lastActiveAt: timestamp('last_active_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// 公共 REST API 令牌：存 token 的 sha256 哈希，明文仅创建时返回一次（铁律 3）。
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    label: text('label').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    // 过期时间（null=永不过期）与作用域（all|readonly），鉴权时强制
    expiresAt: timestamp('expires_at'),
    scope: text('scope').notNull().default('all'),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

// 密码重置票据（自托管）：存 token 的 sha256 哈希，一次性、带过期（铁律 3 延伸）。
export const passwordResets = pgTable('password_resets', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp('expires_at').notNull(),
});

// 用户邀请（自托管：owner/admin 邀请 → 邀请链接 → 接受时才建 users 行）。
// 存 token 的 sha256 哈希（铁律 3）；未接受的邀请即「pending 用户」，在用户列表里合并展示。
export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  tokenHash: text('token_hash').notNull().unique(),
  role: text('role').notNull().default('member'),
  invitedBy: uuid('invited_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull().default('personal'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const projectRelations = pgTable(
  'project_relations',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(false),
  nodes: jsonb('nodes').$type<INode[]>().notNull(),
  connections: jsonb('connections').$type<IConnections>().notNull(),
  settings: jsonb('settings').$type<IWorkflowSettings>(),
  staticData: jsonb('static_data').$type<JsonObject>(),
  // 钉住数据（nodeName → 冻结输出 items）；仅手动运行应用
  pinData: jsonb('pin_data').$type<IPinData>(),
  versionId: uuid('version_id'),
  // 收藏（列表置顶星标）与归档（软删除：默认列表隐藏、触发器下线；基线语义 Delete 仅对 archived 开放）
  favorite: boolean('favorite').notNull().default(false),
  archived: boolean('archived').notNull().default(false),
  // 发布/草稿分离：生产触发跑 publishedVersionId 指向的版本快照；null = 从未发布（生产退回当前定义，兼容旧数据）
  publishedVersionId: uuid('published_version_id'),
  publishedAt: timestamp('published_at'),
  // 所属文件夹；null = 项目根。归属/嵌套由服务层校验，不加 FK。
  folderId: uuid('folder_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// 工作流版本历史：每次编辑保存快照一份，可查看/回滚。projectId 冗余存以便归属过滤。
export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    versionNumber: integer('version_number').notNull(),
    name: text('name').notNull(),
    nodes: jsonb('nodes').$type<INode[]>().notNull(),
    connections: jsonb('connections').$type<IConnections>().notNull(),
    settings: jsonb('settings').$type<IWorkflowSettings>(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('workflow_versions_workflow_idx').on(t.workflowId)],
);

// 工作流文件夹：项目内组织工作流，支持嵌套（parent_folder_id 自引用，app 层校验）。
export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    parentFolderId: uuid('parent_folder_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('folders_project_idx').on(t.projectId)],
);

// 已安装社区节点包（community nodes）：实例级（非项目归属），bootstrap 时据此重载。
export const installedNodes = pgTable('installed_nodes', {
  packageName: text('package_name').primaryKey(),
  version: text('version').notNull(),
  nodeTypes: jsonb('node_types').$type<string[]>().notNull(),
  installedBy: uuid('installed_by'),
  installedAt: timestamp('installed_at').notNull().defaultNow(),
});

export const sharedWorkflows = pgTable(
  'shared_workflows',
  {
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    role: text('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workflowId, t.projectId] }),
    index('shared_workflows_project_id_idx').on(t.projectId),
  ],
);

export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  data: text('data').notNull(), // 加密后的密文，绝不明文
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const sharedCredentials = pgTable(
  'shared_credentials',
  {
    credentialId: uuid('credential_id')
      .notNull()
      .references(() => credentials.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    role: text('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.credentialId, t.projectId] }),
    index('shared_credentials_project_id_idx').on(t.projectId),
  ],
);

export const variables = pgTable(
  'variables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    key: text('key').notNull(),
    value: text('value').notNull().default(''),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('variables_project_id_idx').on(t.projectId)],
);

export const dataTables = pgTable(
  'data_tables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    columns: jsonb('columns').$type<Array<{ name: string; type: string }>>().notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('data_tables_project_id_idx').on(t.projectId)],
);

export const dataTableRows = pgTable(
  'data_table_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataTableId: uuid('data_table_id')
      .notNull()
      .references(() => dataTables.id),
    data: jsonb('data').$type<JsonObject>().notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('data_table_rows_table_id_idx').on(t.dataTableId)],
);

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id').notNull(),
    status: text('status').notNull(), // new|running|success|error|canceled|waiting
    mode: text('mode').notNull(), // trigger|webhook|manual|retry
    startedAt: timestamp('started_at'),
    stoppedAt: timestamp('stopped_at'),
    // waiting 状态的唤醒时刻；null = 等外部信号（resume API）
    waitTill: timestamp('wait_till'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('executions_workflow_id_created_at_idx').on(t.workflowId, t.createdAt)],
);

export const executionData = pgTable('execution_data', {
  executionId: uuid('execution_id')
    .primaryKey()
    .references(() => executions.id),
  workflowData: jsonb('workflow_data').$type<JsonObject>().notNull(),
  data: jsonb('data').$type<JsonObject>().notNull(),
});

export const webhookEntities = pgTable(
  'webhook_entities',
  {
    webhookPath: text('webhook_path').notNull(),
    method: text('method').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    node: text('node').notNull(),
  },
  (t) => [primaryKey({ columns: [t.webhookPath, t.method] })],
);

// 轮询去重（processed data）：记录某工作流某上下文（节点）已见过的键，只放行新键。
// 工作流标签：项目维度，名字项目内唯一（服务层校验）。
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('tags_project_idx').on(t.projectId)],
);

export const workflowTagMappings = pgTable(
  'workflow_tag_mappings',
  {
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.workflowId, t.tagId] })],
);

// 工作流运行统计：执行收尾累加（生产=非 manual）。执行历史可清理，统计不受影响。
export const workflowStatistics = pgTable('workflow_statistics', {
  workflowId: uuid('workflow_id').primaryKey(),
  productionSuccess: integer('production_success').notNull().default(0),
  productionError: integer('production_error').notNull().default(0),
  manualRuns: integer('manual_runs').notNull().default(0),
  lastRunAt: timestamp('last_run_at'),
});

export const processedData = pgTable(
  'processed_data',
  {
    workflowId: uuid('workflow_id').notNull(),
    contextKey: text('context_key').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workflowId, t.contextKey, t.value] })],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  loadOnStartup: boolean('load_on_startup').notNull().default(false),
});

// 每 project 的配额配置（docs/08）。无行 = unlimited（自托管友好）。
export const projectQuotas = pgTable('project_quotas', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id),
  plan: text('plan').notNull(), // free|pro|unlimited|custom
  monthlyExecutions: integer('monthly_executions'), // custom 用；其余按内置套餐表
  expiresAt: timestamp('expires_at'), // 付费套餐有效期（null = 永久）；过期按 free 处理
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// 支付订单（支付宝订单式购买；out_trade_no = id）
/* Chat 会话/个人 Agent（backlog #14,用户维度非项目维度;messages 随会话行 JSON 存） */
export const chatAgents = pgTable(
  'chat_agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    system: text('system').notNull().default(''),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('chat_agents_user_id_idx').on(t.userId)],
);

export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull().default('New chat'),
    /** 会话目标（模型/个人 agent/工作流 agent）,前端 ChatTarget 形状原样 JSON。 */
    target: jsonb('target').$type<JsonObject>(),
    wfSessionId: text('wf_session_id'),
    /** 消息数组（{role, content, workflow?, error?}[]）,聊天规模下整列重写可接受。 */
    messages: jsonb('messages').$type<JsonObject[]>().notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('chat_sessions_user_id_idx').on(t.userId)],
);

/** 自定义项目角色（backlog #29）：命名的权限集,name 全实例唯一。 */
export const customRoles = pgTable('custom_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const billingOrders = pgTable('billing_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  plan: text('plan').notNull(), // pro
  months: integer('months').notNull(),
  amount: text('amount').notNull(), // 元，字符串精确金额（如 '99.00'）
  status: text('status').notNull().default('pending'), // pending|paid
  externalRef: text('external_ref'), // 支付宝 trade_no
  createdAt: timestamp('created_at').notNull().defaultNow(),
  paidAt: timestamp('paid_at'),
});

// 用量计数（docs/08）：billing-ready，独立于 executions（执行历史可清理，计数不受影响）。
export const usageCounters = pgTable(
  'usage_counters',
  {
    projectId: uuid('project_id').notNull(),
    period: text('period').notNull(), // 'YYYY-MM'（UTC 自然月）
    executions: integer('executions').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.period] })],
);

// 审计日志（docs/06）：只追加。details 绝不含凭证明文/密文（铁律 3）。
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
    userId: uuid('user_id'), // 可空：系统动作（cron 触发）无用户
    projectId: uuid('project_id'), // 可空：登录/注册无项目上下文
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    details: jsonb('details').$type<JsonObject>(),
    ip: text('ip'),
  },
  (t) => [index('audit_logs_project_id_timestamp_idx').on(t.projectId, t.timestamp)],
);

/** 评测测试运行（backlog #31）：对某工作流用数据集跑一轮评测。归属沿用 workflow。 */
export const testRuns = pgTable(
  'test_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id').notNull(),
    dataTableId: uuid('data_table_id'), // 数据集来源（null = trigger 未绑定，跑空）
    triggerNode: text('trigger_node').notNull(),
    status: text('status').notNull().default('running'), // running|completed|error|canceled
    totalCases: integer('total_cases').notNull().default(0),
    ranCases: integer('ran_cases').notNull().default(0),
    passedCases: integer('passed_cases'), // null = 无 pass/fail 判定
    metrics: jsonb('metrics').$type<Record<string, number>>().notNull().default({}), // 聚合指标（各指标行均值）
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (t) => [index('test_runs_workflow_id_created_at_idx').on(t.workflowId, t.createdAt)],
);

/** 评测单用例结果（backlog #31）：数据集每行一条,链到实际 execution。 */
export const testCaseRuns = pgTable(
  'test_case_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    testRunId: uuid('test_run_id')
      .notNull()
      .references(() => testRuns.id),
    executionId: uuid('execution_id'), // 该行触发的执行（null = 执行建立前就失败）
    rowIndex: integer('row_index').notNull(),
    input: jsonb('input').$type<JsonObject>().notNull().default({}),
    metrics: jsonb('metrics').$type<Record<string, number>>().notNull().default({}),
    status: text('status').notNull(), // success|error
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('test_case_runs_test_run_id_idx').on(t.testRunId)],
);

/**
 * 外部身份绑定（backlog #36）：user ↔ (providerType, providerId)。
 * SSO/LDAP 登录优先按此绑定认归属——email 变更或多 provider 并存不再错认。
 */
export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    providerType: text('provider_type').notNull(), // 'oidc' | 'saml' | 'ldap'
    providerId: text('provider_id').notNull(), // IdP sub / SAML nameID / LDAP 稳定 id
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('auth_identities_provider_uic').on(t.providerType, t.providerId)],
);

/** 认证 provider 同步历史（backlog #36）：每次 LDAP 同步记 scanned/created/updated/disabled 与错误。 */
export const authProviderSyncHistory = pgTable('auth_provider_sync_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerType: text('provider_type').notNull(),
  status: text('status').notNull(), // 'success' | 'error'
  scanned: integer('scanned').notNull().default(0),
  created: integer('created').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  disabled: integer('disabled').notNull().default(0),
  error: text('error'),
  runAt: timestamp('run_at').notNull().defaultNow(),
});

/** 登出令牌黑名单（backlog #37）：登出即拉黑该 JWT 哈希,到期后清理。 */
export const invalidAuthTokens = pgTable('invalid_auth_tokens', {
  tokenHash: text('token_hash').primaryKey(), // sha256(JWT)，绝不存明文
  expiresAt: timestamp('expires_at').notNull(), // = JWT exp,过期即可清理
});

/** 执行标注（backlog #35）：每次执行一条,👍👎 + 笔记。1:1 于 execution。 */
export const executionAnnotations = pgTable('execution_annotations', {
  executionId: uuid('execution_id')
    .primaryKey()
    .references(() => executions.id),
  vote: text('vote'), // 'up' | 'down' | null
  note: text('note').notNull().default(''),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** 标注标签定义（backlog #35）：name 全实例唯一。 */
export const annotationTags = pgTable('annotation_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/** 执行↔标注标签 多对多（backlog #35）。 */
export const executionAnnotationTags = pgTable(
  'execution_annotation_tags',
  {
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => annotationTags.id),
  },
  (t) => [primaryKey({ columns: [t.executionId, t.tagId] })],
);

/** 执行自定义元数据（backlog #35）：运行中写 KV,执行列表可按键值检索。 */
export const executionMetadata = pgTable(
  'execution_metadata',
  {
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.executionId, t.key] }),
    index('execution_metadata_key_value_idx').on(t.key, t.value),
  ],
);

/** 每用户收藏（backlog #34）：取代 workflows.favorite 全局布尔。resourceType 可扩展。 */
export const userFavorites = pgTable(
  'user_favorites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    resourceType: text('resource_type').notNull(), // 'workflow'（未来可加 credential 等）
    resourceId: text('resource_id').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.resourceType, t.resourceId] })],
);

export const pgSchema = {
  users,
  apiKeys,
  passwordResets,
  invitations,
  projects,
  projectRelations,
  workflows,
  workflowVersions,
  installedNodes,
  folders,
  sharedWorkflows,
  credentials,
  sharedCredentials,
  variables,
  dataTables,
  dataTableRows,
  executions,
  executionData,
  webhookEntities,
  processedData,
  tags,
  workflowTagMappings,
  workflowStatistics,
  settings,
  auditLogs,
  projectQuotas,
  usageCounters,
  billingOrders,
  customRoles,
  chatAgents,
  chatSessions,
  testRuns,
  testCaseRuns,
  userFavorites,
  executionAnnotations,
  annotationTags,
  executionAnnotationTags,
  executionMetadata,
  invalidAuthTokens,
  authIdentities,
  authProviderSyncHistory,
};
