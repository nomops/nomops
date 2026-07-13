import type {
  Repositories,
  Workflow as WorkflowRow,
  WorkflowVersion,
  WorkflowVersionMeta,
} from '@nomops/db';
import type { IConnections, INode, IWorkflowSettings } from '@nomops/workflow';
import { OperationalError, Workflow } from '@nomops/workflow';
import type { INodeLoader } from '@nomops/core';

export interface IWorkflowInput {
  name: string;
  nodes: INode[];
  connections: IConnections;
  settings?: IWorkflowSettings;
  /** 所属文件夹；null = 项目根。移动时在 patch 里传。 */
  folderId?: string | null;
}

/** 每个工作流最多保留的历史版本数（限界增长；超出裁最旧）。 */
const MAX_VERSIONS = 50;

/**
 * Workflow 业务：结构校验 + 归属 CRUD + 版本历史。
 * Zod 只保证「形状」；这里再做图级校验（连接引用存在、节点类型已注册、节点名唯一）。
 * 版本：定义变更（nodes/connections）的每次保存快照一份，可查看/回滚（对标 n8n）。
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

  /** 把工作流当前状态快照为一个新版本，并裁掉超额旧版本。 */
  private async snapshot(wf: WorkflowRow, projectId: string, authorId: string | null): Promise<void> {
    await this.repos.workflowVersions.create({
      workflowId: wf.id,
      projectId,
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings,
      createdBy: authorId,
    });
    await this.repos.workflowVersions.prune(wf.id, MAX_VERSIONS);
  }

  async create(input: IWorkflowInput, projectId: string, authorId: string | null = null): Promise<WorkflowRow> {
    await this.validateStructure(input);
    await this.assertFolderInProject(input.folderId, projectId);
    const created = await this.repos.workflows.create(
      {
        name: input.name,
        nodes: input.nodes,
        connections: input.connections,
        settings: input.settings ?? null,
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

  /** folderId: undefined → 全部；null → 项目根；string → 指定文件夹。 */
  async list(projectId: string, folderId?: string | null): Promise<WorkflowRow[]> {
    if (folderId === undefined) return this.repos.workflows.findAllByProject(projectId);
    return this.repos.workflows.findByProjectAndFolder(projectId, folderId);
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
    await this.repos.workflows.delete(id);
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
