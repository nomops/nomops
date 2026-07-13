import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { JsonObject } from '@nomops/workflow';
import type { DatabaseHandle, NomopsSchema } from './client.js';
import type {
  AuditLog,
  BillingOrder,
  CreateAuditLogInput,
  ExecutionData,
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
  ExecutionDataSnapshot,
  Project,
  DataTable,
  DataTableRow,
  Setting,
  User,
  Variable,
  WebhookEntity,
  WebhookEntityInput,
  Workflow,
} from './types.js';

/**
 * 归属边界内建在仓储层（铁律 2）：所有跨归属的读操作强制传 projectId，
 * SQL 里 join shared_* 表过滤 —— Cloud 多租户无需改业务代码。
 *
 * 注：db 句柄在两方言下类型不同，仓储内部以宽松类型持有；
 * 列引用（schema.x.col）仍受 schema 类型约束，公共方法返回精确领域类型。
 */

const ROLE_WORKFLOW_OWNER = 'workflow:owner';
const ROLE_CREDENTIAL_OWNER = 'credential:owner';

abstract class BaseRepository {
  protected readonly db: any;
  protected readonly schema: NomopsSchema;

  constructor(db: any, schema: NomopsSchema) {
    this.db = db;
    this.schema = schema;
  }
}

export class UserRepository extends BaseRepository {
  async create(input: CreateUserInput): Promise<User> {
    const [row] = await this.db
      .insert(this.schema.users)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        role: input.role ?? 'member',
      })
      .returning();
    return row as User;
  }

  async findById(id: string): Promise<User | null> {
    const rows = await this.db.select().from(this.schema.users).where(eq(this.schema.users.id, id)).limit(1);
    return (rows[0] as User | undefined) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(this.schema.users)
      .where(eq(this.schema.users.email, email))
      .limit(1);
    return (rows[0] as User | undefined) ?? null;
  }

  async count(): Promise<number> {
    const rows = await this.db.select().from(this.schema.users);
    return rows.length;
  }

  /** 全部用户（SCIM 列表用；实例内用户量级小，暂不分页查询）。 */
  async findAll(): Promise<User[]> {
    return (await this.db.select().from(this.schema.users)) as User[];
  }

  /** 更新用户属性（SCIM replace/patch 用）。 */
  async update(
    id: string,
    patch: Partial<Pick<User, 'firstName' | 'lastName' | 'disabled' | 'role'>>,
  ): Promise<User> {
    const [row] = await this.db
      .update(this.schema.users)
      .set(patch)
      .where(eq(this.schema.users.id, id))
      .returning();
    return row as User;
  }
}

export class ProjectRepository extends BaseRepository {
  async create(input: CreateProjectInput): Promise<Project> {
    const [row] = await this.db
      .insert(this.schema.projects)
      .values({ name: input.name, type: input.type ?? 'personal' })
      .returning();
    return row as Project;
  }

  async findById(id: string): Promise<Project | null> {
    const rows = await this.db
      .select()
      .from(this.schema.projects)
      .where(eq(this.schema.projects.id, id))
      .limit(1);
    return (rows[0] as Project | undefined) ?? null;
  }

  /** 把用户加入 project（project_relations）。 */
  async addMember(projectId: string, userId: string, role: string): Promise<void> {
    await this.db.insert(this.schema.projectRelations).values({ projectId, userId, role });
  }

