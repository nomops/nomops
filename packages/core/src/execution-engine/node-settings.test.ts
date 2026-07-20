/**
 * 节点级设置的**行为**验收：retryOnFail / onError 三态 / executionTimeout /
 * alwaysOutputData / executeOnce。
 *
 * 这些字段长期只存不用（UI 可配、DB 可存、运行时无行为），本组测试就是那道闸门：
 * 每个字段既测「配置生效」，也测「未配置时零回归」。
 */

import { describe, expect, it, beforeEach } from 'vitest';
import type {
  IExecuteContext,
  ILoadableNodeType,
  INode,
  INodeExecutionData,
  INodeType,
  IRun,
  IWorkflowSettings,
} from '@nomops/workflow';
import { ExecutionPause, Workflow } from '@nomops/workflow';
import { NodeLoader } from '../nodes-loader/node-loader.js';
import { WorkflowExecute } from './workflow-execute.js';

/* ────────────── 探针：内联测试节点共享的可观测状态 ────────────── */

const probe = {
  /** t.flaky 还要失败几次才成功。 */
  failuresLeft: 0,
  /** 各节点类型被真正调用的次数。 */
  calls: {} as Record<string, number>,
};

function record(type: string): number {
  probe.calls[type] = (probe.calls[type] ?? 0) + 1;
  return probe.calls[type]!;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  // 透传
  loadable('t.pass', ['main'], async function () {
    record('t.pass');
    return [this.getInputData().map((it, i) => ({ json: it.json, pairedItem: { item: i } }))];
  }),
  // 前 N 次失败、之后成功（N 由 probe.failuresLeft 给定）
  loadable('t.flaky', ['main'], async function () {
    record('t.flaky');
    if (probe.failuresLeft > 0) {
      probe.failuresLeft--;
      throw new Error('transient');
    }
    return [[{ json: { ok: true } }]];
  }),
  // 必报错
  loadable('t.fail', ['main'], async function () {
    record('t.fail');
    throw new Error('boom');
  }),
  // 空输出（端口 0 无 item）
  loadable('t.empty', ['main'], async function () {
    record('t.empty');
    return [[]];
  }),
  // 慢节点：sleep 参数毫秒后返回
  loadable('t.slow', ['main'], async function () {
    record('t.slow');
    await sleep((this.getNodeParameter('ms', 0) as number) ?? 50);
    return [[{ json: { done: true } }]];
  }),
  // 首跑挂起、续跑放行
  loadable('t.pause', ['main'], async function () {
    record('t.pause');
    if (!this.isResumed()) throw new ExecutionPause();
    return [[{ json: { resumed: true } }]];
  }),
];

/* ────────────── 工具 ────────────── */

function node(
  name: string,
  type: string,
  parameters: Record<string, unknown> = {},
  extra: Partial<INode> = {},
): INode {
  return { id: name, name, type, typeVersion: 1, position: [0, 0], parameters, ...extra };
}

const to = (n: string, index = 0) => ({ node: n, type: 'main', index });

function engine() {
  return new WorkflowExecute(new NodeLoader(testNodes));
}

/** 单节点工作流跑一次（最常见的形状：起点 → 被测节点）。 */
async function runSingle(
  target: INode,
  opts: { seed?: INodeExecutionData[]; settings?: IWorkflowSettings; downstream?: INode } = {},
): Promise<IRun> {
  const nodes = [node('START', 't.pass'), target];
  const connections: Record<string, { main: Array<Array<{ node: string; type: string; index: number }>> }> = {
    START: { main: [[to(target.name)]] },
  };
  if (opts.downstream) {
    nodes.push(opts.downstream);
    connections[target.name] = { main: [[to(opts.downstream.name)]] };
  }
  const wf = new Workflow({ name: 'settings', nodes, connections, settings: opts.settings });
  return engine().run(wf, undefined, undefined, opts.seed);
}

const lastRun = (run: IRun, name: string) => {
  const runs = run.data.resultData.runData[name] ?? [];
  return runs[runs.length - 1];
};

const outputJson = (run: IRun, name: string, port = 0) =>
  (lastRun(run, name)?.data?.['main']?.[port] ?? []).map((it) => it.json);

beforeEach(() => {
  probe.failuresLeft = 0;
  probe.calls = {};
});

/* ────────────── retryOnFail ────────────── */

