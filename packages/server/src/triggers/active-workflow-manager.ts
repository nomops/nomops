import type { Repositories, Workflow as WorkflowRow } from '@nomops/db';
import type { INodeLoader } from '@nomops/core';
import { defaultHttpRequest } from '@nomops/core';
import type {
  INode,
  INodeExecutionData,
  IPollContext,
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

  /** workflowId → 轮询函数列表（pollOnce 测试驱动用）。 */
  private readonly pollFns = new Map<string, Array<() => Promise<void>>>();

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

  /** 生产定义解析：触发器注册（webhook 路径/轮询间隔等）必须来自已发布版本；未发布退回当前定义。 */
  private async productionRow(row: WorkflowRow): Promise<WorkflowRow> {
    if (!row.publishedVersionId) return row;
    const version = await this.repos.workflowVersions.findById(row.publishedVersionId, row.id);
    if (!version) return row;
    return { ...row, name: version.name, nodes: version.nodes, connections: version.connections, settings: version.settings };
  }

  /** 激活：注册该工作流全部触发节点（按已发布定义）。失败抛 OperationalError（activationError）。 */
  async add(input: WorkflowRow): Promise<void> {
    const row = await this.productionRow(input);
    await this.remove(row.id); // 幂等：先清旧注册（update/republish 场景）
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

      // 轮询型：节点自带 poll()，仅 leader 调度（激活即先跑一轮，再按间隔）
      if (nodeType.poll && this.isLeader()) {
        const pollFn = nodeType.poll;
        const doPoll = async (): Promise<void> => {
          try {
            const { context, persist } = await this.buildPollContext(row.id, node);
            const output = await pollFn.call(context);
            await persist(); // 增量游标（staticData）在触发执行前先落库
            const items = output?.[0] ?? [];
            if (items.length > 0) this.dispatchTrigger(row.id, node.name, items);
          } catch (error) {
            console.error(`[nomops] 轮询失败 ${row.id}/${node.name}:`, (error as Error).message);
          }
        };
        let pollers = this.pollFns.get(row.id);
        if (!pollers) {
          pollers = [];
          this.pollFns.set(row.id, pollers);
        }
        pollers.push(doPoll);

        const intervalSeconds = Math.max(1, Number(node.parameters['pollInterval'] ?? 60));
        const timer = setInterval(() => void doPoll(), intervalSeconds * 1000);
        timer.unref?.();
        closer.push(async () => {
          clearInterval(timer);
          this.pollFns.delete(row.id);
        });
        await doPoll(); // 激活即拉一轮（建立基线并触发首批新条目）
      }
    }
  }

  /** 手动驱动某工作流的全部轮询器跑一轮（测试用，不等定时器）。 */
  async pollOnce(workflowId: string): Promise<void> {
    for (const poll of this.pollFns.get(workflowId) ?? []) await poll();
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

  /** 触发/轮询共用的执行派发（审计留痕 + 配额超限静默跳过）。 */
  private dispatchTrigger(workflowId: string, nodeName: string, items: INodeExecutionData[]): void {
    void this.executions
      .runTriggered(workflowId, 'trigger', items.length > 0 ? items : [{ json: {} }], nodeName)
      .then(async (summary) => {
        // 系统触发：userId 为空，projectId 取工作流归属（docs/06）
        this.audit?.log({
          projectId: await this.repos.workflows.getOwnerProjectId(workflowId),
          action: 'workflow.run',
          resourceType: 'workflow',
          resourceId: workflowId,
          details: { mode: 'trigger', executionId: summary.executionId },
        });
      })
      .catch((error: Error) => {
        // 配额超限：静默跳过本次（不建执行行），warn 提示（docs/08）
        const status = (error as { context?: { status?: number } }).context?.['status'];
        if (status === 429) {
          console.warn(`[nomops] 定时触发跳过（配额超限）${workflowId}: ${error.message}`);
          return;
        }
        console.error(`[nomops] 定时触发执行失败 ${workflowId}:`, error.message);
      });
  }

  private buildTriggerContext(row: WorkflowRow, node: INode): ITriggerContext {
    const staticData: JsonObject = (row.staticData as JsonObject | null) ?? {};
    return {
      emit: (data: INodeExecutionData[][]) => {
        this.dispatchTrigger(row.id, node.name, data[0] ?? [{ json: {} }]);
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

  /**
   * 轮询上下文：staticData 每轮读最新行、poll 结束后持久化（增量游标场景）；
   * filterNewKeys 绑定 (workflowId, node) 命名空间的去重存储。
   */
  private async buildPollContext(
    workflowId: string,
    node: INode,
  ): Promise<{ context: IPollContext; persist: () => Promise<void> }> {
    const fresh = await this.repos.workflows.findByIdUnscoped(workflowId);
    const staticData: JsonObject = (fresh?.staticData as JsonObject | null) ?? {};
    let staticDataTouched = false;

    const context: IPollContext = {
      getNodeParameter: (name: string) => node.parameters[name],
      getWorkflowStaticData: (type: string) => {
        staticDataTouched = true;
        const key = type === 'global' ? 'global' : `node:${node.name}`;
        let data = staticData[key];
        if (data === undefined || data === null || typeof data !== 'object') {
          data = {};
          staticData[key] = data;
        }
        return data as JsonObject;
      },
      helpers: {
        httpRequest: defaultHttpRequest,
        filterNewKeys: (keys: string[]) =>
          this.repos.executions.filterNewKeys(workflowId, `node:${node.name}`, keys),
      },
    };

    const persist = async () => {
      if (staticDataTouched) await this.repos.workflows.update(workflowId, { staticData });
    };
    return { context, persist };
  }
}
