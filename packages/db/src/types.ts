import type { InferSelectModel } from 'drizzle-orm';
import type { IConnections, INode, IWorkflowSettings, JsonObject } from '@nomops/workflow';
import { sqliteSchema } from './schema/sqlite.js';

/**
 * 领域类型：以 sqlite schema 推断为「规范形态」（两方言结构一致）。
 * 业务层只认这些类型，不感知底层方言。
 */
export type User = InferSelectModel<typeof sqliteSchema.users>;
export type Project = InferSelectModel<typeof sqliteSchema.projects>;
export type Workflow = InferSelectModel<typeof sqliteSchema.workflows>;
export type Credential = InferSelectModel<typeof sqliteSchema.credentials>;
export type Variable = InferSelectModel<typeof sqliteSchema.variables>;
export type DataTable = InferSelectModel<typeof sqliteSchema.dataTables>;
export type DataTableRow = InferSelectModel<typeof sqliteSchema.dataTableRows>;
export type Execution = InferSelectModel<typeof sqliteSchema.executions>;
export type ExecutionData = InferSelectModel<typeof sqliteSchema.executionData>;
export type WebhookEntity = InferSelectModel<typeof sqliteSchema.webhookEntities>;
export type Setting = InferSelectModel<typeof sqliteSchema.settings>;
export type AuditLog = InferSelectModel<typeof sqliteSchema.auditLogs>;
export type ProjectQuota = InferSelectModel<typeof sqliteSchema.projectQuotas>;
export type UsageCounter = InferSelectModel<typeof sqliteSchema.usageCounters>;
export type BillingOrder = InferSelectModel<typeof sqliteSchema.billingOrders>;
export type ApiKey = InferSelectModel<typeof sqliteSchema.apiKeys>;
export type Invitation = InferSelectModel<typeof sqliteSchema.invitations>;
export type Folder = InferSelectModel<typeof sqliteSchema.folders>;
export type WorkflowVersion = InferSelectModel<typeof sqliteSchema.workflowVersions>;
export type InstalledNode = InferSelectModel<typeof sqliteSchema.installedNodes>;

/* ── 创建入参（区别于自动生成的 id/时间戳字段） ── */

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  firstName?: string | null;
  lastName?: string | null;
  role?: string;
}

export interface CreateProjectInput {
  name: string;
  type?: string;
}

export interface CreateWorkflowInput {
  name: string;
  nodes: INode[];
  connections: IConnections;
  active?: boolean;
  settings?: IWorkflowSettings | null;
  staticData?: JsonObject | null;
  folderId?: string | null;
}

export interface CreateCredentialInput {
  name: string;
  type: string;
  data: string; // 已加密的密文
}

export interface CreateExecutionInput {
  workflowId: string;
  status: string;
  mode: string;
  startedAt?: Date | null;
}

export interface ExecutionDataSnapshot {
  workflowData: JsonObject;
  data: JsonObject;
}

export interface WebhookEntityInput {
  webhookPath: string;
  method: string;
  workflowId: string;
  node: string;
}

export interface CreateAuditLogInput {
  userId?: string | null;
  projectId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  details?: JsonObject | null;
  ip?: string | null;
}

/** 项目成员视图（join users）。 */
export interface ProjectMember {
  userId: string;
  email: string;
  role: string;
}
