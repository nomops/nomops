import { randomUUID } from 'node:crypto';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { IConnections, INode, IWorkflowSettings, JsonObject } from '@nomops/workflow';

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

// 公共 REST API 令牌（对标 n8n 的 n8n API）：存 token 的 sha256 哈希，明文仅创建时返回一次（铁律 3）。
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
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

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
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  nodes: text('nodes', { mode: 'json' }).$type<INode[]>().notNull(),
  connections: text('connections', { mode: 'json' }).$type<IConnections>().notNull(),
  settings: text('settings', { mode: 'json' }).$type<IWorkflowSettings>(),
  staticData: text('static_data', { mode: 'json' }).$type<JsonObject>(),
  versionId: text('version_id'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
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
  projects,
  projectRelations,
  workflows,
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
