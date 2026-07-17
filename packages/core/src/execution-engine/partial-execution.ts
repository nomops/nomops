import type {
  IExecuteData,
  INodeExecutionData,
  IRunData,
  IRunExecutionData,
  ITaskDataConnections,
  ITaskDataConnectionsSource,
  Workflow,
} from '@nomops/workflow';
import { OperationalError, createRunExecutionData } from '@nomops/workflow';
import type { INode } from '@nomops/workflow';

/**
 * 部分执行（partial execution 概念，自有实现）：
 * 编辑后重跑到 destinationNode 时，复用上次运行里「干净」上游节点的输出，
 * 只重新执行「脏」子图 —— 省时间、省 API 调用。
 *
 * 脏的传染规则（保证数据一致性）：
 *   脏 = 显式标脏（编辑过） ∪ 上次没跑过 ∪ 任一父节点是脏的（向下游传染闭包）。
 * destinationNode 恒为脏（用户点谁跑谁）。
 * 纯计算：只依赖 Workflow 图 + 上次 runData，产出可直接交给引擎的 IRunExecutionData。
 */

/** 上次运行里某节点最近一次的各输出端口 items（无数据视为没跑过）。 */
function lastOutputOf(runData: IRunData, nodeName: string): Array<INodeExecutionData[] | null> | undefined {
  const runs = runData[nodeName];
  const last = runs?.[runs.length - 1];
  if (!last?.data) return undefined;
  return last.data['main'] ?? undefined;
}

/**
 * 对比两版节点定义，找出「定义变了」的节点（参数/类型/版本/禁用/凭证/入向连接）。
 * 新增节点与上一版不存在的节点都算脏。连接变化会改变输入形状，因此目标节点也算脏。
 */
export function computeDirtyNodes(
  previous: { nodes: INode[]; incomingSignature: (name: string) => string },
  current: { nodes: INode[]; incomingSignature: (name: string) => string },
): Set<string> {
  const dirty = new Set<string>();
  const prevByName = new Map(previous.nodes.map((n) => [n.name, n]));

  for (const node of current.nodes) {
    const prev = prevByName.get(node.name);
    if (!prev) {
      dirty.add(node.name);
      continue;
    }
    const changed =
      prev.type !== node.type ||
      prev.typeVersion !== node.typeVersion ||
      Boolean(prev.disabled) !== Boolean(node.disabled) ||
      JSON.stringify(prev.parameters) !== JSON.stringify(node.parameters) ||
      JSON.stringify(prev.credentials ?? null) !== JSON.stringify(node.credentials ?? null) ||
      previous.incomingSignature(node.name) !== current.incomingSignature(node.name);
    if (changed) dirty.add(node.name);
  }
  return dirty;
}

/** Workflow 的入向连接签名（用于 computeDirtyNodes 的连接变化对比）。 */
export function incomingSignatureOf(workflow: Workflow): (name: string) => string {
  return (name) =>
    JSON.stringify(
      workflow
        .getIncomingConnections(name)
        .map((c) => [c.sourceNode, c.sourceOutput, c.destinationInput])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
}

/**
 * 构造部分执行的初始状态：
 * 1. 需求集 = destination 的祖先 ∪ destination（runNodeFilter 沿用现有机制）；
 * 2. 脏闭包 = 显式脏/没跑过 向下游传染；destination 恒脏；
 * 3. 干净节点的上次 runData 原样预置（带 reused 语义：不再执行）；
 * 4. 就绪栈/等待表按「脏前沿」播种：脏节点的干净父输出直接喂进去。
 */
export function buildPartialRunState(
  workflow: Workflow,
  previousRunData: IRunData,
  destinationNode: string,
  explicitDirty: Iterable<string> = [],
): IRunExecutionData {
  workflow.getNode(destinationNode); // 不存在则抛错

  const required = workflow.getAncestors(destinationNode);
  required.add(destinationNode);

  // 起始脏集：显式脏 + 需求集内上次没跑过的节点 + destination 本身
  const dirty = new Set<string>();
  for (const name of explicitDirty) if (required.has(name)) dirty.add(name);
  for (const name of required) {
    if (lastOutputOf(previousRunData, name) === undefined && !workflow.getNode(name).disabled) {
      dirty.add(name);
    }
  }
  dirty.add(destinationNode);

  // 向下游传染至闭包（在需求集内做 BFS）
  const queue = [...dirty];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const child of workflow.getChildNodes(cur)) {
      if (required.has(child) && !dirty.has(child)) {
        dirty.add(child);
        queue.push(child);
      }
    }
  }

  const state = createRunExecutionData();
  state.startData = { destinationNode, runNodeFilter: [...required] };

  // 干净节点：预置上次 runData（引擎不会再执行它们——不在栈上）
  for (const name of required) {
    if (dirty.has(name)) continue;
    const runs = previousRunData[name];
    if (runs) state.resultData.runData[name] = structuredClone(runs);
  }

  // 播种脏前沿：脏节点的每条「来自干净父」的入向连接，把干净父的输出喂进等待表/栈
  const executionData = state.executionData!;
  for (const name of dirty) {
    if (!required.has(name)) continue;
    const incoming = workflow.getIncomingConnections(name);
    if (incoming.length === 0) {
      // 图起点（且脏）：以空种子重跑
      executionData.nodeExecutionStack.push({
        node: workflow.getNode(name),
        data: { main: [[{ json: {} }]] },
        source: null,
      });
      continue;
    }

    const cleanFeeds = incoming.filter((c) => !dirty.has(c.sourceNode) && required.has(c.sourceNode));
    if (cleanFeeds.length === 0) continue; // 全部父都脏：等它们跑完自然路由过来

    const connectedInputs = workflow.getConnectedInputIndexes(name);
    const data: ITaskDataConnections = { main: [] };
    const source: ITaskDataConnectionsSource = { main: [] };
    for (const feed of cleanFeeds) {
      const ports = lastOutputOf(previousRunData, feed.sourceNode);
      const items = ports?.[feed.sourceOutput] ?? [];
      data['main']![feed.destinationInput] = structuredClone(items);
      source['main']![feed.destinationInput] = {
        previousNode: feed.sourceNode,
        previousNodeOutput: feed.sourceOutput,
      };
    }

    const allInputsSeeded = connectedInputs.every((i) => data['main']![i] != null);
    if (allInputsSeeded) {
      executionData.nodeExecutionStack.push({
        node: workflow.getNode(name),
        data,
        source,
      } satisfies IExecuteData);
    } else {
      // 部分输入来自脏父：干净部分先挂等待表，脏父执行后由正常路由补齐
      executionData.waitingExecution[name] = { 0: data };
      executionData.waitingExecutionSource[name] = { 0: source };
    }
  }

  if (executionData.nodeExecutionStack.length === 0 && Object.keys(executionData.waitingExecution).length === 0) {
    throw new OperationalError('部分执行无可运行的起点（前置数据不足），请做一次完整运行', {
      node: destinationNode,
    });
  }

  return state;
}
