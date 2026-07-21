import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { conditionsPass, type ICondition } from '../../lib/conditions.js';
import { filterDescription } from './Filter.description.js';

/** 过滤：条件命中的 item 通过，其余丢弃（If 的单输出变体）。 */
export class Filter implements INodeType {
  description = filterDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const kept: INodeExecutionData[] = [];

    for (const [i, item] of items.entries()) {
      const conditions = (this.getNodeParameter('conditions', i, []) ?? []) as ICondition[];
      const combine = (this.getNodeParameter('combine', i, 'and') ?? 'and') as 'and' | 'or';
      if (conditionsPass(conditions, combine)) kept.push({ json: item.json, pairedItem: { item: i } });
    }

    return [kept];
  }
}
