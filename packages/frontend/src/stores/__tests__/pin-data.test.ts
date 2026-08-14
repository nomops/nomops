import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { IConnections, INode, INodeExecutionData } from '@nomops/workflow';
import { useEditorStore } from '../editor.js';

/**
 * Pin data（钉住节点输出）的 store 语义（P1-2）。
 *
 * 守的是：pin/unpin 写入 `pinData`、置 dirty（触发自动保存落库），
 * 且节点增删改时同步维护——否则会留下指向已不存在节点的孤儿 pin，
 * 引擎手动执行时读到脏数据。
 */
const node = (name: string): INode => ({
  id: name,
  name,
  type: 'nomops.set',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
});

const items = (v: number): INodeExecutionData[] => [{ json: { amount: v } }];

let editor: ReturnType<typeof useEditorStore>;

beforeEach(() => {
  setActivePinia(createPinia());
  editor = useEditorStore();
  editor.nodes = [node('A'), node('B')];
  editor.dirty = false;
});

describe('pin data store', () => {
  it('pins a node output and marks dirty', () => {
    editor.pinNodeData('A', items(150));
    expect(editor.isNodeDataPinned('A')).toBe(true);
    expect(editor.getNodePinData('A')).toEqual(items(150));
    expect(editor.dirty).toBe(true);
  });

  it('unpins a node output and marks dirty', () => {
    editor.pinNodeData('A', items(150));
    editor.dirty = false;
    editor.unpinNodeData('A');
    expect(editor.isNodeDataPinned('A')).toBe(false);
    expect(editor.getNodePinData('A')).toBeUndefined();
    expect(editor.dirty).toBe(true);
  });

  it('unpin is a no-op for an unpinned node (no dirty)', () => {
    editor.unpinNodeData('A');
    expect(editor.dirty).toBe(false);
  });

  it('drops pin data when its node is removed', () => {
    editor.pinNodeData('A', items(150));
    editor.pinNodeData('B', items(50));
    editor.removeNode('A');
    expect(editor.isNodeDataPinned('A')).toBe(false);
    expect(editor.isNodeDataPinned('B')).toBe(true);
  });

  it('removeNode bridges a single main path and undo restores the original graph', () => {
    editor.nodes = [node('A'), node('Middle'), node('B')];
    editor.connections = {
      A: { main: [[{ node: 'Middle', type: 'main', index: 0 }]] },
      Middle: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
    } satisfies IConnections;

    editor.removeNode('Middle');
    expect(editor.nodes.map((entry) => entry.name)).toEqual(['A', 'B']);
    expect(editor.connections).toEqual({
      A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
    });

    editor.undo();
    expect(editor.nodes.map((entry) => entry.name)).toEqual(['A', 'Middle', 'B']);
    expect(editor.connections['A']?.main?.[0]?.[0]?.node).toBe('Middle');
  });

  it('keyboard deletion through the batch entrypoint also bridges one selected node', () => {
    editor.nodes = [node('A'), node('Middle'), node('B')];
    editor.connections = {
      A: { main: [[{ node: 'Middle', type: 'main', index: 0 }]] },
      Middle: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
    } satisfies IConnections;

    editor.removeNodes(['Middle']);

    expect(editor.connections).toEqual({
      A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
    });
  });

  it('moves pin data to the new key when its node is renamed', () => {
    editor.pinNodeData('A', items(150));
    editor.renameNode('A', 'A renamed');
    expect(editor.isNodeDataPinned('A')).toBe(false);
    expect(editor.isNodeDataPinned('A renamed')).toBe(true);
    expect(editor.getNodePinData('A renamed')).toEqual(items(150));
  });

  it('leaves other nodes untouched on rename', () => {
    editor.pinNodeData('A', items(150));
    editor.pinNodeData('B', items(50));
    editor.renameNode('A', 'Z');
    expect(editor.getNodePinData('B')).toEqual(items(50));
    expect(editor.getNodePinData('Z')).toEqual(items(150));
  });
});