describe('retryOnFail — 节点失败自动重试', () => {
  it('未开启重试时只尝试一次（零回归基线）', async () => {
    const run = await runSingle(node('N', 't.fail'));

    expect(probe.calls['t.fail']).toBe(1);
    expect(run.status).toBe('error');
  });

  it('前两次失败、第三次成功 → 整体成功，tryCount 记录 3', async () => {
    probe.failuresLeft = 2;
    const run = await runSingle(
      node('N', 't.flaky', {}, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1 }),
    );

    expect(probe.calls['t.flaky']).toBe(3);
    expect(run.status).toBe('success');
    expect(lastRun(run, 'N')?.tryCount).toBe(3);
    expect(outputJson(run, 'N')).toEqual([{ ok: true }]);
  });

  it('一次成功时不记 tryCount（只有重试过才留痕）', async () => {
    const run = await runSingle(node('N', 't.flaky', {}, { retryOnFail: true, maxTries: 3 }));

    expect(probe.calls['t.flaky']).toBe(1);
    expect(lastRun(run, 'N')?.tryCount).toBeUndefined();
  });

  it('尝试次数耗尽后按 onError 收束，且只留一条 runData', async () => {
    const run = await runSingle(
      node('N', 't.fail', {}, { retryOnFail: true, maxTries: 2, waitBetweenTries: 1 }),
    );

    expect(probe.calls['t.fail']).toBe(2);
    expect(run.status).toBe('error');
    expect(run.data.resultData.runData['N']).toHaveLength(1);
    expect(run.data.resultData.error?.message).toBe('boom');
  });

  it('maxTries 越界被钳制到上限 5', async () => {
    const run = await runSingle(
      node('N', 't.fail', {}, { retryOnFail: true, maxTries: 99, waitBetweenTries: 1 }),
    );

    expect(probe.calls['t.fail']).toBe(5);
    expect(run.status).toBe('error');
  });

  it('重试与 onError 叠加：重试用尽后仍从错误端口继续', async () => {
    const run = await runSingle(
      node('N', 't.fail', {}, { retryOnFail: true, maxTries: 2, waitBetweenTries: 1, onError: 'continueErrorOutput' }),
      { downstream: node('AFTER', 't.pass') },
    );

    expect(probe.calls['t.fail']).toBe(2);
    expect(run.status).toBe('success');
    // t.fail 声明 1 个输出 → 错误端口索引 = 1
    expect(outputJson(run, 'N', 1)).toEqual([{ error: 'boom' }]);
  });

  it('★暂停信号不被当作失败重试（否则会吞掉 wait/resume）', async () => {
    const run = await runSingle(
      node('N', 't.pause', {}, { retryOnFail: true, maxTries: 5, waitBetweenTries: 1 }),
    );

    expect(run.status).toBe('waiting');
    expect(probe.calls['t.pause']).toBe(1);
  });
});

/* ────────────── onError 三态 ────────────── */

describe('onError — 节点报错时的行为', () => {
  it('缺省 = stopWorkflow：终止执行，下游不跑', async () => {
    const run = await runSingle(node('N', 't.fail'), { downstream: node('AFTER', 't.pass') });

    expect(run.status).toBe('error');
    expect(run.data.resultData.runData['AFTER']).toBeUndefined();
  });

  it('continueErrorOutput：错误 item 走错误端口，执行继续', async () => {
    const run = await runSingle(node('N', 't.fail', {}, { onError: 'continueErrorOutput' }), {
      downstream: node('AFTER', 't.pass'),
    });

    expect(run.status).toBe('success');
    expect(outputJson(run, 'N', 0)).toEqual([]);
    expect(outputJson(run, 'N', 1)).toEqual([{ error: 'boom' }]);
    expect(lastRun(run, 'N')?.error?.message).toBe('boom');
  });

  it('continueRegularOutput：输入原样从端口 0 透出，执行继续', async () => {
    const seed = [{ json: { a: 1 } }, { json: { a: 2 } }];
    const run = await runSingle(node('N', 't.fail', {}, { onError: 'continueRegularOutput' }), {
      seed,
      downstream: node('AFTER', 't.pass'),
    });

    expect(run.status).toBe('success');
    // 数据像没经过这个节点一样往下走，但错误仍记录在案
    expect(outputJson(run, 'N', 0)).toEqual([{ a: 1 }, { a: 2 }]);
    expect(outputJson(run, 'AFTER', 0)).toEqual([{ a: 1 }, { a: 2 }]);
    expect(lastRun(run, 'N')?.error?.message).toBe('boom');
  });

  it('旧字段兼容：continueOnError=true 等价于 continueErrorOutput', async () => {
    const run = await runSingle(node('N', 't.fail', {}, { continueOnError: true }));

    expect(run.status).toBe('success');
    expect(outputJson(run, 'N', 1)).toEqual([{ error: 'boom' }]);
  });

  it('二者并存时 onError 优先（UI 的显式选择压过历史残留）', async () => {
    const run = await runSingle(
      node('N', 't.fail', {}, { continueOnError: true, onError: 'stopWorkflow' }),
    );

    expect(run.status).toBe('error');
  });
});

