import type {
  IExecuteData,
  INode,
  INodeExecutionData,
  IRun,
  IRunExecutionData,
  ITaskData,
  ITaskDataConnections,
  ITaskDataConnectionsSource,
  JsonObject,
  Workflow,
} from '@nomops/workflow';
import {
  ExecutionPause,
  OperationalError,
  createRunExecutionData,
  toExecutionError,
} from '@nomops/workflow';
import type { INodeLoader } from '../nodes-loader/node-loader.js';
import type { IWorkflowExecuteAdditionalData } from './node-execution-context.js';
import { createExecuteContext } from './node-execution-context.js';
import { executeRoutingNode, hasRoutingDeclarations } from './routing-executor.js';

/** 引擎 hooks：server 层挂 WS 推送/落库；引擎只调，不知其用途。 */
export interface IExecutionHooks {
  nodeExecuteBefore?: (nodeName: string) => void | Promise<void>;
  nodeExecuteAfter?: (nodeName: string, data: ITaskData) => void | Promise<void>;
}

export interface IWorkflowExecuteOptions {
  additionalData?: IWorkflowExecuteAdditionalData;
  hooks?: IExecutionHooks;
  /** 工作流 staticData（触发器持久状态）。引擎读写内存对象，持久化由 server 负责。 */
  staticData?: JsonObject;
}

/** 环保护上限：单节点最大运行次数（防失控循环把进程跑死）。 */
const MAX_NODE_RUNS = 1000;

/**
 * 触发器产物注入（通用机制，非节点特判）：把 node 记为「已执行、输出=output」，
 * 并将其下游按连接扩散入栈/等待表。真实触发（webhook/cron）用它起跑——
 * 触发器节点的 execute() 只服务手动调试，真实触发时数据由外部事件给定。
 */
export function seedTriggerOutput(
  workflow: Workflow,
  state: IRunExecutionData,
  node: INode,
  output: INodeExecutionData[][],
): void {
  state.resultData.runData[node.name] = [
    {
      startTime: Date.now(),
      executionTime: 0,
      source: [],
      data: { main: output.map((port) => port ?? null) },
    },
  ];
  state.resultData.lastNodeExecuted = node.name;
  routeNodeOutput(workflow, state, node, output);
}

/** 输出扩散：单输入子节点直接压栈；多输入子节点进等待表，齐了才转栈。 */
export function routeNodeOutput(
  workflow: Workflow,
  state: IRunExecutionData,
  node: INode,
  output: INodeExecutionData[][] | null,
): void {
  if (!output) return;
  const executionData = state.executionData!;
  const byType = workflow.connectionsBySource[node.name]?.['main'] ?? [];

  byType.forEach((endpoints, outputIndex) => {
    if (!endpoints) return;
    const items = output[outputIndex] ?? [];
    // 空输出端口不触发下游（IF 未命中的分支）
    if (items.length === 0) return;

    for (const ep of endpoints) {
      const child = workflow.getNode(ep.node);
      const connectedInputs = workflow.getConnectedInputIndexes(ep.node);
      const sourceData = {
        previousNode: node.name,
        previousNodeOutput: outputIndex,
      };

      if (connectedInputs.length <= 1) {
        const data: ITaskDataConnections = { main: [] };
        data['main']![ep.index] = items;
        const source: ITaskDataConnectionsSource = { main: [] };
        source['main']![ep.index] = sourceData;
        executionData.nodeExecutionStack.push({ node: child, data, source });
        continue;
      }

      // 多输入：按 runIndex 攒，找到该端口还空着的最小 runIndex
      const waiting = (executionData.waitingExecution[ep.node] ??= {});
      const waitingSource = (executionData.waitingExecutionSource[ep.node] ??= {});
      let runIndex = 0;
      while (waiting[runIndex]?.['main']?.[ep.index] != null) runIndex++;
      const slot = (waiting[runIndex] ??= { main: [] });
      const slotSource = (waitingSource[runIndex] ??= { main: [] });
      slot['main']![ep.index] = items;
      slotSource['main']![ep.index] = sourceData;

      // 全部已连输入端口到齐 → 转入就绪栈
      const complete = connectedInputs.every((i) => slot['main']?.[i] != null);
      if (complete) {
        executionData.nodeExecutionStack.push({
          node: child,
          data: slot,
          source: slotSource,
        });
        delete waiting[runIndex];
        delete waitingSource[runIndex];
        if (Object.keys(waiting).length === 0) delete executionData.waitingExecution[ep.node];
        if (Object.keys(waitingSource).length === 0)
          delete executionData.waitingExecutionSource[ep.node];
      }
    }
  });
}