  /** 用户所属的全部 project（经 project_relations）。 */
  async findAllByUser(userId: string): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(this.schema.projects)
      .innerJoin(
        this.schema.projectRelations,
        eq(this.schema.projectRelations.projectId, this.schema.projects.id),
      )
      .where(eq(this.schema.projectRelations.userId, userId));
    return rows.map((r: { projects: Project }) => r.projects);
  }

  /** 用户所属项目 + 其角色（项目列表页用）。 */
  async findAllByUserWithRole(userId: string): Promise<Array<Project & { role: string }>> {
    const rows = await this.db
      .select()
      .from(this.schema.projects)
      .innerJoin(
        this.schema.projectRelations,
        eq(this.schema.projectRelations.projectId, this.schema.projects.id),
      )
      .where(eq(this.schema.projectRelations.userId, userId));
    return rows.map((r: { projects: Project; project_relations: { role: string } }) => ({
      ...r.projects,
      role: r.project_relations.role,
    }));
  }

  /** 用户在某项目的角色；非成员返回 null（RBAC 每请求查询，改权立即生效）。 */
  async findMemberRole(projectId: string, userId: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(this.schema.projectRelations)
      .where(
        and(
          eq(this.schema.projectRelations.projectId, projectId),
          eq(this.schema.projectRelations.userId, userId),
        ),
      )
      .limit(1);
    return rows[0] ? (rows[0] as { role: string }).role : null;
  }

  /** 项目成员列表（join users 取邮箱）。 */
  async findMembers(projectId: string): Promise<ProjectMember[]> {
    const rows = await this.db
      .select()
      .from(this.schema.projectRelations)
      .innerJoin(this.schema.users, eq(this.schema.users.id, this.schema.projectRelations.userId))
      .where(eq(this.schema.projectRelations.projectId, projectId));
    return rows.map(
      (r: { project_relations: { userId: string; role: string }; users: { email: string } }) => ({
        userId: r.project_relations.userId,
        email: r.users.email,
        role: r.project_relations.role,
      }),
    );
  }

  async updateMemberRole(projectId: string, userId: string, role: string): Promise<void> {
    await this.db
      .update(this.schema.projectRelations)
      .set({ role })
      .where(
        and(
          eq(this.schema.projectRelations.projectId, projectId),
          eq(this.schema.projectRelations.userId, userId),
        ),
      );
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    await this.db
      .delete(this.schema.projectRelations)
      .where(
        and(
          eq(this.schema.projectRelations.projectId, projectId),
          eq(this.schema.projectRelations.userId, userId),
        ),
      );
  }
}

export class WorkflowRepository extends BaseRepository {
  async create(input: CreateWorkflowInput, projectId: string): Promise<Workflow> {
    const [row] = await this.db
      .insert(this.schema.workflows)
      .values({
        name: input.name,
        active: input.active ?? false,
        nodes: input.nodes,
        connections: input.connections,
        settings: input.settings ?? null,
        staticData: input.staticData ?? null,
      })
      .returning();
    await this.db
      .insert(this.schema.sharedWorkflows)
      .values({ workflowId: row.id, projectId, role: ROLE_WORKFLOW_OWNER });
    return row as Workflow;
  }

  async findById(id: string, projectId: string): Promise<Workflow | null> {
    const rows = await this.db
      .select()
      .from(this.schema.workflows)
      .innerJoin(
        this.schema.sharedWorkflows,
        eq(this.schema.sharedWorkflows.workflowId, this.schema.workflows.id),
      )
      .where(
        and(eq(this.schema.workflows.id, id), eq(this.schema.sharedWorkflows.projectId, projectId)),
      )
      .limit(1);
    return rows[0] ? (rows[0].workflows as Workflow) : null;
  }

  async findAllByProject(projectId: string): Promise<Workflow[]> {
    const rows = await this.db
      .select()
      .from(this.schema.workflows)
      .innerJoin(
        this.schema.sharedWorkflows,
        eq(this.schema.sharedWorkflows.workflowId, this.schema.workflows.id),
      )
      .where(eq(this.schema.sharedWorkflows.projectId, projectId));
    return rows.map((r: { workflows: Workflow }) => r.workflows);
  }

