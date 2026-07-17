import type { INode, INodeExecutionData, JsonObject } from './interfaces.js';

/**
 * 执行状态契约（docs/02-DATA-MODEL.md 第四节）。
 * ★铁律 4：IRunExecutionData 及其所有字段必须 JSON.stringify 安全——
 * 不放函数、类实例、循环引用。引擎用显式栈而非递归正是为了这一点。
 */

/** 按端口组织的任务数据：key = 连接类型（主数据流 'main'），值 = 各输入/输出端口的 items。 */
export interface ITaskDataConnections {
  [connectionType: string]: Array<INodeExecutionData[] | null>;
}

/** 数据来源：每个输入端口来自哪个上游节点的哪个输出端口。 */
export interface ISourceData {
  previousNode: string;
  previousNodeOutput?: number;
  previousNodeRun?: number;
}

export interface ITaskDataConnectionsSource {
  [connectionType: string]: Array<ISourceData | null>;
}

/** 一个待执行的节点单元（就绪栈的元素）。 */
export interface IExecuteData {
  node: INode;
  data: ITaskDataConnections;
  source: ITaskDataConnectionsSource | null;
  /** true = 本帧是从 waiting 恢复的续跑（节点用 ctx.isResumed() 感知）。 */
  resumed?: boolean;
}

/** 可序列化的执行错误快照（不是 Error 实例）。 */
export interface IExecutionError {
  message: string;
  name?: string;
  node?: string;
  itemIndex?: number;
  parameter?: string;
  stack?: string;
  context?: JsonObject;
}

/** 每个节点每次运行的记录。 */
export interface ITaskData {
  startTime: number;
  executionTime: number;
  data?: ITaskDataConnections;
  error?: IExecutionError;
  source: Array<ISourceData | null>;
  /** true = 本次「运行」用的是钉住数据，节点并未真正执行。 */
  pinned?: boolean;
}

/** 每个节点的执行结果列表（循环里同一节点可多次运行）。 */
export interface IRunData {
  [nodeName: string]: ITaskData[];
}

/** 多输入节点（如 Merge）的等待表：nodeName → runIndex → 按端口攒的数据。 */
export interface IWaitingForExecution {
  [nodeName: string]: {
    [runIndex: number]: ITaskDataConnections;
  };
}

export interface IWaitingForExecutionSource {
  [nodeName: string]: {
    [runIndex: number]: ITaskDataConnectionsSource;
  };
}

/** ★引擎的完整状态——一切都在这里，可整体序列化（暂停/恢复/入队的前提）。 */
export interface IRunExecutionData {
  startData?: {
    destinationNode?: string;
    runNodeFilter?: string[];
  };
  resultData: {
    runData: IRunData;
    lastNodeExecuted?: string;
    error?: IExecutionError;
  };
  executionData?: {
    nodeExecutionStack: IExecuteData[];
    waitingExecution: IWaitingForExecution;
    waitingExecutionSource: IWaitingForExecutionSource;
  };
  /** waiting 状态的唤醒时刻（epoch 毫秒）；null/undefined = 等外部信号。 */
  waitTill?: number | null;
  resumeToken?: string;
}

export type ExecutionStatus = 'new' | 'running' | 'success' | 'error' | 'canceled' | 'waiting';

/** 一次执行的最终产出。 */
export interface IRun {
  data: IRunExecutionData;
  status: ExecutionStatus;
  startedAt: number;
  stoppedAt?: number;
}

/** 空白执行状态工厂。 */
export function createRunExecutionData(): IRunExecutionData {
  return {
    resultData: { runData: {} },
    executionData: {
      nodeExecutionStack: [],
      waitingExecution: {},
      waitingExecutionSource: {},
    },
  };
}

/** 把任意抛出的错误转成可序列化快照。 */
export function toExecutionError(
  error: unknown,
  extra: Partial<IExecutionError> = {},
): IExecutionError {
  if (error instanceof Error) {
    const context = (error as { context?: JsonObject }).context;
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
      ...(context ? { context } : {}),
      ...extra,
    };
  }
  return { message: String(error), ...extra };
}
