import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { setDescription } from './Set.description.js';

/** 给每个输入 item 合并一组字段，输出到单一端口。带 pairedItem 溯源。 */
export class Set implements INodeType {
  description = setDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    for (const [i, item] of items.entries()) {
      const fields = (this.getNodeParameter('fields', i, {}) ?? {}) as Record<string, unknown>;
      returnData.push({
        json: { ...item.json, ...fields },
        pairedItem: { item: i },
      });
    }
    return [returnData];
  }
}
