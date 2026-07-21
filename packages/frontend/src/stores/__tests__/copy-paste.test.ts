import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { INode } from '@nomops/workflow';
import { useEditorStore } from '../editor.js';

/**
 * 画布复制/粘贴（backlog #3）的 store 语义。
 *
 * 守的是：载荷只含选中集内部的连线；粘贴改名去重、位置偏移、
 * 内部连线按改名映射重建；一次粘贴 = 一步撤销；批量删除 = 单步撤销。
 */
const node = (name: string, x = 0): INode => ({
  id: name,
  name,
  type: 'nomops.set',
  typeVersion: 1,
  position: [x, 0],
  parameters: { fields: { from: name } },
});

let editor: ReturnType<typeof useEditorStore>;

beforeEach(() => {
  setActivePinia(createPinia());
  editor = useEditorStore();
  editor.nodes = [node('A', 0), node('B', 200), node('C', 400)];
  // A→B→C 线性
  editor.connections = {
    A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
    B: { main: [[{ node: 'C', type: 'main', index: 0 }]] },
  };
  editor.dirty = false;
});

describe('copyPayload', () => {
  it('只含选中集内部连线（A,B 选中 → 带 A→B,丢 B→C）', () => {
    const payload = editor.copyPayload(['A', 'B'])!;
    expect(payload.nomops).toBe(true);
    expect(payload.nodes.map((n) => n.name)).toEqual(['A', 'B']);
    expect(payload.connections['A']!['main']![0]).toEqual([{ node: 'B', type: 'main', index: 0 }]);
    expect(payload.connections['B']).toBeUndefined(); // B→C 目标不在集内
  });

  it('无参时取多选集;空选中 → null', () => {
    editor.setSelection(['B', 'C']);
    expect(editor.copyPayload()!.nodes.map((n) => n.name)).toEqual(['B', 'C']);
    editor.setSelection([]);
    expect(editor.copyPayload()).toBeNull();
  });

  it('载荷是深拷贝:改载荷不影响画布', () => {
    const payload = editor.copyPayload(['A'])!;
    (payload.nodes[0]!.parameters as Record<string, unknown>)['fields'] = 'mutated';
    expect((editor.nodes[0]!.parameters as Record<string, { from: string }>)['fields']!.from).toBe('A');
  });
});

describe('pasteNodes', () => {
  it('改名去重 + 位置偏移 + 内部连线重映射 + 粘贴集成为选中', () => {
    const payload = editor.copyPayload(['A', 'B'])!;
    const count = editor.pasteNodes(payload);
    expect(count).toBe(2);
    const names = editor.nodes.map((n) => n.name);
    expect(names).toContain('A 2');
    expect(names).toContain('B 2');
    // 位置右下偏移
    const a1 = editor.nodes.find((n) => n.name === 'A 2')!;
    expect(a1.position).toEqual([48, 48]);
    expect(a1.id).not.toBe('A'); // 新 id
    // 内部连线映射到新名字,不动原 A→B
    expect(editor.connections['A 2']!['main']![0]).toEqual([{ node: 'B 2', type: 'main', index: 0 }]);
    expect(editor.connections['A']!['main']![0]).toEqual([{ node: 'B', type: 'main', index: 0 }]);
    // 粘贴集成为当前选中
    expect(editor.selectedNames).toEqual(['A 2', 'B 2']);
    expect(editor.dirty).toBe(true);
  });

  it('一次粘贴 = 一步撤销', () => {
    const payload = editor.copyPayload(['A', 'B'])!;
    const before = editor.nodes.length;
    editor.pasteNodes(payload);
    expect(editor.nodes.length).toBe(before + 2);
    editor.undo();
    expect(editor.nodes.length).toBe(before);
    expect(editor.connections['A 2']).toBeUndefined();
  });

  it('兼容旧单节点格式（无 connections）', () => {
    expect(editor.pasteNodes({ nodes: [node('A')] })).toBe(1);
    expect(editor.nodes.map((n) => n.name)).toContain('A 2');
  });

  it('空/非法载荷 → 0,不入历史', () => {
    const depth = editor.undoStack.length;
    expect(editor.pasteNodes({ nodes: [] })).toBe(0);
    expect(editor.pasteNodes({ nodes: [{} as INode] })).toBe(0);
    expect(editor.undoStack.length).toBe(depth);
  });
});

describe('removeNodes（批量删除）', () => {
  it('单步撤销删多节点,连带清理连接与选中集', () => {
    editor.setSelection(['A', 'B']);
    editor.removeNodes(['A', 'B']);
    expect(editor.nodes.map((n) => n.name)).toEqual(['C']);
    expect(editor.connections['A']).toBeUndefined();
    expect(editor.selectedNames).toEqual([]);
    editor.undo();
    expect(editor.nodes.length).toBe(3);
    expect(editor.connections['A']!['main']![0]).toEqual([{ node: 'B', type: 'main', index: 0 }]);
  });
});
