import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { IConnections, INode, JsonObject } from '@nomops/workflow';
import type { DatabaseHandle, NomopsSchema } from './client.js';
import type {
  ApiKey,
  AuditLog,
  BillingOrder,
  ChatAgent,
  ChatSession,
  CustomRole,
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
  DynamicCredentialResolver,
  DynamicCredentialEntry,
  DynamicCredentialUserEntry,
  Execution,
  ExecutionDataSnapshot,
  Folder,
  Invitation,
  Project,
  DataTable,
  DataTableRow,
  Setting,
  Tag,
  User,
  Variable,
  WebhookEntity,
  WebhookEntityInput,
  Workflow,
  WorkflowVersion,
  InstalledNode,
  TestRun,
  TestCaseRun,
  AnnotationTag,
  AuthProviderSyncRecord,
  ScheduledJob,
  ScheduledTask,
  InsightsRawEvent,
  InsightsPeriodRow,
  PublishHistoryRow,
  TriggerStatusRow,
  RoleMappingRule,
  InstanceVersionRow,
  McpRegistryServerRow,
  DeploymentKey,
  TrustedKey,
  TrustedKeySource,
  Agent,
  AgentVersion,
  AgentThread,
  AgentRun,
  AgentMessage,
  MemoryEntry,
  MemoryObservation,
  AgentTaskDefinition,
  AgentFile,
  AgentChannel,
  WorkflowBuilderSession,
  AiBuilderTemporaryWorkflow,
  InstanceAiThread,
  InstanceAiMessage,
  InstanceAiCheckpoint,
  InstanceAiPendingAction,
  InstanceAiRunNode,
  InstanceAiMemory,
  InstanceAiMcpConnection,
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

  /** 记最近活跃（D146）：进程内节流,同一用户 60s 内只写一次 DB。 */
  private readonly lastActiveTouch = new Map<string, number>();
  async touchLastActive(id: string, now: number = Date.now()): Promise<void> {
    const last = this.lastActiveTouch.get(id) ?? 0;
    if (now - last < 60_000) return;
    this.lastActiveTouch.set(id, now);
    await this.db
      .update(this.schema.users)
      .set({ lastActiveAt: new Date(now) })
      .where(eq(this.schema.users.id, id));
  }

  /** 全部用户（SCIM 列表用；实例内用户量级小，暂不分页查询）。 */
  async findAll(): Promise<User[]> {
    return (await this.db.select().from(this.schema.users)) as User[];
  }

  /** 更新用户属性（SCIM replace/patch 用）。 */
  async update(
    id: string,
    patch: Partial<Pick<User, 'firstName' | 'lastName' | 'disabled' | 'role' | 'email'>>,
  ): Promise<User> {
    const [row] = await this.db
      .update(this.schema.users)
      .set(patch)
      .where(eq(this.schema.users.id, id))
      .returning();
    return row as User;
  }

  /** 每用户偏好（backlog #43）：整存 settings JSON。 */
  async updateSettings(id: string, settings: JsonObject): Promise<void> {
    await this.db.update(this.schema.users).set({ settings }).where(eq(this.schema.users.id, id));
  }

  /** 更新两步验证状态（enable/disable/备份码消费）。 */
  async setMfaState(
    id: string,
    patch: Partial<Pick<User, 'mfaEnabled' | 'mfaSecret' | 'mfaBackupCodes'>>,
  ): Promise<void> {
    await this.db.update(this.schema.users).set(patch).where(eq(this.schema.users.id, id));
  }

  /** 改口令（密码重置用）。 */
  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.db.update(this.schema.users).set({ passwordHash }).where(eq(this.schema.users.id, id));
  }

  /** 改密后递增 tokenVersion，使该用户所有既有会话立即失效。 */
  async setPasswordAndRevokeSessions(id: string, passwordHash: string): Promise<void> {
    await this.db
      .update(this.schema.users)
      .set({ passwordHash, tokenVersion: sql`${this.schema.users.tokenVersion} + 1` })
      .where(eq(this.schema.users.id, id));
  }

  /**
   * 删除用户（实例 admin 移除成员）。先清引用 users.id 的子行（FK 强制开启），
   * 再删用户本身。invitedBy 置空（该用户曾发出的邀请保留、发起人匿名化）。
   * 其名下 personal project 若因此无成员则成孤儿，暂不 GC。
   */
  async delete(id: string): Promise<void> {
    await this.db.delete(this.schema.apiKeys).where(eq(this.schema.apiKeys.userId, id));
    await this.db.delete(this.schema.passwordResets).where(eq(this.schema.passwordResets.userId, id));
    await this.db.delete(this.schema.projectRelations).where(eq(this.schema.projectRelations.userId, id));
    await this.db
      .update(this.schema.invitations)
      .set({ invitedBy: null })
      .where(eq(this.schema.invitations.invitedBy, id));
    await this.db.delete(this.schema.users).where(eq(this.schema.users.id, id));
  }
}

export class AuthRateLimitRepository extends BaseRepository {
  async get(key: string): Promise<{ failures: number; windowStart: Date; blockedUntil: Date | null } | null> {
    const rows = await this.db.select().from(this.schema.authRateLimits).where(eq(this.schema.authRateLimits.key, key)).limit(1);
    return rows[0] ?? null;
  }

  async set(key: string, value: { failures: number; windowStart: Date; blockedUntil: Date | null }): Promise<void> {
    await this.db
      .insert(this.schema.authRateLimits)
      .values({ key, ...value })
      .onConflictDoUpdate({ target: this.schema.authRateLimits.key, set: value });
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(this.schema.authRateLimits).where(eq(this.schema.authRateLimits.key, key));
  }
}

/** 密码重置票据仓储（存 token 哈希，一次性）。 */
export class PasswordResetRepository extends BaseRepository {
  async create(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    await this.db
      .insert(this.schema.passwordResets)
      .values({ tokenHash, userId, expiresAt })
      .onConflictDoUpdate({ target: this.schema.passwordResets.tokenHash, set: { userId, expiresAt } });
  }

  async find(tokenHash: string): Promise<{ userId: string; expiresAt: Date } | null> {
    const rows = await this.db
      .select()
      .from(this.schema.passwordResets)
      .where(eq(this.schema.passwordResets.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ? { userId: rows[0].userId, expiresAt: rows[0].expiresAt } : null;
  }

  async delete(tokenHash: string): Promise<void> {
    await this.db.delete(this.schema.passwordResets).where(eq(this.schema.passwordResets.tokenHash, tokenHash));
  }
}

/** 用户邀请仓储（存 token 哈希；未接受即 pending 用户，接受时消费）。 */
export class InvitationRepository extends BaseRepository {
  async create(input: {
    email: string;
    tokenHash: string;
    role: string;
    invitedBy: string | null;
  }): Promise<Invitation> {
    const [row] = await this.db
      .insert(this.schema.invitations)
      .values({
        email: input.email,
        tokenHash: input.tokenHash,
        role: input.role,
        invitedBy: input.invitedBy,
      })
      .returning();
    return row as Invitation;
  }

  async findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const rows = await this.db
      .select()
      .from(this.schema.invitations)
      .where(eq(this.schema.invitations.tokenHash, tokenHash))
      .limit(1);
    return (rows[0] as Invitation | undefined) ?? null;
  }

  async findByEmail(email: string): Promise<Invitation | null> {
    const rows = await this.db
      .select()
      .from(this.schema.invitations)
      .where(eq(this.schema.invitations.email, email))
      .limit(1);
    return (rows[0] as Invitation | undefined) ?? null;
  }

  async findById(id: string): Promise<Invitation | null> {
    const rows = await this.db
      .select()
      .from(this.schema.invitations)
      .where(eq(this.schema.invitations.id, id))
      .limit(1);
    return (rows[0] as Invitation | undefined) ?? null;
  }

  /** 全部未接受邀请（用户列表合并 pending 行用）。 */
  async findAll(): Promise<Invitation[]> {
    return (await this.db.select().from(this.schema.invitations)) as Invitation[];
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(this.schema.invitations).where(eq(this.schema.invitations.id, id));
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

  /** 幂等设成员角色（#42 角色映射每次登录调用）：已是成员则改角色,否则加入。 */
  async setMemberRole(projectId: string, userId: string, role: string): Promise<void> {
    const existing = await this.findMemberRole(projectId, userId);
    if (existing === null) await this.addMember(projectId, userId, role);
    else if (existing !== role) await this.updateMemberRole(projectId, userId, role);
  }

  /** 某类型的全部 project（SCIM Groups 列 team 项目用）。 */
  async findAllByType(type: string): Promise<Project[]> {
    return (await this.db.select().from(this.schema.projects).where(eq(this.schema.projects.type, type))) as Project[];
  }

  /** 按 name + type 查（SCIM Group displayName eq 过滤）。 */
  async findByNameAndType(name: string, type: string): Promise<Project | null> {
    const rows = await this.db
      .select()
      .from(this.schema.projects)
      .where(and(eq(this.schema.projects.name, name), eq(this.schema.projects.type, type)))
      .limit(1);
    return (rows[0] as Project | undefined) ?? null;
  }

  async rename(id: string, name: string): Promise<void> {
    await this.db.update(this.schema.projects).set({ name }).where(eq(this.schema.projects.id, id));
  }

  /** 删项目 + 其成员关系（SCIM Group delete）。有工作流/凭证共享行时 FK 阻止,调用方转 409。 */
  async deleteWithRelations(id: string): Promise<void> {
    await this.db.delete(this.schema.projectRelations).where(eq(this.schema.projectRelations.projectId, id));
    await this.db.delete(this.schema.projects).where(eq(this.schema.projects.id, id));
  }

  /** 实例内某类型的 project 总数（license 席位/项目配额守门用，不带归属过滤）。 */
  async countByType(type: string): Promise<number> {
    const rows = await this.db
      .select({ n: sql`count(*)` })
      .from(this.schema.projects)
      .where(eq(this.schema.projects.type, type));
    return Number((rows[0] as { n: unknown } | undefined)?.n ?? 0);
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
  constructor(db: any, schema: NomopsSchema, private readonly dialect: DatabaseHandle['dialect']) {
    super(db, schema);
  }
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
        pinData: input.pinData ?? null,
        folderId: input.folderId ?? null,
      })
      .returning();
    await this.db
      .insert(this.schema.sharedWorkflows)
      .values({ workflowId: row.id, projectId, role: ROLE_WORKFLOW_OWNER });
    return row as Workflow;
  }

  /** 用指定 id 建工作流（源码同步导入：跨环境保持同一 workflow id）。 */
  async createWithId(input: CreateWorkflowInput, projectId: string, id: string): Promise<Workflow> {
    const [row] = await this.db
      .insert(this.schema.workflows)
      .values({
        id,
        name: input.name,
        active: input.active ?? false,
        nodes: input.nodes,
        connections: input.connections,
        settings: input.settings ?? null,
        staticData: input.staticData ?? null,
        pinData: input.pinData ?? null,
        folderId: input.folderId ?? null,
      })
      .returning();
    await this.db
      .insert(this.schema.sharedWorkflows)
      .values({ workflowId: row.id, projectId, role: ROLE_WORKFLOW_OWNER });
    return row as Workflow;
  }

  /** 按文件夹过滤（folderId=null → 项目根）。归属经 shared_workflows。 */
  async findByProjectAndFolder(projectId: string, folderId: string | null, archived = false): Promise<Workflow[]> {
    const rows = await this.db
      .select()
      .from(this.schema.workflows)
      .innerJoin(
        this.schema.sharedWorkflows,
        eq(this.schema.sharedWorkflows.workflowId, this.schema.workflows.id),
      )
      .where(
        and(
          eq(this.schema.sharedWorkflows.projectId, projectId),
          eq(this.schema.workflows.archived, archived),
          folderId === null
            ? isNull(this.schema.workflows.folderId)
            : eq(this.schema.workflows.folderId, folderId),
        ),
      );
    return rows.map((r: { workflows: Workflow }) => r.workflows);
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

  /**
   * 不带归属过滤的按 id 查询 —— ★仅限系统内部路径（触发器/轮询调度读最新 staticData）。
   * 一切用户请求路径必须走带 projectId 的 findById（铁律 2）。
   */
  async findByIdUnscoped(id: string): Promise<Workflow | null> {
    const rows = await this.db
      .select()
      .from(this.schema.workflows)
      .where(eq(this.schema.workflows.id, id))
      .limit(1);
    return (rows[0] as Workflow | undefined) ?? null;
  }

  async findAllByProject(projectId: string, archived = false): Promise<Workflow[]> {
    const rows = await this.db
      .select()
      .from(this.schema.workflows)
      .innerJoin(
        this.schema.sharedWorkflows,
        eq(this.schema.sharedWorkflows.workflowId, this.schema.workflows.id),
      )
      .where(
        and(
          eq(this.schema.sharedWorkflows.projectId, projectId),
          eq(this.schema.workflows.archived, archived),
        ),
      );
    return rows.map((r: { workflows: Workflow }) => r.workflows);
  }

  /** 收藏/归档标志位（B2 卡片菜单）。归档时上层负责先下线触发器。 */
  async setFlags(id: string, patch: { favorite?: boolean; archived?: boolean }): Promise<Workflow> {
    const [row] = await this.db
      .update(this.schema.workflows)
      .set(patch)
      .where(eq(this.schema.workflows.id, id))
      .returning();
    return row as Workflow;
  }

  async update(id: string, patch: Partial<CreateWorkflowInput>): Promise<Workflow> {
    const [row] = await this.db
      .update(this.schema.workflows)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(this.schema.workflows.id, id))
      .returning();
    return row as Workflow;
  }

  /** 实例级列表（仅 MCP 管理页等系统路径；admin 已由路由把关）：id/name/项目名/是否已发布。 */
  async listAllUnscoped(): Promise<
    Array<{ id: string; name: string; description: string | null; projectName: string; published: boolean }>
  > {
    const rows = await this.db
      .select({
        id: this.schema.workflows.id,
        name: this.schema.workflows.name,
        // D144：MCP Workflows 表要展示 Description 列
        description: this.schema.workflows.description,
        projectName: this.schema.projects.name,
        publishedVersionId: this.schema.workflows.publishedVersionId,
      })
      .from(this.schema.workflows)
      .innerJoin(this.schema.sharedWorkflows, eq(this.schema.sharedWorkflows.workflowId, this.schema.workflows.id))
      .innerJoin(this.schema.projects, eq(this.schema.projects.id, this.schema.sharedWorkflows.projectId));
    return (
      rows as Array<{
        id: string;
        name: string;
        description: string | null;
        projectName: string;
        publishedVersionId: string | null;
      }>
    ).map(({ publishedVersionId, ...rest }) => ({ ...rest, published: Boolean(publishedVersionId) }));
  }

