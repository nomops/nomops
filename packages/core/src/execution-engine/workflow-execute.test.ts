import { describe, expect, it } from 'vitest';
import type {
  IExecuteContext,
  ILoadableNodeType,
  INode,
  INodeExecutionData,
  INodeType,
  IRunExecutionData,
  ITaskData,
} from '@nomops/workflow';
import { Workflow } from '@nomops/workflow';
import { NodeLoader } from '../nodes-loader/node-loader.js';
import { WorkflowExecute } from './workflow-execute.js';

/* ────────────── 内联测试节点（引擎测试不依赖 @nomops/nodes，保持分层隔离） ────────────── */

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
  // 透传并打标记
  loadable('t.pass', ['main'], async function () {
    return [this.getInputData().map((it, i) => ({ json: { ...it.json }, pairedItem: { item: i } }))];
  }),
  // value 翻倍（用表达式参数验证 getNodeParameter 自动求值）
  loadable('t.double', ['main'], async function () {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];
    for (let i = 0; i < items.length; i++) {
      out.push({ json: { value: this.getNodeParameter('newValue', i) }, pairedItem: { item: i } });
    }
    return [out];
  }),
  // 按 json.pass 分流：true → 输出0，false → 输出1
  loadable('t.if', ['main', 'main'], async function () {
    const t: INodeExecutionData[] = [];
    const f: INodeExecutionData[] = [];
    for (const [i, it] of this.getInputData().entries()) {
      (it.json['pass'] ? t : f).push({ json: it.json, pairedItem: { item: i } });
    }
    return [t, f];
  }),
  // 双输入合并（引擎保证等齐）
  loadable('t.merge', ['main'], async function () {
    return [[...this.getInputData(0), ...this.getInputData(1)]];
  }),
  // 计数 +1
  loadable('t.inc', ['main'], async function () {
    return [
      this.getInputData().map((it, i) => ({
        json: { count: ((it.json['count'] as number) ?? 0) + 1 },
        pairedItem: { item: i },
      })),
    ];
  }),
  // 门：count < 3 → 输出0（继续循环），否则 → 输出1（退出）
  loadable('t.gate', ['main', 'main'], async function () {
    const items = this.getInputData();
    const back: INodeExecutionData[] = [];
    const exit: INodeExecutionData[] = [];
    for (const [i, it] of items.entries()) {
      ((it.json['count'] as number) < 3 ? back : exit).push({ json: it.json, pairedItem: { item: i } });
    }
    return [back, exit];
  }),
  // 必报错
  loadable('t.fail', ['main'], async function () {
    throw new Error('boom');
  }),
];

/* ────────────── 工具 ────────────── */

function node(name: string, type: string, parameters: Record<string, unknown> = {}, extra: Partial<INode> = {}): INode {
  return { id: name, name, type, typeVersion: 1, position: [0, 0], parameters, ...extra };
}

const to = (n: string, index = 0) => ({ node: n, type: 'main', index });

function engine(hooks?: ConstructorParameters<typeof WorkflowExecute>[1]) {
  return new WorkflowExecute(new NodeLoader(testNodes), hooks);
}

/** 提取某节点最近一次运行的输出端口0 items 的 json 列表。 */
function outputJson(state: IRunExecutionData, nodeName: string, port = 0): unknown[] {
  const runs = state.resultData.runData[nodeName] ?? [];
  const last = runs[runs.length - 1];
  return (last?.data?.['main']?.[port] ?? []).map((it) => it.json);
}

/* ────────────── 六种拓扑（Phase 2 验收门槛） ────────────── */

