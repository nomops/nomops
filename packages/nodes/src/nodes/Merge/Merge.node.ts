import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { mergeDescription } from './Merge.description.js';

/**
 * 合并两路输入。「等两路都到齐才执行」由引擎的 waitingExecution 保证，
 * 节点本身只做合并计算。
 */
export class Merge implements INodeType {
  description = mergeDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const input0 = this.getInputData(0);
    const input1 = this.getInputData(1);
    const mode = (this.getNodeParameter('mode', 0, 'append') ?? 'append') as string;

    if (mode === 'combineByPosition') {
      const length = Math.max(input0.length, input1.length);
      const out: INodeExecutionData[] = [];
      for (let i = 0; i < length; i++) {
        out.push({
          json: { ...(input0[i]?.json ?? {}), ...(input1[i]?.json ?? {}) },
          pairedItem: { item: i },
        });
      }
      return [out];
    }

    // append：input0 全部 + input1 全部
    return [[...input0, ...input1]];
  }
}