/* ────────────── executeOnce ────────────── */

describe('executeOnce — 只用第一个 item 执行一次', () => {
  it('开启后节点只看到第一个 item', async () => {
    const seed = [{ json: { a: 1 } }, { json: { a: 2 } }, { json: { a: 3 } }];
    const run = await runSingle(node('N', 't.pass', {}, { executeOnce: true }), { seed });

    expect(outputJson(run, 'N')).toEqual([{ a: 1 }]);
  });

  it('未开启时全部 item 都进节点（零回归基线）', async () => {
    const seed = [{ json: { a: 1 } }, { json: { a: 2 } }];
    const run = await runSingle(node('N', 't.pass'), { seed });

    expect(outputJson(run, 'N')).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

/* ────────────── alwaysOutputData ────────────── */

describe('alwaysOutputData — 空输出时补空 item', () => {
  it('未开启时空输出不触发下游（引擎默认语义，零回归基线）', async () => {
    const run = await runSingle(node('N', 't.empty'), { downstream: node('AFTER', 't.pass') });

    expect(run.status).toBe('success');
    expect(run.data.resultData.runData['AFTER']).toBeUndefined();
  });

  it('开启后补一个空 item，下游照常执行', async () => {
    const run = await runSingle(node('N', 't.empty', {}, { alwaysOutputData: true }), {
      downstream: node('AFTER', 't.pass'),
    });

    expect(run.status).toBe('success');
    expect(outputJson(run, 'N')).toEqual([{}]);
    expect(run.data.resultData.runData['AFTER']).toHaveLength(1);
  });

  it('节点本来就有输出时不插手', async () => {
    const seed = [{ json: { a: 1 } }];
    const run = await runSingle(node('N', 't.pass', {}, { alwaysOutputData: true }), { seed });

    expect(outputJson(run, 'N')).toEqual([{ a: 1 }]);
  });

  it('补出来的空 item 带 pairedItem 溯源（不断链）', async () => {
    const seed = [{ json: { a: 1 } }, { json: { a: 2 } }];
    const run = await runSingle(node('N', 't.empty', {}, { alwaysOutputData: true }), { seed });

    expect(lastRun(run, 'N')?.data?.['main']?.[0]?.[0]?.pairedItem).toEqual([
      { item: 0, input: 0 },
      { item: 1, input: 0 },
    ]);
  });
});

/* ────────────── executionTimeout ────────────── */

describe('executionTimeout — 整次执行的时限', () => {
  it('不设置时不限时（零回归基线）', async () => {
    const run = await runSingle(node('N', 't.slow', { ms: 60 }));

    expect(run.status).toBe('success');
  });

  it('节点跑不完时限即终止，状态为 error', async () => {
    const run = await runSingle(node('N', 't.slow', { ms: 5000 }), {
      settings: { executionTimeout: 1 },
    });

    expect(run.status).toBe('error');
    expect(run.data.resultData.error?.name).toBe('ExecutionTimeout');
  });

  it('★超时压过 onError：配了继续执行也救不回来', async () => {
    const run = await runSingle(
      node('N', 't.slow', { ms: 5000 }, { onError: 'continueErrorOutput' }),
      { settings: { executionTimeout: 1 }, downstream: node('AFTER', 't.pass') },
    );

    expect(run.status).toBe('error');
    expect(run.data.resultData.runData['AFTER']).toBeUndefined();
  });

  it('非正数视为不限时', async () => {
    const run = await runSingle(node('N', 't.slow', { ms: 60 }), {
      settings: { executionTimeout: 0 },
    });

    expect(run.status).toBe('success');
  });
});
