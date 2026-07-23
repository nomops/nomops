import { and, desc, eq, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import type { JsonObject } from '@nomops/workflow';
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
    patch: Partial<Pick<User, 'firstName' | 'lastName' | 'disabled' | 'role'>>,
  ): Promise<User> {
    const [row] = await this.db
      .update(this.schema.users)
      .set(patch)
      .where(eq(this.schema.users.id, id))
      .returning();
    return row as User;
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

  /** 发布：把生产指针指向某个版本快照（不 bump updatedAt——发布不是编辑）。 */
  async markPublished(id: string, versionId: string): Promise<Workflow> {
    const [row] = await this.db
      .update(this.schema.workflows)
      .set({ publishedVersionId: versionId, publishedAt: new Date() })
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
      .set({ status, stoppedAt: stoppedAt ?? null, waitTill: null })
      .where(eq(this.schema.executions.id, id));
  }

  /** 挂起为 waiting：记录唤醒时刻（null = 等外部信号），stoppedAt 保持空。 */
  async setWaiting(id: string, waitTill: Date | null): Promise<void> {
    await this.db
      .update(this.schema.executions)
      .set({ status: 'waiting', stoppedAt: null, waitTill })
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

export interface Repositories {
  users: UserRepository;
  apiKeys: ApiKeyRepository;
  passwordResets: PasswordResetRepository;
  invitations: InvitationRepository;
  folders: FolderRepository;
  projects: ProjectRepository;
  workflows: WorkflowRepository;
  workflowVersions: WorkflowVersionRepository;
  installedNodes: InstalledNodeRepository;
  credentials: CredentialRepository;
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
}

/** 用一个 DatabaseHandle 组装全部仓储。server 层在启动时调用一次。 */
export function createRepositories(handle: DatabaseHandle): Repositories {
  const { db, schema } = handle;
  return {
    users: new UserRepository(db, schema),
    apiKeys: new ApiKeyRepository(db, schema),
    passwordResets: new PasswordResetRepository(db, schema),
    invitations: new InvitationRepository(db, schema),
    folders: new FolderRepository(db, schema),
    projects: new ProjectRepository(db, schema),
    workflows: new WorkflowRepository(db, schema),
    workflowVersions: new WorkflowVersionRepository(db, schema),
    installedNodes: new InstalledNodeRepository(db, schema),
    credentials: new CredentialRepository(db, schema),
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
  };
}