/**
 * ★引擎心脏：栈驱动调度（docs/02 第四节伪代码的实现）。
 *
 * 不用递归——全部状态在 IRunExecutionData 里，可整体 JSON 序列化，
 * 因此支持：中途取消、序列化后在另一进程 resume（队列模式的前提）。
 * 纯计算：不碰 HTTP 层、不碰 DB。
 */
export class WorkflowExecute {
  private canceled = false;

  constructor(
    private readonly nodeLoader: INodeLoader,
    private readonly options: IWorkflowExecuteOptions = {},
  ) {}

  /** 请求取消：主循环在下一个节点边界停下，剩余状态保留在 executionData 里。 */
  cancel(): void {
    this.canceled = true;
  }

  /** 从头跑。startNode 缺省取图的起点；destinationNode 给定时只跑其祖先集合（部分执行）。 */
  async run(
    workflow: Workflow,
    startNode?: INode,
    destinationNode?: string,
    seedData?: INodeExecutionData[],
  ): Promise<IRun> {
    const start = startNode ?? workflow.getStartNode();
    if (!start) {
      throw new OperationalError('工作流没有可用的起点节点（无入向连接且未禁用）');
    }

    const state = createRunExecutionData();
    if (destinationNode) {
      const filter = workflow.getAncestors(destinationNode);
      filter.add(destinationNode);
      state.startData = { destinationNode, runNodeFilter: [...filter] };
    }
    state.executionData!.nodeExecutionStack.push({
      node: start,
      data: { main: [seedData ?? [{ json: {} }]] },
      source: null,
    });

    return this.processRunExecutionData(workflow, state);
  }

  /** 从已有状态继续跑（恢复/队列 worker 用）。状态可来自 JSON.parse。 */
  async processRunExecutionData(workflow: Workflow, state: IRunExecutionData): Promise<IRun> {
    const startedAt = Date.now();
    const executionData = state.executionData;
    if (!executionData) {
      throw new OperationalError('IRunExecutionData 缺少 executionData，无法执行');
    }
    const stack = executionData.nodeExecutionStack;
    const filter = state.startData?.runNodeFilter;
    state.waitTill = undefined; // 本轮起跑即清除旧的等待时刻（完成/再次挂起时重置）

    let status: IRun['status'] = 'success';

    while (stack.length > 0) {
      if (this.canceled) {
        status = 'canceled';
        break;
      }

      const exec = stack.pop()!;
      const node = exec.node;

      // 部分执行：不在白名单内的节点跳过（不执行也不扩散）
      if (filter && !filter.includes(node.name)) continue;

      // 禁用节点：input 0 直通到 output 0
      if (node.disabled) {
        this.routeOutput(workflow, state, node, [exec.data['main']?.[0] ?? []]);
        continue;
      }

      // 钉住数据：直接采用冻结输出，不执行节点（Workflow 是否携带 pin 由调用方决定）
      const pinned = workflow.getPinData(node.name);
      if (pinned !== undefined) {
        await this.options.hooks?.nodeExecuteBefore?.(node.name);
        const pinnedTask: ITaskData = {
          startTime: Date.now(),
          executionTime: 0,
          data: this.toConnections([pinned]),
          source: exec.source?.['main'] ?? [],
          pinned: true,
        };
        state.resultData.runData[node.name] ??= [];
        state.resultData.runData[node.name]!.push(pinnedTask);
        state.resultData.lastNodeExecuted = node.name;
        await this.options.hooks?.nodeExecuteAfter?.(node.name, pinnedTask);
        if (state.startData?.destinationNode === node.name) continue;
        this.routeOutput(workflow, state, node, [pinned]);
        continue;
      }

      const runs = state.resultData.runData[node.name]?.length ?? 0;
      if (runs >= MAX_NODE_RUNS) {
        state.resultData.error = toExecutionError(
          new OperationalError(`节点 ${node.name} 运行超过 ${MAX_NODE_RUNS} 次，疑似死循环`),
          { node: node.name },
        );
        status = 'error';
        break;
      }

      await this.options.hooks?.nodeExecuteBefore?.(node.name);
      const startTime = Date.now();

      let output: INodeExecutionData[][] | null = null;
      let taskData: ITaskData;
      try {
        output = await this.runNode(workflow, state, exec);
        taskData = {
          startTime,
          executionTime: Date.now() - startTime,
          data: this.toConnections(output),
          source: exec.source?.['main'] ?? [],
        };
      } catch (error) {
        // 暂停信号（控制流）：当前帧带 resumed 标记压回栈，状态整体可序列化落库等唤醒
        if (error instanceof ExecutionPause) {
          stack.push({ ...exec, resumed: true });
          state.waitTill = error.waitTill ?? null;
          state.resultData.lastNodeExecuted = node.name;
          status = 'waiting';
          break;
        }
        const execError = toExecutionError(error, { node: node.name });
        taskData = {
          startTime,
          executionTime: Date.now() - startTime,
          error: execError,
          source: exec.source?.['main'] ?? [],
        };
        if (node.continueOnError) {
          // 错误 item 从「错误输出端口」（索引 = 声明输出数）放出去继续
          const description = await this.nodeLoader
            .getByNameAndVersion(node.type, node.typeVersion)
            .then((n) => n.description);
          const errorPortIndex = description.outputs.length;
          const errorItems: INodeExecutionData[] = [
            { json: { error: execError.message }, pairedItem: { item: 0 } },
          ];
          output = [];
          for (let i = 0; i < errorPortIndex; i++) output.push([]);
          output.push(errorItems);
          taskData.data = this.toConnections(output); // 错误已记录在 taskData.error，继续执行
        } else {
          state.resultData.runData[node.name] ??= [];
          state.resultData.runData[node.name]!.push(taskData);
          state.resultData.lastNodeExecuted = node.name;
          state.resultData.error = execError;
          await this.options.hooks?.nodeExecuteAfter?.(node.name, taskData);
          status = 'error';
          break;
        }
      }

      this.assignPairedItems(exec.data['main']?.[0] ?? [], output);

      state.resultData.runData[node.name] ??= [];
      state.resultData.runData[node.name]!.push(taskData);
      state.resultData.lastNodeExecuted = node.name;
      await this.options.hooks?.nodeExecuteAfter?.(node.name, taskData);

      // 到达 destinationNode 即停（其结果已记录）
      if (state.startData?.destinationNode === node.name) continue;

      this.routeOutput(workflow, state, node, output);
    }

    if (status === 'error') {
      // 终止：清空就绪栈（等待表保留以供诊断）
      stack.length = 0;
    }

    return { data: state, status, startedAt, stoppedAt: Date.now() };
  }