  /** 发布：生产指针与 outbox 同事务提交，避免进程在两次写之间退出而丢激活事件。 */
  async markPublished(id: string, versionId: string): Promise<Workflow> {
    if (this.dialect === 'sqlite') {
      return this.db.transaction((tx: any) => {
        const [row] = tx.update(this.schema.workflows)
          .set({ publishedVersionId: versionId, publishedAt: new Date() })
          .where(eq(this.schema.workflows.id, id))
          .returning()
          .all();
        tx.insert(this.schema.publicationOutbox).values({ workflowId: id, versionId }).run();
        return row as Workflow;
      });
    }
    return this.db.transaction(async (tx: any) => {
      const [row] = await tx.update(this.schema.workflows)
        .set({ publishedVersionId: versionId, publishedAt: new Date() })
        .where(eq(this.schema.workflows.id, id))
        .returning();
      await tx.insert(this.schema.publicationOutbox).values({ workflowId: id, versionId });
      return row as Workflow;
    });
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
  /** 实例级计数（metrics 用，无归属过滤——只出聚合数字）。 */
  async countAll(): Promise<number> {
    const rows = await this.db.select({ n: sql`count(*)` }).from(this.schema.workflows);
    return Number(rows[0]?.n ?? 0);
  }

  async countActive(): Promise<number> {
    const rows = await this.db
      .select({ n: sql`count(*)` })
      .from(this.schema.workflows)
      .where(eq(this.schema.workflows.active, true));
    return Number(rows[0]?.n ?? 0);
  }

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
   * ★必须按 owner 角色过滤——共享(#12)后一个工作流有多行 shared_workflows,
   *   取任意一行会把生产触发的凭证解密上下文指到受享方项目。
   */
  async getOwnerProjectId(workflowId: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(this.schema.sharedWorkflows)
      .where(
        and(
          eq(this.schema.sharedWorkflows.workflowId, workflowId),
          eq(this.schema.sharedWorkflows.role, ROLE_WORKFLOW_OWNER),
        ),
      )
      .limit(1);
    return rows[0] ? (rows[0] as { projectId: string }).projectId : null;
  }

  /* ── 共享（backlog #12;role: workflow:owner=归属,workflow:editor=受享读写跑） ── */

  /** 某项目对该工作流的角色（null = 无任何关系）。 */
  async getRoleForProject(workflowId: string, projectId: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(this.schema.sharedWorkflows)
      .where(
        and(
          eq(this.schema.sharedWorkflows.workflowId, workflowId),
          eq(this.schema.sharedWorkflows.projectId, projectId),
        ),
      )
      .limit(1);
    return rows[0] ? (rows[0] as { role: string }).role : null;
  }

  /** 共享清单（含 owner 行,带项目名/类型）。 */
  async listShares(workflowId: string): Promise<Array<{ projectId: string; role: string; projectName: string; projectType: string }>> {
    const rows = await this.db
      .select({
        projectId: this.schema.sharedWorkflows.projectId,
        role: this.schema.sharedWorkflows.role,
        projectName: this.schema.projects.name,
        projectType: this.schema.projects.type,
      })
      .from(this.schema.sharedWorkflows)
      .innerJoin(this.schema.projects, eq(this.schema.projects.id, this.schema.sharedWorkflows.projectId))
      .where(eq(this.schema.sharedWorkflows.workflowId, workflowId));
    return rows as Array<{ projectId: string; role: string; projectName: string; projectType: string }>;
  }

  /** 覆盖式设置受享项目集（owner 行不动;目标恒为 editor 角色）。 */
  async setShares(workflowId: string, projectIds: string[]): Promise<void> {
    await this.db
      .delete(this.schema.sharedWorkflows)
      .where(
        and(
          eq(this.schema.sharedWorkflows.workflowId, workflowId),
          ne(this.schema.sharedWorkflows.role, ROLE_WORKFLOW_OWNER),
        ),
      );
    const owner = await this.getOwnerProjectId(workflowId);
    const targets = [...new Set(projectIds)].filter((p) => p !== owner);
    if (targets.length) {
      await this.db
        .insert(this.schema.sharedWorkflows)
        .values(targets.map((projectId) => ({ workflowId, projectId, role: 'workflow:editor' })));
    }
  }

  /**
   * 跨项目转移（backlog #13）：owner 行改指目标项目。
   * 共享行全清（受享关系不跨项目迁移,也防目标项目已有 editor 行撞 PK）;
   * folderId 归零（文件夹属于旧项目）。
   */
  async transferOwner(workflowId: string, targetProjectId: string): Promise<void> {
    await this.db
      .delete(this.schema.sharedWorkflows)
      .where(
        and(
          eq(this.schema.sharedWorkflows.workflowId, workflowId),
          ne(this.schema.sharedWorkflows.role, ROLE_WORKFLOW_OWNER),
        ),
      );
    await this.db
      .update(this.schema.sharedWorkflows)
      .set({ projectId: targetProjectId })
      .where(
        and(
          eq(this.schema.sharedWorkflows.workflowId, workflowId),
          eq(this.schema.sharedWorkflows.role, ROLE_WORKFLOW_OWNER),
        ),
      );
    await this.db
      .update(this.schema.workflows)
      .set({ folderId: null, updatedAt: new Date() })
      .where(eq(this.schema.workflows.id, workflowId));
  }

  /** 共享**给**某项目的工作流（受享侧,role != owner;Shared with you 页）。 */
  async findSharedWithProject(projectId: string): Promise<Workflow[]> {
    const rows = await this.db
      .select()
      .from(this.schema.workflows)
      .innerJoin(
        this.schema.sharedWorkflows,
        eq(this.schema.sharedWorkflows.workflowId, this.schema.workflows.id),
      )
      .where(
        and(
          eq(this.schema.sharedWorkflows.projectId, projectId),
          ne(this.schema.sharedWorkflows.role, ROLE_WORKFLOW_OWNER),
        ),
      );
    return rows.map((r: { workflows: Workflow }) => r.workflows);
  }
}

/** 版本元信息（列表用，不含 nodes/connections 大字段）。 */
export interface WorkflowVersionMeta {
  id: string;
  versionNumber: number;
  name: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface CreateWorkflowVersionInput {
  workflowId: string;
  projectId: string;
  name: string;
  nodes: Workflow['nodes'];
  connections: Workflow['connections'];
  settings: Workflow['settings'];
  createdBy: string | null;
}

export class WorkflowVersionRepository extends BaseRepository {
  /** 下一个版本号（该工作流当前最大 +1，从 1 起）。 */
  async nextVersionNumber(workflowId: string): Promise<number> {
    const rows = await this.db
      .select({ n: this.schema.workflowVersions.versionNumber })
      .from(this.schema.workflowVersions)
      .where(eq(this.schema.workflowVersions.workflowId, workflowId))
      .orderBy(desc(this.schema.workflowVersions.versionNumber))
      .limit(1);
    return (rows[0]?.n ?? 0) + 1;
  }

  async create(input: CreateWorkflowVersionInput): Promise<WorkflowVersion> {
    const versionNumber = await this.nextVersionNumber(input.workflowId);
    const [row] = await this.db
      .insert(this.schema.workflowVersions)
      .values({
        workflowId: input.workflowId,
        projectId: input.projectId,
        versionNumber,
        name: input.name,
        nodes: input.nodes,
        connections: input.connections,
        settings: input.settings ?? null,
        createdBy: input.createdBy,
      })
      .returning();
    return row as WorkflowVersion;
  }

  /** 某工作流的版本列表（新→旧），只取元信息。 */
  async listByWorkflow(workflowId: string): Promise<WorkflowVersionMeta[]> {
    const rows = await this.db
      .select({
        id: this.schema.workflowVersions.id,
        versionNumber: this.schema.workflowVersions.versionNumber,
        name: this.schema.workflowVersions.name,
        createdBy: this.schema.workflowVersions.createdBy,
        createdAt: this.schema.workflowVersions.createdAt,
      })
      .from(this.schema.workflowVersions)
      .where(eq(this.schema.workflowVersions.workflowId, workflowId))
      .orderBy(desc(this.schema.workflowVersions.versionNumber));
    return rows as WorkflowVersionMeta[];
  }

  /** 单个版本全量（含 nodes/connections）。按 workflowId 二次校验，避免跨工作流取版本。 */
  async findById(id: string, workflowId: string): Promise<WorkflowVersion | null> {
    const rows = await this.db
      .select()
      .from(this.schema.workflowVersions)
      .where(
        and(
          eq(this.schema.workflowVersions.id, id),
          eq(this.schema.workflowVersions.workflowId, workflowId),
        ),
      )
      .limit(1);
    return (rows[0] as WorkflowVersion | undefined) ?? null;
  }

  /** 只保留最近 keep 个版本，删更旧的（限界增长）。keepId：额外保留的版本（已发布指针，不能被裁）。 */
  async prune(workflowId: string, keep: number, keepId?: string | null): Promise<void> {
    const rows = await this.db
      .select({ n: this.schema.workflowVersions.versionNumber })
      .from(this.schema.workflowVersions)
      .where(eq(this.schema.workflowVersions.workflowId, workflowId))
      .orderBy(desc(this.schema.workflowVersions.versionNumber))
      .limit(1)
      .offset(keep);
    const cutoff = rows[0]?.n;
    if (cutoff === undefined) return;
    await this.db
      .delete(this.schema.workflowVersions)
      .where(
        and(
          eq(this.schema.workflowVersions.workflowId, workflowId),
          lt(this.schema.workflowVersions.versionNumber, cutoff + 1),
          ...(keepId ? [ne(this.schema.workflowVersions.id, keepId)] : []),
        ),
      );
  }

  /** 工作流删除时清掉其版本（无级联 FK）。 */
  async deleteByWorkflow(workflowId: string): Promise<void> {
    await this.db
      .delete(this.schema.workflowVersions)
      .where(eq(this.schema.workflowVersions.workflowId, workflowId));
  }
}

export interface InstalledNodeInput {
  packageName: string;
  version: string;
  nodeTypes: string[];
  installedBy: string | null;
}

/** 已安装社区节点包（实例级）。 */
export class InstalledNodeRepository extends BaseRepository {
  async list(): Promise<InstalledNode[]> {
    return (await this.db.select().from(this.schema.installedNodes)) as InstalledNode[];
  }

  async findByName(packageName: string): Promise<InstalledNode | null> {
    const rows = await this.db
      .select()
      .from(this.schema.installedNodes)
      .where(eq(this.schema.installedNodes.packageName, packageName))
      .limit(1);
    return (rows[0] as InstalledNode | undefined) ?? null;
  }

  /** upsert：重复安装同名包时更新版本/类型/安装人。 */
  async upsert(input: InstalledNodeInput): Promise<InstalledNode> {
    const [row] = await this.db
      .insert(this.schema.installedNodes)
      .values(input)
      .onConflictDoUpdate({
        target: this.schema.installedNodes.packageName,
        set: { version: input.version, nodeTypes: input.nodeTypes, installedBy: input.installedBy },
      })
      .returning();
    return row as InstalledNode;
  }

  async delete(packageName: string): Promise<void> {
    await this.db
      .delete(this.schema.installedNodes)
      .where(eq(this.schema.installedNodes.packageName, packageName));
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
    await this.db
      .update(this.schema.credentials)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(this.schema.credentials.id, id));
  }

  /** 标记/解除凭证的动态解析（#46）：resolverId=null 解除,恢复固定密文老行为。 */
  async setResolver(id: string, resolverId: string | null): Promise<void> {
    await this.db
      .update(this.schema.credentials)
      .set({ resolverId, isResolvable: resolverId !== null, updatedAt: new Date() })
      .where(eq(this.schema.credentials.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(this.schema.sharedCredentials)
      .where(eq(this.schema.sharedCredentials.credentialId, id));
    await this.db.delete(this.schema.credentials).where(eq(this.schema.credentials.id, id));
  }

  /* ── 共享（backlog #12,与工作流对称;受享=credential:user,执行注入可用、不可改/删/再共享） ── */

  async getOwnerProjectId(credentialId: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(this.schema.sharedCredentials)
      .where(
        and(
          eq(this.schema.sharedCredentials.credentialId, credentialId),
          eq(this.schema.sharedCredentials.role, ROLE_CREDENTIAL_OWNER),
        ),
      )
      .limit(1);
    return rows[0] ? (rows[0] as { projectId: string }).projectId : null;
  }

  async getRoleForProject(credentialId: string, projectId: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(this.schema.sharedCredentials)
      .where(
        and(
          eq(this.schema.sharedCredentials.credentialId, credentialId),
          eq(this.schema.sharedCredentials.projectId, projectId),
        ),
      )
      .limit(1);
    return rows[0] ? (rows[0] as { role: string }).role : null;
  }

  async listShares(credentialId: string): Promise<Array<{ projectId: string; role: string; projectName: string; projectType: string }>> {
    const rows = await this.db
      .select({
        projectId: this.schema.sharedCredentials.projectId,
        role: this.schema.sharedCredentials.role,
        projectName: this.schema.projects.name,
        projectType: this.schema.projects.type,
      })
      .from(this.schema.sharedCredentials)
      .innerJoin(this.schema.projects, eq(this.schema.projects.id, this.schema.sharedCredentials.projectId))
      .where(eq(this.schema.sharedCredentials.credentialId, credentialId));
    return rows as Array<{ projectId: string; role: string; projectName: string; projectType: string }>;
  }

  async setShares(credentialId: string, projectIds: string[]): Promise<void> {
    await this.db
      .delete(this.schema.sharedCredentials)
      .where(
        and(
          eq(this.schema.sharedCredentials.credentialId, credentialId),
          ne(this.schema.sharedCredentials.role, ROLE_CREDENTIAL_OWNER),
        ),
      );
    const owner = await this.getOwnerProjectId(credentialId);
    const targets = [...new Set(projectIds)].filter((p) => p !== owner);
    if (targets.length) {
      await this.db
        .insert(this.schema.sharedCredentials)
        .values(targets.map((projectId) => ({ credentialId, projectId, role: 'credential:user' })));
    }
  }

  async findSharedWithProject(projectId: string): Promise<Credential[]> {
    const rows = await this.db
      .select()
      .from(this.schema.credentials)
      .innerJoin(
        this.schema.sharedCredentials,
        eq(this.schema.sharedCredentials.credentialId, this.schema.credentials.id),
      )
      .where(
        and(
          eq(this.schema.sharedCredentials.projectId, projectId),
          ne(this.schema.sharedCredentials.role, ROLE_CREDENTIAL_OWNER),
        ),
      );
    return rows.map((r: { credentials: Credential }) => r.credentials);
  }
}

/**
 * 动态凭证仓储（backlog #46 M1）：解析器 + 按 subject 的凭证值（密文）。归属按 projectId（铁律 2）。
 * entry.data 是密文（加解密在服务层用凭证加密栈）。
 */
export class DynamicCredentialRepository extends BaseRepository {
  /* ── 解析器 ── */
  async createResolver(input: { projectId: string; name: string; kind: string; config: JsonObject }): Promise<DynamicCredentialResolver> {
    const [row] = await this.db
      .insert(this.schema.dynamicCredentialResolvers)
      .values({ projectId: input.projectId, name: input.name, kind: input.kind, config: input.config })
      .returning();
    return row as DynamicCredentialResolver;
  }

  async listResolvers(projectId: string): Promise<DynamicCredentialResolver[]> {
    return (await this.db
      .select()
      .from(this.schema.dynamicCredentialResolvers)
      .where(eq(this.schema.dynamicCredentialResolvers.projectId, projectId))
      .orderBy(desc(this.schema.dynamicCredentialResolvers.createdAt))) as DynamicCredentialResolver[];
  }

  /** 归属校验版（projectId 隔离）。 */
  async findResolver(id: string, projectId: string): Promise<DynamicCredentialResolver | null> {
    const rows = await this.db
      .select()
      .from(this.schema.dynamicCredentialResolvers)
      .where(and(eq(this.schema.dynamicCredentialResolvers.id, id), eq(this.schema.dynamicCredentialResolvers.projectId, projectId)))
      .limit(1);
    return (rows[0] as DynamicCredentialResolver | undefined) ?? null;
  }

  async deleteResolver(id: string): Promise<void> {
    await this.db.delete(this.schema.dynamicCredentialEntries).where(eq(this.schema.dynamicCredentialEntries.resolverId, id));
    await this.db.delete(this.schema.dynamicCredentialUserEntries).where(eq(this.schema.dynamicCredentialUserEntries.resolverId, id));
    await this.db.delete(this.schema.dynamicCredentialResolvers).where(eq(this.schema.dynamicCredentialResolvers.id, id));
  }

  /* ── 按 subject 的凭证值（entry） ── */
  /** upsert：同 (resolverId, subject) 覆盖（unique 索引保证）。 */
  async upsertEntry(input: { resolverId: string; subject: string; data: string }): Promise<void> {
    await this.db
      .insert(this.schema.dynamicCredentialEntries)
      .values({ resolverId: input.resolverId, subject: input.subject, data: input.data })
      .onConflictDoUpdate({
        target: [this.schema.dynamicCredentialEntries.resolverId, this.schema.dynamicCredentialEntries.subject],
        set: { data: input.data, updatedAt: new Date() },
      });
  }

  async findEntry(resolverId: string, subject: string): Promise<DynamicCredentialEntry | null> {
    const rows = await this.db
      .select()
      .from(this.schema.dynamicCredentialEntries)
      .where(and(eq(this.schema.dynamicCredentialEntries.resolverId, resolverId), eq(this.schema.dynamicCredentialEntries.subject, subject)))
      .limit(1);
    return (rows[0] as DynamicCredentialEntry | undefined) ?? null;
  }

  /** 列出某解析器的 subject（不含 data 密文！——铁律 3）。 */
  async listEntrySubjects(resolverId: string): Promise<Array<{ id: string; subject: string; updatedAt: Date }>> {
    return (await this.db
      .select({
        id: this.schema.dynamicCredentialEntries.id,
        subject: this.schema.dynamicCredentialEntries.subject,
        updatedAt: this.schema.dynamicCredentialEntries.updatedAt,
      })
      .from(this.schema.dynamicCredentialEntries)
      .where(eq(this.schema.dynamicCredentialEntries.resolverId, resolverId))
      .orderBy(this.schema.dynamicCredentialEntries.subject)) as Array<{ id: string; subject: string; updatedAt: Date }>;
  }

  async deleteEntry(resolverId: string, subject: string): Promise<void> {
    await this.db
      .delete(this.schema.dynamicCredentialEntries)
      .where(and(eq(this.schema.dynamicCredentialEntries.resolverId, resolverId), eq(this.schema.dynamicCredentialEntries.subject, subject)));
  }

  /* ── 按平台 user 的凭证值（user_entry，#46 M2）：subject 无值时回退 ── */
  async upsertUserEntry(input: { resolverId: string; userId: string; data: string }): Promise<void> {
    await this.db
      .insert(this.schema.dynamicCredentialUserEntries)
      .values({ resolverId: input.resolverId, userId: input.userId, data: input.data })
      .onConflictDoUpdate({
        target: [this.schema.dynamicCredentialUserEntries.resolverId, this.schema.dynamicCredentialUserEntries.userId],
        set: { data: input.data, updatedAt: new Date() },
      });
  }

  async findUserEntry(resolverId: string, userId: string): Promise<DynamicCredentialUserEntry | null> {
    const rows = await this.db
      .select()
      .from(this.schema.dynamicCredentialUserEntries)
      .where(and(eq(this.schema.dynamicCredentialUserEntries.resolverId, resolverId), eq(this.schema.dynamicCredentialUserEntries.userId, userId)))
      .limit(1);
    return (rows[0] as DynamicCredentialUserEntry | undefined) ?? null;
  }

  /** 列 userId（不含 data 密文——铁律 3）。 */
  async listUserEntryUsers(resolverId: string): Promise<Array<{ id: string; userId: string; updatedAt: Date }>> {
    return (await this.db
      .select({
        id: this.schema.dynamicCredentialUserEntries.id,
        userId: this.schema.dynamicCredentialUserEntries.userId,
        updatedAt: this.schema.dynamicCredentialUserEntries.updatedAt,
      })
      .from(this.schema.dynamicCredentialUserEntries)
      .where(eq(this.schema.dynamicCredentialUserEntries.resolverId, resolverId))) as Array<{ id: string; userId: string; updatedAt: Date }>;
  }

  async deleteUserEntry(resolverId: string, userId: string): Promise<void> {
    await this.db
      .delete(this.schema.dynamicCredentialUserEntries)
      .where(and(eq(this.schema.dynamicCredentialUserEntries.resolverId, resolverId), eq(this.schema.dynamicCredentialUserEntries.userId, userId)));
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

  /** filter.metaKey 传入时 join execution_metadata 按键(值可选)过滤（#35）。 */
  async findAllByProject(
    projectId: string,
    filter?: { metaKey?: string; metaValue?: string },
  ): Promise<Execution[]> {
    if (filter?.metaKey) {
      const conds = [
        eq(this.schema.sharedWorkflows.projectId, projectId),
        eq(this.schema.executionMetadata.key, filter.metaKey),
      ];
      if (filter.metaValue) conds.push(eq(this.schema.executionMetadata.value, filter.metaValue));
      const rows = await this.db
        .selectDistinct({ executions: this.schema.executions })
        .from(this.schema.executions)
        .innerJoin(
          this.schema.sharedWorkflows,
          eq(this.schema.sharedWorkflows.workflowId, this.schema.executions.workflowId),
        )
        .innerJoin(
          this.schema.executionMetadata,
          eq(this.schema.executionMetadata.executionId, this.schema.executions.id),
        )
        .where(and(...conds));
      return rows.map((r: { executions: Execution }) => r.executions);
    }
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

  /** 某工作流最近一次已结束的执行（部分执行复用旧数据用）。 */
  async findLatestFinishedByWorkflow(workflowId: string): Promise<Execution | null> {
    const rows = await this.db
      .select()
      .from(this.schema.executions)
      .where(
        and(
          eq(this.schema.executions.workflowId, workflowId),
          sql`${this.schema.executions.status} IN ('success', 'error')`,
        ),
      )
      .orderBy(desc(this.schema.executions.createdAt))
      .limit(1);
    return (rows[0] as Execution | undefined) ?? null;
  }

  async updateStatus(id: string, status: string, stoppedAt?: Date | null): Promise<void> {
    await this.db
      .update(this.schema.executions)
      .set({ status, stoppedAt: stoppedAt ?? null, waitTill: null, waitClaimedBy: null, waitClaimExpiresAt: null })
      .where(eq(this.schema.executions.id, id));
  }

  /** 挂起为 waiting：记录唤醒时刻（null = 等外部信号），stoppedAt 保持空。 */
  async setWaiting(id: string, waitTill: Date | null): Promise<void> {
    await this.db
      .update(this.schema.executions)
      .set({ status: 'waiting', stoppedAt: null, waitTill, waitClaimedBy: null, waitClaimExpiresAt: null })
      .where(eq(this.schema.executions.id, id));
  }

  /* ── processed data（轮询去重） ── */

  /**
   * 去重原语：传入候选键，返回其中「首次出现」的键并原子记录。
   * 已见过的键被过滤掉。键按 (workflowId, contextKey) 命名空间隔离。
   */
  async filterNewKeys(workflowId: string, contextKey: string, keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const fresh: string[] = [];
    for (const value of keys) {
      const inserted = await this.db
        .insert(this.schema.processedData)
        .values({ workflowId, contextKey, value })
        .onConflictDoNothing()
        .returning();
      if (inserted.length > 0) fresh.push(value);
    }
    return fresh;
  }

  /** 清理某工作流的去重记录（删除工作流时调用）。 */
  async clearProcessedData(workflowId: string): Promise<void> {
    await this.db
      .delete(this.schema.processedData)
      .where(eq(this.schema.processedData.workflowId, workflowId));
  }

  /** 按状态聚合执行数（metrics 用）。 */
  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: this.schema.executions.status, n: sql`count(*)` })
      .from(this.schema.executions)
      .groupBy(this.schema.executions.status);
    const out: Record<string, number> = {};
    for (const r of rows as Array<{ status: string; n: unknown }>) out[r.status] = Number(r.n);
    return out;
  }

  /** 到点该唤醒的 waiting 执行（wait-tracker 轮询用；等外部信号的不含在内）。 */
  async findDueWaiting(now: Date): Promise<Execution[]> {
    const rows = await this.db
      .select()
      .from(this.schema.executions)
      .where(
        and(
          eq(this.schema.executions.status, 'waiting'),
          sql`${this.schema.executions.waitTill} IS NOT NULL`,
          lte(this.schema.executions.waitTill, now),
        ),
      );
    return rows as Execution[];
  }

  /** 多实例安全领取到点等待项；候选查询后以 owner/lease 条件 CAS，只有一个实例成功。 */
  async claimDueWaiting(now: Date, owner: string, leaseMs = 30_000, limit = 100): Promise<Execution[]> {
    const candidates = await this.db
      .select({ id: this.schema.executions.id })
      .from(this.schema.executions)
      .where(and(
        eq(this.schema.executions.status, 'waiting'),
        sql`${this.schema.executions.waitTill} IS NOT NULL`,
        lte(this.schema.executions.waitTill, now),
        or(isNull(this.schema.executions.waitClaimExpiresAt), lte(this.schema.executions.waitClaimExpiresAt, now)),
      ))
      .limit(limit);
    const claimed: Execution[] = [];
    for (const candidate of candidates as Array<{ id: string }>) {
      const rows = await this.db.update(this.schema.executions)
        .set({ waitClaimedBy: owner, waitClaimExpiresAt: new Date(now.getTime() + leaseMs) })
        .where(and(
          eq(this.schema.executions.id, candidate.id),
          eq(this.schema.executions.status, 'waiting'),
          lte(this.schema.executions.waitTill, now),
          or(isNull(this.schema.executions.waitClaimExpiresAt), lte(this.schema.executions.waitClaimExpiresAt, now)),
        ))
        .returning();
      if (rows[0]) claimed.push(rows[0] as Execution);
    }
    return claimed;
  }

  async releaseWaitClaim(id: string, owner: string): Promise<void> {
    await this.db.update(this.schema.executions)
      .set({ waitClaimedBy: null, waitClaimExpiresAt: null })
      .where(and(eq(this.schema.executions.id, id), eq(this.schema.executions.waitClaimedBy, owner)));
  }

  /** 更新执行数据大字段（RunExecutionData）。 */
  /** 删除执行（含数据行）。工作流 settings 的「不保存某类执行」策略在收尾时调用。 */
  /**
   * 删除前回调（binary GC #22）：server 注入,拿到即将删除的执行数据先清其 binary 引用。
   * 覆盖所有删除路径（单删/批删/pruner/save-policy drop）——它们都走 delete()。
   */
  private onBeforeDelete: ((data: JsonObject | null) => Promise<void>) | null = null;
  setBeforeDelete(fn: (data: JsonObject | null) => Promise<void>): void {
    this.onBeforeDelete = fn;
  }

  async delete(id: string): Promise<void> {
    if (this.onBeforeDelete) {
      const data = await this.getData(id).catch(() => null);
      await this.onBeforeDelete(data).catch(() => undefined); // 清理失败不阻塞删除
    }
    await this.db.delete(this.schema.executionData).where(eq(this.schema.executionData.executionId, id));
    await this.db.delete(this.schema.executions).where(eq(this.schema.executions.id, id));
  }

  async updateData(id: string, data: JsonObject): Promise<void> {
    await this.db
      .update(this.schema.executionData)
      .set({ data })
      .where(eq(this.schema.executionData.executionId, id));
  }

  /** 全部执行数据 blob（binary 孤儿清理用;只出 data 字段,不带归属——系统级扫描）。 */
  async allData(): Promise<JsonObject[]> {
    const rows = await this.db.select({ data: this.schema.executionData.data }).from(this.schema.executionData);
    return (rows as Array<{ data: JsonObject | null }>).map((r) => r.data).filter((d): d is JsonObject => d !== null);
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

  /**
   * 清理历史执行（限界增长）。两条策略取并集：
   * - maxAgeHours：早于该时长的记录删掉；
   * - maxCount：只保留最近 N 条，更旧的删掉。
   *
   * ★只删终态记录。waiting（等唤醒）与 running/new（在跑）绝不能删——
   * 删了 wait-tracker 就再也唤不醒它，等于静默丢失一次执行。
   * 返回删除条数（供日志/指标）。
   */
  async prune(options: { maxAgeHours?: number; maxCount?: number }): Promise<number> {
    const terminal = sql`${this.schema.executions.status} IN ('success', 'error', 'canceled')`;
    const doomed = new Set<string>();

    if (options.maxAgeHours && options.maxAgeHours > 0) {
      const cutoff = new Date(Date.now() - options.maxAgeHours * 3_600_000);
      const rows = await this.db
        .select({ id: this.schema.executions.id })
        .from(this.schema.executions)
        .where(and(terminal, lt(this.schema.executions.createdAt, cutoff)));
      for (const r of rows as Array<{ id: string }>) doomed.add(r.id);
    }

    if (options.maxCount && options.maxCount > 0) {
      // 不用 SQL OFFSET：SQLite 要求它与 LIMIT 同现，两方言行为不一致。
      // id 很小，全取回来在内存里切更可靠。
      const rows = await this.db
        .select({ id: this.schema.executions.id })
        .from(this.schema.executions)
        .where(terminal)
        .orderBy(desc(this.schema.executions.createdAt));
      for (const r of (rows as Array<{ id: string }>).slice(options.maxCount)) doomed.add(r.id);
    }

    // 逐条删以复用 delete() 的级联语义（execution_data 无 FK 约束，必须手动清）
    for (const id of doomed) await this.delete(id);
    return doomed.size;
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

  async delete(key: string): Promise<void> {
    await this.db.delete(this.schema.settings).where(eq(this.schema.settings.key, key));
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

  /** 在单条 UPSERT 中完成“未超限才 +1”，跨进程无检查/自增竞态。 */
  async consumeUsage(projectId: string, period: string, limit: number): Promise<{ allowed: boolean; used: number }> {
    if (limit <= 0) return { allowed: false, used: await this.getUsage(projectId, period) };
    const rows = await this.db
      .insert(this.schema.usageCounters)
      .values({ projectId, period, executions: 1 })
      .onConflictDoUpdate({
        target: [this.schema.usageCounters.projectId, this.schema.usageCounters.period],
        set: { executions: sql`${this.schema.usageCounters.executions} + 1` },
        setWhere: lt(this.schema.usageCounters.executions, limit),
      })
      .returning({ used: this.schema.usageCounters.executions });
    if (rows[0]) return { allowed: true, used: Number(rows[0].used) };
    return { allowed: false, used: await this.getUsage(projectId, period) };
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

  /** 按资源过滤审计（#46 M3：动态凭证管理台的审计面板）。 */
  async findByResource(projectId: string, resourceType: string, resourceId: string, limit = 50): Promise<AuditLog[]> {
    const rows = await this.db
      .select()
      .from(this.schema.auditLogs)
      .where(
        and(
          eq(this.schema.auditLogs.projectId, projectId),
          eq(this.schema.auditLogs.resourceType, resourceType),
          eq(this.schema.auditLogs.resourceId, resourceId),
        ),
      )
      .orderBy(desc(this.schema.auditLogs.timestamp))
      .limit(Math.min(limit, 200));
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

/** 公共 REST API 令牌仓储。归属为**用户级**（非项目级）。 */
export class ApiKeyRepository extends BaseRepository {
  async create(input: {
    userId: string;
    label: string;
    tokenHash: string;
    prefix: string;
    expiresAt?: Date | null;
    scope?: string;
  }): Promise<ApiKey> {
    const [row] = await this.db.insert(this.schema.apiKeys).values(input).returning();
    return row as ApiKey;
  }

  /** 鉴权热路径：按 token 哈希查（token_hash 唯一 + 索引）。 */
  async findByTokenHash(tokenHash: string): Promise<ApiKey | null> {
    const rows = await this.db
      .select()
      .from(this.schema.apiKeys)
      .where(eq(this.schema.apiKeys.tokenHash, tokenHash))
      .limit(1);
    return (rows[0] as ApiKey | undefined) ?? null;
  }

  async findAllByUser(userId: string): Promise<ApiKey[]> {
    return (await this.db
      .select()
      .from(this.schema.apiKeys)
      .where(eq(this.schema.apiKeys.userId, userId))
      .orderBy(desc(this.schema.apiKeys.createdAt))) as ApiKey[];
  }

  /** 记录最近使用时间（fire-and-forget，鉴权后调）。 */
  async touchLastUsed(id: string): Promise<void> {
    await this.db
      .update(this.schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(this.schema.apiKeys.id, id));
  }

  /** 吊销：带用户归属校验，删到行返回 true。 */
  async deleteOwned(id: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .delete(this.schema.apiKeys)
      .where(and(eq(this.schema.apiKeys.id, id), eq(this.schema.apiKeys.userId, userId)))
      .returning();
    return rows.length > 0;
  }
}

/** 工作流文件夹仓储。项目级归属；支持嵌套（parentFolderId）。 */
export class FolderRepository extends BaseRepository {
  async create(input: { projectId: string; name: string; parentFolderId: string | null }): Promise<Folder> {
    const [row] = await this.db.insert(this.schema.folders).values(input).returning();
    return row as Folder;
  }

  async findById(id: string, projectId: string): Promise<Folder | null> {
    const rows = await this.db
      .select()
      .from(this.schema.folders)
      .where(and(eq(this.schema.folders.id, id), eq(this.schema.folders.projectId, projectId)))
      .limit(1);
    return (rows[0] as Folder | undefined) ?? null;
  }

  /** 某父文件夹下的子文件夹（parentFolderId=null → 项目根）。 */
  async findChildren(projectId: string, parentFolderId: string | null): Promise<Folder[]> {
    const rows = await this.db
      .select()
      .from(this.schema.folders)
      .where(
        and(
          eq(this.schema.folders.projectId, projectId),
          parentFolderId === null
            ? isNull(this.schema.folders.parentFolderId)
            : eq(this.schema.folders.parentFolderId, parentFolderId),
        ),
      );
    return rows as Folder[];
  }

  /** 项目全部文件夹（面包屑/树解析用）。 */
  async findAllByProject(projectId: string): Promise<Folder[]> {
    return (await this.db
      .select()
      .from(this.schema.folders)
      .where(eq(this.schema.folders.projectId, projectId))) as Folder[];
  }

  async update(id: string, patch: { name?: string; parentFolderId?: string | null }): Promise<void> {
    await this.db
      .update(this.schema.folders)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(this.schema.folders.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(this.schema.folders).where(eq(this.schema.folders.id, id));
  }

  /** 是否非空（有子文件夹或工作流）——非空拒删。 */
  async hasContents(id: string): Promise<boolean> {
    const sub = await this.db
      .select({ id: this.schema.folders.id })
      .from(this.schema.folders)
      .where(eq(this.schema.folders.parentFolderId, id))
      .limit(1);
    if (sub.length > 0) return true;
    const wf = await this.db
      .select({ id: this.schema.workflows.id })
      .from(this.schema.workflows)
      .where(eq(this.schema.workflows.folderId, id))
      .limit(1);
    return wf.length > 0;
  }
}

export class TagRepository extends BaseRepository {
  async findAllByProject(projectId: string): Promise<Tag[]> {
    return (await this.db
      .select()
      .from(this.schema.tags)
      .where(eq(this.schema.tags.projectId, projectId))) as Tag[];
  }

  async findById(id: string, projectId: string): Promise<Tag | null> {
    const rows = await this.db
      .select()
      .from(this.schema.tags)
      .where(and(eq(this.schema.tags.id, id), eq(this.schema.tags.projectId, projectId)))
      .limit(1);
    return (rows[0] as Tag | undefined) ?? null;
  }

  async create(projectId: string, name: string): Promise<Tag> {
    const [row] = await this.db.insert(this.schema.tags).values({ projectId, name }).returning();
    return row as Tag;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(this.schema.workflowTagMappings).where(eq(this.schema.workflowTagMappings.tagId, id));
    await this.db.delete(this.schema.tags).where(eq(this.schema.tags.id, id));
  }

  /** 覆盖式设置某工作流的标签集合。 */
  async setWorkflowTags(workflowId: string, tagIds: string[]): Promise<void> {
    await this.db
      .delete(this.schema.workflowTagMappings)
      .where(eq(this.schema.workflowTagMappings.workflowId, workflowId));
    for (const tagId of tagIds) {
      await this.db.insert(this.schema.workflowTagMappings).values({ workflowId, tagId }).onConflictDoNothing();
    }
  }

  /** 一批工作流的标签映射（列表页一次取全）。 */
  async tagsForWorkflows(workflowIds: string[]): Promise<Map<string, Tag[]>> {
    const out = new Map<string, Tag[]>();
    if (workflowIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(this.schema.workflowTagMappings)
      .innerJoin(this.schema.tags, eq(this.schema.tags.id, this.schema.workflowTagMappings.tagId))
      .where(sql`${this.schema.workflowTagMappings.workflowId} IN (${sql.join(workflowIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const r of rows as Array<{ workflow_tag_mappings: { workflowId: string }; tags: Tag }>) {
      const list = out.get(r.workflow_tag_mappings.workflowId) ?? [];
      list.push(r.tags);
      out.set(r.workflow_tag_mappings.workflowId, list);
    }
    return out;
  }

  /** 清掉某工作流的全部标签映射（删工作流时用）。 */
  async clearWorkflow(workflowId: string): Promise<void> {
    await this.db
      .delete(this.schema.workflowTagMappings)
      .where(eq(this.schema.workflowTagMappings.workflowId, workflowId));
  }

  /* ── 工作流运行统计 ── */

  /** 执行收尾累加：production（非 manual）分成功/失败，manual 单独计。 */
  async bumpStatistics(workflowId: string, mode: string, success: boolean): Promise<void> {
    const isManual = mode === 'manual';
    await this.db
      .insert(this.schema.workflowStatistics)
      .values({
        workflowId,
        productionSuccess: !isManual && success ? 1 : 0,
        productionError: !isManual && !success ? 1 : 0,
        manualRuns: isManual ? 1 : 0,
        lastRunAt: new Date(),
      })
      .onConflictDoUpdate({
        target: this.schema.workflowStatistics.workflowId,
        set: {
          productionSuccess: sql`${this.schema.workflowStatistics.productionSuccess} + ${!isManual && success ? 1 : 0}`,
          productionError: sql`${this.schema.workflowStatistics.productionError} + ${!isManual && !success ? 1 : 0}`,
          manualRuns: sql`${this.schema.workflowStatistics.manualRuns} + ${isManual ? 1 : 0}`,
          lastRunAt: new Date(),
        },
      });
  }

  async statisticsFor(workflowIds: string[]): Promise<Map<string, { productionSuccess: number; productionError: number; manualRuns: number; lastRunAt: Date | null }>> {
    const out = new Map();
    if (workflowIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(this.schema.workflowStatistics)
      .where(sql`${this.schema.workflowStatistics.workflowId} IN (${sql.join(workflowIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const r of rows) out.set(r.workflowId, r);
    return out;
  }
}

/** Chat 会话/个人 Agent（backlog #14）：全部按 userId 归属;upsert 收前端生成的 uuid。 */
export class ChatRepository extends BaseRepository {
  async listSessions(userId: string): Promise<ChatSession[]> {
    const rows = await this.db
      .select()
      .from(this.schema.chatSessions)
      .where(eq(this.schema.chatSessions.userId, userId))
      .orderBy(desc(this.schema.chatSessions.createdAt));
    return rows as ChatSession[];
  }

  async upsertSession(
    userId: string,
    input: { id: string; title: string; target: JsonObject | null; wfSessionId: string | null; messages: JsonObject[] },
  ): Promise<ChatSession> {
    const [row] = await this.db
      .insert(this.schema.chatSessions)
      .values({ ...input, userId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: this.schema.chatSessions.id,
        set: {
          title: input.title,
          target: input.target,
          wfSessionId: input.wfSessionId,
          messages: input.messages,
          updatedAt: new Date(),
        },
        // 归属护栏:只有本人的行可被覆盖(别人的 uuid 撞进来时 where 不命中 → 无行返回)
        setWhere: eq(this.schema.chatSessions.userId, userId),
      })
      .returning();
    return row as ChatSession;
  }

  async deleteSession(userId: string, id: string): Promise<void> {
    await this.db
      .delete(this.schema.chatSessions)
      .where(and(eq(this.schema.chatSessions.id, id), eq(this.schema.chatSessions.userId, userId)));
  }

  async listAgents(userId: string): Promise<ChatAgent[]> {
    const rows = await this.db
      .select()
      .from(this.schema.chatAgents)
      .where(eq(this.schema.chatAgents.userId, userId))
      .orderBy(desc(this.schema.chatAgents.createdAt));
    return rows as ChatAgent[];
  }

  async upsertAgent(userId: string, input: { id: string; name: string; system: string }): Promise<ChatAgent> {
    const [row] = await this.db
      .insert(this.schema.chatAgents)
      .values({ ...input, userId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: this.schema.chatAgents.id,
        set: { name: input.name, system: input.system, updatedAt: new Date() },
        setWhere: eq(this.schema.chatAgents.userId, userId),
      })
      .returning();
    return row as ChatAgent;
  }

  async deleteAgent(userId: string, id: string): Promise<void> {
    await this.db
      .delete(this.schema.chatAgents)
      .where(and(eq(this.schema.chatAgents.id, id), eq(this.schema.chatAgents.userId, userId)));
  }
}

/** 自定义角色（backlog #29）：小集合,带进程内缓存供鉴权中间件同步命中。 */
export class CustomRoleRepository extends BaseRepository {
  private cache: CustomRole[] | null = null;

  private invalidate(): void {
    this.cache = null;
  }

  async list(): Promise<CustomRole[]> {
    if (this.cache) return this.cache;
    this.cache = (await this.db.select().from(this.schema.customRoles)) as CustomRole[];
    return this.cache;
  }

  /** 按 name 命中缓存的 scopes（鉴权中间件用；未知名字 → null）。 */
  async scopesForName(name: string): Promise<string[] | null> {
    const found = (await this.list()).find((r) => r.name === name);
    return found ? found.scopes : null;
  }

  async create(input: { name: string; description?: string; scopes: string[] }): Promise<CustomRole> {
    const [row] = await this.db
      .insert(this.schema.customRoles)
      .values({ name: input.name, description: input.description ?? '', scopes: input.scopes })
      .returning();
    this.invalidate();
    return row as CustomRole;
  }

  async update(id: string, patch: { description?: string; scopes?: string[] }): Promise<CustomRole | null> {
    const [row] = await this.db
      .update(this.schema.customRoles)
      .set({ ...(patch.description !== undefined ? { description: patch.description } : {}), ...(patch.scopes ? { scopes: patch.scopes } : {}) })
      .where(eq(this.schema.customRoles.id, id))
      .returning();
    this.invalidate();
    return (row as CustomRole | undefined) ?? null;
  }

  async findById(id: string): Promise<CustomRole | null> {
    const rows = await this.db.select().from(this.schema.customRoles).where(eq(this.schema.customRoles.id, id)).limit(1);
    return (rows[0] as CustomRole | undefined) ?? null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(this.schema.customRoles).where(eq(this.schema.customRoles.id, id));
    this.invalidate();
  }
}

/**
 * 评测测试运行（backlog #31）。归属沿用 workflow：读操作 join shared_workflows
 * 按 projectId 过滤（与 ExecutionRepository 同惯例）。
 */
export class TestRunRepository extends BaseRepository {
  async createRun(input: {
    workflowId: string;
    dataTableId: string | null;
    triggerNode: string;
    totalCases: number;
  }): Promise<TestRun> {
    const [row] = await this.db
      .insert(this.schema.testRuns)
      .values({
        workflowId: input.workflowId,
        dataTableId: input.dataTableId,
        triggerNode: input.triggerNode,
        totalCases: input.totalCases,
        status: 'running',
      })
      .returning();
    return row as TestRun;
  }

  async updateRun(
    id: string,
    patch: Partial<{
      status: string;
      ranCases: number;
      passedCases: number | null;
      metrics: Record<string, number>;
      error: string | null;
      completedAt: Date | null;
    }>,
  ): Promise<void> {
    await this.db.update(this.schema.testRuns).set(patch).where(eq(this.schema.testRuns.id, id));
  }

  async findRunById(id: string, projectId: string): Promise<TestRun | null> {
    const rows = await this.db
      .select()
      .from(this.schema.testRuns)
      .innerJoin(
        this.schema.sharedWorkflows,
        eq(this.schema.sharedWorkflows.workflowId, this.schema.testRuns.workflowId),
      )
      .where(and(eq(this.schema.testRuns.id, id), eq(this.schema.sharedWorkflows.projectId, projectId)))
      .limit(1);
    return rows[0] ? (rows[0].test_runs as TestRun) : null;
  }

  /** 某工作流的测试运行历史（最新在前）。 */
  async findRunsByWorkflow(workflowId: string, projectId: string): Promise<TestRun[]> {
    const rows = await this.db
      .select()
      .from(this.schema.testRuns)
      .innerJoin(
        this.schema.sharedWorkflows,
        eq(this.schema.sharedWorkflows.workflowId, this.schema.testRuns.workflowId),
      )
      .where(
        and(
          eq(this.schema.testRuns.workflowId, workflowId),
          eq(this.schema.sharedWorkflows.projectId, projectId),
        ),
      )
      .orderBy(desc(this.schema.testRuns.createdAt));
    return rows.map((r: { test_runs: TestRun }) => r.test_runs);
  }

  async deleteRun(id: string): Promise<void> {
    await this.db.delete(this.schema.testCaseRuns).where(eq(this.schema.testCaseRuns.testRunId, id));
    await this.db.delete(this.schema.testRuns).where(eq(this.schema.testRuns.id, id));
  }

  async addCaseRun(input: {
    testRunId: string;
    executionId: string | null;
    rowIndex: number;
    input: JsonObject;
    metrics: Record<string, number>;
    status: string;
    error?: string | null;
  }): Promise<TestCaseRun> {
    const [row] = await this.db
      .insert(this.schema.testCaseRuns)
      .values({
        testRunId: input.testRunId,
        executionId: input.executionId,
        rowIndex: input.rowIndex,
        input: input.input,
        metrics: input.metrics,
        status: input.status,
        error: input.error ?? null,
      })
      .returning();
    return row as TestCaseRun;
  }

  async findCaseRuns(testRunId: string): Promise<TestCaseRun[]> {
    const rows = await this.db
      .select()
      .from(this.schema.testCaseRuns)
      .where(eq(this.schema.testCaseRuns.testRunId, testRunId))
      .orderBy(this.schema.testCaseRuns.rowIndex);
    return rows as TestCaseRun[];
  }
}

/**
 * 每用户收藏（backlog #34）。归属天然按 userId 隔离——收藏是私人视图，
 * 不经项目边界（双用户各自星标互不可见）。
 */
export class FavoriteRepository extends BaseRepository {
  async add(userId: string, resourceType: string, resourceId: string): Promise<void> {
    await this.db
      .insert(this.schema.userFavorites)
      .values({ userId, resourceType, resourceId })
      .onConflictDoNothing();
  }

  async remove(userId: string, resourceType: string, resourceId: string): Promise<void> {
    await this.db
      .delete(this.schema.userFavorites)
      .where(
        and(
          eq(this.schema.userFavorites.userId, userId),
          eq(this.schema.userFavorites.resourceType, resourceType),
          eq(this.schema.userFavorites.resourceId, resourceId),
        ),
      );
  }

  /** 某用户某类资源的收藏 id 集合（列表标星/过滤用）。 */
  async listResourceIds(userId: string, resourceType: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ resourceId: this.schema.userFavorites.resourceId })
      .from(this.schema.userFavorites)
      .where(
        and(
          eq(this.schema.userFavorites.userId, userId),
          eq(this.schema.userFavorites.resourceType, resourceType),
        ),
      );
    return new Set(rows.map((r: { resourceId: string }) => r.resourceId));
  }

  async isFavorite(userId: string, resourceType: string, resourceId: string): Promise<boolean> {
    const rows = await this.db
      .select({ resourceId: this.schema.userFavorites.resourceId })
      .from(this.schema.userFavorites)
      .where(
        and(
          eq(this.schema.userFavorites.userId, userId),
          eq(this.schema.userFavorites.resourceType, resourceType),
          eq(this.schema.userFavorites.resourceId, resourceId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * 一次性回填：把 workflows.favorite=true 的全局星标搬给各自项目 owner。
   * 幂等（onConflictDoNothing）；bootstrap 用 settings 标志位保证只跑一次。
   * 返回搬运的行数。
   */
  async backfillFromWorkflowFlag(): Promise<number> {
    const rows = (await this.db
      .select({
        workflowId: this.schema.workflows.id,
        userId: this.schema.projectRelations.userId,
      })
      .from(this.schema.workflows)
      .innerJoin(
        this.schema.sharedWorkflows,
        eq(this.schema.sharedWorkflows.workflowId, this.schema.workflows.id),
      )
      .innerJoin(
        this.schema.projectRelations,
        eq(this.schema.projectRelations.projectId, this.schema.sharedWorkflows.projectId),
      )
      .where(
        and(
          eq(this.schema.workflows.favorite, true),
          eq(this.schema.projectRelations.role, 'project:owner'),
        ),
      )) as Array<{ workflowId: string; userId: string }>;
    for (const r of rows) await this.add(r.userId, 'workflow', r.workflowId);
    return rows.length;
  }
}

/** 执行标注 shape：vote/note + 标签。 */
export interface ExecutionAnnotationView {
  vote: 'up' | 'down' | null;
  note: string;
  tags: AnnotationTag[];
}

/**
 * 执行标注 + 标签（backlog #35）。归属经 execution → workflow 派生，
 * 调用方须先用 ExecutionRepository.findById(id, projectId) 校验归属再调这里。
 */
export class ExecutionAnnotationRepository extends BaseRepository {
  async get(executionId: string): Promise<ExecutionAnnotationView> {
    const rows = await this.db
      .select()
      .from(this.schema.executionAnnotations)
      .where(eq(this.schema.executionAnnotations.executionId, executionId))
      .limit(1);
    const ann = rows[0] as { vote: string | null; note: string } | undefined;
    const tags = await this.tagsFor(executionId);
    return {
      vote: (ann?.vote as 'up' | 'down' | null) ?? null,
      note: ann?.note ?? '',
      tags,
    };
  }

  /** upsert vote/note（executionId 为主键）。 */
  async setAnnotation(executionId: string, patch: { vote?: 'up' | 'down' | null; note?: string }): Promise<void> {
    await this.db
      .insert(this.schema.executionAnnotations)
      .values({
        executionId,
        vote: patch.vote ?? null,
        note: patch.note ?? '',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: this.schema.executionAnnotations.executionId,
        set: {
          ...(patch.vote !== undefined ? { vote: patch.vote } : {}),
          ...(patch.note !== undefined ? { note: patch.note } : {}),
          updatedAt: new Date(),
        },
      });
  }

  async tagsFor(executionId: string): Promise<AnnotationTag[]> {
    const rows = await this.db
      .select({
        id: this.schema.annotationTags.id,
        name: this.schema.annotationTags.name,
        createdAt: this.schema.annotationTags.createdAt,
      })
      .from(this.schema.executionAnnotationTags)
      .innerJoin(
        this.schema.annotationTags,
        eq(this.schema.annotationTags.id, this.schema.executionAnnotationTags.tagId),
      )
      .where(eq(this.schema.executionAnnotationTags.executionId, executionId));
    return rows as AnnotationTag[];
  }

  /** 全量替换某执行的标签映射（传入 tagId 列表）。 */
  async setTags(executionId: string, tagIds: string[]): Promise<void> {
    await this.db
      .delete(this.schema.executionAnnotationTags)
      .where(eq(this.schema.executionAnnotationTags.executionId, executionId));
    if (tagIds.length > 0) {
      await this.db
        .insert(this.schema.executionAnnotationTags)
        .values(tagIds.map((tagId) => ({ executionId, tagId })));
    }
  }

  async listTags(): Promise<AnnotationTag[]> {
    return (await this.db.select().from(this.schema.annotationTags)) as AnnotationTag[];
  }

  /** 按名取标签,不存在则建（标注时输入新标签名即创建）。 */
  async findOrCreateTag(name: string): Promise<AnnotationTag> {
    const existing = await this.db
      .select()
      .from(this.schema.annotationTags)
      .where(eq(this.schema.annotationTags.name, name))
      .limit(1);
    if (existing[0]) return existing[0] as AnnotationTag;
    const [row] = await this.db.insert(this.schema.annotationTags).values({ name }).returning();
    return row as AnnotationTag;
  }
}

/**
 * 执行自定义元数据（backlog #35）：运行收尾从 runData 提取 KV 落库,执行列表按键值检索。
 * 归属经 execution → workflow 派生（查询走 ExecutionRepository 的 join，见其 findAllByProject）。
 */
export class ExecutionMetadataRepository extends BaseRepository {
  /** 全量替换某执行的元数据（每次运行覆写）。 */
  async replaceAll(executionId: string, entries: Array<{ key: string; value: string }>): Promise<void> {
    await this.db
      .delete(this.schema.executionMetadata)
      .where(eq(this.schema.executionMetadata.executionId, executionId));
    if (entries.length > 0) {
      await this.db
        .insert(this.schema.executionMetadata)
        .values(entries.map((e) => ({ executionId, key: e.key, value: e.value })));
    }
  }

  async findByExecution(executionId: string): Promise<Array<{ key: string; value: string }>> {
    const rows = await this.db
      .select({ key: this.schema.executionMetadata.key, value: this.schema.executionMetadata.value })
      .from(this.schema.executionMetadata)
      .where(eq(this.schema.executionMetadata.executionId, executionId));
    return rows as Array<{ key: string; value: string }>;
  }
}

/**
 * 登出令牌黑名单（backlog #37）。鉴权热路径每请求都查——内存缓存全部未过期哈希,
 * add 时增量更新,避免每请求打库。过期哈希留在缓存无害（对应 JWT 本就已过期,verify 先拒）。
 */
export class AuthTokenBlacklistRepository extends BaseRepository {
  private cache: Set<string> | null = null;

  private async load(): Promise<Set<string>> {
    if (this.cache) return this.cache;
    const rows = await this.db
      .select({ tokenHash: this.schema.invalidAuthTokens.tokenHash })
      .from(this.schema.invalidAuthTokens);
    this.cache = new Set(rows.map((r: { tokenHash: string }) => r.tokenHash));
    return this.cache;
  }

  async isBlacklisted(tokenHash: string): Promise<boolean> {
    return (await this.load()).has(tokenHash);
  }

  /** 拉黑一个 token 哈希；顺手清理已过期行（免单独调度器）。 */
  async add(tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db
      .insert(this.schema.invalidAuthTokens)
      .values({ tokenHash, expiresAt })
      .onConflictDoNothing();
    (await this.load()).add(tokenHash);
    await this.pruneExpired(new Date());
  }

  /** 删除已过期(exp < now)的黑名单行；同步剔出缓存（此时对应 JWT 也已失效）。 */
  async pruneExpired(now: Date): Promise<void> {
    await this.db.delete(this.schema.invalidAuthTokens).where(lt(this.schema.invalidAuthTokens.expiresAt, now));
    this.cache = null; // 下次 load 重建（简单可靠,黑名单量小）
  }
}

/**
 * 外部身份绑定 + 同步历史（backlog #36）。登录时优先按 (providerType, providerId)
 * 认归属——email 变更或多 provider 并存不再错认。
 */
export class AuthIdentityRepository extends BaseRepository {
  /** 按 provider 绑定找 userId（命中即认此 user,忽略 email 变更）。 */
  async findUserId(providerType: string, providerId: string): Promise<string | null> {
    const rows = await this.db
      .select({ userId: this.schema.authIdentities.userId })
      .from(this.schema.authIdentities)
      .where(
        and(
          eq(this.schema.authIdentities.providerType, providerType),
          eq(this.schema.authIdentities.providerId, providerId),
        ),
      )
      .limit(1);
    return (rows[0]?.userId as string | undefined) ?? null;
  }

  /** 建绑定（幂等：同 provider+providerId 已存在则不动）。 */
  async bind(userId: string, providerType: string, providerId: string): Promise<void> {
    await this.db
      .insert(this.schema.authIdentities)
      .values({ userId, providerType, providerId })
      .onConflictDoNothing();
  }

  async recordSync(entry: {
    providerType: string;
    status: string;
    scanned: number;
    created: number;
    updated: number;
    disabled: number;
    error?: string | null;
  }): Promise<void> {
    await this.db.insert(this.schema.authProviderSyncHistory).values({ ...entry, error: entry.error ?? null });
  }

  /** 同步历史（最新在前）。 */
  async listSyncHistory(providerType?: string, limit = 50): Promise<AuthProviderSyncRecord[]> {
    const base = this.db.select().from(this.schema.authProviderSyncHistory);
    const filtered = providerType
      ? base.where(eq(this.schema.authProviderSyncHistory.providerType, providerType))
      : base;
    const rows = await filtered.orderBy(desc(this.schema.authProviderSyncHistory.runAt)).limit(limit);
    return rows as AuthProviderSyncRecord[];
  }
}

/** 调度作业创建/更新入参。 */
export interface ScheduledJobInput {
  kind: string;
  workflowId?: string | null;
  nodeName?: string | null;
  config: JsonObject;
  timezone?: string;
  nextRunAt: Date | null;
  maxAttempts?: number;
}

/**
 * DB 调度器仓储（backlog #38 地基项）。租约抢占用乐观锁（leaseEpoch）实现原子 claim——
 * 多实例并发查到同一到期 task,只有一个 UPDATE 命中(epoch 匹配),保证只触发一次。
 */
export class SchedulerRepository extends BaseRepository {
  /* ── 作业（recurrence 定义） ── */

  async createJob(input: ScheduledJobInput): Promise<ScheduledJob> {
    const [row] = await this.db
      .insert(this.schema.scheduledJobs)
      .values({
        kind: input.kind,
        workflowId: input.workflowId ?? null,
        nodeName: input.nodeName ?? null,
        config: input.config,
        timezone: input.timezone ?? 'UTC',
        nextRunAt: input.nextRunAt,
        maxAttempts: input.maxAttempts ?? 1,
        active: true,
      })
      .returning();
    return row as ScheduledJob;
  }

  /** 某工作流某节点的全部规则作业（一个 Schedule 节点可有多条 Trigger Rule）。 */
  async findJobsByNode(workflowId: string, nodeName: string): Promise<ScheduledJob[]> {
    const rows = await this.db
      .select()
      .from(this.schema.scheduledJobs)
      .where(
        and(
          eq(this.schema.scheduledJobs.workflowId, workflowId),
          eq(this.schema.scheduledJobs.nodeName, nodeName),
        ),
      )
      .orderBy(asc(this.schema.scheduledJobs.createdAt), asc(this.schema.scheduledJobs.id));
    return rows as ScheduledJob[];
  }

  /** 兼容旧调用：返回该节点第一条规则作业。 */
  async findJobByNode(workflowId: string, nodeName: string): Promise<ScheduledJob | null> {
    return (await this.findJobsByNode(workflowId, nodeName))[0] ?? null;
  }

  async updateJob(
    id: string,
    patch: Partial<{
      config: JsonObject;
      timezone: string;
      active: boolean;
      nextRunAt: Date | null;
      lastRunAt: Date | null;
      maxAttempts: number;
    }>,
  ): Promise<void> {
    await this.db
      .update(this.schema.scheduledJobs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(this.schema.scheduledJobs.id, id));
  }

  /** 停用某工作流的全部调度作业（工作流下线时）。 */
  async deactivateJobsForWorkflow(workflowId: string): Promise<void> {
    await this.db
      .update(this.schema.scheduledJobs)
      .set({ active: false, nextRunAt: null, updatedAt: new Date() })
      .where(eq(this.schema.scheduledJobs.workflowId, workflowId));
  }

  async findJobById(id: string): Promise<ScheduledJob | null> {
    const rows = await this.db
      .select()
      .from(this.schema.scheduledJobs)
      .where(eq(this.schema.scheduledJobs.id, id))
      .limit(1);
    return (rows[0] as ScheduledJob | undefined) ?? null;
  }

  /** 系统级作业按 kind 查（无 workflowId 的全局作业,如 insights-rollup）。 */
  async findJobByKind(kind: string): Promise<ScheduledJob | null> {
    const rows = await this.db
      .select()
      .from(this.schema.scheduledJobs)
      .where(eq(this.schema.scheduledJobs.kind, kind))
      .limit(1);
    return (rows[0] as ScheduledJob | undefined) ?? null;
  }

  /** 到期的活跃作业（nextRunAt <= now）。调度循环据此物化 task。 */
  async findDueJobs(now: Date): Promise<ScheduledJob[]> {
    const rows = await this.db
      .select()
      .from(this.schema.scheduledJobs)
      .where(
        and(
          eq(this.schema.scheduledJobs.active, true),
          lte(this.schema.scheduledJobs.nextRunAt, now),
        ),
      );
    return rows as ScheduledJob[];
  }

  /* ── 到期触发实例（lease） ── */

  /**
   * 物化一条到期 task（unique(jobId, scheduledFor) 去重）。
   * 返回 true = 本次新建（由本实例负责随后推进 nextRunAt）；false = 已存在（别的实例先建了）。
   */
  async materializeTask(jobId: string, scheduledFor: Date): Promise<boolean> {
    const rows = await this.db
      .insert(this.schema.scheduledTasks)
      .values({ jobId, scheduledFor, status: 'pending' })
      .onConflictDoNothing()
      .returning({ id: this.schema.scheduledTasks.id });
    return rows.length > 0;
  }

  /** 可认领的 task：pending,或 running 但租约已过期（持有者疑似崩溃）。 */
  async findClaimableTasks(now: Date, limit = 50): Promise<ScheduledTask[]> {
    const rows = await this.db
      .select()
      .from(this.schema.scheduledTasks)
      .where(
        or(
          eq(this.schema.scheduledTasks.status, 'pending'),
          and(
            eq(this.schema.scheduledTasks.status, 'running'),
            lt(this.schema.scheduledTasks.leaseExpiresAt, now),
          ),
        ),
      )
      .limit(limit);
    return rows as ScheduledTask[];
  }

  /**
   * 原子认领（乐观锁）：仅当 leaseEpoch 仍等于观察值时命中——并发下只一个实例成功。
   * 返回认领到的 task（含新 epoch）或 null（被别人抢先）。
   */
  async claimTask(
    id: string,
    expectedEpoch: number,
    instanceId: string,
    leaseExpiresAt: Date,
  ): Promise<ScheduledTask | null> {
    const rows = await this.db
      .update(this.schema.scheduledTasks)
      .set({
        status: 'running',
        claimedBy: instanceId,
        leaseExpiresAt,
        leaseEpoch: expectedEpoch + 1,
        attempts: sql`${this.schema.scheduledTasks.attempts} + 1`,
      })
      .where(
        and(
          eq(this.schema.scheduledTasks.id, id),
          eq(this.schema.scheduledTasks.leaseEpoch, expectedEpoch),
        ),
      )
      .returning();
    return (rows[0] as ScheduledTask | undefined) ?? null;
  }

  async completeTask(id: string, executionId: string | null): Promise<void> {
    await this.db
      .update(this.schema.scheduledTasks)
      .set({ status: 'done', executionId, leaseExpiresAt: null, claimedBy: null })
      .where(eq(this.schema.scheduledTasks.id, id));
  }

  /** 失败：retry=true → 回 pending 等下轮重试；否则 error 终态。 */
  async failTask(id: string, error: string, retry: boolean): Promise<void> {
    await this.db
      .update(this.schema.scheduledTasks)
      .set({
        status: retry ? 'pending' : 'error',
        error,
        leaseExpiresAt: null,
        claimedBy: null,
      })
      .where(eq(this.schema.scheduledTasks.id, id));
  }

  async listTasksForJob(jobId: string, limit = 50): Promise<ScheduledTask[]> {
    const rows = await this.db
      .select()
      .from(this.schema.scheduledTasks)
      .where(eq(this.schema.scheduledTasks.jobId, jobId))
      .orderBy(desc(this.schema.scheduledTasks.scheduledFor))
      .limit(limit);
    return rows as ScheduledTask[];
  }
}

/**
 * Insights 预聚合管线（backlog #39）：执行收尾写 insights_raw（与 executions 保留期解耦）;
 * 卷积任务把旧 raw 折进 insights_by_period 并剪旧行;读取合并 by_period(旧) + 未卷积 raw(近期)。
 */
export class InsightsRepository extends BaseRepository {
  /** 执行收尾写事件 + 快照工作流/项目名。 */
  async recordEvent(input: {
    executionId: string;
    workflowId: string;
    projectId: string;
    status: string;
    runtimeMs: number | null;
    at: Date;
    workflowName: string;
    projectName: string;
  }): Promise<void> {
    await this.db.insert(this.schema.insightsRaw).values({
      executionId: input.executionId,
      workflowId: input.workflowId,
      projectId: input.projectId,
      status: input.status,
      runtimeMs: input.runtimeMs,
      at: input.at,
    });
    await this.db
      .insert(this.schema.insightsMetadata)
      .values({
        workflowId: input.workflowId,
        workflowName: input.workflowName,
        projectId: input.projectId,
        projectName: input.projectName,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: this.schema.insightsMetadata.workflowId,
        set: { workflowName: input.workflowName, projectName: input.projectName, updatedAt: new Date() },
      });
  }

  /** 范围内未卷积的 raw 事件（projectId 省略 = 跨项目）。已卷积的在 by_period,不重复计。 */
  async findRawInRange(from: Date, to: Date, projectId?: string): Promise<InsightsRawEvent[]> {
    const conds = [
      eq(this.schema.insightsRaw.rolledUp, false),
      gte(this.schema.insightsRaw.at, from),
      lte(this.schema.insightsRaw.at, to),
    ];
    if (projectId) conds.push(eq(this.schema.insightsRaw.projectId, projectId));
    const rows = await this.db
      .select()
      .from(this.schema.insightsRaw)
      .where(and(...conds));
    return rows as InsightsRawEvent[];
  }

  /* ── 卷积（#39b） ── */

  /** 未卷积且早于 before 的 raw 事件（按项目×日折叠用）。 */
  async findUnrolledBefore(before: Date, limit = 5000): Promise<InsightsRawEvent[]> {
    const rows = await this.db
      .select()
      .from(this.schema.insightsRaw)
      .where(and(eq(this.schema.insightsRaw.rolledUp, false), lt(this.schema.insightsRaw.at, before)))
      .limit(limit);
    return rows as InsightsRawEvent[];
  }

  /** 累加一个项目×日桶（卷积写入）。 */
  async addToPeriod(
    projectId: string,
    period: string,
    delta: { total: number; success: number; error: number; runtimeSum: number; runtimeCount: number },
  ): Promise<void> {
    await this.db
      .insert(this.schema.insightsByPeriod)
      .values({ projectId, period, ...delta })
      .onConflictDoUpdate({
        target: [this.schema.insightsByPeriod.projectId, this.schema.insightsByPeriod.period],
        set: {
          total: sql`${this.schema.insightsByPeriod.total} + ${delta.total}`,
          success: sql`${this.schema.insightsByPeriod.success} + ${delta.success}`,
          error: sql`${this.schema.insightsByPeriod.error} + ${delta.error}`,
          runtimeSum: sql`${this.schema.insightsByPeriod.runtimeSum} + ${delta.runtimeSum}`,
          runtimeCount: sql`${this.schema.insightsByPeriod.runtimeCount} + ${delta.runtimeCount}`,
        },
      });
  }

  async markRolledUp(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.db
      .update(this.schema.insightsRaw)
      .set({ rolledUp: true })
      .where(inArray(this.schema.insightsRaw.id, ids));
  }

  /** 剪掉已卷积的旧 raw（by_period 已留存,可删）。 */
  async pruneRolledBefore(before: Date): Promise<number> {
    const rows = await this.db
      .delete(this.schema.insightsRaw)
      .where(and(eq(this.schema.insightsRaw.rolledUp, true), lt(this.schema.insightsRaw.at, before)))
      .returning({ id: this.schema.insightsRaw.id });
    return rows.length;
  }

  /** 范围内的日桶（period 在 [fromDay, toDay]，projectId 省略 = 跨项目）。 */
  async findPeriodsInRange(fromDay: string, toDay: string, projectId?: string): Promise<InsightsPeriodRow[]> {
    const conds = [
      gte(this.schema.insightsByPeriod.period, fromDay),
      lte(this.schema.insightsByPeriod.period, toDay),
    ];
    if (projectId) conds.push(eq(this.schema.insightsByPeriod.projectId, projectId));
    const rows = await this.db
      .select()
      .from(this.schema.insightsByPeriod)
      .where(and(...conds));
    return rows as InsightsPeriodRow[];
  }
}

/**
 * 发布管线深化（backlog #40）：发布/回滚事件史、逐触发器激活状态、凭证引用索引。
 */
export class OAuthRuntimeRepository extends BaseRepository {
  async createPendingState(stateHash: string, credentialId: string, projectId: string, expiresAt: Date): Promise<void> {
    await this.db.delete(this.schema.oauthPendingStates).where(lte(this.schema.oauthPendingStates.expiresAt, new Date()));
    await this.db.insert(this.schema.oauthPendingStates).values({ stateHash, credentialId, projectId, expiresAt });
  }

  /** DELETE ... RETURNING 使 state 在所有实例间只能成功消费一次。 */
  async consumePendingState(stateHash: string, now = new Date()): Promise<{ credentialId: string; projectId: string } | null> {
    const rows = await this.db.delete(this.schema.oauthPendingStates)
      .where(and(eq(this.schema.oauthPendingStates.stateHash, stateHash), gt(this.schema.oauthPendingStates.expiresAt, now)))
      .returning({ credentialId: this.schema.oauthPendingStates.credentialId, projectId: this.schema.oauthPendingStates.projectId });
    return rows[0] ?? null;
  }

  async tryAcquireRefreshLock(credentialId: string, owner: string, expiresAt: Date, now = new Date()): Promise<boolean> {
    const rows = await this.db.insert(this.schema.oauthRefreshLocks)
      .values({ credentialId, owner, expiresAt })
      .onConflictDoUpdate({
        target: this.schema.oauthRefreshLocks.credentialId,
        set: { owner, expiresAt },
        setWhere: lte(this.schema.oauthRefreshLocks.expiresAt, now),
      })
      .returning({ owner: this.schema.oauthRefreshLocks.owner });
    return rows[0]?.owner === owner;
  }

  async releaseRefreshLock(credentialId: string, owner: string): Promise<void> {
    await this.db.delete(this.schema.oauthRefreshLocks)
      .where(and(eq(this.schema.oauthRefreshLocks.credentialId, credentialId), eq(this.schema.oauthRefreshLocks.owner, owner)));
  }
}

export class PublishPipelineRepository extends BaseRepository {
  /* ── 发布史 ── */
  async recordPublish(workflowId: string, versionId: string, action: string, userId: string | null): Promise<void> {
    await this.db
      .insert(this.schema.workflowPublishHistory)
      .values({ workflowId, versionId, action, userId });
  }

  async listPublishHistory(workflowId: string, limit = 50): Promise<PublishHistoryRow[]> {
    const rows = await this.db
      .select()
      .from(this.schema.workflowPublishHistory)
      .where(eq(this.schema.workflowPublishHistory.workflowId, workflowId))
      .orderBy(desc(this.schema.workflowPublishHistory.createdAt))
      .limit(limit);
    return rows as PublishHistoryRow[];
  }

  async enqueuePublication(workflowId: string, versionId: string): Promise<string> {
    const [row] = await this.db.insert(this.schema.publicationOutbox)
      .values({ workflowId, versionId })
      .returning({ id: this.schema.publicationOutbox.id });
    return row.id as string;
  }

  async claimPublications(owner: string, now = new Date(), leaseMs = 30_000, limit = 50): Promise<Array<{ id: string; workflowId: string; versionId: string; attempts: number }>> {
    const candidates = await this.db.select({ id: this.schema.publicationOutbox.id })
      .from(this.schema.publicationOutbox)
      .where(and(
        isNull(this.schema.publicationOutbox.deliveredAt),
        lte(this.schema.publicationOutbox.nextAttemptAt, now),
        or(isNull(this.schema.publicationOutbox.claimExpiresAt), lte(this.schema.publicationOutbox.claimExpiresAt, now)),
      ))
      .limit(limit);
    const claimed: Array<{ id: string; workflowId: string; versionId: string; attempts: number }> = [];
    for (const candidate of candidates as Array<{ id: string }>) {
      const rows = await this.db.update(this.schema.publicationOutbox)
        .set({ claimedBy: owner, claimExpiresAt: new Date(now.getTime() + leaseMs) })
        .where(and(
          eq(this.schema.publicationOutbox.id, candidate.id),
          isNull(this.schema.publicationOutbox.deliveredAt),
          or(isNull(this.schema.publicationOutbox.claimExpiresAt), lte(this.schema.publicationOutbox.claimExpiresAt, now)),
        ))
        .returning();
      if (rows[0]) claimed.push(rows[0] as typeof claimed[number]);
    }
    return claimed;
  }

  async completePublication(id: string, owner: string): Promise<void> {
    await this.db.update(this.schema.publicationOutbox)
      .set({ deliveredAt: new Date(), claimedBy: null, claimExpiresAt: null })
      .where(and(eq(this.schema.publicationOutbox.id, id), eq(this.schema.publicationOutbox.claimedBy, owner)));
  }

  async retryPublication(id: string, owner: string, attempts: number): Promise<void> {
    const delay = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
    await this.db.update(this.schema.publicationOutbox)
      .set({ attempts: attempts + 1, nextAttemptAt: new Date(Date.now() + delay), claimedBy: null, claimExpiresAt: null })
      .where(and(eq(this.schema.publicationOutbox.id, id), eq(this.schema.publicationOutbox.claimedBy, owner)));
  }

  /* ── 逐触发器激活状态 ── */
  async setTriggerStatus(
    workflowId: string,
    nodeName: string,
    triggerType: string,
    status: string,
    error: string | null,
  ): Promise<void> {
    await this.db
      .insert(this.schema.publicationTriggerStatus)
      .values({ workflowId, nodeName, triggerType, status, error, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [this.schema.publicationTriggerStatus.workflowId, this.schema.publicationTriggerStatus.nodeName],
        set: { triggerType, status, error, updatedAt: new Date() },
      });
  }

  async clearTriggerStatus(workflowId: string): Promise<void> {
    await this.db
      .delete(this.schema.publicationTriggerStatus)
      .where(eq(this.schema.publicationTriggerStatus.workflowId, workflowId));
  }

  async listTriggerStatus(workflowId: string): Promise<TriggerStatusRow[]> {
    const rows = await this.db
      .select()
      .from(this.schema.publicationTriggerStatus)
      .where(eq(this.schema.publicationTriggerStatus.workflowId, workflowId));
    return rows as TriggerStatusRow[];
  }

  /* ── 凭证引用索引（#40b） ── */
  /** 全量替换某工作流的凭证依赖（保存时重建）。 */
  async setCredentialDeps(workflowId: string, credentialIds: string[]): Promise<void> {
    await this.db
      .delete(this.schema.credentialDependency)
      .where(eq(this.schema.credentialDependency.workflowId, workflowId));
    const uniq = [...new Set(credentialIds)];
    if (uniq.length > 0) {
      await this.db
        .insert(this.schema.credentialDependency)
        .values(uniq.map((credentialId) => ({ workflowId, credentialId })));
    }
  }

  /** 引用某凭证的工作流 id 集合（删凭证前查引用方）。 */
  async workflowsUsingCredential(credentialId: string): Promise<string[]> {
    const rows = await this.db
      .select({ workflowId: this.schema.credentialDependency.workflowId })
      .from(this.schema.credentialDependency)
      .where(eq(this.schema.credentialDependency.credentialId, credentialId));
    return rows.map((r: { workflowId: string }) => r.workflowId);
  }

  async clearWorkflow(workflowId: string): Promise<void> {
    await this.db.delete(this.schema.publicationOutbox).where(eq(this.schema.publicationOutbox.workflowId, workflowId));
    await this.db.delete(this.schema.credentialDependency).where(eq(this.schema.credentialDependency.workflowId, workflowId));
    await this.db.delete(this.schema.publicationTriggerStatus).where(eq(this.schema.publicationTriggerStatus.workflowId, workflowId));
  }
}

export interface RoleMappingRuleView extends RoleMappingRule {
  projectIds: string[];
}

/**
 * SSO 角色映射规则（backlog #42）：把 SSO 声明/LDAP group 映射到项目角色。
 * 登录热路径读全部规则——内存缓存,写时失效。
 */
export class RoleMappingRepository extends BaseRepository {
  private cache: RoleMappingRuleView[] | null = null;
  private invalidate(): void {
    this.cache = null;
  }

  async list(): Promise<RoleMappingRuleView[]> {
    if (this.cache) return this.cache;
    const rules = (await this.db
      .select()
      .from(this.schema.roleMappingRule)
      .orderBy(desc(this.schema.roleMappingRule.ordering))) as RoleMappingRule[];
    const maps = (await this.db.select().from(this.schema.roleMappingRuleProject)) as Array<{ ruleId: string; projectId: string }>;
    const byRule = new Map<string, string[]>();
    for (const m of maps) {
      const arr = byRule.get(m.ruleId) ?? [];
      arr.push(m.projectId);
      byRule.set(m.ruleId, arr);
    }
    this.cache = rules.map((r) => ({ ...r, projectIds: byRule.get(r.id) ?? [] }));
    return this.cache;
  }

  async create(
    input: { sourceType: string; matchKey?: string; matchValue: string; projectRole: string; ordering?: number },
    projectIds: string[],
  ): Promise<RoleMappingRuleView> {
    const [rule] = await this.db
      .insert(this.schema.roleMappingRule)
      .values({
        sourceType: input.sourceType,
        matchKey: input.matchKey ?? '',
        matchValue: input.matchValue,
        projectRole: input.projectRole,
        ordering: input.ordering ?? 0,
      })
      .returning();
    const r = rule as RoleMappingRule;
    if (projectIds.length > 0) {
      await this.db
        .insert(this.schema.roleMappingRuleProject)
        .values([...new Set(projectIds)].map((projectId) => ({ ruleId: r.id, projectId })));
    }
    this.invalidate();
    return { ...r, projectIds: [...new Set(projectIds)] };
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(this.schema.roleMappingRuleProject).where(eq(this.schema.roleMappingRuleProject.ruleId, id));
    await this.db.delete(this.schema.roleMappingRule).where(eq(this.schema.roleMappingRule.id, id));
    this.invalidate();
  }
}

/** 平台零散补差（backlog #43）：实例升级史、MCP registry 缓存、文件夹打标。 */
export class PlatformRepository extends BaseRepository {
  /* ── 实例升级史 ── */
  async latestVersion(): Promise<InstanceVersionRow | null> {
    const rows = await this.db
      .select()
      .from(this.schema.instanceVersionHistory)
      .orderBy(desc(this.schema.instanceVersionHistory.recordedAt))
      .limit(1);
    return (rows[0] as InstanceVersionRow | undefined) ?? null;
  }
  async recordVersion(version: string): Promise<void> {
    await this.db.insert(this.schema.instanceVersionHistory).values({ version });
  }
  async listVersionHistory(limit = 50): Promise<InstanceVersionRow[]> {
    return (await this.db
      .select()
      .from(this.schema.instanceVersionHistory)
      .orderBy(desc(this.schema.instanceVersionHistory.recordedAt))
      .limit(limit)) as InstanceVersionRow[];
  }

  /* ── MCP registry 缓存 ── */
  async listRegistryServers(): Promise<McpRegistryServerRow[]> {
    return (await this.db.select().from(this.schema.mcpRegistryServer)) as McpRegistryServerRow[];
  }
  /** 全量刷新缓存（清空后写入）。 */
  async replaceRegistryServers(
    servers: Array<{ name: string; url: string; description?: string; category?: string }>,
  ): Promise<void> {
    await this.db.delete(this.schema.mcpRegistryServer);
    if (servers.length > 0) {
      await this.db.insert(this.schema.mcpRegistryServer).values(
        servers.map((s) => ({ name: s.name, url: s.url, description: s.description ?? '', category: s.category ?? '' })),
      );
    }
  }

  /* ── 文件夹打标 ── */
  async setFolderTags(folderId: string, tagIds: string[]): Promise<void> {
    await this.db.delete(this.schema.folderTagMapping).where(eq(this.schema.folderTagMapping.folderId, folderId));
    const uniq = [...new Set(tagIds)];
    if (uniq.length > 0) {
      await this.db.insert(this.schema.folderTagMapping).values(uniq.map((tagId) => ({ folderId, tagId })));
    }
  }
  async folderTags(folderId: string): Promise<Tag[]> {
    const rows = await this.db
      .select({ id: this.schema.tags.id, name: this.schema.tags.name, projectId: this.schema.tags.projectId, createdAt: this.schema.tags.createdAt })
      .from(this.schema.folderTagMapping)
      .innerJoin(this.schema.tags, eq(this.schema.tags.id, this.schema.folderTagMapping.tagId))
      .where(eq(this.schema.folderTagMapping.folderId, folderId));
    return rows as Tag[];
  }
}

/**
 * 实例信任密钥链仓储（backlog #47）：部署密钥 + 信任密钥 + JWKS 源 + 换令牌防重放 jti。
 * 全实例级（无 projectId）——这是实例身份/联邦,不是项目资源。
 */
export class InstanceTrustRepository extends BaseRepository {
  /* ── 部署密钥（本实例签名） ── */
  async activeDeploymentKey(): Promise<DeploymentKey | null> {
    const rows = await this.db
      .select()
      .from(this.schema.deploymentKeys)
      .where(eq(this.schema.deploymentKeys.active, true))
      .limit(1);
    return (rows[0] as DeploymentKey | undefined) ?? null;
  }

  async findDeploymentKeyByKid(kid: string): Promise<DeploymentKey | null> {
    const rows = await this.db
      .select()
      .from(this.schema.deploymentKeys)
      .where(eq(this.schema.deploymentKeys.kid, kid))
      .limit(1);
    return (rows[0] as DeploymentKey | undefined) ?? null;
  }

  async listDeploymentKeys(): Promise<DeploymentKey[]> {
    return (await this.db
      .select()
      .from(this.schema.deploymentKeys)
      .orderBy(desc(this.schema.deploymentKeys.createdAt))) as DeploymentKey[];
  }

  async addDeploymentKey(input: { kid: string; publicKey: string; privateKey: string }): Promise<DeploymentKey> {
    const [row] = await this.db
      .insert(this.schema.deploymentKeys)
      .values({ kid: input.kid, publicKey: input.publicKey, privateKey: input.privateKey, active: true })
      .returning();
    return row as DeploymentKey;
  }

  /** 轮换：旧钥全部标非活跃（留验证窗口,不删）。 */
  async deactivateAllDeploymentKeys(): Promise<void> {
    await this.db.update(this.schema.deploymentKeys).set({ active: false, rotatedAt: new Date() }).where(eq(this.schema.deploymentKeys.active, true));
  }

  /* ── 信任密钥（对端公钥） ── */
  async upsertTrustedKey(input: { kid: string; issuer: string; publicKey: string; sourceId: string | null }): Promise<void> {
    await this.db
      .insert(this.schema.trustedKeys)
      .values({ kid: input.kid, issuer: input.issuer, publicKey: input.publicKey, sourceId: input.sourceId, active: true })
      .onConflictDoUpdate({
        target: this.schema.trustedKeys.kid,
        set: { issuer: input.issuer, publicKey: input.publicKey, sourceId: input.sourceId, active: true },
      });
  }

  async findTrustedKey(kid: string): Promise<TrustedKey | null> {
    const rows = await this.db
      .select()
      .from(this.schema.trustedKeys)
      .where(and(eq(this.schema.trustedKeys.kid, kid), eq(this.schema.trustedKeys.active, true)))
      .limit(1);
    return (rows[0] as TrustedKey | undefined) ?? null;
  }

  async listTrustedKeys(): Promise<TrustedKey[]> {
    return (await this.db
      .select()
      .from(this.schema.trustedKeys)
      .orderBy(desc(this.schema.trustedKeys.createdAt))) as TrustedKey[];
  }

  async deleteTrustedKey(kid: string): Promise<void> {
    await this.db.delete(this.schema.trustedKeys).where(eq(this.schema.trustedKeys.kid, kid));
  }

  /* ── JWKS 源 ── */
  async addSource(input: { name: string; type: string; jwksUrl: string; config: JsonObject }): Promise<TrustedKeySource> {
    const [row] = await this.db
      .insert(this.schema.trustedKeySources)
      .values({ name: input.name, type: input.type, jwksUrl: input.jwksUrl, config: input.config, status: 'pending', active: true })
      .returning();
    return row as TrustedKeySource;
  }

  /** 更新源健康态（#47 M2）：refresh 成功 healthy / 失败 error+lastError。 */
  async setSourceStatus(id: string, status: string, lastError: string | null): Promise<void> {
    await this.db.update(this.schema.trustedKeySources).set({ status, lastError }).where(eq(this.schema.trustedKeySources.id, id));
  }

  async listSources(): Promise<TrustedKeySource[]> {
    return (await this.db
      .select()
      .from(this.schema.trustedKeySources)
      .orderBy(desc(this.schema.trustedKeySources.createdAt))) as TrustedKeySource[];
  }

  async findSource(id: string): Promise<TrustedKeySource | null> {
    const rows = await this.db.select().from(this.schema.trustedKeySources).where(eq(this.schema.trustedKeySources.id, id)).limit(1);
    return (rows[0] as TrustedKeySource | undefined) ?? null;
  }

  async markSourceFetched(id: string): Promise<void> {
    await this.db.update(this.schema.trustedKeySources).set({ lastFetchedAt: new Date() }).where(eq(this.schema.trustedKeySources.id, id));
  }

  async deleteSource(id: string): Promise<void> {
    await this.db.delete(this.schema.trustedKeys).where(eq(this.schema.trustedKeys.sourceId, id));
    await this.db.delete(this.schema.trustedKeySources).where(eq(this.schema.trustedKeySources.id, id));
  }

  /* ── 换令牌防重放（jti 记一次即拒复用,过期可清） ── */
  /** 返回 true = 首次见（已记录）；false = 已见过（重放）。 */
  async recordJtiIfNew(jti: string, expiresAt: Date): Promise<boolean> {
    const rows = await this.db
      .insert(this.schema.tokenExchangeJti)
      .values({ jti, expiresAt })
      .onConflictDoNothing()
      .returning({ jti: this.schema.tokenExchangeJti.jti });
    return rows.length > 0;
  }

  async pruneExpiredJti(now: Date): Promise<void> {
    await this.db.delete(this.schema.tokenExchangeJti).where(lt(this.schema.tokenExchangeJti.expiresAt, now));
  }
}

/**
 * Agents 平台仓储（backlog #44 M1）：项目级 agent 定义 + 版本史（发布/回滚）。
 * 归属直过滤 projectId（同 DataTableRepository）；版本模式仿 workflow_versions。
 */
export class AgentRepository extends BaseRepository {
  async findAllByProject(projectId: string): Promise<Agent[]> {
    return (await this.db
      .select()
      .from(this.schema.agents)
      .where(eq(this.schema.agents.projectId, projectId))
      .orderBy(desc(this.schema.agents.createdAt))) as Agent[];
  }

  async findById(id: string, projectId: string): Promise<Agent | null> {
    const rows = await this.db
      .select()
      .from(this.schema.agents)
      .where(and(eq(this.schema.agents.id, id), eq(this.schema.agents.projectId, projectId)))
      .limit(1);
    return (rows[0] as Agent | undefined) ?? null;
  }

  async create(input: { projectId: string; name: string; description?: string; config: JsonObject }): Promise<Agent> {
    const [row] = await this.db
      .insert(this.schema.agents)
      .values({
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? '',
        config: input.config,
      })
      .returning();
    return row as Agent;
  }

  async update(id: string, patch: Partial<{ name: string; description: string; config: JsonObject }>): Promise<Agent> {
    const [row] = await this.db
      .update(this.schema.agents)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(this.schema.agents.id, id))
      .returning();
    return row as Agent;
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await this.db.update(this.schema.agents).set({ active, updatedAt: new Date() }).where(eq(this.schema.agents.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(this.schema.agentHistory).where(eq(this.schema.agentHistory.agentId, id));
    await this.db.delete(this.schema.agents).where(eq(this.schema.agents.id, id));
  }

  /* ── 版本史 ── */
  private async nextVersionNumber(agentId: string): Promise<number> {
    const rows = await this.db
      .select({ versionNumber: this.schema.agentHistory.versionNumber })
      .from(this.schema.agentHistory)
      .where(eq(this.schema.agentHistory.agentId, agentId))
      .orderBy(desc(this.schema.agentHistory.versionNumber))
      .limit(1);
    return (rows[0]?.versionNumber ?? 0) + 1;
  }

  /** 快照当前定义为一个版本,并把它标为已发布。返回版本行。 */
  async publish(agent: Agent, createdBy: string | null): Promise<AgentVersion> {
    const versionNumber = await this.nextVersionNumber(agent.id);
    const [version] = await this.db
      .insert(this.schema.agentHistory)
      .values({ agentId: agent.id, versionNumber, name: agent.name, config: agent.config, createdBy })
      .returning();
    const v = version as AgentVersion;
    await this.db
      .update(this.schema.agents)
      .set({ publishedVersionId: v.id, updatedAt: new Date() })
      .where(eq(this.schema.agents.id, agent.id));
    return v;
  }

  async listVersions(agentId: string): Promise<AgentVersion[]> {
    return (await this.db
      .select()
      .from(this.schema.agentHistory)
      .where(eq(this.schema.agentHistory.agentId, agentId))
      .orderBy(desc(this.schema.agentHistory.versionNumber))) as AgentVersion[];
  }

  async findVersion(agentId: string, versionId: string): Promise<AgentVersion | null> {
    const rows = await this.db
      .select()
      .from(this.schema.agentHistory)
      .where(and(eq(this.schema.agentHistory.id, versionId), eq(this.schema.agentHistory.agentId, agentId)))
      .limit(1);
    return (rows[0] as AgentVersion | undefined) ?? null;
  }

  /* ── 后备工作流 + 线程/运行/消息（#44 M2） ── */
  async setBackingWorkflow(agentId: string, workflowId: string): Promise<void> {
    await this.db.update(this.schema.agents).set({ backingWorkflowId: workflowId }).where(eq(this.schema.agents.id, agentId));
  }

  async createThread(input: { agentId: string; projectId: string; channel?: string; title?: string; externalRef?: string }): Promise<AgentThread> {
    const [row] = await this.db
      .insert(this.schema.agentThreads)
      .values({
        agentId: input.agentId,
        projectId: input.projectId,
        channel: input.channel ?? 'canvas',
        title: input.title ?? 'New thread',
        externalRef: input.externalRef ?? null,
      })
      .returning();
    return row as AgentThread;
  }

  /** 渠道会话映射（#44 M5）：同一外部会话（如 Telegram chat_id）复用同一线程。 */
  async findThreadByExternalRef(agentId: string, channel: string, externalRef: string): Promise<AgentThread | null> {
    const rows = await this.db
      .select()
      .from(this.schema.agentThreads)
      .where(
        and(
          eq(this.schema.agentThreads.agentId, agentId),
          eq(this.schema.agentThreads.channel, channel),
          eq(this.schema.agentThreads.externalRef, externalRef),
        ),
      )
      .limit(1);
    return (rows[0] as AgentThread | undefined) ?? null;
  }

  async findThread(id: string, agentId: string): Promise<AgentThread | null> {
    const rows = await this.db
      .select()
      .from(this.schema.agentThreads)
      .where(and(eq(this.schema.agentThreads.id, id), eq(this.schema.agentThreads.agentId, agentId)))
      .limit(1);
    return (rows[0] as AgentThread | undefined) ?? null;
  }

  async listThreads(agentId: string): Promise<AgentThread[]> {
    return (await this.db
      .select()
      .from(this.schema.agentThreads)
      .where(eq(this.schema.agentThreads.agentId, agentId))
      .orderBy(desc(this.schema.agentThreads.createdAt))) as AgentThread[];
  }

  async createRun(input: {
    threadId: string;
    agentId: string;
    executionId: string | null;
    status: string;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    model: string;
    error?: string | null;
  }): Promise<AgentRun> {
    const [row] = await this.db
      .insert(this.schema.agentRuns)
      .values({ ...input, error: input.error ?? null })
      .returning();
    return row as AgentRun;
  }

  async listRuns(threadId: string): Promise<AgentRun[]> {
    return (await this.db
      .select()
      .from(this.schema.agentRuns)
      .where(eq(this.schema.agentRuns.threadId, threadId))
      .orderBy(desc(this.schema.agentRuns.createdAt))) as AgentRun[];
  }

  async addMessage(input: { threadId: string; runId?: string | null; role: string; content: JsonObject }): Promise<void> {
    await this.db
      .insert(this.schema.agentMessages)
      .values({ threadId: input.threadId, runId: input.runId ?? null, role: input.role, content: input.content });
  }

  async listMessages(threadId: string): Promise<AgentMessage[]> {
    return (await this.db
      .select()
      .from(this.schema.agentMessages)
      .where(eq(this.schema.agentMessages.threadId, threadId))
      .orderBy(this.schema.agentMessages.createdAt)) as AgentMessage[];
  }

  /* ── 分层记忆 + 证据链（#44 M3） ── */
  async addMemory(input: {
    agentId: string;
    threadId?: string | null;
    scope?: string;
    kind?: string;
    content: string;
    embedding: number[];
  }): Promise<MemoryEntry> {
    const [row] = await this.db
      .insert(this.schema.memoryEntries)
      .values({
        agentId: input.agentId,
        threadId: input.threadId ?? null,
        scope: input.scope ?? 'agent',
        kind: input.kind ?? 'fact',
        content: input.content,
        embedding: input.embedding,
      })
      .returning();
    return row as MemoryEntry;
  }

  /** agent 可见的记忆（agent/global scope + 本线程的 thread scope）。检索用。 */
  async memoriesForAgent(agentId: string): Promise<MemoryEntry[]> {
    return (await this.db
      .select()
      .from(this.schema.memoryEntries)
      .where(eq(this.schema.memoryEntries.agentId, agentId))) as MemoryEntry[];
  }

  async touchMemory(id: string): Promise<void> {
    await this.db.update(this.schema.memoryEntries).set({ lastUsedAt: new Date() }).where(eq(this.schema.memoryEntries.id, id));
  }

  async addObservation(entryId: string, runId: string, evidence: JsonObject): Promise<void> {
    await this.db.insert(this.schema.memoryObservations).values({ entryId, runId, evidence });
  }

  /** 记忆 + 其证据链（记忆视图 / "查到来源运行"）。 */
  async listMemoriesWithObservations(agentId: string): Promise<Array<MemoryEntry & { observations: MemoryObservation[] }>> {
    const entries = (await this.db
      .select()
      .from(this.schema.memoryEntries)
      .where(eq(this.schema.memoryEntries.agentId, agentId))
      .orderBy(desc(this.schema.memoryEntries.createdAt))) as MemoryEntry[];
    const out: Array<MemoryEntry & { observations: MemoryObservation[] }> = [];
    for (const e of entries) {
      const obs = (await this.db
        .select()
        .from(this.schema.memoryObservations)
        .where(eq(this.schema.memoryObservations.entryId, e.id))) as MemoryObservation[];
      out.push({ ...e, observations: obs });
    }
    return out;
  }

  /* ── 定时任务定义（#44 M4） ── */
  async createTask(input: {
    agentId: string;
    projectId: string;
    name: string;
    message: string;
    schedule: JsonObject;
    timezone?: string;
  }): Promise<AgentTaskDefinition> {
    const [row] = await this.db
      .insert(this.schema.agentTaskDefinitions)
      .values({
        agentId: input.agentId,
        projectId: input.projectId,
        name: input.name,
        message: input.message,
        schedule: input.schedule,
        timezone: input.timezone ?? 'UTC',
      })
      .returning();
    return row as AgentTaskDefinition;
  }

  async listTasks(agentId: string): Promise<AgentTaskDefinition[]> {
    return (await this.db
      .select()
      .from(this.schema.agentTaskDefinitions)
      .where(eq(this.schema.agentTaskDefinitions.agentId, agentId))
      .orderBy(desc(this.schema.agentTaskDefinitions.createdAt))) as AgentTaskDefinition[];
  }

  /** 归属校验版（API 侧：任务必须属于该 agent）。 */
  async findTask(id: string, agentId: string): Promise<AgentTaskDefinition | null> {
    const rows = await this.db
      .select()
      .from(this.schema.agentTaskDefinitions)
      .where(and(eq(this.schema.agentTaskDefinitions.id, id), eq(this.schema.agentTaskDefinitions.agentId, agentId)))
      .limit(1);
    return (rows[0] as AgentTaskDefinition | undefined) ?? null;
  }

  /** 无归属版（调度 fire 侧：系统上下文按 id 取,projectId 已冗余在行内）。 */
  async findTaskById(id: string): Promise<AgentTaskDefinition | null> {
    const rows = await this.db
      .select()
      .from(this.schema.agentTaskDefinitions)
      .where(eq(this.schema.agentTaskDefinitions.id, id))
      .limit(1);
    return (rows[0] as AgentTaskDefinition | undefined) ?? null;
  }

  async updateTask(
    id: string,
    patch: Partial<{
      name: string;
      message: string;
      schedule: JsonObject;
      timezone: string;
      active: boolean;
      jobId: string | null;
      threadId: string | null;
      lastRunAt: Date;
    }>,
  ): Promise<void> {
    await this.db
      .update(this.schema.agentTaskDefinitions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(this.schema.agentTaskDefinitions.id, id));
  }

  async deleteTask(id: string): Promise<void> {
    await this.db.delete(this.schema.agentTaskDefinitions).where(eq(this.schema.agentTaskDefinitions.id, id));
  }

  /* ── 文件（#44 M5）：binaryId 复用 #32 binaryStore ── */
  async addFile(input: {
    agentId: string;
    threadId?: string | null;
    binaryId: string;
    fileName: string;
    mimeType: string;
    size: number;
  }): Promise<AgentFile> {
    const [row] = await this.db
      .insert(this.schema.agentFiles)
      .values({
        agentId: input.agentId,
        threadId: input.threadId ?? null,
        binaryId: input.binaryId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.size,
      })
      .returning();
    return row as AgentFile;
  }

  async listFiles(agentId: string): Promise<AgentFile[]> {
    return (await this.db
      .select()
      .from(this.schema.agentFiles)
      .where(eq(this.schema.agentFiles.agentId, agentId))
      .orderBy(desc(this.schema.agentFiles.createdAt))) as AgentFile[];
  }

  async findFile(id: string, agentId: string): Promise<AgentFile | null> {
    const rows = await this.db
      .select()
      .from(this.schema.agentFiles)
      .where(and(eq(this.schema.agentFiles.id, id), eq(this.schema.agentFiles.agentId, agentId)))
      .limit(1);
    return (rows[0] as AgentFile | undefined) ?? null;
  }

  async deleteFile(id: string): Promise<void> {
    await this.db.delete(this.schema.agentFiles).where(eq(this.schema.agentFiles.id, id));
  }

  /* ── 外部渠道（#44 M5） ── */
  async createChannel(input: {
    agentId: string;
    projectId: string;
    type: string;
    credentialId: string;
    config: JsonObject;
  }): Promise<AgentChannel> {
    const [row] = await this.db
      .insert(this.schema.agentChannels)
      .values({
        agentId: input.agentId,
        projectId: input.projectId,
        type: input.type,
        credentialId: input.credentialId,
        config: input.config,
      })
      .returning();
    return row as AgentChannel;
  }

  async listChannels(agentId: string): Promise<AgentChannel[]> {
    return (await this.db
      .select()
      .from(this.schema.agentChannels)
      .where(eq(this.schema.agentChannels.agentId, agentId))
      .orderBy(desc(this.schema.agentChannels.createdAt))) as AgentChannel[];
  }

  /** 归属校验版（API 侧）。 */
  async findChannel(id: string, agentId: string): Promise<AgentChannel | null> {
    const rows = await this.db
      .select()
      .from(this.schema.agentChannels)
      .where(and(eq(this.schema.agentChannels.id, id), eq(this.schema.agentChannels.agentId, agentId)))
      .limit(1);
    return (rows[0] as AgentChannel | undefined) ?? null;
  }

  /** 无归属版（公开 webhook 侧按 id 取,secret 校验在服务层）。 */
  async findChannelById(id: string): Promise<AgentChannel | null> {
    const rows = await this.db
      .select()
      .from(this.schema.agentChannels)
      .where(eq(this.schema.agentChannels.id, id))
      .limit(1);
    return (rows[0] as AgentChannel | undefined) ?? null;
  }

  async updateChannel(id: string, patch: Partial<{ active: boolean; config: JsonObject }>): Promise<void> {
    await this.db.update(this.schema.agentChannels).set(patch).where(eq(this.schema.agentChannels.id, id));
  }

  async deleteChannel(id: string): Promise<void> {
    await this.db.delete(this.schema.agentChannels).where(eq(this.schema.agentChannels.id, id));
  }
}

/**
 * AI 建流会话仓储（backlog #45 M1）：会话 + 临时草稿 revision 链。归属按 projectId（铁律 2）。
 * 临时流不进 workflows 表——Apply 时业务层调 WorkflowService.create 物化。
 */
export class WorkflowBuilderRepository extends BaseRepository {
  async createSession(input: { userId: string; projectId: string; title: string; goal: string }): Promise<WorkflowBuilderSession> {
    const [row] = await this.db
      .insert(this.schema.workflowBuilderSessions)
      .values({ userId: input.userId, projectId: input.projectId, title: input.title, goal: input.goal, messages: [] })
      .returning();
    return row as WorkflowBuilderSession;
  }

  async listSessions(projectId: string): Promise<WorkflowBuilderSession[]> {
    return (await this.db
      .select()
      .from(this.schema.workflowBuilderSessions)
      .where(eq(this.schema.workflowBuilderSessions.projectId, projectId))
      .orderBy(desc(this.schema.workflowBuilderSessions.updatedAt))) as WorkflowBuilderSession[];
  }

  /** 归属校验版（铁律 2）：会话必须属于该 project。 */
  async findSession(id: string, projectId: string): Promise<WorkflowBuilderSession | null> {
    const rows = await this.db
      .select()
      .from(this.schema.workflowBuilderSessions)
      .where(and(eq(this.schema.workflowBuilderSessions.id, id), eq(this.schema.workflowBuilderSessions.projectId, projectId)))
      .limit(1);
    return (rows[0] as WorkflowBuilderSession | undefined) ?? null;
  }

  async updateSession(
    id: string,
    patch: Partial<{
      title: string;
      status: string;
      messages: JsonObject[];
      currentRevisionId: string | null;
      appliedWorkflowId: string | null;
    }>,
  ): Promise<void> {
    await this.db
      .update(this.schema.workflowBuilderSessions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(this.schema.workflowBuilderSessions.id, id));
  }

  async addRevision(input: {
    sessionId: string;
    revision: number;
    name: string;
    nodes: INode[];
    connections: IConnections;
    summary: string;
  }): Promise<AiBuilderTemporaryWorkflow> {
    const [row] = await this.db
      .insert(this.schema.aiBuilderTemporaryWorkflows)
      .values({
        sessionId: input.sessionId,
        revision: input.revision,
        name: input.name,
        nodes: input.nodes,
        connections: input.connections,
        summary: input.summary,
      })
      .returning();
    return row as AiBuilderTemporaryWorkflow;
  }

  async listRevisions(sessionId: string): Promise<AiBuilderTemporaryWorkflow[]> {
    return (await this.db
      .select()
      .from(this.schema.aiBuilderTemporaryWorkflows)
      .where(eq(this.schema.aiBuilderTemporaryWorkflows.sessionId, sessionId))
      .orderBy(this.schema.aiBuilderTemporaryWorkflows.revision)) as AiBuilderTemporaryWorkflow[];
  }

  async findRevision(id: string, sessionId: string): Promise<AiBuilderTemporaryWorkflow | null> {
    const rows = await this.db
      .select()
      .from(this.schema.aiBuilderTemporaryWorkflows)
      .where(and(eq(this.schema.aiBuilderTemporaryWorkflows.id, id), eq(this.schema.aiBuilderTemporaryWorkflows.sessionId, sessionId)))
      .limit(1);
    return (rows[0] as AiBuilderTemporaryWorkflow | undefined) ?? null;
  }
}

/**
 * 有检查点的 AI 线程仓储（backlog #45 M2）：线程 + 追加消息日志 + 可序列化状态检查点。
 * 归属按 userId（实例助手多为实例/用户级）。回滚 = 还原 state + 截断检查点之后的消息。
 */
export class InstanceAiRepository extends BaseRepository {
  /* ── 线程 ── */
  async createThread(input: { userId: string; kind: string; title: string }): Promise<InstanceAiThread> {
    const [row] = await this.db
      .insert(this.schema.instanceAiThreads)
      .values({ userId: input.userId, kind: input.kind, title: input.title, state: {} })
      .returning();
    return row as InstanceAiThread;
  }

  async listThreads(userId: string): Promise<InstanceAiThread[]> {
    return (await this.db
      .select()
      .from(this.schema.instanceAiThreads)
      .where(eq(this.schema.instanceAiThreads.userId, userId))
      .orderBy(desc(this.schema.instanceAiThreads.updatedAt))) as InstanceAiThread[];
  }

  /** 归属校验版（userId 隔离）。 */
  async findThread(id: string, userId: string): Promise<InstanceAiThread | null> {
    const rows = await this.db
      .select()
      .from(this.schema.instanceAiThreads)
      .where(and(eq(this.schema.instanceAiThreads.id, id), eq(this.schema.instanceAiThreads.userId, userId)))
      .limit(1);
    return (rows[0] as InstanceAiThread | undefined) ?? null;
  }

  async setThreadState(id: string, state: JsonObject): Promise<void> {
    await this.db.update(this.schema.instanceAiThreads).set({ state, updatedAt: new Date() }).where(eq(this.schema.instanceAiThreads.id, id));
  }

  async renameThread(id: string, title: string): Promise<void> {
    await this.db.update(this.schema.instanceAiThreads).set({ title, updatedAt: new Date() }).where(eq(this.schema.instanceAiThreads.id, id));
  }

  async deleteThread(id: string): Promise<void> {
    // 子记录先清（无级联 FK）
    await this.db.delete(this.schema.instanceAiCheckpoints).where(eq(this.schema.instanceAiCheckpoints.threadId, id));
    await this.db.delete(this.schema.instanceAiMessages).where(eq(this.schema.instanceAiMessages.threadId, id));
    await this.db.delete(this.schema.instanceAiThreads).where(eq(this.schema.instanceAiThreads.id, id));
  }

  /* ── 消息（追加日志） ── */
  async countMessages(threadId: string): Promise<number> {
    const rows = (await this.db
      .select({ seq: this.schema.instanceAiMessages.seq })
      .from(this.schema.instanceAiMessages)
      .where(eq(this.schema.instanceAiMessages.threadId, threadId))) as Array<{ seq: number }>;
    return rows.length;
  }

  async appendMessage(threadId: string, seq: number, role: string, content: JsonObject): Promise<InstanceAiMessage> {
    const [row] = await this.db
      .insert(this.schema.instanceAiMessages)
      .values({ threadId, seq, role, content })
      .returning();
    await this.db.update(this.schema.instanceAiThreads).set({ updatedAt: new Date() }).where(eq(this.schema.instanceAiThreads.id, threadId));
    return row as InstanceAiMessage;
  }

  async listMessages(threadId: string): Promise<InstanceAiMessage[]> {
    return (await this.db
      .select()
      .from(this.schema.instanceAiMessages)
      .where(eq(this.schema.instanceAiMessages.threadId, threadId))
      .orderBy(this.schema.instanceAiMessages.seq)) as InstanceAiMessage[];
  }

  /** 截断 seq > cutoff 的消息（回滚时用）。返回删除条数。 */
  async truncateMessagesAfter(threadId: string, cutoff: number): Promise<void> {
    await this.db
      .delete(this.schema.instanceAiMessages)
      .where(and(eq(this.schema.instanceAiMessages.threadId, threadId), gt(this.schema.instanceAiMessages.seq, cutoff)));
  }

  /* ── 检查点 ── */
  async countCheckpoints(threadId: string): Promise<number> {
    const rows = (await this.db
      .select({ seq: this.schema.instanceAiCheckpoints.seq })
      .from(this.schema.instanceAiCheckpoints)
      .where(eq(this.schema.instanceAiCheckpoints.threadId, threadId))) as Array<{ seq: number }>;
    return rows.length;
  }

  async addCheckpoint(input: { threadId: string; seq: number; label: string; state: JsonObject; messageCount: number }): Promise<InstanceAiCheckpoint> {
    const [row] = await this.db
      .insert(this.schema.instanceAiCheckpoints)
      .values(input)
      .returning();
    return row as InstanceAiCheckpoint;
  }

  async listCheckpoints(threadId: string): Promise<InstanceAiCheckpoint[]> {
    return (await this.db
      .select()
      .from(this.schema.instanceAiCheckpoints)
      .where(eq(this.schema.instanceAiCheckpoints.threadId, threadId))
      .orderBy(this.schema.instanceAiCheckpoints.seq)) as InstanceAiCheckpoint[];
  }

  async findCheckpoint(id: string, threadId: string): Promise<InstanceAiCheckpoint | null> {
    const rows = await this.db
      .select()
      .from(this.schema.instanceAiCheckpoints)
      .where(and(eq(this.schema.instanceAiCheckpoints.id, id), eq(this.schema.instanceAiCheckpoints.threadId, threadId)))
      .limit(1);
    return (rows[0] as InstanceAiCheckpoint | undefined) ?? null;
  }

  /** 回滚后于该检查点之后建的检查点也作废（截断 seq > 检查点 seq）。 */
  async truncateCheckpointsAfter(threadId: string, cutoffSeq: number): Promise<void> {
    await this.db
      .delete(this.schema.instanceAiCheckpoints)
      .where(and(eq(this.schema.instanceAiCheckpoints.threadId, threadId), gt(this.schema.instanceAiCheckpoints.seq, cutoffSeq)));
  }

  /* ── HITL 待确认动作（#45 M3） ── */
  async addPendingAction(input: { threadId: string; tool: string; args: JsonObject; reason: string }): Promise<InstanceAiPendingAction> {
    const [row] = await this.db
      .insert(this.schema.instanceAiPendingActions)
      .values({ threadId: input.threadId, tool: input.tool, args: input.args, reason: input.reason, risk: 'dangerous', status: 'pending' })
      .returning();
    return row as InstanceAiPendingAction;
  }

  async listPendingActions(threadId: string): Promise<InstanceAiPendingAction[]> {
    return (await this.db
      .select()
      .from(this.schema.instanceAiPendingActions)
      .where(eq(this.schema.instanceAiPendingActions.threadId, threadId))
      .orderBy(desc(this.schema.instanceAiPendingActions.createdAt))) as InstanceAiPendingAction[];
  }

  async findPendingAction(id: string): Promise<InstanceAiPendingAction | null> {
    const rows = await this.db
      .select()
      .from(this.schema.instanceAiPendingActions)
      .where(eq(this.schema.instanceAiPendingActions.id, id))
      .limit(1);
    return (rows[0] as InstanceAiPendingAction | undefined) ?? null;
  }

  async decidePendingAction(id: string, patch: { status: string; result?: JsonObject | null; decidedBy: string }): Promise<void> {
    await this.db
      .update(this.schema.instanceAiPendingActions)
      .set({ status: patch.status, result: patch.result ?? null, decidedBy: patch.decidedBy, decidedAt: new Date() })
      .where(eq(this.schema.instanceAiPendingActions.id, id));
  }

  /* ── 运行树（#45 M4） ── */
  async addRunNode(input: { threadId: string; parentId: string | null; label: string; nodeInput: JsonObject }): Promise<InstanceAiRunNode> {
    const [row] = await this.db
      .insert(this.schema.instanceAiRunTree)
      .values({ threadId: input.threadId, parentId: input.parentId, label: input.label, input: input.nodeInput, status: 'running' })
      .returning();
    return row as InstanceAiRunNode;
  }

  async finishRunNode(id: string, status: string, output: JsonObject): Promise<void> {
    await this.db
      .update(this.schema.instanceAiRunTree)
      .set({ status, output, endedAt: new Date() })
      .where(eq(this.schema.instanceAiRunTree.id, id));
  }

  async listRunNodes(threadId: string): Promise<InstanceAiRunNode[]> {
    return (await this.db
      .select()
      .from(this.schema.instanceAiRunTree)
      .where(eq(this.schema.instanceAiRunTree.threadId, threadId))
      .orderBy(this.schema.instanceAiRunTree.createdAt)) as InstanceAiRunNode[];
  }

  /* ── 观察-反思记忆（#45 M4）：embedding 检索,scope=instance 跨线程 ── */
  async addMemory(input: { userId: string; threadId: string | null; scope: string; kind: string; content: string; embedding: number[] }): Promise<InstanceAiMemory> {
    const [row] = await this.db
      .insert(this.schema.instanceAiMemory)
      .values(input)
      .returning();
    return row as InstanceAiMemory;
  }

  /** 召回候选：本用户的 instance 记忆(跨线程) + 当前线程的 thread 记忆。相似度排序在服务层。 */
  async memoriesForRecall(userId: string, threadId: string | null): Promise<InstanceAiMemory[]> {
    const rows = (await this.db
      .select()
      .from(this.schema.instanceAiMemory)
      .where(eq(this.schema.instanceAiMemory.userId, userId))) as InstanceAiMemory[];
    return rows.filter((m) => m.scope === 'instance' || (m.scope === 'thread' && m.threadId === threadId));
  }

  async listMemories(userId: string): Promise<InstanceAiMemory[]> {
    return (await this.db
      .select()
      .from(this.schema.instanceAiMemory)
      .where(eq(this.schema.instanceAiMemory.userId, userId))
      .orderBy(desc(this.schema.instanceAiMemory.createdAt))) as InstanceAiMemory[];
  }

  /* ── MCP 连接（#45 M5） ── */
  async addMcpConnection(input: {
    userId: string;
    threadId: string | null;
    serverName: string;
    url: string;
    config: JsonObject;
    tools: Array<{ name: string; description: string }>;
  }): Promise<InstanceAiMcpConnection> {
    const [row] = await this.db
      .insert(this.schema.instanceAiMcpConnections)
      .values({ ...input, status: 'connected' })
      .returning();
    return row as InstanceAiMcpConnection;
  }

  async listMcpConnections(userId: string): Promise<InstanceAiMcpConnection[]> {
    return (await this.db
      .select()
      .from(this.schema.instanceAiMcpConnections)
      .where(eq(this.schema.instanceAiMcpConnections.userId, userId))
      .orderBy(desc(this.schema.instanceAiMcpConnections.createdAt))) as InstanceAiMcpConnection[];
  }

  async findMcpConnection(id: string): Promise<InstanceAiMcpConnection | null> {
    const rows = await this.db
      .select()
      .from(this.schema.instanceAiMcpConnections)
      .where(eq(this.schema.instanceAiMcpConnections.id, id))
      .limit(1);
    return (rows[0] as InstanceAiMcpConnection | undefined) ?? null;
  }

  async deleteMcpConnection(id: string): Promise<void> {
    await this.db.delete(this.schema.instanceAiMcpConnections).where(eq(this.schema.instanceAiMcpConnections.id, id));
  }
}

export interface Repositories {
  users: UserRepository;
  authRateLimits: AuthRateLimitRepository;
  apiKeys: ApiKeyRepository;
  passwordResets: PasswordResetRepository;
  invitations: InvitationRepository;
  folders: FolderRepository;
  projects: ProjectRepository;
  workflows: WorkflowRepository;
  workflowVersions: WorkflowVersionRepository;
  installedNodes: InstalledNodeRepository;
  credentials: CredentialRepository;
  dynamicCredentials: DynamicCredentialRepository;
  variables: VariableRepository;
  dataTables: DataTableRepository;
  tags: TagRepository;
  executions: ExecutionRepository;
  settings: SettingsRepository;
  webhooks: WebhookRepository;
  auditLogs: AuditLogRepository;
  quotas: QuotaRepository;
  customRoles: CustomRoleRepository;
  chat: ChatRepository;
  testRuns: TestRunRepository;
  favorites: FavoriteRepository;
  annotations: ExecutionAnnotationRepository;
  executionMetadata: ExecutionMetadataRepository;
  authTokenBlacklist: AuthTokenBlacklistRepository;
  authIdentities: AuthIdentityRepository;
  scheduler: SchedulerRepository;
  insights: InsightsRepository;
  oauthRuntime: OAuthRuntimeRepository;
  publishPipeline: PublishPipelineRepository;
  roleMappings: RoleMappingRepository;
  platform: PlatformRepository;
  instanceTrust: InstanceTrustRepository;
  agents: AgentRepository;
  workflowBuilder: WorkflowBuilderRepository;
  instanceAi: InstanceAiRepository;
}

/** 用一个 DatabaseHandle 组装全部仓储。server 层在启动时调用一次。 */
export function createRepositories(handle: DatabaseHandle): Repositories {
  const { db, schema, dialect } = handle;
  return {
    users: new UserRepository(db, schema),
    authRateLimits: new AuthRateLimitRepository(db, schema),
    apiKeys: new ApiKeyRepository(db, schema),
    passwordResets: new PasswordResetRepository(db, schema),
    invitations: new InvitationRepository(db, schema),
    folders: new FolderRepository(db, schema),
    projects: new ProjectRepository(db, schema),
    workflows: new WorkflowRepository(db, schema, dialect),
    workflowVersions: new WorkflowVersionRepository(db, schema),
    installedNodes: new InstalledNodeRepository(db, schema),
    credentials: new CredentialRepository(db, schema),
    dynamicCredentials: new DynamicCredentialRepository(db, schema),
    variables: new VariableRepository(db, schema),
    dataTables: new DataTableRepository(db, schema),
    tags: new TagRepository(db, schema),
    executions: new ExecutionRepository(db, schema),
    settings: new SettingsRepository(db, schema),
    webhooks: new WebhookRepository(db, schema),
    auditLogs: new AuditLogRepository(db, schema),
    quotas: new QuotaRepository(db, schema),
    customRoles: new CustomRoleRepository(db, schema),
    chat: new ChatRepository(db, schema),
    testRuns: new TestRunRepository(db, schema),
    favorites: new FavoriteRepository(db, schema),
    annotations: new ExecutionAnnotationRepository(db, schema),
    executionMetadata: new ExecutionMetadataRepository(db, schema),
    authTokenBlacklist: new AuthTokenBlacklistRepository(db, schema),
    authIdentities: new AuthIdentityRepository(db, schema),
    scheduler: new SchedulerRepository(db, schema),
    insights: new InsightsRepository(db, schema),
    oauthRuntime: new OAuthRuntimeRepository(db, schema),
    publishPipeline: new PublishPipelineRepository(db, schema),
    roleMappings: new RoleMappingRepository(db, schema),
    platform: new PlatformRepository(db, schema),
    instanceTrust: new InstanceTrustRepository(db, schema),
    agents: new AgentRepository(db, schema),
    workflowBuilder: new WorkflowBuilderRepository(db, schema),
    instanceAi: new InstanceAiRepository(db, schema),
  };
}
