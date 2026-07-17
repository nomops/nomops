import { describe, expect, it } from 'vitest';
import type {
  IExecuteContext,
  ILoadableNodeType,
  INode,
  INodeExecutionData,
  INodeType,
  IRunData,
  IRunExecutionData,
} from '@nomops/workflow';
import { Workflow } from '@nomops/workflow';
import { NodeLoader } from '../nodes-loader/node-loader.js';
import { WorkflowExecute } from './workflow-execute.js';
import { buildPartialRunState, computeDirtyNodes, incomingSignatureOf } from './partial-execution.js';

/* ────────────── 内联测试节点 ────────────── */

function loadable(
  type: string,
  outputs: string[],
  execute: (this: IExecuteContext) => Promise<INodeExecutionData[][]>,
): ILoadableNodeType {
  const description = {
    displayName: type,
    name: type,
    group: ['transform'],
    version: 1,
    description: '',
    defaults: { name: type },
    inputs: ['main'],
    outputs,
    properties: [],
  };
  return {
    type,
    description,
    load: async () =>
      class implements INodeType {
        description = description;
        execute = execute;
      },
  };
}

const testNodes: ILoadableNodeType[] = [
  loadable('t.pass', ['main'], async function () {
    return [this.getInputData().map((it, i) => ({ json: { ...it.json }, pairedItem: { item: i } }))];
  }),
  loadable('t.tag', ['main'], async function () {
    const tag = this.getNodeParameter('tag', 0);
    return [
      this.getInputData().map((it, i) => ({ json: { ...it.json, tag }, pairedItem: { item: i } })),
    ];
  }),
  loadable('t.merge', ['main'], async function () {
    return [[...this.getInputData(0), ...this.getInputData(1)]];
  }),
  loadable('t.fail', ['main'], async function () {
    throw new Error('boom — 本不该被执行');
  }),
];

function node(name: string, type: string, parameters: Record<string, unknown> = {}, extra: Partial<INode> = {}): INode {
  return { id: name, name, type, typeVersion: 1, position: [0, 0], parameters, ...extra };
}
const to = (n: string, index = 0) => ({ node: n, type: 'main', index });
const engine = () => new WorkflowExecute(new NodeLoader(testNodes));

function outputJson(state: IRunExecutionData, nodeName: string, port = 0): unknown[] {
  const runs = state.resultData.runData[nodeName] ?? [];
  const last = runs[runs.length - 1];
  return (last?.data?.['main']?.[port] ?? []).map((it) => it.json);
}

/** 造一份「上次运行」的 runData：每个节点一次成功运行，输出=指定 items。 */
function prevRun(outputs: Record<string, INodeExecutionData[]>): IRunData {
  const runData: IRunData = {};
  for (const [name, items] of Object.entries(outputs)) {
    runData[name] = [{ startTime: 0, executionTime: 1, source: [], data: { main: [items] } }];
  }
  return runData;
}

