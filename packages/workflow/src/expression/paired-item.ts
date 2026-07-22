import type { IRunData } from '../execution-interfaces.js';
import type { INodeExecutionData } from '../interfaces.js';

/**
 * pairedItem 跨节点血缘解析（backlog #21）。
 *
 * 数据事实：
 * - 每个节点输出 item 的 `pairedItem` 指向**本节点输入 items** 的索引;
 * - 每次运行的 `source.main[port]` 记录该输入端口来自哪个节点（previousNode）。
 * 由此可从「某节点输出的第 i 个 item」一路回溯到任意祖先节点的具体 item——
 * 这是表达式 `$('X').item`（按血缘取对应 item,而非永远第一个）的地基。
 *
 * v1 边界（诚实声明）：沿输入端口 0 的来源回溯;pairedItem 为数组时取第一个
 * （多对一合并的血缘天然多义）;断链（无 pairedItem/无 source）即停。
 */

export interface ILineageStep {
  node: string;
  /** 该节点输出里对应的 item 索引。 */
  itemIndex: number;
}

/** pairedItem 三种形态归一为输入索引;无法解析 → null。 */
function pairedIndexOf(item: INodeExecutionData | undefined): number | null {
  const paired = item?.pairedItem;
  if (paired === undefined || paired === null) return null;
  if (typeof paired === 'number') return paired;
  if (Array.isArray(paired)) {
    const first = paired[0];
    return first && typeof first === 'object' && typeof first.item === 'number' ? first.item : null;
  }
  return typeof paired.item === 'number' ? paired.item : null;
}

/** 某节点最近一次运行的主输出端口 0 items。 */
function lastOutputItems(runData: IRunData, node: string): INodeExecutionData[] {
  const runs = runData[node];
  return runs?.[runs.length - 1]?.data?.['main']?.[0] ?? [];
}

/** 某节点最近一次运行的输入端口 0 来源节点名（ITaskData.source 是 main 端口序的扁平数组）。 */
function sourceNodeOf(runData: IRunData, node: string): string | null {
  const runs = runData[node];
  const src = runs?.[runs.length - 1]?.source?.[0];
  return src?.previousNode ?? null;
}

/**
 * 从「fromNode 输出的第 itemIndex 个 item」回溯血缘链（含起点,不含环:上限 64 步）。
 * 返回沿途每个节点的 {node, itemIndex}。
 */
export function traceLineage(runData: IRunData, fromNode: string, itemIndex: number): ILineageStep[] {
  const chain: ILineageStep[] = [];
  let node: string | null = fromNode;
  let idx = itemIndex;
  for (let hops = 0; node && hops < 64; hops++) {
    chain.push({ node, itemIndex: idx });
    const outItem = lastOutputItems(runData, node)[idx];
    const inputIdx = pairedIndexOf(outItem);
    const parent = sourceNodeOf(runData, node);
    if (inputIdx === null || !parent) break; // 断链（触发器起点/未标 pairedItem）
    node = parent;
    idx = inputIdx; // 父节点输出 items 与本节点输入 items 同序（引擎直通路由）
  }
  return chain;
}

/**
 * 血缘定位：当前 item（= prevNode 输出的第 itemIndex 个）对应祖先 targetNode 里的哪个 item。
 * 命中返回该 item;血缘走不到 targetNode（断链/不在链上）→ null,由调用方决定回退语义。
 */
export function itemInAncestor(
  runData: IRunData,
  prevNode: string,
  itemIndex: number,
  targetNode: string,
): INodeExecutionData | null {
  for (const step of traceLineage(runData, prevNode, itemIndex)) {
    if (step.node === targetNode) {
      return lastOutputItems(runData, targetNode)[step.itemIndex] ?? null;
    }
  }
  return null;
}
