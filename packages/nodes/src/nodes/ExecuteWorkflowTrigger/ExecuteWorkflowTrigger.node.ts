import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { executeWorkflowTriggerDescription } from './ExecuteWorkflowTrigger.description.js';

/**
 * 子工作流被调方起点：真实调用时父流入参经 engine.run 作为本节点**输入**进来 → 原样透传；
 * 手动调试（无入参）时吐一个空 item 方便下游开发。
 */
export class ExecuteWorkflowTrigger implements INodeType {
  description = executeWorkflowTriggerDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    return [items.length > 0 ? items : [{ json: {} }]];
  }
}