describe('部分执行 — 脏节点图算法', () => {
  it('线性 A→B→C，B 脏：A 复用不执行（A 是必炸节点证明），B/C 重跑', async () => {
    const wf = new Workflow({
      name: 'partial-linear',
      nodes: [node('A', 't.fail'), node('B', 't.tag', { tag: 'v2' }), node('C', 't.pass')],
      connections: { A: { main: [[to('B')]] }, B: { main: [[to('C')]] } },
    });
    const prev = prevRun({
      A: [{ json: { fromA: 1 } }],
      B: [{ json: { fromA: 1, tag: 'v1' } }],
      C: [{ json: { fromA: 1, tag: 'v1' } }],
    });

    const state = buildPartialRunState(wf, prev, 'C', ['B']);
    const run = await engine().processRunExecutionData(wf, state);

    expect(run.status).toBe('success');
    expect(outputJson(run.data, 'A')).toEqual([{ fromA: 1 }]); // 预置的旧数据
    expect(run.data.resultData.runData['A']).toHaveLength(1); // 没有第二次运行
    expect(outputJson(run.data, 'B')).toEqual([{ fromA: 1, tag: 'v2' }]); // 用旧 A 输出重算
    expect(outputJson(run.data, 'C')).toEqual([{ fromA: 1, tag: 'v2' }]);
  });

  it('多输入 Merge：一父干净一父脏 → 干净侧挂等待表，脏侧跑完自动补齐', async () => {
    const wf = new Workflow({
      name: 'partial-merge',
      nodes: [node('A', 't.fail'), node('B', 't.tag', { tag: 'new' }), node('M', 't.merge')],
      connections: {
        A: { main: [[to('M', 0)]] },
        B: { main: [[to('M', 1)]] },
      },
    });
    const prev = prevRun({
      A: [{ json: { side: 'a' } }],
      B: [{ json: { side: 'b', tag: 'old' } }],
      M: [{ json: { side: 'a' } }, { json: { side: 'b', tag: 'old' } }],
    });

    const state = buildPartialRunState(wf, prev, 'M', ['B']);
    const run = await engine().processRunExecutionData(wf, state);

    expect(run.status).toBe('success');
    expect(outputJson(run.data, 'M')).toEqual([
      { side: 'a' }, // 干净侧：旧数据
      { tag: 'new' }, // 脏侧：B 是起点节点，从空种子重算（旧的 side:'b' 不复用）
    ]);
    expect(run.data.resultData.runData['A']).toHaveLength(1); // A 未重跑
  });

  it('无显式脏：只有 destination 重跑，其余全部复用', async () => {
    const wf = new Workflow({
      name: 'partial-dest-only',
      nodes: [node('A', 't.fail'), node('B', 't.fail'), node('C', 't.pass')],
      connections: { A: { main: [[to('B')]] }, B: { main: [[to('C')]] } },
    });
    const prev = prevRun({
      A: [{ json: { v: 1 } }],
      B: [{ json: { v: 2 } }],
      C: [{ json: { v: 2 } }],
    });

    const state = buildPartialRunState(wf, prev, 'C');
    const run = await engine().processRunExecutionData(wf, state);

    expect(run.status).toBe('success');
    expect(outputJson(run.data, 'C')).toEqual([{ v: 2 }]); // C 以旧 B 输出重跑
    expect(run.data.resultData.runData['B']).toHaveLength(1);
  });

  it('上次没跑过的节点自动视为脏', async () => {
    const wf = new Workflow({
      name: 'partial-unrun',
      nodes: [node('A', 't.fail'), node('B', 't.pass'), node('C', 't.pass')],
      connections: { A: { main: [[to('B')]] }, B: { main: [[to('C')]] } },
    });
    // 上次只跑到 A（B/C 没有数据）
    const prev = prevRun({ A: [{ json: { v: 9 } }] });

    const state = buildPartialRunState(wf, prev, 'C');
    const run = await engine().processRunExecutionData(wf, state);

    expect(run.status).toBe('success');
    expect(outputJson(run.data, 'C')).toEqual([{ v: 9 }]);
  });
});

describe('computeDirtyNodes — 定义对比', () => {
  const build = (params: Record<string, unknown>, conns: Record<string, unknown>) =>
    new Workflow({
      name: 'diff',
      nodes: [node('A', 't.pass'), node('B', 't.tag', params), node('C', 't.pass')],
      connections: conns as ConstructorParameters<typeof Workflow>[0]['connections'],
    });

  it('参数变化 → 该节点脏；新增节点 → 脏；连接变化 → 目标节点脏', () => {
    const prev = build({ tag: 'v1' }, { A: { main: [[to('B')]] }, B: { main: [[to('C')]] } });
    const curParam = build({ tag: 'v2' }, { A: { main: [[to('B')]] }, B: { main: [[to('C')]] } });
    const dirtyParam = computeDirtyNodes(
      { nodes: [...prev.nodes.values()], incomingSignature: incomingSignatureOf(prev) },
      { nodes: [...curParam.nodes.values()], incomingSignature: incomingSignatureOf(curParam) },
    );
    expect([...dirtyParam]).toEqual(['B']);

    // 连接变化：C 改为直接接 A → C 的入向签名变了
    const curConn = build({ tag: 'v1' }, { A: { main: [[to('B'), to('C')]] } });
    const dirtyConn = computeDirtyNodes(
      { nodes: [...prev.nodes.values()], incomingSignature: incomingSignatureOf(prev) },
      { nodes: [...curConn.nodes.values()], incomingSignature: incomingSignatureOf(curConn) },
    );
    expect(dirtyConn.has('C')).toBe(true);
  });
});
