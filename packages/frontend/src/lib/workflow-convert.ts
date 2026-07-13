import type { IConnections, INode } from '@nomops/workflow';

/**
 * 契约格式（INode/IConnections，按节点 name 连线）↔ Vue Flow 元素的纯转换。
 * VF 节点 id = INode.name（名称在图内唯一，连接表以 name 为键）。
 */

export interface FlowNode {
  id: string;
  type: 'nomops';
  position: { x: number; y: number };
  data: { node: INode };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string; // out-<outputIndex>
  targetHandle: string; // in-<inputIndex>
}

export function toFlowNodes(nodes: INode[]): FlowNode[] {
  return nodes.map((node) => ({
    id: node.name,
    type: 'nomops',
    position: { x: node.position[0], y: node.position[1] },
    data: { node },
  }));
}

export function toFlowEdges(connections: IConnections): FlowEdge[] {
  const edges: FlowEdge[] = [];
  for (const [source, byType] of Object.entries(connections)) {
    (byType['main'] ?? []).forEach((endpoints, outputIndex) => {
      for (const ep of endpoints ?? []) {
        edges.push({
          id: `${source}:${outputIndex}->${ep.node}:${ep.index}`,
          source,
          target: ep.node,
          sourceHandle: `out-${outputIndex}`,
          targetHandle: `in-${ep.index}`,
        });
      }
    });
  }
  return edges;
}

/** 解析 handle id（"out-1" → 1）。缺省端口按 0。 */
export function handleIndex(handleId: string | null | undefined): number {
  const match = /-(\d+)$/.exec(handleId ?? '');
  return match ? Number(match[1]) : 0;
}

/**
 * 深克隆连接表。注意不能用 structuredClone：入参可能是 Vue reactive Proxy，
 * structuredClone 对 Proxy 抛 DataCloneError。IConnections 是纯 JSON，走 JSON 往返即可。
 */
function cloneConnections(connections: IConnections): IConnections {
  return JSON.parse(JSON.stringify(connections)) as IConnections;
}

/** 往连接表加一条边（幂等：同一条连接不重复）。返回新对象，不改入参。 */
export function addConnection(
  connections: IConnections,
  args: { source: string; sourceIndex: number; target: string; targetIndex: number },
): IConnections {
  const next = cloneConnections(connections);
  const byType = (next[args.source] ??= {});
  const outputs = (byType['main'] ??= []);
  while (outputs.length <= args.sourceIndex) outputs.push(null);
  const endpoints = (outputs[args.sourceIndex] ??= []);
  const exists = endpoints.some((ep) => ep.node === args.target && ep.index === args.targetIndex);
  if (!exists) {
    endpoints.push({ node: args.target, type: 'main', index: args.targetIndex });
  }
  return next;
}

/** 删除一条边。 */
export function removeConnection(
  connections: IConnections,
  args: { source: string; sourceIndex: number; target: string; targetIndex: number },
): IConnections {
  const next = cloneConnections(connections);
  const endpoints = next[args.source]?.['main']?.[args.sourceIndex];
  if (!endpoints) return next;
  const filtered = endpoints.filter(
    (ep) => !(ep.node === args.target && ep.index === args.targetIndex),
  );
  next[args.source]!['main']![args.sourceIndex] = filtered.length > 0 ? filtered : null;
  return next;
}

/** 删除节点：连带清掉它作为源/目标的全部连接。 */
export function removeNodeFromConnections(connections: IConnections, nodeName: string): IConnections {
  const next: IConnections = {};
  for (const [source, byType] of Object.entries(connections)) {
    if (source === nodeName) continue;
    const main = (byType['main'] ?? []).map((endpoints) => {
      const filtered = (endpoints ?? []).filter((ep) => ep.node !== nodeName);
      return filtered.length > 0 ? filtered : null;
    });
    // 全空的源不保留
    if (main.some((e) => e !== null)) next[source] = { main };
  }
  return next;
}

/** 生成不冲突的节点名："Set" → "Set 2" → "Set 3"…（对齐 defaults.name）。 */
export function uniqueNodeName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}