describe('拓扑1 — 线性流', () => {
  it('三节点跑通，数据正确传递（含表达式参数求值）', async () => {
    const wf = new Workflow({
      name: 'linear',
      nodes: [
        node('A', 't.pass'),
        node('B', 't.double', { newValue: '={{ $json.value * 2 }}' }),
        node('C', 't.pass'),
      ],
      connections: {
        A: { main: [[to('B')]] },
        B: { main: [[to('C')]] },
      },
    });

    const run = await engine().run(wf, undefined, undefined, [{ json: { value: 21 } }]);

    expect(run.status).toBe('success');
    expect(outputJson(run.data, 'A')).toEqual([{ value: 21 }]);
    expect(outputJson(run.data, 'B')).toEqual([{ value: 42 }]);
    expect(outputJson(run.data, 'C')).toEqual([{ value: 42 }]);
    expect(run.data.resultData.lastNodeExecuted).toBe('C');
  });
});

describe('拓扑2 — IF 分支', () => {
  it('条件真走输出0，假走输出1', async () => {
    const wf = new Workflow({
      name: 'branch',
      nodes: [node('IF', 't.if'), node('T', 't.pass'), node('F', 't.pass')],
      connections: {
        IF: { main: [[to('T')], [to('F')]] },
      },
    });

    const run = await engine().run(wf, undefined, undefined, [
      { json: { pass: true, id: 1 } },
      { json: { pass: false, id: 2 } },
    ]);

    expect(run.status).toBe('success');
    expect(outputJson(run.data, 'T')).toEqual([{ pass: true, id: 1 }]);
    expect(outputJson(run.data, 'F')).toEqual([{ pass: false, id: 2 }]);
  });

  it('某分支为空时其下游不执行', async () => {
    const wf = new Workflow({
      name: 'branch-empty',
      nodes: [node('IF', 't.if'), node('T', 't.pass'), node('F', 't.pass')],
      connections: { IF: { main: [[to('T')], [to('F')]] } },
    });

    const run = await engine().run(wf, undefined, undefined, [{ json: { pass: true } }]);
    expect(run.data.resultData.runData['T']).toBeDefined();
    expect(run.data.resultData.runData['F']).toBeUndefined();
  });
});

describe('拓扑3 — Merge 多输入等待', () => {
  it('等两路输入到齐才执行，且只执行一次', async () => {
    const order: string[] = [];
    const wf = new Workflow({
      name: 'merge',
      nodes: [node('IF', 't.if'), node('L', 't.pass'), node('R', 't.pass'), node('M', 't.merge')],
      connections: {
        IF: { main: [[to('L')], [to('R')]] },
        L: { main: [[to('M', 0)]] },
        R: { main: [[to('M', 1)]] },
      },
    });

    const run = await engine({
      hooks: { nodeExecuteBefore: (n) => void order.push(n) },
    }).run(wf, undefined, undefined, [
      { json: { pass: true, id: 'l' } },
      { json: { pass: false, id: 'r' } },
    ]);

    expect(run.status).toBe('success');
    // M 只跑一次，且在 L、R 都完成之后
    expect(order.filter((n) => n === 'M')).toHaveLength(1);
    expect(order.indexOf('M')).toBeGreaterThan(order.indexOf('L'));
    expect(order.indexOf('M')).toBeGreaterThan(order.indexOf('R'));
    expect(outputJson(run.data, 'M')).toEqual([
      { pass: true, id: 'l' },
      { pass: false, id: 'r' },
    ]);
    // 等待表清空
    expect(run.data.executionData!.waitingExecution).toEqual({});
  });

  it('只有一路到达时 Merge 不执行（不误触发）', async () => {
    const wf = new Workflow({
      name: 'merge-half',
      nodes: [node('IF', 't.if'), node('L', 't.pass'), node('R', 't.pass'), node('M', 't.merge')],
      connections: {
        IF: { main: [[to('L')], [to('R')]] },
        L: { main: [[to('M', 0)]] },
        R: { main: [[to('M', 1)]] },
      },
    });

    // 全部走 true → 只有 L 路有数据
    const run = await engine().run(wf, undefined, undefined, [{ json: { pass: true } }]);
    expect(run.status).toBe('success');
    expect(run.data.resultData.runData['M']).toBeUndefined();
    expect(run.data.executionData!.waitingExecution['M']).toBeDefined();
  });
});

