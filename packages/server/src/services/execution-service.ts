import type { Execution, Repositories, Workflow as WorkflowRow } from '@nomops/db';
import type { INodeLoader } from '@nomops/core';
import { WorkflowExecute, seedTriggerOutput } from '@nomops/core';
import type {
  IConnections,
  INode,
  INodeExecutionData,
  IRun,
  IRunExecutionData,
  JsonObject,
} from '@nomops/workflow';
import { OperationalError, Workflow, createRunExecutionData } from '@nomops/workflow';
import type { CredentialService } from './credential-service.js';
import type { WorkflowService } from './workflow-service.js';
import type { QuotaService } from './quota-service.js';
import type { PushHub } from '../ws/push-hub.js';
import type { IExecutionQueue } from '../queue/execution-queue.js';

export interface IRunSummary {
  executionId: string;
  status: IRun['status'] | 'queued';
  lastNodeExecuted?: string;
  error?: string;
}

export type TriggerMode = 'webhook' | 'trigger';

/** 子工作流最大嵌套深度（防递归；docs/09 产品深化）。 */
const MAX_SUBWORKFLOW_DEPTH = 5;

/**
 * 执行编排：加载 workflow → 建 execution 记录 → 跑引擎（hook 推 WS）→ 结果落库。
 * 触发执行（webhook/cron）用可序列化的初始 RunExecutionData 落库：
 * 单进程直接跑；队列模式只入队 executionId，worker 反序列化后继续（docs/01 队列设计）。
 */
export class ExecutionService {
  constructor(
    private readonly repos: Repositories,
    private readonly workflowService: WorkflowService,
    private readonly credentialService: CredentialService,
    private readonly nodeLoader: INodeLoader,
    private readonly pushHub: PushHub,
    private readonly quota: QuotaService,
    private readonly queue: IExecutionQueue | null = null,
    /** 执行结束事件的旁路观察者（docs/10 B3 日志流）。注入后每次收尾都会广播。 */
    private readonly onExecutionFinished?: (evt: {
      executionId: string;
      workflowId: string;
      status: string;
      projectId: string;
    }) => void,
  ) {}

  /** 手动运行（调试）：总在当前进程跑（WS 进度只对发起方有意义）。 */
  async runManually(
    workflowId: string,
    projectId: string,
    options: { destinationNode?: string } = {},
  ): Promise<IRunSummary> {
    const row = await this.workflowService.getById(workflowId, projectId);
    const workflow = this.toWorkflow(row);

    await this.quota.consume(projectId); // ★配额网关：超额 429（docs/08）
    const execution = await this.createExecutionRow(row, 'manual', {
      resultData: { runData: {} },
    } as unknown as JsonObject);

    const run = await this.runEngine(workflow, execution, projectId, (engine) =>
      engine.run(workflow, undefined, options.destinationNode),
    );
    return this.toSummary(execution.id, run);
  }

  /**
   * 触发执行（webhook/cron）：构造种子状态（就绪栈里放起始节点+种子数据）并落库。
   * 队列模式入队，否则当场执行。
   */
  async runTriggered(
    workflowId: string,
    mode: TriggerMode,
    seedData: INodeExecutionData[],
    startNodeName: string,
  ): Promise<IRunSummary> {
    const projectId = await this.repos.workflows.getOwnerProjectId(workflowId);
    if (!projectId) throw new OperationalError('Workflow has no owning project', { workflowId });
    const row = await this.workflowService.getById(workflowId, projectId);
    const workflow = this.toWorkflow(row);
    const startNode = workflow.getNode(startNodeName);

    // 触发器节点的输出 = 外部事件数据（不执行其 execute），下游按连接入栈
    const state = createRunExecutionData();
    seedTriggerOutput(workflow, state, startNode, [seedData]);

    await this.quota.consume(projectId); // ★配额网关：超额 429（webhook）/由 AWM 静默跳过（cron）
    const execution = await this.createExecutionRow(row, mode, state as unknown as JsonObject);

    if (this.queue) {
      await this.queue.enqueue({ executionId: execution.id });
      return { executionId: execution.id, status: 'queued' };
    }
    const run = await this.executeStored(execution.id);
    return this.toSummary(execution.id, run);
  }

