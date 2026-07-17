import type { IConnections, INode } from '@nomops/workflow';

/**
 * 契约格式（INode/IConnections，按节点 name 连线）↔ Vue Flow 元素的纯转换。
 * VF 节点 id = INode.name（名称在图内唯一，连接表以 name 为键）。
 * 连接类型：main = 数据流；ai_*（ai_languageModel/ai_tool/ai_memory）= 能力流，
 * 画布上渲染为「子节点在下、虚线上挂宿主」的形态。
 * handle id 编码：in|out-<connType>-<index>（如 in-main-0 / out-ai_tool-0）。
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
  sourceHandle: string; // out-<type>-<outputIndex>
  targetHandle: string; // in-<type>-<inputIndex>
  class?: string;
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
    for (const [connType, outputs] of Object.entries(byType)) {
      (outputs ?? []).forEach((endpoints, outputIndex) => {
        for (const ep of endpoints ?? []) {
          edges.push({
            id: `${source}:${connType}:${outputIndex}->${ep.node}:${ep.index}`,
            source,
            target: ep.node,
            sourceHandle: `out-${connType}-${outputIndex}`,
            targetHandle: `in-${connType}-${ep.index}`,
            ...(connType !== 'main' ? { class: 'edge-ai' } : {}),
          });
        }
      });
    }
  }
  return edges;
}

export interface IParsedHandle {
  type: string;
  index: number;
}

/** 解析 handle id："out-ai_tool-0" → {type:'ai_tool', index:0}。兼容旧格式 "out-1"（视为 main）。 */
export function parseHandle(handleId: string | null | undefined): IParsedHandle {
  const match = /^(?:in|out)-(.+)-(\d+)$/.exec(handleId ?? '');
  if (match) return { type: match[1]!, index: Number(match[2]) };
  const legacy = /-(\d+)$/.exec(handleId ?? '');
  return { type: 'main', index: legacy ? Number(legacy[1]) : 0 };
}

/** @deprecated 用 parseHandle；保留给旧调用点。 */
export function handleIndex(handleId: string | null | undefined): number {
  return parseHandle(handleId).index;
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
  args: { source: string; sourceIndex: number; target: string; targetIndex: number; type?: string },
): IConnections {
  const connType = args.type ?? 'main';
  const next = cloneConnections(connections);
  const byType = (next[args.source] ??= {});
  const outputs = (byType[connType] ??= []);
  while (outputs.length <= args.sourceIndex) outputs.push(null);
  const endpoints = (outputs[args.sourceIndex] ??= []);
  const exists = endpoints.some((ep) => ep.node === args.target && ep.index === args.targetIndex);
  if (!exists) {
    endpoints.push({ node: args.target, type: connType, index: args.targetIndex });
  }
  return next;
}

/** 删除一条边。 */
export function removeConnection(
  connections: IConnections,
  args: { source: string; sourceIndex: number; target: string; targetIndex: number; type?: string },
): IConnections {
  const connType = args.type ?? 'main';
  const next = cloneConnections(connections);
  const endpoints = next[args.source]?.[connType]?.[args.sourceIndex];
  if (!endpoints) return next;
  const filtered = endpoints.filter(
    (ep) => !(ep.node === args.target && ep.index === args.targetIndex),
  );
  next[args.source]![connType]![args.sourceIndex] = filtered.length > 0 ? filtered : null;
  return next;
}

/** 删除节点：连带清掉它作为源/目标的全部连接（所有连接类型）。 */
export function removeNodeFromConnections(connections: IConnections, nodeName: string): IConnections {
  const next: IConnections = {};
  for (const [source, byType] of Object.entries(connections)) {
    if (source === nodeName) continue;
    const kept: IConnections[string] = {};
    for (const [connType, outputs] of Object.entries(byType)) {
      const filteredOutputs = (outputs ?? []).map((endpoints) => {
        const filtered = (endpoints ?? []).filter((ep) => ep.node !== nodeName);
        return filtered.length > 0 ? filtered : null;
      });
      if (filteredOutputs.some((e) => e !== null)) kept[connType] = filteredOutputs;
    }
    if (Object.keys(kept).length > 0) next[source] = kept;
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
