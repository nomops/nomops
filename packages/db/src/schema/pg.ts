import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { IConnections, INode, IWorkflowSettings, JsonObject } from '@nomops/workflow';

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
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// 公共 REST API 令牌（对标 n8n 的 n8n API）：存 token 的 sha256 哈希，明文仅创建时返回一次（铁律 3）。
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
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

// 密码重置票据（对标 n8n 自托管）：存 token 的 sha256 哈希，一次性、带过期（铁律 3 延伸）。
export const passwordResets = pgTable('password_resets', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp('expires_at').notNull(),
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
  active: boolean('active').notNull().default(false),
  nodes: jsonb('nodes').$type<INode[]>().notNull(),
  connections: jsonb('connections').$type<IConnections>().notNull(),
  settings: jsonb('settings').$type<IWorkflowSettings>(),
  staticData: jsonb('static_data').$type<JsonObject>(),
  versionId: uuid('version_id'),
  // 所属文件夹（对标 n8n）；null = 项目根。归属/嵌套由服务层校验，不加 FK。
  folderId: uuid('folder_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// 工作流版本历史（对标 n8n）：每次编辑保存快照一份，可查看/回滚。projectId 冗余存以便归属过滤。
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

// 工作流文件夹（对标 n8n）：项目内组织工作流，支持嵌套（parent_folder_id 自引用，app 层校验）。
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

// 已安装社区节点包（对标 n8n community nodes）：实例级（非项目归属），bootstrap 时据此重载。
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

export const pgSchema = {
  users,
  apiKeys,
  passwordResets,
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
  settings,
  auditLogs,
  projectQuotas,
  usageCounters,
  billingOrders,
};