  async update(id: string, patch: Partial<CreateWorkflowInput>): Promise<Workflow> {
    const [row] = await this.db
      .update(this.schema.workflows)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(this.schema.workflows.id, id))
      .returning();
    return row as Workflow;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(this.schema.sharedWorkflows).where(eq(this.schema.sharedWorkflows.workflowId, id));
    await this.db.delete(this.schema.workflows).where(eq(this.schema.workflows.id, id));
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await this.db
      .update(this.schema.workflows)
      .set({ active, updatedAt: new Date() })
      .where(eq(this.schema.workflows.id, id));
  }

  /** 全部已激活的工作流（启动时恢复触发器用）。 */
  async findAllActive(): Promise<Workflow[]> {
    const rows = await this.db
      .select()
      .from(this.schema.workflows)
      .where(eq(this.schema.workflows.active, true));
    return rows as Workflow[];
  }

  /**
   * 工作流的归属 project（owner）。触发执行（webhook/cron）没有请求上下文，
   * 凭证解密所需的 projectId 从这里取。
   */
  async getOwnerProjectId(workflowId: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(this.schema.sharedWorkflows)
      .where(eq(this.schema.sharedWorkflows.workflowId, workflowId))
      .limit(1);
    return rows[0] ? (rows[0] as { projectId: string }).projectId : null;
  }
}

export class CredentialRepository extends BaseRepository {
  async create(input: CreateCredentialInput, projectId: string): Promise<Credential> {
    const [row] = await this.db
      .insert(this.schema.credentials)
      .values({ name: input.name, type: input.type, data: input.data })
      .returning();
    await this.db
      .insert(this.schema.sharedCredentials)
      .values({ credentialId: row.id, projectId, role: ROLE_CREDENTIAL_OWNER });
    return row as Credential;
  }

  async findById(id: string, projectId: string): Promise<Credential | null> {
    const rows = await this.db
      .select()
      .from(this.schema.credentials)
      .innerJoin(
        this.schema.sharedCredentials,
        eq(this.schema.sharedCredentials.credentialId, this.schema.credentials.id),
      )
      .where(
        and(
          eq(this.schema.credentials.id, id),
          eq(this.schema.sharedCredentials.projectId, projectId),
        ),
      )
      .limit(1);
    return rows[0] ? (rows[0].credentials as Credential) : null;
  }

  async findAllByProject(projectId: string): Promise<Credential[]> {
    const rows = await this.db
      .select()
      .from(this.schema.credentials)
      .innerJoin(
        this.schema.sharedCredentials,
        eq(this.schema.sharedCredentials.credentialId, this.schema.credentials.id),
      )
      .where(eq(this.schema.sharedCredentials.projectId, projectId));
    return rows.map((r: { credentials: Credential }) => r.credentials);
  }

