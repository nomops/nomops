import type { Repositories, Workflow as WorkflowRow } from '@nomops/db';
import type { INodeLoader } from '@nomops/core';
import type {
  INode,
  INodeExecutionData,
  ITriggerContext,
  IWebhookDescription,
  JsonObject,
} from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { ExecutionService } from '../services/execution-service.js';
import type { AuditService } from '../services/audit-service.js';

/** 解析声明式 webhook 值（字面量 或 { parameter } 引用节点参数）。 */
function resolveWebhookValue(
  value: IWebhookDescription['path'],
  node: INode,
): string {
  if (typeof value === 'string') return value;
  const raw = node.parameters[value.parameter];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new OperationalError(`Webhook node ${node.name} is missing parameter "${value.parameter}"`, {
      node: node.name,
      parameter: value.parameter,
    });
  }
  return raw;
}

/**
 * 触发器管理（docs/03 模块 5）：激活时注册触发器，停用时注销。
 * 两类分治：
 * - webhook 型（无状态）：写 webhook_entities 路由表，任意进程可接请求；
 * - 定时型（有状态，节点实现 trigger()）：起定时器，★仅 leader 进程（队列模式防 N 次触发）。
 * 加新触发器类型 = 写节点（description.webhooks 或 trigger()），本类无节点特判（铁律 6）。
 */
export class ActiveWorkflowManager {
  /** workflowId → 触发器关闭函数（停用/关机时调用）。 */
  private readonly closers = new Map<string, Array<() => Promise<void>>>();

  constructor(
    private readonly repos: Repositories,
    private readonly nodeLoader: INodeLoader,
    private readonly executions: ExecutionService,
    private readonly isLeader: () => boolean,
    private readonly audit?: AuditService,
  ) {}

  /** 启动时恢复全部已激活工作流的触发器。单个失败不阻断其它。 */
  async init(): Promise<void> {
    for (const row of await this.repos.workflows.findAllActive()) {
      try {
        await this.add(row);
      } catch (error) {
        console.error(`[nomops] 恢复工作流 ${row.id} 触发器失败:`, (error as Error).message);
      }
    }
  }

  /** 激活：注册该工作流全部触发节点。失败抛 OperationalError（activationError）。 */
  async add(row: WorkflowRow): Promise<void> {
    await this.remove(row.id); // 幂等：先清旧注册（update 场景）
    const closer: Array<() => Promise<void>> = [];
    this.closers.set(row.id, closer);

    for (const node of row.nodes as INode[]) {
      if (node.disabled) continue;
      const nodeType = await this.nodeLoader
        .getByNameAndVersion(node.type, node.typeVersion)
        .catch(() => null);
      if (!nodeType) continue;

      // webhook 型：声明式注册路由
      for (const webhook of nodeType.description.webhooks ?? []) {
        const path = resolveWebhookValue(webhook.path, node);
        const method = resolveWebhookValue(webhook.httpMethod, node).toUpperCase();
        const existing = await this.repos.webhooks.findByPathAndMethod(path, method);
        if (existing && existing.workflowId !== row.id) {
          await this.remove(row.id);
          throw new OperationalError(
            `Webhook path conflict: ${method} /webhook/${path} is already in use by another workflow`,
            { path, method, conflictWorkflowId: existing.workflowId },
          );
        }
        await this.repos.webhooks.upsert({
          webhookPath: path,
          method,
          workflowId: row.id,
          node: node.name,
        });
        closer.push(async () => this.repos.webhooks.deleteByWorkflow(row.id));
      }

      // 定时型：节点自带 trigger()，仅 leader 起
      if (nodeType.trigger && this.isLeader()) {
        const context = this.buildTriggerContext(row, node);
        const response = await nodeType.trigger.call(context);
        if (response.closeFunction) closer.push(response.closeFunction);
      }
    }
  }

  /** 停用：注销路由 + 关掉定时器。幂等。 */
  async remove(workflowId: string): Promise<void> {
    const closer = this.closers.get(workflowId);
    this.closers.delete(workflowId);
    await this.repos.webhooks.deleteByWorkflow(workflowId);
    for (const close of closer ?? []) {
      await close().catch((error: Error) =>
        console.error(`[nomops] 关闭触发器失败 ${workflowId}:`, error.message),
      );
    }
  }

  /** 关机清理全部。 */
  async shutdown(): Promise<void> {
    for (const workflowId of [...this.closers.keys()]) {
      const closer = this.closers.get(workflowId) ?? [];
      this.closers.delete(workflowId);
      for (const close of closer) await close().catch(() => undefined);
    }
  }

  private buildTriggerContext(row: WorkflowRow, node: INode): ITriggerContext {
    const staticData: JsonObject = (row.staticData as JsonObject | null) ?? {};
    return {
      emit: (data: INodeExecutionData[][]) => {
        void this.executions
          .runTriggered(row.id, 'trigger', data[0] ?? [{ json: {} }], node.name)
          .then(async (summary) => {
            // 系统触发：userId 为空，projectId 取工作流归属（docs/06）
            this.audit?.log({
              projectId: await this.repos.workflows.getOwnerProjectId(row.id),
              action: 'workflow.run',
              resourceType: 'workflow',
              resourceId: row.id,
              details: { mode: 'trigger', executionId: summary.executionId },
            });
          })
          .catch((error: Error) => {
            // 配额超限：静默跳过本次（不建执行行），warn 提示（docs/08）
            const status = (error as { context?: { status?: number } }).context?.['status'];
            if (status === 429) {
              console.warn(`[nomops] 定时触发跳过（配额超限）${row.id}: ${error.message}`);
              return;
            }
            console.error(`[nomops] 定时触发执行失败 ${row.id}:`, error.message);
          });
      },
      getNodeParameter: (name: string) => {
        if (name in node.parameters) return node.parameters[name];
        // 未填参数回落到节点描述里的 default
        return undefined;
      },
      getWorkflowStaticData: (type: string) => {
        const key = type === 'global' ? 'global' : `node:${node.name}`;
        let data = staticData[key];
        if (data === undefined || data === null || typeof data !== 'object') {
          data = {};
          staticData[key] = data;
        }
        return data as JsonObject;
      },
    };
  }
}
