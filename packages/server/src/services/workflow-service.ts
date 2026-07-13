import type { Repositories, Workflow as WorkflowRow } from '@nomops/db';
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

/**
 * Workflow 业务：结构校验 + 归属 CRUD。
 * Zod 只保证「形状」；这里再做图级校验（连接引用存在、节点类型已注册、节点名唯一）。
 */
export class WorkflowService {
  constructor(
    private readonly repos: Repositories,
    private readonly nodeLoader: INodeLoader,
  ) {}

  async validateStructure(input: Pick<IWorkflowInput, 'nodes' | 'connections'>): Promise<void> {
    // Workflow 构造函数校验：节点名唯一、连接引用存在
    new Workflow({ nodes: input.nodes, connections: input.connections });
    // 节点类型必须已注册
    const known = new Set(
      this.nodeLoader.getAllDescriptions().map((d) => `nomops.${d.name}`),
    );
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

  async create(input: IWorkflowInput, projectId: string): Promise<WorkflowRow> {
    await this.validateStructure(input);
    await this.assertFolderInProject(input.folderId, projectId);
    return this.repos.workflows.create(
      {
        name: input.name,
        nodes: input.nodes,
        connections: input.connections,
        settings: input.settings ?? null,
        folderId: input.folderId ?? null,
      },
      projectId,
    );
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

  async update(id: string, patch: Partial<IWorkflowInput>, projectId: string): Promise<WorkflowRow> {
    const existing = await this.getById(id, projectId); // 归属检查
    const nodes = patch.nodes ?? existing.nodes;
    const connections = patch.connections ?? existing.connections;
    await this.validateStructure({ nodes, connections });
    if ('folderId' in patch) await this.assertFolderInProject(patch.folderId, projectId);
    return this.repos.workflows.update(id, { ...patch });
  }

  async delete(id: string, projectId: string): Promise<void> {
    await this.getById(id, projectId); // 归属检查
    await this.repos.workflows.delete(id);
  }
}