  /**
   * 执行一条已落库的 execution（初始状态或中断状态均可）。
   * worker 进程的唯一入口；单进程模式复用同一路径。
   */
  async executeStored(executionId: string): Promise<IRun> {
    const data = await this.repos.executions.getData(executionId);
    if (!data) throw new OperationalError('Execution data not found', { executionId });

    const stored = await this.repos.executions.getRecord(executionId);
    if (!stored) throw new OperationalError('Execution record not found', { executionId });
    const projectId = await this.repos.workflows.getOwnerProjectId(stored.workflowId);
    if (!projectId) throw new OperationalError('Workflow has no owning project', { workflowId: stored.workflowId });
    const workflowData = await this.repos.executions.getWorkflowData(executionId);
    if (!workflowData) throw new OperationalError('Execution workflow snapshot not found', { executionId });

    const workflow = new Workflow({
      id: stored.workflowId,
      name: String(workflowData['name'] ?? ''),
      nodes: workflowData['nodes'] as INode[],
      connections: workflowData['connections'] as IConnections,
    });
    const state = data as unknown as IRunExecutionData;

    await this.repos.executions.updateStatus(executionId, 'running');
    const execution = { id: executionId, workflowId: stored.workflowId } as Execution;
    return this.runEngine(workflow, execution, projectId, (engine) =>
      engine.processRunExecutionData(workflow, state),
    );
  }

  async list(projectId: string): Promise<Execution[]> {
    return this.repos.executions.findAllByProject(projectId);
  }

  async getById(id: string, projectId: string): Promise<{ execution: Execution; data: JsonObject | null }> {
    const execution = await this.repos.executions.findById(id, projectId);
    if (!execution) throw new OperationalError('Execution record not found', { executionId: id, status: 404 });
    const data = await this.repos.executions.getData(id);
    return { execution, data };
  }

  /* ────────────── 内部 ────────────── */

  private toWorkflow(row: WorkflowRow): Workflow {
    return new Workflow({
      id: row.id,
      name: row.name,
      nodes: row.nodes as INode[],
      connections: row.connections as IConnections,
    });
  }

  private async createExecutionRow(
    row: WorkflowRow,
    mode: string,
    initialData: JsonObject,
  ): Promise<Execution> {
    return this.repos.executions.create(
      { workflowId: row.id, status: 'new', mode, startedAt: new Date() },
      {
        workflowData: { name: row.name, nodes: row.nodes, connections: row.connections } as JsonObject,
        data: initialData,
      },
    );
  }

  /**
   * 子工作流执行（ExecuteWorkflow 节点回调）：同项目归属校验 + 深度限制。
   * 像函数调用一样内联执行：不建执行行、不重复计配额（父执行已计）。
   */
  private async runSubWorkflow(
    workflowId: string,
    projectId: string,
    seedItems: INodeExecutionData[],
    depth: number,
  ): Promise<INodeExecutionData[]> {
    if (depth >= MAX_SUBWORKFLOW_DEPTH) {
      throw new OperationalError(`Sub-workflow nesting exceeds ${MAX_SUBWORKFLOW_DEPTH} levels (possible recursion)`, {
        workflowId,
      });
    }
    const row = await this.workflowService.getById(workflowId, projectId); // 跨项目 404
    const workflow = this.toWorkflow(row);
    const engine = new WorkflowExecute(this.nodeLoader, {
      additionalData: await this.buildAdditionalData(projectId, depth + 1),
    });
    const run = await engine.run(workflow, undefined, undefined, seedItems);
    if (run.status !== 'success') {
      throw new OperationalError(
        `Sub-workflow ${row.name} failed: ${run.data.resultData.error?.message ?? run.status}`,
        { workflowId },
      );
    }
    const lastNode = run.data.resultData.lastNodeExecuted;
    const runs = lastNode ? run.data.resultData.runData[lastNode] : undefined;
    return runs?.[runs.length - 1]?.data?.['main']?.[0] ?? [];
  }

