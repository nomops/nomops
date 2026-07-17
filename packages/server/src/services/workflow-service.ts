import type {
  Repositories,
  Workflow as WorkflowRow,
  WorkflowVersion,
  WorkflowVersionMeta,
} from '@nomops/db';
import type { IConnections, INode, IPinData, IWorkflowSettings } from '@nomops/workflow';
import { OperationalError, Workflow } from '@nomops/workflow';
import type { INodeLoader } from '@nomops/core';

export interface IWorkflowInput {
  name: string;
  /** 工作流描述（画布 ⋯ → Edit description；列表卡片副行展示）。 */
  description?: string | null;
  nodes: INode[];
  connections: IConnections;
  settings?: IWorkflowSettings;
  /** 钉住数据（nodeName → 冻结输出）；null = 清空全部 pin。 */
  pinData?: IPinData | null;
  /** 所属文件夹；null = 项目根。移动时在 patch 里传。 */
  folderId?: string | null;
}

/** 每个工作流最多保留的历史版本数（限界增长；超出裁最旧）。 */
const MAX_VERSIONS = 50;

/**
 * Workflow 业务：结构校验 + 归属 CRUD + 版本历史。
 * Zod 只保证「形状」；这里再做图级校验（连接引用存在、节点类型已注册、节点名唯一）。
 * 版本：定义变更（nodes/connections）的每次保存快照一份，可查看/回滚。
 */
export class WorkflowService {
  constructor(
    private readonly repos: Repositories,
    private readonly nodeLoader: INodeLoader,
  ) {}

  async validateStructure(input: Pick<IWorkflowInput, 'nodes' | 'connections'>): Promise<void> {
    // Workflow 构造函数校验：节点名唯一、连接引用存在
    new Workflow({ nodes: input.nodes, connections: input.connections });
    // 节点类型必须已注册（全名，内置 nomops.* 与社区 <pkg>.* 一视同仁）
    const known = new Set(this.nodeLoader.getAllTypes());
    for (const node of input.nodes) {
      if (!known.has(node.type)) {
        throw new OperationalError(`Unknown node type: ${node.type}`, { node: node.name });
      }
    }
  }

  /** 校验 folderId 归属：null（根）放行；非空必须是本项目的文件夹。 */
  private async assertFolderInProject(folderId: string | null | undefined, projectId: string): Promise<void> {
    if (folderId === undefined || folderId === null) return;
    if (!(await this.repos.folders.findById(folderId, projectId))) {
      throw new OperationalError('Folder not found', { folderId, status: 404 });
    }
  }

  /** 把工作流当前状态快照为一个新版本，并裁掉超额旧版本（已发布指针指向的版本永不被裁）。 */
  private async snapshot(wf: WorkflowRow, projectId: string, authorId: string | null): Promise<WorkflowVersion> {
    const version = await this.repos.workflowVersions.create({
      workflowId: wf.id,
      projectId,
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings,
      createdBy: authorId,
    });
    await this.repos.workflowVersions.prune(wf.id, MAX_VERSIONS, wf.publishedVersionId);
    return version;
  }

  /** pin 的节点必须真实存在（防钉住幽灵节点造成引擎路由错乱）。 */
  private assertPinTargets(pinData: IPinData | null | undefined, nodes: INode[]): void {
    if (!pinData) return;
    const names = new Set(nodes.map((n) => n.name));
    for (const pinned of Object.keys(pinData)) {
      if (!names.has(pinned)) {
        throw new OperationalError(`Cannot pin data for unknown node: ${pinned}`, { status: 400 });
      }
    }
  }

  async create(input: IWorkflowInput, projectId: string, authorId: string | null = null): Promise<WorkflowRow> {
    await this.validateStructure(input);
    this.assertPinTargets(input.pinData, input.nodes);
    await this.assertFolderInProject(input.folderId, projectId);
    const created = await this.repos.workflows.create(
      {
        name: input.name,
        description: input.description ?? null,
        nodes: input.nodes,
        connections: input.connections,
        settings: input.settings ?? null,
        pinData: input.pinData ?? null,
        folderId: input.folderId ?? null,
      },
      projectId,
    );
    await this.snapshot(created, projectId, authorId); // 初始版本 v1
    return created;
  }

  async getById(id: string, projectId: string): Promise<WorkflowRow> {
    const wf = await this.repos.workflows.findById(id, projectId);
    if (!wf) throw new OperationalError('Workflow not found', { workflowId: id, status: 404 });
    return wf;
  }