  async update(id: string, patch: { name?: string; data?: string }): Promise<void> {
    await this.db.update(this.schema.credentials).set(patch).where(eq(this.schema.credentials.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(this.schema.sharedCredentials)
      .where(eq(this.schema.sharedCredentials.credentialId, id));
    await this.db.delete(this.schema.credentials).where(eq(this.schema.credentials.id, id));
  }
}

export class ExecutionRepository extends BaseRepository {
  async create(input: CreateExecutionInput, snapshot: ExecutionDataSnapshot): Promise<Execution> {
    const [row] = await this.db
      .insert(this.schema.executions)
      .values({
        workflowId: input.workflowId,
        status: input.status,
        mode: input.mode,
        startedAt: input.startedAt ?? null,
      })
      .returning();
    await this.db.insert(this.schema.executionData).values({
      executionId: row.id,
      workflowData: snapshot.workflowData,
      data: snapshot.data,
    });
    return row as Execution;
  }

  async findById(id: string, projectId: string): Promise<Execution | null> {
    const rows = await this.db
      .select()
      .from(this.schema.executions)
      .innerJoin(
        this.schema.sharedWorkflows,
        eq(this.schema.sharedWorkflows.workflowId, this.schema.executions.workflowId),
      )
      .where(
        and(eq(this.schema.executions.id, id), eq(this.schema.sharedWorkflows.projectId, projectId)),
      )
      .limit(1);
    return rows[0] ? (rows[0].executions as Execution) : null;
  }

  async findAllByProject(projectId: string): Promise<Execution[]> {
    const rows = await this.db
      .select()
      .from(this.schema.executions)
      .innerJoin(
        this.schema.sharedWorkflows,
        eq(this.schema.sharedWorkflows.workflowId, this.schema.executions.workflowId),
      )
      .where(eq(this.schema.sharedWorkflows.projectId, projectId));
    return rows.map((r: { executions: Execution }) => r.executions);
  }

  async updateStatus(id: string, status: string, stoppedAt?: Date | null): Promise<void> {
    await this.db
      .update(this.schema.executions)
      .set({ status, stoppedAt: stoppedAt ?? null })
      .where(eq(this.schema.executions.id, id));
  }

  /** 更新执行数据大字段（RunExecutionData）。 */
  async updateData(id: string, data: JsonObject): Promise<void> {
    await this.db
      .update(this.schema.executionData)
      .set({ data })
      .where(eq(this.schema.executionData.executionId, id));
  }

  /** 读执行数据大字段。注意：不带归属过滤，调用方必须先经 findById(id, projectId) 校验归属。 */
  async getData(id: string): Promise<JsonObject | null> {
    const rows = await this.db
      .select()
      .from(this.schema.executionData)
      .where(eq(this.schema.executionData.executionId, id))
      .limit(1);
    return rows[0] ? ((rows[0] as ExecutionData).data as JsonObject) : null;
  }

  /** 读执行时的 workflow 快照（不带归属过滤，系统内部用——worker 消费队列时无请求上下文）。 */
  async getWorkflowData(id: string): Promise<JsonObject | null> {
    const rows = await this.db
      .select()
      .from(this.schema.executionData)
      .where(eq(this.schema.executionData.executionId, id))
      .limit(1);
    return rows[0] ? ((rows[0] as ExecutionData).workflowData as JsonObject) : null;
  }

  /** 读执行记录本体（不带归属过滤，系统内部用）。 */
  async getRecord(id: string): Promise<Execution | null> {
    const rows = await this.db
      .select()
      .from(this.schema.executions)
      .where(eq(this.schema.executions.id, id))
      .limit(1);
    return (rows[0] as Execution | undefined) ?? null;
  }
}

export class SettingsRepository extends BaseRepository {
  async get(key: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(this.schema.settings)
      .where(eq(this.schema.settings.key, key))
      .limit(1);
    return rows[0] ? (rows[0] as Setting).value : null;
  }

  async set(key: string, value: string, loadOnStartup = false): Promise<void> {
    await this.db
      .insert(this.schema.settings)
      .values({ key, value, loadOnStartup })
      .onConflictDoUpdate({ target: this.schema.settings.key, set: { value, loadOnStartup } });
  }
}

export class QuotaRepository extends BaseRepository {
  async getQuota(projectId: string): Promise<ProjectQuota | null> {
    const rows = await this.db
      .select()
      .from(this.schema.projectQuotas)
      .where(eq(this.schema.projectQuotas.projectId, projectId))
      .limit(1);
    return (rows[0] as ProjectQuota | undefined) ?? null;
  }

  async upsertQuota(
    projectId: string,
    plan: string,
    monthlyExecutions: number | null,
    expiresAt: Date | null = null,
  ): Promise<void> {
    await this.db
      .insert(this.schema.projectQuotas)
      .values({ projectId, plan, monthlyExecutions, expiresAt, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: this.schema.projectQuotas.projectId,
        set: { plan, monthlyExecutions, expiresAt, updatedAt: new Date() },
      });
  }

  /* ── 支付订单（支付宝） ── */

  async createOrder(input: {
    projectId: string;
    plan: string;
    months: number;
    amount: string;
  }): Promise<BillingOrder> {
    const [row] = await this.db
      .insert(this.schema.billingOrders)
      .values({ ...input, status: 'pending' })
      .returning();
    return row as BillingOrder;
  }

  async getOrder(id: string): Promise<BillingOrder | null> {
    const rows = await this.db
      .select()
      .from(this.schema.billingOrders)
      .where(eq(this.schema.billingOrders.id, id))
      .limit(1);
    return (rows[0] as BillingOrder | undefined) ?? null;
  }

  async markOrderPaid(id: string, externalRef: string): Promise<void> {
    await this.db
      .update(this.schema.billingOrders)
      .set({ status: 'paid', externalRef, paidAt: new Date() })
      .where(eq(this.schema.billingOrders.id, id));
  }

  async getUsage(projectId: string, period: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(this.schema.usageCounters)
      .where(
        and(
          eq(this.schema.usageCounters.projectId, projectId),
          eq(this.schema.usageCounters.period, period),
        ),
      )
      .limit(1);
    return rows[0] ? (rows[0] as UsageCounter).executions : 0;
  }

  /** 原子自增（DB 侧 +1，upsert）。 */
  async incrementUsage(projectId: string, period: string): Promise<void> {
    await this.db
      .insert(this.schema.usageCounters)
      .values({ projectId, period, executions: 1 })
      .onConflictDoUpdate({
        target: [this.schema.usageCounters.projectId, this.schema.usageCounters.period],
        set: { executions: sql`${this.schema.usageCounters.executions} + 1` },
      });
  }
}

export class AuditLogRepository extends BaseRepository {
  /** 追加一条审计记录（表只追加，无更新/删除方法）。 */
  async append(entry: CreateAuditLogInput): Promise<void> {
    await this.db.insert(this.schema.auditLogs).values({
      userId: entry.userId ?? null,
      projectId: entry.projectId ?? null,
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      details: entry.details ?? null,
      ip: entry.ip ?? null,
    });
  }

  /** 按项目倒序查询（分页：limit + before 时间游标）。 */
  async findAllByProject(
    projectId: string,
    options: { limit?: number; before?: Date } = {},
  ): Promise<AuditLog[]> {
    const limit = Math.min(options.limit ?? 50, 200);
    const conditions = [eq(this.schema.auditLogs.projectId, projectId)];
    if (options.before) conditions.push(lt(this.schema.auditLogs.timestamp, options.before));
    const rows = await this.db
      .select()
      .from(this.schema.auditLogs)
      .where(and(...conditions))
      .orderBy(desc(this.schema.auditLogs.timestamp))
      .limit(limit);
    return rows as AuditLog[];
  }
}

export class WebhookRepository extends BaseRepository {
  async upsert(entity: WebhookEntityInput): Promise<void> {
    await this.db
      .insert(this.schema.webhookEntities)
      .values(entity)
      .onConflictDoUpdate({
        target: [this.schema.webhookEntities.webhookPath, this.schema.webhookEntities.method],
        set: { workflowId: entity.workflowId, node: entity.node },
      });
  }

  async findByPathAndMethod(webhookPath: string, method: string): Promise<WebhookEntity | null> {
    const rows = await this.db
      .select()
      .from(this.schema.webhookEntities)
      .where(
        and(
          eq(this.schema.webhookEntities.webhookPath, webhookPath),
          eq(this.schema.webhookEntities.method, method),
        ),
      )
      .limit(1);
    return (rows[0] as WebhookEntity | undefined) ?? null;
  }

  async deleteByWorkflow(workflowId: string): Promise<void> {
    await this.db
      .delete(this.schema.webhookEntities)
      .where(eq(this.schema.webhookEntities.workflowId, workflowId));
  }
}

export class VariableRepository extends BaseRepository {
  async findAllByProject(projectId: string): Promise<Variable[]> {
    const rows = await this.db
      .select()
      .from(this.schema.variables)
      .where(eq(this.schema.variables.projectId, projectId));
    return rows as Variable[];
  }

  async findById(id: string, projectId: string): Promise<Variable | null> {
    const rows = await this.db
      .select()
      .from(this.schema.variables)
      .where(and(eq(this.schema.variables.id, id), eq(this.schema.variables.projectId, projectId)))
      .limit(1);
    return (rows[0] as Variable) ?? null;
  }

  async create(input: { projectId: string; key: string; value: string }): Promise<Variable> {
    const [row] = await this.db.insert(this.schema.variables).values(input).returning();
    return row as Variable;
  }

  async update(id: string, patch: { key?: string; value?: string }): Promise<void> {
    await this.db.update(this.schema.variables).set(patch).where(eq(this.schema.variables.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(this.schema.variables).where(eq(this.schema.variables.id, id));
  }
}

export class DataTableRepository extends BaseRepository {
  async findAllByProject(projectId: string): Promise<DataTable[]> {
    const rows = await this.db
      .select()
      .from(this.schema.dataTables)
      .where(eq(this.schema.dataTables.projectId, projectId));
    return rows as DataTable[];
  }

  async findById(id: string, projectId: string): Promise<DataTable | null> {
    const rows = await this.db
      .select()
      .from(this.schema.dataTables)
      .where(and(eq(this.schema.dataTables.id, id), eq(this.schema.dataTables.projectId, projectId)))
      .limit(1);
    return (rows[0] as DataTable) ?? null;
  }

  async createTable(input: {
    projectId: string;
    name: string;
    columns: Array<{ name: string; type: string }>;
  }): Promise<DataTable> {
    const [row] = await this.db.insert(this.schema.dataTables).values(input).returning();
    return row as DataTable;
  }

  async updateTable(id: string, patch: { name?: string; columns?: Array<{ name: string; type: string }> }): Promise<void> {
    await this.db.update(this.schema.dataTables).set(patch).where(eq(this.schema.dataTables.id, id));
  }

  async deleteTable(id: string): Promise<void> {
    await this.db.delete(this.schema.dataTableRows).where(eq(this.schema.dataTableRows.dataTableId, id));
    await this.db.delete(this.schema.dataTables).where(eq(this.schema.dataTables.id, id));
  }

  async findRows(tableId: string): Promise<DataTableRow[]> {
    const rows = await this.db
      .select()
      .from(this.schema.dataTableRows)
      .where(eq(this.schema.dataTableRows.dataTableId, tableId));
    return rows as DataTableRow[];
  }

  async findRow(id: string, tableId: string): Promise<DataTableRow | null> {
    const rows = await this.db
      .select()
      .from(this.schema.dataTableRows)
      .where(and(eq(this.schema.dataTableRows.id, id), eq(this.schema.dataTableRows.dataTableId, tableId)))
      .limit(1);
    return (rows[0] as DataTableRow) ?? null;
  }

  async insertRow(tableId: string, data: JsonObject): Promise<DataTableRow> {
    const [row] = await this.db.insert(this.schema.dataTableRows).values({ dataTableId: tableId, data }).returning();
    return row as DataTableRow;
  }

  async updateRow(id: string, data: JsonObject): Promise<void> {
    await this.db
      .update(this.schema.dataTableRows)
      .set({ data, updatedAt: new Date() })
      .where(eq(this.schema.dataTableRows.id, id));
  }

  async deleteRow(id: string): Promise<void> {
    await this.db.delete(this.schema.dataTableRows).where(eq(this.schema.dataTableRows.id, id));
  }
}

export interface Repositories {
  users: UserRepository;
  projects: ProjectRepository;
  workflows: WorkflowRepository;
  credentials: CredentialRepository;
  variables: VariableRepository;
  dataTables: DataTableRepository;
  executions: ExecutionRepository;
  settings: SettingsRepository;
  webhooks: WebhookRepository;
  auditLogs: AuditLogRepository;
  quotas: QuotaRepository;
}

/** 用一个 DatabaseHandle 组装全部仓储。server 层在启动时调用一次。 */
export function createRepositories(handle: DatabaseHandle): Repositories {
  const { db, schema } = handle;
  return {
    users: new UserRepository(db, schema),
    projects: new ProjectRepository(db, schema),
    workflows: new WorkflowRepository(db, schema),
    credentials: new CredentialRepository(db, schema),
    variables: new VariableRepository(db, schema),
    dataTables: new DataTableRepository(db, schema),
    executions: new ExecutionRepository(db, schema),
    settings: new SettingsRepository(db, schema),
    webhooks: new WebhookRepository(db, schema),
    auditLogs: new AuditLogRepository(db, schema),
    quotas: new QuotaRepository(db, schema),
  };
}
