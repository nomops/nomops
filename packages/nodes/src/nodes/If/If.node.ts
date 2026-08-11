import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { conditionsPass, type ICondition } from '../../lib/conditions.js';
import { ifDescription } from './If.description.js';

/** 按条件分流：满足 → 输出0（true），否则 → 输出1（false）。逐 item 判定。 */
export class If implements INodeType {
  description = ifDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const trueItems: INodeExecutionData[] = [];
    const falseItems: INodeExecutionData[] = [];

    for (const [i, item] of items.entries()) {
      // getNodeParameter 已对条件里的表达式（如 left: "={{ $json.amount }}"）求值
      const conditions = (this.getNodeParameter('conditions', i, []) ?? []) as ICondition[];
      const options = (this.getNodeParameter('options', i, {}) ?? {}) as Record<string, unknown>;
      const combine = (options['combine'] ?? this.getNodeParameter('combine', i, 'and') ?? 'and') as 'and' | 'or';
      const convertTypes = Boolean(this.getNodeParameter('convertTypes', i, false));
      (conditionsPass(conditions, combine, convertTypes) ? trueItems : falseItems).push({
        json: item.json,
        pairedItem: { item: i },
      });
    }

    return [trueItems, falseItems];
  }
}
