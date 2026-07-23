import { describe, expect, it } from 'vitest';
import type { IExecuteContext, INodeExecutionData } from '@nomops/workflow';
import { EvaluationTrigger } from '../EvaluationTrigger/EvaluationTrigger.node.js';
import { Evaluation, EVAL_METRICS_KEY, EVAL_OUTPUTS_KEY } from '../Evaluation/Evaluation.node.js';

/** 最小上下文桩（params 支持按 itemIndex 求值，模拟引擎已求值的表达式）。 */
function stubContext(
  inputs: INodeExecutionData[][],
  params: Record<string, unknown | ((i: number) => unknown)> = {},
): IExecuteContext {
  return {
    getInputData: (index = 0) => inputs[index] ?? [],
    getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
      if (!(name in params)) return fallback;
      const v = params[name];
      return typeof v === 'function' ? (v as (i: number) => unknown)(itemIndex) : v;
    },
    getCredentials: async () => ({}),
    getWorkflowStaticData: () => ({}),
    helpers: {} as IExecuteContext['helpers'],
  } as IExecuteContext;
}

describe('EvaluationTrigger 节点', () => {
  it('有 seed（service 注入的行）→ 原样透传', async () => {
    const row = [{ json: { question: 'ping', expected: 'pong' } }];
    const output = await new EvaluationTrigger().execute!.call(stubContext([row]));
    expect(output).toEqual([row]);
  });

  it('无 seed（画布手动 Execute）→ 播一个空 item', async () => {
    const output = await new EvaluationTrigger().execute!.call(stubContext([[]]));
    expect(output).toEqual([[{ json: {} }]]);
  });
});

describe('Evaluation 节点', () => {
  it('setMetrics：数值/布尔归一到 _nmMetrics，透传 json + pairedItem', async () => {
    const items = [{ json: { score: 0.9, ok: true } }];
    const output = await new Evaluation().execute!.call(
      stubContext([items], {
        operation: 'setMetrics',
        // 模拟引擎对 ={{ $json.score }} 等表达式求值后的结果
        metrics: (i: number) => ({ accuracy: items[i]!.json['score'], passed: items[i]!.json['ok'] }),
      }),
    );
    expect(output[0]).toEqual([
      {
        json: { score: 0.9, ok: true, [EVAL_METRICS_KEY]: { accuracy: 0.9, passed: 1 } },
        pairedItem: { item: 0 },
      },
    ]);
  });

  it('setMetrics：非数值指标被丢弃（指标须可聚合）', async () => {
    const output = await new Evaluation().execute!.call(
      stubContext([[{ json: {} }]], {
        operation: 'setMetrics',
        metrics: { good: 1, bad: 'not-a-number', nan: NaN, inf: Infinity },
      }),
    );
    expect((output[0]![0]!.json as Record<string, unknown>)[EVAL_METRICS_KEY]).toEqual({ good: 1 });
  });

  it('setMetrics：与 item 上已有的 _nmMetrics 合并（多个 Evaluation 节点叠加）', async () => {
    const items = [{ json: { [EVAL_METRICS_KEY]: { latency: 12 } } }];
    const output = await new Evaluation().execute!.call(
      stubContext([items], { operation: 'setMetrics', metrics: { accuracy: 1 } }),
    );
    expect((output[0]![0]!.json as Record<string, unknown>)[EVAL_METRICS_KEY]).toEqual({
      latency: 12,
      accuracy: 1,
    });
  });

  it('setOutputs：任意值写入 _nmOutputs（不强制数值）', async () => {
    const output = await new Evaluation().execute!.call(
      stubContext([[{ json: { a: 1 } }]], {
        operation: 'setOutputs',
        outputs: { answer: 'pong', confidence: 0.8 },
      }),
    );
    expect((output[0]![0]!.json as Record<string, unknown>)[EVAL_OUTPUTS_KEY]).toEqual({
      answer: 'pong',
      confidence: 0.8,
    });
  });
});
