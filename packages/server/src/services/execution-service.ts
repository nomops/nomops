import type { Execution, Repositories, Workflow as WorkflowRow } from '@nomops/db';
import type { IBinaryDataStore, INodeLoader } from '@nomops/core';
import {
  WorkflowExecute,
  buildPartialRunState,
  computeDirtyNodes,
  incomingSignatureOf,
  seedTriggerOutput,
} from '@nomops/core';
import type {
  IConnections,
  INode,
  INodeExecutionData,
  IRun,
  IRunExecutionData,
  IWorkflowSettings,
  JsonObject,
} from '@nomops/workflow';
import { OperationalError, Workflow, createRunExecutionData } from '@nomops/workflow';
import type { CredentialService } from './credential-service.js';
import type { WorkflowService } from './workflow-service.js';
import type { IUsageGate } from './usage-gate.js';
import type { PushHub } from '../ws/push-hub.js';
import type { IExecutionQueue } from '../queue/execution-queue.js';
import { ConcurrencyGate, UNLIMITED } from './concurrency-gate.js';

export interface IRunSummary {
  executionId: string;
  status: IRun['status'] | 'queued';
  lastNodeExecuted?: string;
  error?: string;
}

/** 'error' = 错误处理流的运行（由失败执行派生；不再级联触发自身的 errorWorkflow）。 */
export type TriggerMode = 'webhook' | 'trigger' | 'error' | 'mcp' | 'retry' | 'chat';

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
    private readonly quota: IUsageGate,
    private readonly queue: IExecutionQueue | null = null,
    /** 执行结束事件的旁路观察者（docs/10 B3 日志流）。注入后每次收尾都会广播。 */
    private readonly onExecutionFinished?: (evt: {
      executionId: string;
      workflowId: string;
      status: string;
      projectId: string;
    }) => void,
    /** 二进制存储（文件系统/S3）；节点 helpers 经它读写字节流。 */
    private readonly binaryStore?: IBinaryDataStore,
    /** 实例级并发闸门（B7）。缺省不限，由 bootstrap 注入配置值。 */
    private readonly concurrency: ConcurrencyGate = new ConcurrencyGate(UNLIMITED),
  ) {}

  /** 当前并发占用（/metrics 与运维排查用）。 */
  concurrencyStats(): { active: number; waiting: number; enabled: boolean } {
    return {
      active: this.concurrency.active,
      waiting: this.concurrency.waiting,
      enabled: this.concurrency.enabled,
    };
  }

  /** 二进制下载用（控制器归属校验后取字节）。 */
  getBinaryStore(): IBinaryDataStore | undefined {
    return this.binaryStore;
  }

  /** 手动运行（调试）：总在当前进程跑（WS 进度只对发起方有意义）。 */
  async runManually(
    workflowId: string,
    projectId: string,
    options: { destinationNode?: string; usePreviousData?: boolean; startNode?: string } = {},
  ): Promise<IRunSummary> {
    const row = await this.workflowService.getById(workflowId, projectId);
    const workflow = this.toWorkflow(row, { applyPinData: true }); // 手动调试应用钉住数据

    // 多触发器：指定起点 trigger（对标基线 "Execute workflow from X"）；不存在即报错
    const startNode = options.startNode ? workflow.getNode(options.startNode) : undefined;
    if (options.startNode && !startNode) {
      throw new OperationalError(`Start node not found: ${options.startNode}`, { status: 400 });
    }

    // 部分执行：复用上次运行的干净上游数据，只重跑脏子图（构造失败则退回完整运行）
    const partialState =
      options.usePreviousData && options.destinationNode
        ? await this.buildPartialState(row, workflow, options.destinationNode)
        : null;

    await this.quota.consume(projectId); // ★配额网关：超额 429（docs/08）
    const execution = await this.createExecutionRow(row, 'manual', {
      resultData: { runData: {} },
    } as unknown as JsonObject);

    const run = await this.runEngine(
      workflow,
      execution,
      projectId,
      'manual',
      (engine) =>
        partialState
          ? engine.processRunExecutionData(workflow, partialState)
          : engine.run(workflow, startNode ?? undefined, options.destinationNode),
      (row.staticData as JsonObject | null) ?? {},
    );
    await this.applySavePolicy(execution.id, row.settings as IWorkflowSettings | null, 'manual', run.status);
    return this.toSummary(execution.id, run);
  }

  /**
   * 画布/API 聊天（Chat Trigger 起点，对标基线 Chat）：消息播种为触发输出，
   * 跑完从最后节点输出提取回复文本（text/output/reply/message 字段，否则整个 json）。
   */
  async chat(
    workflowId: string,
    projectId: string,
    message: string,
    sessionId: string,
  ): Promise<{ executionId: string; status: string; reply: string; error?: string }> {
    const row = await this.workflowService.getById(workflowId, projectId);
    const trigger = (row.nodes as INode[]).find((n) => n.type === 'nomops.chatTrigger' && !n.disabled);
    if (!trigger) {
      throw new OperationalError('This workflow has no Chat Trigger node', { status: 400 });
    }
    const workflow = this.toWorkflow(row, { applyPinData: true }); // 画布聊天属手动调试语境
    const startNode = workflow.getNode(trigger.name);

    await this.quota.consume(projectId);
    const execution = await this.createExecutionRow(row, 'chat', {
      resultData: { runData: {} },
    } as unknown as JsonObject);
    const run = await this.runEngine(
      workflow,
      execution,
      projectId,
      'chat',
      (engine) => engine.run(workflow, startNode ?? undefined, undefined, [{ json: { chatInput: message, sessionId } }]),
      (row.staticData as JsonObject | null) ?? {},
    );
    await this.applySavePolicy(execution.id, row.settings as IWorkflowSettings | null, 'chat', run.status);

    const last = run.data.resultData.lastNodeExecuted;
    const items = last ? run.data.resultData.runData[last]?.at(-1)?.data?.['main']?.[0] : undefined;
    const j = (items?.[0]?.json ?? {}) as Record<string, unknown>;
    const reply =
      typeof j['text'] === 'string' ? j['text']
      : typeof j['output'] === 'string' ? j['output']
      : typeof j['reply'] === 'string' ? j['reply']
      : typeof j['message'] === 'string' ? j['message']
      : JSON.stringify(j);
    return {
      executionId: execution.id,
      status: run.status,
      reply,
      ...(run.data.resultData.error ? { error: run.data.resultData.error.message } : {}),
    };
  }

  /**
   * 执行保存策略（workflow settings，对标基线）：默认全存；
   * saveManualExecutions / saveFailedExecutions / saveSuccessfulExecutions 置 false → 收尾后删除该执行记录。
   * waiting（挂起待续跑）不删。统计已在收尾前累计，不受影响。
   */
  private async applySavePolicy(
    executionId: string,
    settings: IWorkflowSettings | null | undefined,
    mode: string,
    status: string,
  ): Promise<void> {
    if (status === 'waiting') return;
    const s = settings ?? {};
    const drop =
      (mode === 'manual' && s.saveManualExecutions === false) ||
      (mode !== 'manual' && status === 'error' && s.saveFailedExecutions === false) ||
      (mode !== 'manual' && status !== 'error' && s.saveSuccessfulExecutions === false);
    if (drop) await this.repos.executions.delete(executionId).catch(() => undefined);
  }

  /**
   * 构造部分执行状态：取该工作流最近一次已结束执行的 runData + 定义快照，
   * 对比当前定义算脏节点集。无旧数据/构造失败 → null（退回完整运行）。
   */
  private async buildPartialState(
    row: WorkflowRow,
    workflow: Workflow,
    destinationNode: string,
  ): Promise<IRunExecutionData | null> {
    const prev = await this.repos.executions.findLatestFinishedByWorkflow(row.id);
    if (!prev) return null;
    const prevData = (await this.repos.executions.getData(prev.id)) as unknown as IRunExecutionData | null;
    const prevRunData = prevData?.resultData?.runData;
    if (!prevRunData || Object.keys(prevRunData).length === 0) return null;

    const snapshot = await this.repos.executions.getWorkflowData(prev.id);
    let dirty: Iterable<string> = [];
    if (snapshot?.['nodes'] && snapshot?.['connections']) {
      const prevWorkflow = new Workflow({
        nodes: snapshot['nodes'] as INode[],
        connections: snapshot['connections'] as IConnections,
      });
      dirty = computeDirtyNodes(
        { nodes: [...prevWorkflow.nodes.values()], incomingSignature: incomingSignatureOf(prevWorkflow) },
        { nodes: [...workflow.nodes.values()], incomingSignature: incomingSignatureOf(workflow) },
      );
    }

    try {
      return buildPartialRunState(workflow, prevRunData, destinationNode, dirty);
    } catch {
      return null; // 前置数据不足等情况：优雅退回完整运行
    }
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
    // 生产触发一律跑已发布版本（未发布退回当前定义）；草稿编辑不影响生产
    const row = await this.workflowService.productionRow(await this.workflowService.getById(workflowId, projectId));
    const workflow = this.toWorkflow(row);
    const startNode = workflow.getNode(startNodeName);

    // 触发器节点的输出 = 外部事件数据（不执行其 execute），下游按连接入栈
    const state = createRunExecutionData();
    seedTriggerOutput(workflow, state, startNode, [seedData]);

    // queue 模式不过闸门：并发由 worker 的 BullMQ 并发度管，两层会互相打架
    const gated = this.queue === null;

    /**
     * ★闸门必须在建执行记录**之前**：队列满时 acquire 抛 503，
     * 若记录已经建好，就会留下一条永远不会跑的 'new' 状态记录——
     * 而 'new' 是非终态，执行历史清理器不会碰它，洪峰下即成永久垃圾。
     * 被拒的请求也不该吃配额：它压根没执行。
     */
    if (gated) await this.concurrency.acquire(mode);
    try {
      await this.quota.consume(projectId); // ★配额网关：超额 429（webhook）/由 AWM 静默跳过（cron）
      const execution = await this.createExecutionRow(row, mode, state as unknown as JsonObject);

      if (this.queue) {
        await this.queue.enqueue({ executionId: execution.id });
        return { executionId: execution.id, status: 'queued' };
      }
      const run = await this.executeStored(execution.id);
      return this.toSummary(execution.id, run);
    } finally {
      if (gated) this.concurrency.release(mode);
    }
  }

  /**
   * 错误处理流派发：失败执行按其工作流 settings.errorWorkflow 触发指定错误流，
   * 携带失败上下文（工作流/执行/错误摘要）。fire-and-forget，不影响主流程。
   * 防级联：错误流自身的运行（mode='error'）失败不再派发。
   */
  private fireErrorWorkflow(
    failed: Pick<Execution, 'id' | 'workflowId'>,
    mode: string,
    error: { message: string; node?: string } | undefined,
    lastNodeExecuted: string | undefined,
    projectId: string,
  ): void {
    if (mode === 'error') return; // 错误流自身失败：不级联
    void (async () => {
      const row = await this.repos.workflows.findByIdUnscoped(failed.workflowId);
      const errorWorkflowId = (row?.settings as { errorWorkflow?: string } | null)?.errorWorkflow;
      if (!errorWorkflowId) return;
      // 错误流必须与失败流同项目（防跨项目越权触发）
      const targetProject = await this.repos.workflows.getOwnerProjectId(errorWorkflowId);
      if (!targetProject || targetProject !== projectId) {
        console.warn(`[nomops] errorWorkflow ${errorWorkflowId} 不在同一项目，跳过`);
        return;
      }
      const errorRow = await this.workflowService.productionRow(
        await this.workflowService.getById(errorWorkflowId, projectId),
      );
      const startNode = this.toWorkflow(errorRow).getStartNode();
      if (!startNode) return;

      const seed: INodeExecutionData[] = [
        {
          json: {
            workflow: { id: failed.workflowId, name: row?.name ?? '' },
            execution: { id: failed.id, mode },
            error: { message: error?.message ?? 'unknown error', node: error?.node ?? lastNodeExecuted ?? null },
          },
        },
      ];
      await this.runTriggered(errorWorkflowId, 'error', seed, startNode.name);
    })().catch((err: Error) => {
      console.error(`[nomops] 错误处理流派发失败 ${failed.workflowId}:`, err.message);
    });
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
    // staticData 取最新行（快照不含它；触发器游标/记忆要连续）
    const freshRow = await this.repos.workflows.findByIdUnscoped(stored.workflowId);
    const run = await this.runEngine(
      workflow,
      execution,
      projectId,
      stored.mode,
      (engine) => engine.processRunExecutionData(workflow, state),
      (freshRow?.staticData as JsonObject | null) ?? {},
    );
    // 生产执行的保存策略跟随已发布定义的 settings（与运行的版本一致）
    if (freshRow) {
      const prodRow = await this.workflowService.productionRow(freshRow);
      await this.applySavePolicy(executionId, prodRow.settings as IWorkflowSettings | null, stored.mode, run.status);
    }
    return run;
  }

  async list(projectId: string): Promise<Execution[]> {
    return this.repos.executions.findAllByProject(projectId);
  }

  /** 删除执行记录（含 execution_data；归属检查）。 */
  async delete(id: string, projectId: string): Promise<void> {
    const execution = await this.repos.executions.findById(id, projectId);
    if (!execution) throw new OperationalError('Execution record not found', { executionId: id, status: 404 });
    await this.repos.executions.delete(id);
  }

  /**
   * 重试（对标基线 executions 列表 Retry）：整个工作流重跑，产生新执行记录（mode 'retry'）。
   * useOriginal=true 用该执行的定义快照（original workflow）；false 用当前保存的草稿（currently saved）。
   * 与基线差异：基线从错误节点续跑，这里为全量重跑（部分续跑后续深化）。
   */
  async retry(executionId: string, projectId: string, useOriginal: boolean): Promise<IRunSummary> {
    const orig = await this.repos.executions.findById(executionId, projectId);
    if (!orig) throw new OperationalError('Execution record not found', { executionId, status: 404 });
    const row = await this.workflowService.getById(orig.workflowId, projectId);

    let name = row.name;
    let nodes = row.nodes;
    let connections = row.connections;
    if (useOriginal) {
      const snap = await this.repos.executions.getWorkflowData(executionId);
      if (!snap) throw new OperationalError('Execution workflow snapshot not found', { executionId, status: 404 });
      name = String(snap['name'] ?? row.name);
      nodes = snap['nodes'] as INode[];
      connections = snap['connections'] as IConnections;
    }
    const workflow = new Workflow({ id: row.id, name, nodes, connections });

    await this.quota.consume(projectId);
    const execution = await this.repos.executions.create(
      { workflowId: row.id, status: 'new', mode: 'retry', startedAt: new Date() },
      {
        workflowData: { name, nodes, connections } as unknown as JsonObject,
        data: { resultData: { runData: {} } } as unknown as JsonObject,
      },
    );
    const run = await this.runEngine(
      workflow,
      execution,
      projectId,
      'retry',
      (engine) => engine.run(workflow),
      (row.staticData as JsonObject | null) ?? {},
    );
    await this.applySavePolicy(execution.id, row.settings as IWorkflowSettings | null, 'retry', run.status);
    return this.toSummary(execution.id, run);
  }

  async getById(id: string, projectId: string): Promise<{ execution: Execution; data: JsonObject | null }> {
    const execution = await this.repos.executions.findById(id, projectId);
    if (!execution) throw new OperationalError('Execution record not found', { executionId: id, status: 404 });
    const data = await this.repos.executions.getData(id);
    return { execution, data };
  }

  /* ────────────── 内部 ────────────── */

  /**
   * DB 行 → 引擎 Workflow。pin 语义：钉住数据只影响手动调试，
   * 生产触发（webhook/cron/队列快照）与子工作流一律忽略 —— 由这里统一把关。
   */
  private toWorkflow(row: WorkflowRow, opts: { applyPinData?: boolean } = {}): Workflow {
    return new Workflow({
      id: row.id,
      name: row.name,
      nodes: row.nodes as INode[],
      connections: row.connections as IConnections,
      settings: (row.settings ?? undefined) as Workflow['settings'] | undefined,
      ...(opts.applyPinData && row.pinData ? { pinData: row.pinData } : {}),
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
    production: boolean,
  ): Promise<INodeExecutionData[]> {
    if (depth >= MAX_SUBWORKFLOW_DEPTH) {
      throw new OperationalError(`Sub-workflow nesting exceeds ${MAX_SUBWORKFLOW_DEPTH} levels (possible recursion)`, {
        workflowId,
      });
    }
    let row = await this.workflowService.getById(workflowId, projectId); // 跨项目 404
    if (production) row = await this.workflowService.productionRow(row); // 生产父执行 → 子流也跑已发布版
    const workflow = this.toWorkflow(row);
    const engine = new WorkflowExecute(this.nodeLoader, {
      additionalData: await this.buildAdditionalData(projectId, depth + 1, production),
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
  private async buildAdditionalData(projectId: string, depth = 0, production = false) {
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
        this.runSubWorkflow(workflowId, projectId, items, depth, production),
      ...(this.binaryStore ? { binaryStore: this.binaryStore } : {}),
    };
  }

  /**
   * 组装引擎（凭证注入 + WS hooks），执行并收尾落库。mode 用于失败时派发 errorWorkflow（防级联）。
   * staticData：执行期挂到引擎（触发器游标/AI 记忆等），结束后有变更则写回工作流行。
   */
  private async runEngine(
    workflow: Workflow,
    execution: Pick<Execution, 'id' | 'workflowId'>,
    projectId: string,
    mode: string,
    runFn: (engine: WorkflowExecute) => Promise<IRun>,
    staticData?: JsonObject,
  ): Promise<IRun> {
    const staticDataBefore = staticData ? JSON.stringify(staticData) : null;
    const push = (event: Parameters<PushHub['broadcast']>[0]) => this.pushHub.broadcast(event);
    push({
      type: 'executionStarted',
      executionId: execution.id,
      workflowId: execution.workflowId,
      timestamp: Date.now(),
    });

    const engine = new WorkflowExecute(this.nodeLoader, {
      additionalData: await this.buildAdditionalData(projectId, 0, mode !== 'manual'),
      ...(staticData ? { staticData } : {}),
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
      this.fireErrorWorkflow(execution, mode, { message: (error as Error).message }, undefined, projectId);
      throw error;
    }

    if (run.status === 'waiting') {
      // 挂起：完整状态落库（可序列化，铁律 4），记录唤醒时刻等 wait-tracker/resume API
      await this.repos.executions.updateData(execution.id, run.data as unknown as JsonObject);
      await this.repos.executions.setWaiting(
        execution.id,
        run.data.waitTill != null ? new Date(run.data.waitTill) : null,
      );
    } else {
      await this.repos.executions.updateStatus(execution.id, run.status, new Date());
      await this.repos.executions.updateData(execution.id, run.data as unknown as JsonObject);
      if (run.status === 'error') {
        const err = run.data.resultData.error;
        this.fireErrorWorkflow(
          execution,
          mode,
          err ? { message: err.message, ...(err.node ? { node: err.node } : {}) } : undefined,
          run.data.resultData.lastNodeExecuted,
          projectId,
        );
      }
    }
    // staticData 变更写回（触发器游标 / AI 记忆等跨执行状态）
    if (staticData && staticDataBefore !== JSON.stringify(staticData)) {
      await this.repos.workflows
        .update(execution.workflowId, { staticData })
        .catch((e: Error) => console.error(`[nomops] staticData 写回失败 ${execution.workflowId}:`, e.message));
    }

    // 运行统计累加（waiting 不算终态，唤醒续跑收尾时再计）
    if (run.status !== 'waiting') {
      this.repos.tags
        .bumpStatistics(execution.workflowId, mode, run.status === 'success')
        .catch((e: Error) => console.error(`[nomops] 统计累加失败 ${execution.workflowId}:`, e.message));
    }

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

  /**
   * 唤醒 waiting 执行（resume API / wait-tracker 到点触发共用）。
   * 队列模式入队交 worker 续跑；单进程当场续跑（executeStored 从落库状态恢复）。
   */
  async resume(executionId: string, projectId?: string): Promise<IRunSummary> {
    const record = projectId
      ? await this.repos.executions.findById(executionId, projectId)
      : await this.repos.executions.getRecord(executionId);
    if (!record) throw new OperationalError('Execution record not found', { executionId, status: 404 });
    if (record.status !== 'waiting') {
      throw new OperationalError(`Execution is not waiting (status: ${record.status})`, {
        executionId,
        status: 409,
      });
    }
    if (this.queue) {
      await this.repos.executions.updateStatus(executionId, 'new');
      await this.queue.enqueue({ executionId });
      return { executionId, status: 'queued' };
    }
    const run = await this.executeStored(executionId);
    return this.toSummary(executionId, run);
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