  /* ── 执行单个节点 ── */
  private async runNode(
    workflow: Workflow,
    state: IRunExecutionData,
    exec: IExecuteData,
  ): Promise<INodeExecutionData[][]> {
    const node = exec.node;
    const nodeType = await this.nodeLoader.getByNameAndVersion(node.type, node.typeVersion);
    const declarative = !nodeType.execute && hasRoutingDeclarations(nodeType.description);
    if (!nodeType.execute && !declarative) {
      throw new OperationalError(`节点 ${node.name}（${node.type}）没有 execute 实现`, {
        node: node.name,
      });
    }
    const context = createExecuteContext({
      workflow,
      node,
      inputData: exec.data,
      runData: state.resultData.runData,
      staticData: this.options.staticData ?? {},
      additionalData: this.options.additionalData ?? {},
      resumed: exec.resumed === true,
      resolver: this.nodeLoader, // 能力子节点（ai_*）解析
    });
    // 声明式节点：无 execute，按 description 的 routing 声明拼请求
    if (declarative) {
      return executeRoutingNode(
        context as Parameters<typeof executeRoutingNode>[0],
        nodeType.description,
      );
    }
    return nodeType.execute!.call(context);
  }

  /* ── 输出扩散（实现在模块级 routeNodeOutput，触发种子注入复用同一逻辑） ── */
  private routeOutput(
    workflow: Workflow,
    state: IRunExecutionData,
    node: INode,
    output: INodeExecutionData[][] | null,
  ): void {
    routeNodeOutput(workflow, state, node, output);
  }

  /* ── pairedItem 溯源：节点没写时，输入输出等长则按索引补齐 ── */
  private assignPairedItems(
    input: INodeExecutionData[],
    output: INodeExecutionData[][] | null,
  ): void {
    if (!output) return;
    for (const port of output) {
      if (port.length !== input.length) continue;
      port.forEach((item, i) => {
        if (item.pairedItem === undefined) item.pairedItem = { item: i };
      });
    }
  }

  private toConnections(output: INodeExecutionData[][]): ITaskDataConnections {
    return { main: output.map((port) => port ?? null) };
  }
}
