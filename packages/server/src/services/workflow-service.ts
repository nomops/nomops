import type { Repositories, Workflow as WorkflowRow } from '@nomops/db';
import type { IConnections, INode, IWorkflowSettings } from '@nomops/workflow';
import { OperationalError, Workflow } from '@nomops/workflow';
import type { INodeLoader } from '@nomops/core';

export interface IWorkflowInput {
  name: string;
  nodes: INode[];
  connections: IConnections;
  settings?: IWorkflowSettings;
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

  async create(input: IWorkflowInput, projectId: string): Promise<WorkflowRow> {
    await this.validateStructure(input);
    return this.repos.workflows.create(
      { name: input.name, nodes: input.nodes, connections: input.connections, settings: input.settings ?? null },
      projectId,
    );
  }

  async getById(id: string, projectId: string): Promise<WorkflowRow> {
    const wf = await this.repos.workflows.findById(id, projectId);
    if (!wf) throw new OperationalError('Workflow not found', { workflowId: id, status: 404 });
    return wf;
  }

  async list(projectId: string): Promise<WorkflowRow[]> {
    return this.repos.workflows.findAllByProject(projectId);
  }

  async update(id: string, patch: Partial<IWorkflowInput>, projectId: string): Promise<WorkflowRow> {
    const existing = await this.getById(id, projectId); // 归属检查
    const nodes = patch.nodes ?? existing.nodes;
    const connections = patch.connections ?? existing.connections;
    await this.validateStructure({ nodes, connections });
    return this.repos.workflows.update(id, { ...patch });
  }

  async delete(id: string, projectId: string): Promise<void> {
    await this.getById(id, projectId); // 归属检查
    await this.repos.workflows.delete(id);
  }
}