  /** folderId: undefined → 全部；null → 项目根；string → 指定文件夹。archived=true 只看归档。 */
  /**
   * 项目依赖图（对标 n8n 卡片依赖胶囊）：一次扫全项目，返回每个工作流的依赖列表。
   * 类型：credential（节点绑定的凭证）/ subWorkflow（Execute Workflow 目标）/
   * errorWorkflow（settings.errorWorkflow）+ 两个反向（parentWorkflow / errorWorkflowParent）。
   * 已删除的凭证/工作流引用不计入（以 DB 现存为准，与 n8n 打开时重查的语义一致）。
   */
  async dependencies(projectId: string): Promise<Record<string, Array<{ type: string; id: string; name: string }>>> {
    const [workflows, credentials] = await Promise.all([
      this.repos.workflows.findAllByProject(projectId),
      this.repos.credentials.findAllByProject(projectId),
    ]);
    const credName = new Map(credentials.map((c) => [c.id, c.name]));
    const wfName = new Map(workflows.map((w) => [w.id, w.name]));
    const out: Record<string, Array<{ type: string; id: string; name: string }>> = {};
    const push = (wfId: string, dep: { type: string; id: string; name: string }) => {
      (out[wfId] ??= []).push(dep);
    };

    for (const wf of workflows) {
      const seenCreds = new Set<string>();
      for (const node of wf.nodes as INode[]) {
        for (const ref of Object.values(node.credentials ?? {})) {
          if (seenCreds.has(ref.id) || !credName.has(ref.id)) continue;
          seenCreds.add(ref.id);
          push(wf.id, { type: 'credential', id: ref.id, name: credName.get(ref.id)! });
        }
        if (node.type === 'nomops.executeWorkflow') {
          const targetId = node.parameters['workflowId'];
          if (typeof targetId === 'string' && targetId !== wf.id && wfName.has(targetId)) {
            push(wf.id, { type: 'subWorkflow', id: targetId, name: wfName.get(targetId)! });
            push(targetId, { type: 'parentWorkflow', id: wf.id, name: wf.name });
          }
        }
      }
      const errorWf = (wf.settings as Record<string, unknown> | null)?.['errorWorkflow'];
      if (typeof errorWf === 'string' && errorWf !== wf.id && wfName.has(errorWf)) {
        push(wf.id, { type: 'errorWorkflow', id: errorWf, name: wfName.get(errorWf)! });
        push(errorWf, { type: 'errorWorkflowParent', id: wf.id, name: wf.name });
      }
    }
    // 去重（同一对工作流多个 Execute Workflow 节点只算一条）
    for (const [wfId, deps] of Object.entries(out)) {
      const seen = new Set<string>();
      out[wfId] = deps.filter((d) => {
        const key = `${d.type}:${d.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return out;
  }

  async list(projectId: string, folderId?: string | null, archived = false): Promise<WorkflowRow[]> {
    if (folderId === undefined) return this.repos.workflows.findAllByProject(projectId, archived);
    return this.repos.workflows.findByProjectAndFolder(projectId, folderId, archived);
  }

  /**
   * 源码同步导入：按 id upsert 到项目（跨环境保持同一 workflow id）。
   * 校验结构（含节点类型已注册）；未知节点类型的工作流跳过而非整体失败。
   * 返回 'created' | 'updated'（校验失败抛出，由调用方按文件收集为 skipped）。
   */
  async importFromSync(
    id: string,
    input: IWorkflowInput & { active?: boolean },
    projectId: string,
  ): Promise<'created' | 'updated'> {
    await this.validateStructure(input);
    const existing = await this.repos.workflows.findById(id, projectId);
    if (existing) {
      await this.repos.workflows.update(id, {
        name: input.name,
        nodes: input.nodes,
        connections: input.connections,
        settings: input.settings ?? null,
      });
      return 'updated';
    }
    await this.repos.workflows.createWithId(
      {
        name: input.name,
        nodes: input.nodes,
        connections: input.connections,
        settings: input.settings ?? null,
        active: false, // 导入不自动激活触发器（安全默认）
      },
      projectId,
      id,
    );
    return 'created';
  }

  async update(
    id: string,
    patch: Partial<IWorkflowInput>,
    projectId: string,
    authorId: string | null = null,
  ): Promise<WorkflowRow> {
    await this.getById(id, projectId); // 归属检查
    const existing = await this.repos.workflows.findById(id, projectId);
    const nodes = patch.nodes ?? existing!.nodes;
    const connections = patch.connections ?? existing!.connections;
    await this.validateStructure({ nodes, connections });
    if ('pinData' in patch) this.assertPinTargets(patch.pinData, nodes);
    if ('folderId' in patch) await this.assertFolderInProject(patch.folderId, projectId);
    const updated = await this.repos.workflows.update(id, { ...patch });
    // 只有定义变更（nodes/connections）才快照；纯文件夹移动/改名不算一个版本。
    if ('nodes' in patch || 'connections' in patch) {
      await this.snapshot(updated, projectId, authorId);
    }
    return updated;
  }

  async delete(id: string, projectId: string): Promise<void> {
    await this.getById(id, projectId); // 归属检查
    await this.repos.workflowVersions.deleteByWorkflow(id); // 先清版本（FK 指向 workflows）
    await this.repos.tags.clearWorkflow(id); // 清标签映射（FK 指向 workflows）
    await this.repos.workflows.delete(id);
  }

  /* ── 发布/草稿分离 ── */

  /**
   * 发布：把当前定义快照为新版本并把生产指针指过去。
   * 语义：保存（update）只改草稿，生产触发一律跑已发布版本；从未发布的旧数据生产退回当前定义（向后兼容）。
   */
  async publish(id: string, projectId: string, authorId: string | null = null): Promise<WorkflowRow> {
    const wf = await this.getById(id, projectId); // 归属检查
    const version = await this.snapshot(wf, projectId, authorId);
    return this.repos.workflows.markPublished(id, version.id);
  }

  /**
   * 生产定义解析：已发布 → 用版本快照的 name/nodes/connections/settings 替换行内容
   * （id/staticData/pinData 等保持活行——staticData 游标必须连续）；未发布/版本丢失 → 原行。
   */
  async productionRow(row: WorkflowRow): Promise<WorkflowRow> {
    if (!row.publishedVersionId) return row;
    const version = await this.repos.workflowVersions.findById(row.publishedVersionId, row.id);
    if (!version) {
      console.warn(`[nomops] 工作流 ${row.id} 的已发布版本 ${row.publishedVersionId} 不存在，退回当前定义`);
      return row;
    }
    return {
      ...row,
      name: version.name,
      nodes: version.nodes,
      connections: version.connections,
      settings: version.settings,
    };
  }

  /** 草稿是否领先于已发布版本（定义级对比；未发布恒 true）。 */
  async publishedDirty(row: WorkflowRow): Promise<boolean> {
    if (!row.publishedVersionId) return true;
    const version = await this.repos.workflowVersions.findById(row.publishedVersionId, row.id);
    if (!version) return true;
    const sig = (v: { nodes: unknown; connections: unknown; settings: unknown }) =>
      JSON.stringify({ nodes: v.nodes, connections: v.connections, settings: v.settings ?? null });
    return sig(row) !== sig(version);
  }

  /* ── 版本历史 ── */

  /** 版本列表（新→旧，仅元信息）。 */
  async listVersions(workflowId: string, projectId: string): Promise<WorkflowVersionMeta[]> {
    await this.getById(workflowId, projectId); // 归属检查
    return this.repos.workflowVersions.listByWorkflow(workflowId);
  }

  /** 单个版本全量（含 nodes/connections）。 */
  async getVersion(workflowId: string, versionId: string, projectId: string): Promise<WorkflowVersion> {
    await this.getById(workflowId, projectId); // 归属检查
    const version = await this.repos.workflowVersions.findById(versionId, workflowId);
    if (!version) throw new OperationalError('Version not found', { versionId, status: 404 });
    return version;
  }

  /** 回滚到指定版本：把该版本的定义写回工作流（本身也产生一条新版本，历史保持线性）。 */
  async restoreVersion(
    workflowId: string,
    versionId: string,
    projectId: string,
    authorId: string | null = null,
  ): Promise<WorkflowRow> {
    const version = await this.getVersion(workflowId, versionId, projectId);
    const patch: Partial<IWorkflowInput> = {
      name: version.name,
      nodes: version.nodes,
      connections: version.connections,
    };
    if (version.settings) patch.settings = version.settings;
    return this.update(workflowId, patch, projectId, authorId);
  }
}
