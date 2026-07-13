/**
 * @nomops/db — 数据持久层（Drizzle ORM）。
 *
 * 表定义（双方言：SQLite 默认 / PostgreSQL）+ repository 模式。
 * 归属过滤内建在仓储层（铁律 2）；业务层不直接碰 ORM。
 */
export const DB_PACKAGE = '@nomops/db';

export { pgSchema } from './schema/pg.js';
export { sqliteSchema } from './schema/sqlite.js';

export { createDatabase } from './client.js';
export type {
  DatabaseConfig,
  DatabaseHandle,
  DbDialect,
  NomopsSchema,
  PostgresConfig,
  SqliteConfig,
} from './client.js';

export { runMigrations } from './migrate.js';

export {
  AuditLogRepository,
  QuotaRepository,
  createRepositories,
  CredentialRepository,
  ExecutionRepository,
  ProjectRepository,
  SettingsRepository,
  UserRepository,
  WebhookRepository,
  WorkflowRepository,
} from './repositories.js';
export type { Repositories } from './repositories.js';

export type {
  AuditLog,
  BillingOrder,
  CreateAuditLogInput,
  ProjectMember,
  ProjectQuota,
  UsageCounter,
  CreateCredentialInput,
  CreateExecutionInput,
  CreateProjectInput,
  CreateUserInput,
  CreateWorkflowInput,
  Credential,
  Execution,
  ExecutionData,
  ExecutionDataSnapshot,
  Project,
  Setting,
  User,
  WebhookEntity,
  WebhookEntityInput,
  Workflow,
} from './types.js';