describe('拓扑4 — 循环', () => {
  it('循环拓扑不死锁，按门条件退出', async () => {
    // Seed → INC → GATE；GATE 输出0 → INC（回环），输出1 → EXIT
    const wf = new Workflow({
      name: 'loop',
      nodes: [node('INC', 't.inc'), node('GATE', 't.gate'), node('EXIT', 't.pass')],
      connections: {
        INC: { main: [[to('GATE')]] },
        GATE: { main: [[to('INC')], [to('EXIT')]] },
      },
    });

    const run = await engine().run(wf, wf.getNode('INC'), undefined, [{ json: { count: 0 } }]);

    expect(run.status).toBe('success');
    expect(run.data.resultData.runData['INC']).toHaveLength(3); // count 0→1→2→3
    expect(run.data.resultData.runData['GATE']).toHaveLength(3);
    expect(outputJson(run.data, 'EXIT')).toEqual([{ count: 3 }]);
  });

  it('无退出条件的失控循环被 MAX_NODE_RUNS 熔断而非死锁', async () => {
    const wf = new Workflow({
      name: 'runaway',
      nodes: [node('A', 't.pass'), node('B', 't.pass')],
      connections: {
        A: { main: [[to('B')]] },
        B: { main: [[to('A')]] },
      },
    });

    const run = await engine().run(wf, wf.getNode('A'));
    expect(run.status).toBe('error');
    expect(run.data.resultData.error?.message).toMatch(/疑似死循环/);
  }, 30_000);
});

describe('拓扑5 — 错误处理', () => {
  it('节点报错且未设 continueOnError → 终止执行并记录错误', async () => {
    const wf = new Workflow({
      name: 'fail-stop',
      nodes: [node('A', 't.pass'), node('BAD', 't.fail'), node('C', 't.pass')],
      connections: {
        A: { main: [[to('BAD')]] },
        BAD: { main: [[to('C')]] },
      },
    });

    const run = await engine().run(wf);

    expect(run.status).toBe('error');
    expect(run.data.resultData.error?.message).toBe('boom');
    expect(run.data.resultData.error?.node).toBe('BAD');
    expect(run.data.resultData.lastNodeExecuted).toBe('BAD');
    expect(run.data.resultData.runData['C']).toBeUndefined();
  });

  it('continueOnError=true → 错误 item 从错误输出端口放出继续', async () => {
    // t.fail 声明 1 个输出 → 错误端口索引 = 1
    const wf = new Workflow({
      name: 'fail-continue',
      nodes: [
        node('A', 't.pass'),
        node('BAD', 't.fail', {}, { continueOnError: true }),
        node('OK', 't.pass'),
        node('ERR', 't.pass'),
      ],
      connections: {
        A: { main: [[to('BAD')]] },
        BAD: { main: [[to('OK')], [to('ERR')]] }, // 输出0 正常流，输出1 = 错误端口
      },
    });

    const run = await engine().run(wf);

    expect(run.status).toBe('success');
    expect(run.data.resultData.runData['OK']).toBeUndefined(); // 正常口无数据
    expect(outputJson(run.data, 'ERR')).toEqual([{ error: 'boom' }]);
    // 错误同时记录在该节点的 taskData 里
    expect(run.data.resultData.runData['BAD']![0]!.error?.message).toBe('boom');
  });
});

