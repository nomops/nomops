import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { evaluationDescription } from './Evaluation.description.js';

/** 保留命名空间：EvaluationService 从 item.json 提取这两个键。 */
export const EVAL_METRICS_KEY = '_nmMetrics';
export const EVAL_OUTPUTS_KEY = '_nmOutputs';

/** 把值强制成有限数值（指标必须可聚合）；非数值/NaN/±Infinity → 丢弃。 */
function toMetric(value: unknown): number | undefined {
  const n = typeof value === 'boolean' ? Number(value) : Number(value as number);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 记分节点：把指标/输出合并进每个 item 的 json 保留键，透传下游。带 pairedItem 溯源。
 */
export class Evaluation implements INodeType {
  description = evaluationDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    for (const [i, item] of items.entries()) {
      const operation = this.getNodeParameter('operation', i, 'setMetrics') as string;
      const extra: JsonObject = {};

      if (operation === 'setMetrics') {
        const raw = (this.getNodeParameter('metrics', i, {}) ?? {}) as Record<string, unknown>;
        const metrics: Record<string, number> = {};
        for (const [name, value] of Object.entries(raw)) {
          const n = toMetric(value);
          if (n !== undefined) metrics[name] = n;
        }
        extra[EVAL_METRICS_KEY] = { ...(item.json[EVAL_METRICS_KEY] as JsonObject), ...metrics };
      } else {
        const outputs = (this.getNodeParameter('outputs', i, {}) ?? {}) as JsonObject;
        extra[EVAL_OUTPUTS_KEY] = { ...(item.json[EVAL_OUTPUTS_KEY] as JsonObject), ...outputs };
      }

      returnData.push({ json: { ...item.json, ...extra }, pairedItem: { item: i } });
    }
    return [returnData];
  }
}
