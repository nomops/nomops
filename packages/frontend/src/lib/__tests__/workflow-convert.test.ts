import { describe, expect, it } from 'vitest';
import type { IConnections, INode } from '@nomops/workflow';
import {
  addConnection,
  handleIndex,
  removeConnection,
  removeNodeFromConnections,
  toFlowEdges,
  toFlowNodes,
  uniqueNodeName,
} from '../workflow-convert.js';

const node = (name: string): INode => ({
  id: name,
  name,
  type: 'nomops.set',
  typeVersion: 1,
  position: [10, 20],
  parameters: {},
});

describe('契约 ↔ Vue Flow 转换', () => {
  it('toFlowNodes 用节点 name 作 VF id，携带原节点', () => {
    const flow = toFlowNodes([node('A')]);
    expect(flow[0]).toMatchObject({ id: 'A', position: { x: 10, y: 20 } });
    expect(flow[0]!.data.node.name).toBe('A');
  });

  it('toFlowEdges 按输出端口索引展开（IF 双输出）', () => {
    const connections: IConnections = {
      IF: {
        main: [
          [{ node: 'T', type: 'main', index: 0 }],
          [{ node: 'F', type: 'main', index: 0 }],
        ],
      },
    };
    const edges = toFlowEdges(connections);
    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({ source: 'IF', target: 'T', sourceHandle: 'out-0' });
    expect(edges[1]).toMatchObject({ source: 'IF', target: 'F', sourceHandle: 'out-1' });
  });

  it('handleIndex 解析端口序号', () => {
    expect(handleIndex('out-1')).toBe(1);
    expect(handleIndex('in-0')).toBe(0);
    expect(handleIndex(null)).toBe(0);
  });

  it('addConnection 幂等、补齐端口空位、不改入参', () => {
    const empty: IConnections = {};
    const once = addConnection(empty, { source: 'A', sourceIndex: 1, target: 'B', targetIndex: 0 });
    const twice = addConnection(once, { source: 'A', sourceIndex: 1, target: 'B', targetIndex: 0 });
    expect(empty).toEqual({});
    expect(once['A']!['main']).toEqual([null, [{ node: 'B', type: 'main', index: 0 }]]);
    expect(twice).toEqual(once);
  });

  it('removeConnection 删指定边，空端口归 null', () => {
    let c = addConnection({}, { source: 'A', sourceIndex: 0, target: 'B', targetIndex: 0 });
    c = removeConnection(c, { source: 'A', sourceIndex: 0, target: 'B', targetIndex: 0 });
    expect(c['A']!['main']![0]).toBeNull();
  });

  it('removeNodeFromConnections 清源与目标两个方向', () => {
    let c: IConnections = {};
    c = addConnection(c, { source: 'A', sourceIndex: 0, target: 'X', targetIndex: 0 });
    c = addConnection(c, { source: 'X', sourceIndex: 0, target: 'B', targetIndex: 0 });
    c = addConnection(c, { source: 'A', sourceIndex: 0, target: 'B', targetIndex: 0 });
    const cleaned = removeNodeFromConnections(c, 'X');
    expect(cleaned['X']).toBeUndefined();
    expect(cleaned['A']!['main']![0]).toEqual([{ node: 'B', type: 'main', index: 0 }]);
  });

  it('addConnection 接受 Proxy（Vue reactive）入参不抛错（回归：structuredClone DataCloneError）', () => {
    const proxied = new Proxy({} as IConnections, { get: (t, k) => Reflect.get(t, k) });
    const result = addConnection(proxied, { source: 'A', sourceIndex: 0, target: 'B', targetIndex: 0 });
    expect(result['A']!['main']![0]).toEqual([{ node: 'B', type: 'main', index: 0 }]);
  });

  it('uniqueNodeName 递增后缀', () => {
    expect(uniqueNodeName('Set', [])).toBe('Set');
    expect(uniqueNodeName('Set', ['Set'])).toBe('Set 2');
    expect(uniqueNodeName('Set', ['Set', 'Set 2'])).toBe('Set 3');
  });
});