describe('拓扑6 — 序列化中断恢复', () => {
  async function runLinear(interruptAfter?: string) {
    const wf = new Workflow({
      name: 'resume',
      nodes: [
        node('A', 't.inc'),
        node('B', 't.inc'),
        node('C', 't.inc'),
        node('D', 't.inc'),
      ],
      connections: {
        A: { main: [[to('B')]] },
        B: { main: [[to('C')]] },
        C: { main: [[to('D')]] },
      },
    });

    let exec: WorkflowExecute;
    const hooks =
      interruptAfter === undefined
        ? undefined
        : {
            hooks: {
              nodeExecuteAfter: (n: string) => {
                if (n === interruptAfter) exec.cancel();
              },
            },
          };
    exec = engine(hooks);
    const run = await exec.run(wf, undefined, undefined, [{ json: { count: 0 } }]);
    return { wf, run };
  }

  it('执行到一半序列化 → 反序列化 → 继续跑完，结果与不中断一致', async () => {
    // 1) 中断在 B 之后
    const { wf, run: partial } = await runLinear('B');
    expect(partial.status).toBe('canceled');
    expect(partial.data.resultData.lastNodeExecuted).toBe('B');
    expect(partial.data.executionData!.nodeExecutionStack.length).toBeGreaterThan(0);

    // 2) 整体 JSON 序列化往返（铁律4：必须 stringify 安全）
    const json = JSON.stringify(partial.data);
    const restored = JSON.parse(json) as IRunExecutionData;

    // 3) 新引擎实例从状态继续
    const resumed = await engine().processRunExecutionData(wf, restored);
    expect(resumed.status).toBe('success');

    // 4) 与不中断的完整执行对比最终数据
    const { run: full } = await runLinear();
    expect(full.status).toBe('success');
    const strip = (s: IRunExecutionData) =>
      Object.fromEntries(
        Object.entries(s.resultData.runData).map(([k, runs]) => [
          k,
          (runs as ITaskData[]).map((r) => r.data),
        ]),
      );
    expect(strip(resumed.data)).toEqual(strip(full.data));
    expect(outputJson(resumed.data, 'D')).toEqual([{ count: 4 }]);
  });
});

describe('部分执行（destinationNode）', () => {
  it('只跑 destination 的祖先集合，destination 之后不扩散', async () => {
    const wf = new Workflow({
      name: 'partial',
      nodes: [node('A', 't.pass'), node('B', 't.pass'), node('C', 't.pass'), node('D', 't.pass')],
      connections: {
        A: { main: [[to('B')]] },
        B: { main: [[to('C')]] },
        C: { main: [[to('D')]] },
      },
    });

    const run = await engine().run(wf, undefined, 'B');

    expect(run.status).toBe('success');
    expect(run.data.resultData.runData['A']).toBeDefined();
    expect(run.data.resultData.runData['B']).toBeDefined();
    expect(run.data.resultData.runData['C']).toBeUndefined();
    expect(run.data.resultData.runData['D']).toBeUndefined();
  });
});

describe('禁用节点', () => {
  it('disabled 节点直通数据', async () => {
    const wf = new Workflow({
      name: 'disabled',
      nodes: [node('A', 't.pass'), node('SKIP', 't.fail', {}, { disabled: true }), node('C', 't.pass')],
      connections: {
        A: { main: [[to('SKIP')]] },
        SKIP: { main: [[to('C')]] },
      },
    });

    const run = await engine().run(wf, undefined, undefined, [{ json: { x: 1 } }]);
    expect(run.status).toBe('success');
    expect(outputJson(run.data, 'C')).toEqual([{ x: 1 }]);
  });
});

