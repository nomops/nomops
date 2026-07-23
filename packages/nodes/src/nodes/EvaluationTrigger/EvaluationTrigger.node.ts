import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { evaluationTriggerDescription } from './EvaluationTrigger.description.js';

/**
 * 评测触发起点：EvaluationService 逐行运行时把该行数据 seed 进本节点输入，
 * execute 原样交给下游（对标 ChatTrigger 的 seed-passthrough）。
 * 无 seed（画布手动 Execute）时播一个空 item，方便调试 downstream 节点。
 */
export class EvaluationTrigger implements INodeType {
  description = evaluationTriggerDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const seeded = this.getInputData();
    return [seeded.length ? seeded : [{ json: {} }]];
  }
}