  /** 引擎注入包（凭证 + 变量 + 子工作流回调），父/子执行共用。 */
  private async buildAdditionalData(projectId: string, depth = 0) {
    // 项目维度变量 → 表达式里 $vars.KEY（执行前一次性物化）
    const variables: Record<string, string> = {};
    for (const v of await this.repos.variables.findAllByProject(projectId)) variables[v.key] = v.value;
    return {
      variables,
      getCredentials: async (type: string, node: INode) => {
        const ref = node.credentials?.[type];
        if (!ref) {
          throw new OperationalError(`Node ${node.name} has no credential configured for "${type}"`, { node: node.name });
        }
        return this.credentialService.getDecryptedData(ref.id, projectId);
      },
      executeSubWorkflow: (workflowId: string, items: INodeExecutionData[]) =>
        this.runSubWorkflow(workflowId, projectId, items, depth),
    };
  }

  /** 组装引擎（凭证注入 + WS hooks），执行并收尾落库。 */
  private async runEngine(
    workflow: Workflow,
    execution: Pick<Execution, 'id' | 'workflowId'>,
    projectId: string,
    runFn: (engine: WorkflowExecute) => Promise<IRun>,
  ): Promise<IRun> {
    const push = (event: Parameters<PushHub['broadcast']>[0]) => this.pushHub.broadcast(event);
    push({
      type: 'executionStarted',
      executionId: execution.id,
      workflowId: execution.workflowId,
      timestamp: Date.now(),
    });

    const engine = new WorkflowExecute(this.nodeLoader, {
      additionalData: await this.buildAdditionalData(projectId),
      hooks: {
        nodeExecuteBefore: (nodeName) =>
          push({
            type: 'nodeExecuteBefore',
            executionId: execution.id,
            workflowId: execution.workflowId,
            nodeName,
            timestamp: Date.now(),
          }),
        nodeExecuteAfter: (nodeName, taskData) =>
          push({
            type: 'nodeExecuteAfter',
            executionId: execution.id,
            workflowId: execution.workflowId,
            nodeName,
            summary: {
              itemCount: taskData.data?.['main']?.[0]?.length ?? 0,
              executionTime: taskData.executionTime,
              ...(taskData.error ? { error: taskData.error.message } : {}),
            },
            timestamp: Date.now(),
          }),
      },
    });

    let run: IRun;
    try {
      run = await runFn(engine);
    } catch (error) {
      await this.repos.executions.updateStatus(execution.id, 'error', new Date());
      push({
        type: 'executionFinished',
        executionId: execution.id,
        workflowId: execution.workflowId,
        status: 'error',
        timestamp: Date.now(),
      });
      this.emitFinished(execution, 'error', projectId);
      throw error;
    }

    await this.repos.executions.updateStatus(execution.id, run.status, new Date());
    await this.repos.executions.updateData(execution.id, run.data as unknown as JsonObject);
    push({
      type: 'executionFinished',
      executionId: execution.id,
      workflowId: execution.workflowId,
      status: run.status,
      timestamp: Date.now(),
    });
    this.emitFinished(execution, run.status, projectId);
    return run;
  }

  /** 广播执行结束事件到旁路观察者（日志流），失败不影响主流程。 */
  private emitFinished(
    execution: Pick<Execution, 'id' | 'workflowId'>,
    status: string,
    projectId: string,
  ): void {
    try {
      this.onExecutionFinished?.({
        executionId: execution.id,
        workflowId: execution.workflowId,
        status,
        projectId,
      });
    } catch (error) {
      console.error('[nomops] 执行事件旁路失败:', (error as Error).message);
    }
  }

  private toSummary(executionId: string, run: IRun): IRunSummary {
    return {
      executionId,
      status: run.status,
      lastNodeExecuted: run.data.resultData.lastNodeExecuted,
      error: run.data.resultData.error?.message,
    };
  }
}