describe('钉住数据（pinned data）', () => {
  it('钉住的节点不执行，直接用冻结输出，下游照常', async () => {
    // B 是必炸节点——只要引擎真的执行它测试就会失败；pin 应让它被跳过
    const wf = new Workflow({
      name: 'pinned',
      nodes: [node('A', 't.pass'), node('B', 't.fail'), node('C', 't.pass')],
      connections: {
        A: { main: [[to('B')]] },
        B: { main: [[to('C')]] },
      },
      pinData: { B: [{ json: { frozen: true } }, { json: { frozen: 2 } }] },
    });

    const run = await engine().run(wf, undefined, undefined, [{ json: { x: 1 } }]);

    expect(run.status).toBe('success');
    expect(outputJson(run.data, 'B')).toEqual([{ frozen: true }, { frozen: 2 }]);
    expect(outputJson(run.data, 'C')).toEqual([{ frozen: true }, { frozen: 2 }]);
    expect(run.data.resultData.runData['B']![0]!.pinned).toBe(true);
    expect(run.data.resultData.runData['C']![0]!.pinned).toBeUndefined();
  });

  it('不携带 pinData 构造的 Workflow 正常执行节点（生产语义）', async () => {
    const wf = new Workflow({
      name: 'unpinned',
      nodes: [node('A', 't.pass'), node('B', 't.double', { newValue: 7 }), node('C', 't.pass')],
      connections: {
        A: { main: [[to('B')]] },
        B: { main: [[to('C')]] },
      },
    });

    const run = await engine().run(wf, undefined, undefined, [{ json: { value: 1 } }]);
    expect(run.status).toBe('success');
    expect(outputJson(run.data, 'C')).toEqual([{ value: 7 }]);
  });

  it('pin 到 destinationNode 时到达即停，不扩散下游', async () => {
    const wf = new Workflow({
      name: 'pin-dest',
      nodes: [node('A', 't.pass'), node('B', 't.fail'), node('C', 't.pass')],
      connections: {
        A: { main: [[to('B')]] },
        B: { main: [[to('C')]] },
      },
      pinData: { B: [{ json: { stop: 'here' } }] },
    });

    const run = await engine().run(wf, undefined, 'B');
    expect(run.status).toBe('success');
    expect(outputJson(run.data, 'B')).toEqual([{ stop: 'here' }]);
    expect(run.data.resultData.runData['C']).toBeUndefined();
  });

  it('钉住起点节点：种子数据被冻结输出替代', async () => {
    const wf = new Workflow({
      name: 'pin-start',
      nodes: [node('A', 't.fail'), node('B', 't.pass')],
      connections: { A: { main: [[to('B')]] } },
      pinData: { A: [{ json: { seeded: 'pin' } }] },
    });

    const run = await engine().run(wf);
    expect(run.status).toBe('success');
    expect(outputJson(run.data, 'B')).toEqual([{ seeded: 'pin' }]);
  });
});

describe('wait/resume（挂起与唤醒）', () => {
  // 内联等待节点：首跑挂起 100ms，续跑放行输入
  const pauseNode = loadable('t.pause', ['main'], async function (this: IExecuteContext) {
    if (this.isResumed()) return [this.getInputData()];
    const { ExecutionPause } = await import('@nomops/workflow');
    throw new ExecutionPause({ waitTill: Date.now() + 100 });
  });

  function pauseEngine() {
    return new WorkflowExecute(new NodeLoader([...testNodes, pauseNode]));
  }

  it('首跑挂起为 waiting、状态可序列化；恢复后 Wait 放行、下游继续', async () => {
    const wf = new Workflow({
      name: 'wait-flow',
      nodes: [node('A', 't.pass'), node('W', 't.pause'), node('C', 't.pass')],
      connections: { A: { main: [[to('W')]] }, W: { main: [[to('C')]] } },
    });

    const first = await pauseEngine().run(wf, undefined, undefined, [{ json: { v: 7 } }]);
    expect(first.status).toBe('waiting');
    expect(typeof first.data.waitTill).toBe('number');
    expect(first.data.resultData.runData['C']).toBeUndefined(); // 下游未跑

    // 铁律 4：挂起状态整体可 JSON 序列化，跨进程恢复
    const revived = JSON.parse(JSON.stringify(first.data)) as IRunExecutionData;
    const second = await pauseEngine().processRunExecutionData(wf, revived);

    expect(second.status).toBe('success');
    expect(second.data.waitTill).toBeUndefined(); // 完成后清除
    expect(outputJson(second.data, 'W')).toEqual([{ v: 7 }]); // Wait 透传输入
    expect(outputJson(second.data, 'C')).toEqual([{ v: 7 }]);
  });
});
