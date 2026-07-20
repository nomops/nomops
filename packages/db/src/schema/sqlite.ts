import { randomUUID } from 'node:crypto';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { IConnections, INode, IPinData, IWorkflowSettings, JsonObject } from '@nomops/workflow';

/**
 * SQLite 方言 schema（docs/02-DATA-MODEL.md 第一节）。
 * 与 pg.ts 表名/列名一致。类型映射：
 *   uuid → text(+randomUUID)，jsonb → text{mode:json}，boolean → integer{mode:boolean}，
 *   timestamp → integer{mode:timestamp}。
 */

const uuidPk = (name: string) =>
  text(name)
    .primaryKey()
    .$defaultFn(() => randomUUID());

export const users = sqliteTable('users', {
  id: uuidPk('id'),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  role: text('role').notNull().default('member'),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false), // SCIM deactivate（docs/07）
  // 两步验证（TOTP）：secret 待确认时存在但 enabled=false；备份码存 sha256 哈希数组。
  mfaEnabled: integer('mfa_enabled', { mode: 'boolean' }).notNull().default(false),
  mfaSecret: text('mfa_secret'),
  mfaBackupCodes: text('mfa_backup_codes', { mode: 'json' }).$type<string[]>(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// 公共 REST API 令牌：存 token 的 sha256 哈希，明文仅创建时返回一次（铁律 3）。
export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: uuidPk('id'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    label: text('label').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    // 过期时间（null=永不过期）与作用域（all|readonly），鉴权时强制
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    scope: text('scope').notNull().default('all'),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

// 密码重置票据（自托管）：存 token 的 sha256 哈希，一次性、带过期（铁律 3 延伸）。
export const passwordResets = sqliteTable('password_resets', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

// 用户邀请（自托管：owner/admin 邀请 → 邀请链接 → 接受时才建 users 行）。
// 存 token 的 sha256 哈希（铁律 3）；未接受的邀请即「pending 用户」，在用户列表里合并展示。
export const invitations = sqliteTable('invitations', {
  id: uuidPk('id'),
  email: text('email').notNull().unique(),
  tokenHash: text('token_hash').notNull().unique(),
  role: text('role').notNull().default('member'),
  invitedBy: text('invited_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const projects = sqliteTable('projects', {
  id: uuidPk('id'),
  name: text('name').notNull(),
  type: text('type').notNull().default('personal'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const projectRelations = sqliteTable(
  'project_relations',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const workflows = sqliteTable('workflows', {
  id: uuidPk('id'),
  name: text('name').notNull(),
  description: text('description'),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  nodes: text('nodes', { mode: 'json' }).$type<INode[]>().notNull(),
  connections: text('connections', { mode: 'json' }).$type<IConnections>().notNull(),
  settings: text('settings', { mode: 'json' }).$type<IWorkflowSettings>(),
  staticData: text('static_data', { mode: 'json' }).$type<JsonObject>(),
  // 钉住数据（nodeName → 冻结输出 items）；仅手动运行应用
  pinData: text('pin_data', { mode: 'json' }).$type<IPinData>(),
  versionId: text('version_id'),
  // 收藏（列表置顶星标）与归档（软删除：默认列表隐藏、触发器下线；基线语义 Delete 仅对 archived 开放）
  favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  // 发布/草稿分离：生产触发跑 publishedVersionId 指向的版本快照；null = 从未发布（生产退回当前定义，兼容旧数据）
  publishedVersionId: text('published_version_id'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  // 所属文件夹；null = 项目根。归属/嵌套由服务层校验，不加 FK。
  folderId: text('folder_id'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// 工作流版本历史：每次编辑保存快照一份，可查看/回滚。projectId 冗余存以便归属过滤。
export const workflowVersions = sqliteTable(
  'workflow_versions',
  {
    id: uuidPk('id'),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    versionNumber: integer('version_number').notNull(),
    name: text('name').notNull(),
    nodes: text('nodes', { mode: 'json' }).$type<INode[]>().notNull(),
    connections: text('connections', { mode: 'json' }).$type<IConnections>().notNull(),
    settings: text('settings', { mode: 'json' }).$type<IWorkflowSettings>(),
    createdBy: text('created_by'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('workflow_versions_workflow_idx').on(t.workflowId)],
);

// 工作流文件夹：项目内组织工作流，支持嵌套（parent_folder_id 自引用，app 层校验）。
export const folders = sqliteTable(
  'folders',
  {
    id: uuidPk('id'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    parentFolderId: text('parent_folder_id'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('folders_project_idx').on(t.projectId)],
);

// 已安装社区节点包（community nodes）：实例级（非项目归属），bootstrap 时据此重载。
export const installedNodes = sqliteTable('installed_nodes', {
  packageName: text('package_name').primaryKey(),
  version: text('version').notNull(),
  nodeTypes: text('node_types', { mode: 'json' }).$type<string[]>().notNull(),
  installedBy: text('installed_by'),
  installedAt: integer('installed_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sharedWorkflows = sqliteTable(
  'shared_workflows',
  {
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    role: text('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workflowId, t.projectId] }),
    index('shared_workflows_project_id_idx').on(t.projectId),
  ],
);

export const credentials = sqliteTable('credentials', {
  id: uuidPk('id'),
  name: text('name').notNull(),
  type: text('type').notNull(),
  data: text('data').notNull(), // 加密后的密文，绝不明文
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sharedCredentials = sqliteTable(
  'shared_credentials',
  {
    credentialId: text('credential_id')
      .notNull()
      .references(() => credentials.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    role: text('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.credentialId, t.projectId] }),
    index('shared_credentials_project_id_idx').on(t.projectId),
  ],
);

export const variables = sqliteTable(
  'variables',
  {
    id: uuidPk('id'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    key: text('key').notNull(),
    value: text('value').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('variables_project_id_idx').on(t.projectId)],
);

export const dataTables = sqliteTable(
  'data_tables',
  {
    id: uuidPk('id'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    columns: text('columns', { mode: 'json' })
      .$type<Array<{ name: string; type: string }>>()
      .notNull()
      .$defaultFn(() => []),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('data_tables_project_id_idx').on(t.projectId)],
);

export const dataTableRows = sqliteTable(
  'data_table_rows',
  {
    id: uuidPk('id'),
    dataTableId: text('data_table_id')
      .notNull()
      .references(() => dataTables.id),
    data: text('data', { mode: 'json' }).$type<JsonObject>().notNull().$defaultFn(() => ({})),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('data_table_rows_table_id_idx').on(t.dataTableId)],
);

export const executions = sqliteTable(
  'executions',
  {
    id: uuidPk('id'),
    workflowId: text('workflow_id').notNull(),
    status: text('status').notNull(),
    mode: text('mode').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    stoppedAt: integer('stopped_at', { mode: 'timestamp' }),
    // waiting 状态的唤醒时刻；null = 等外部信号（resume API）。毫秒精度（timestamp 模式是秒，短等待会被截断）
    waitTill: integer('wait_till', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('executions_workflow_id_created_at_idx').on(t.workflowId, t.createdAt)],
);

export const executionData = sqliteTable('execution_data', {
  executionId: text('execution_id')
    .primaryKey()
    .references(() => executions.id),
  workflowData: text('workflow_data', { mode: 'json' }).$type<JsonObject>().notNull(),
  data: text('data', { mode: 'json' }).$type<JsonObject>().notNull(),
});

export const webhookEntities = sqliteTable(
  'webhook_entities',
  {
    webhookPath: text('webhook_path').notNull(),
    method: text('method').notNull(),
    workflowId: text('workflow_id').notNull(),
    node: text('node').notNull(),
  },
  (t) => [primaryKey({ columns: [t.webhookPath, t.method] })],
);

// 轮询去重（processed data）：记录某工作流某上下文（节点）已见过的键，只放行新键。
// 工作流标签：项目维度，名字项目内唯一（服务层校验）。
export const tags = sqliteTable(
  'tags',
  {
    id: uuidPk('id'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('tags_project_idx').on(t.projectId)],
);

export const workflowTagMappings = sqliteTable(
  'workflow_tag_mappings',
  {
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.workflowId, t.tagId] })],
);

// 工作流运行统计：执行收尾累加（生产=非 manual）。执行历史可清理，统计不受影响。
export const workflowStatistics = sqliteTable('workflow_statistics', {
  workflowId: text('workflow_id').primaryKey(),
  productionSuccess: integer('production_success').notNull().default(0),
  productionError: integer('production_error').notNull().default(0),
  manualRuns: integer('manual_runs').notNull().default(0),
  lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
});

export const processedData = sqliteTable(
  'processed_data',
  {
    workflowId: text('workflow_id').notNull(),
    contextKey: text('context_key').notNull(),
    value: text('value').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.workflowId, t.contextKey, t.value] })],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  loadOnStartup: integer('load_on_startup', { mode: 'boolean' }).notNull().default(false),
});

// 每 project 的配额配置（docs/08）。无行 = unlimited（自托管友好）。
export const projectQuotas = sqliteTable('project_quotas', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id),
  plan: text('plan').notNull(),
  monthlyExecutions: integer('monthly_executions'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// 支付订单（支付宝订单式购买；out_trade_no = id）
export const billingOrders = sqliteTable('billing_orders', {
  id: uuidPk('id'),
  projectId: text('project_id').notNull(),
  plan: text('plan').notNull(),
  months: integer('months').notNull(),
  amount: text('amount').notNull(),
  status: text('status').notNull().default('pending'),
  externalRef: text('external_ref'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  paidAt: integer('paid_at', { mode: 'timestamp' }),
});

// 用量计数（docs/08）：billing-ready，独立于 executions。
export const usageCounters = sqliteTable(
  'usage_counters',
  {
    projectId: text('project_id').notNull(),
    period: text('period').notNull(),
    executions: integer('executions').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.period] })],
);

// 审计日志（docs/06）：只追加。details 绝不含凭证明文/密文（铁律 3）。
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: uuidPk('id'),
    timestamp: integer('timestamp', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    userId: text('user_id'),
    projectId: text('project_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    details: text('details', { mode: 'json' }).$type<JsonObject>(),
    ip: text('ip'),
  },
  (t) => [index('audit_logs_project_id_timestamp_idx').on(t.projectId, t.timestamp)],
);

export const sqliteSchema = {
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
};
