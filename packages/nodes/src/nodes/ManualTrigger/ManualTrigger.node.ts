import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { manualTriggerDescription } from './ManualTrigger.description.js';

/**
 * 手动触发起点：手动运行时播下一个空 item 供下游消费。
 * Phase 1 占位实现（用 execute 播种）；真正的触发器机制在 Phase 5。
 */
export class ManualTrigger implements INodeType {
  description = manualTriggerDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    return [[{ json: {} }]];
  }
}
