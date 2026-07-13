import type { IConnections, INode, IWorkflowSettings } from './interfaces.js';
import { OperationalError } from './errors.js';

export interface IWorkflowInit {
  id?: string;
  name?: string;
  nodes: INode[];
  connections: IConnections;
  settings?: IWorkflowSettings;
  active?: boolean;
}

/** 一条入向连接：某节点的某输入端口，接的是哪个上游节点的哪个输出端口。 */
export interface IIncomingConnection {
  sourceNode: string;
  sourceOutput: number;
  destinationInput: number;
  type: string;
}

/**
 * Workflow 类：图结构 + 父/子节点查询（Layer 1，纯计算）。
 * 连接表以「源节点 → 目标」存储；本类在构造时同时建立反向索引（目标 → 源），
 * 供引擎做「输入是否到齐」「找起点」「destinationNode 的祖先集合」等查询。
 */
export class Workflow {
  readonly id?: string;
  readonly name?: string;
  readonly nodes = new Map<string, INode>();
  readonly connectionsBySource: IConnections;
  readonly settings: IWorkflowSettings;

  /** 反向索引：destNodeName → connectionType → 入向连接列表。 */
  private readonly incoming = new Map<string, Map<string, IIncomingConnection[]>>();

  constructor(init: IWorkflowInit) {
    this.id = init.id;
    this.name = init.name;
    this.connectionsBySource = init.connections;
    this.settings = init.settings ?? {};

    for (const node of init.nodes) {
      if (this.nodes.has(node.name)) {
        throw new OperationalError(`节点名重复: ${node.name}`, { node: node.name });
      }
      this.nodes.set(node.name, node);
    }

    // 校验连接引用 + 建反向索引
    for (const [sourceName, byType] of Object.entries(init.connections)) {
      if (!this.nodes.has(sourceName)) {
        throw new OperationalError(`连接引用了不存在的源节点: ${sourceName}`, { node: sourceName });
      }
      for (const [type, outputs] of Object.entries(byType)) {
        outputs.forEach((endpoints, sourceOutput) => {
          if (!endpoints) return;
          for (const ep of endpoints) {
            if (!this.nodes.has(ep.node)) {
              throw new OperationalError(
                `连接引用了不存在的目标节点: ${sourceName} → ${ep.node}`,
                { node: ep.node },
              );
            }
            let byDestType = this.incoming.get(ep.node);
            if (!byDestType) {
              byDestType = new Map();
              this.incoming.set(ep.node, byDestType);
            }
            let list = byDestType.get(ep.type);
            if (!list) {
              list = [];
              byDestType.set(ep.type, list);
            }
            list.push({
              sourceNode: sourceName,
              sourceOutput,
              destinationInput: ep.index,
              type,
            });
          }
        });
      }
    }
  }

  getNode(name: string): INode {
    const node = this.nodes.get(name);
    if (!node) throw new OperationalError(`节点不存在: ${name}`, { node: name });
    return node;
  }

  /** 某节点某类型的全部入向连接。 */
  getIncomingConnections(nodeName: string, type = 'main'): IIncomingConnection[] {
    return this.incoming.get(nodeName)?.get(type) ?? [];
  }

  /** 某节点被连入的输入端口索引集合（用于判断多输入是否到齐；未连的端口不等）。 */
  getConnectedInputIndexes(nodeName: string, type = 'main'): number[] {
    const set = new Set<number>();
    for (const c of this.getIncomingConnections(nodeName, type)) set.add(c.destinationInput);
    return [...set].sort((a, b) => a - b);
  }

  /** 直接父节点名（去重）。 */
  getParentNodes(nodeName: string, type = 'main'): string[] {
    return [...new Set(this.getIncomingConnections(nodeName, type).map((c) => c.sourceNode))];
  }

  /** 直接子节点名（去重）。 */
  getChildNodes(nodeName: string, type = 'main'): string[] {
    const byType = this.connectionsBySource[nodeName]?.[type] ?? [];
    const out = new Set<string>();
    for (const endpoints of byType) {
      if (!endpoints) continue;
      for (const ep of endpoints) out.add(ep.node);
    }
    return [...out];
  }

  /** 全部祖先（含环保护）。destinationNode 部分执行的 runNodeFilter 用。 */
  getAncestors(nodeName: string, type = 'main'): Set<string> {
    const seen = new Set<string>();
    const stack = [...this.getParentNodes(nodeName, type)];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...this.getParentNodes(current, type));
    }
    return seen;
  }

  /**
   * 找起点节点：无 main 入向连接、未禁用的第一个节点。
   * 引擎调用方可显式传 startNode 覆盖（如手动运行指定 trigger）。
   */
  getStartNode(): INode | undefined {
    const candidates: INode[] = [];
    for (const node of this.nodes.values()) {
      if (node.disabled) continue;
      if (this.getIncomingConnections(node.name).length === 0) candidates.push(node);
    }
    return candidates[0];
  }
}
