import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { noOpDescription } from './NoOp.description.js';

/** 原样透传输入到输出端口。 */
export class NoOp implements INodeType {
  description = noOpDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    return [this.getInputData()];
  }
}
