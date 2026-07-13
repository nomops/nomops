import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { ifDescription } from './If.description.js';

interface ICondition {
  left: unknown;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'isEmpty' | 'isNotEmpty';
  right?: unknown;
}

function compare(c: ICondition): boolean {
  const { left, op, right } = c;
  switch (op) {
    case 'eq':
      return left === right;
    case 'ne':
      return left !== right;
    case 'gt':
      return (left as number) > (right as number);
    case 'gte':
      return (left as number) >= (right as number);
    case 'lt':
      return (left as number) < (right as number);
    case 'lte':
      return (left as number) <= (right as number);
    case 'contains':
      return String(left).includes(String(right));
    case 'isEmpty':
      return left === null || left === undefined || left === '';
    case 'isNotEmpty':
      return !(left === null || left === undefined || left === '');
    default:
      throw new OperationalError(`IF: unsupported comparison operator: ${String(op)}`, { op });
  }
}

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
      const combine = (this.getNodeParameter('combine', i, 'and') ?? 'and') as 'and' | 'or';

      const results = conditions.map(compare);
      const pass =
        conditions.length === 0 ||
        (combine === 'and' ? results.every(Boolean) : results.some(Boolean));

      (pass ? trueItems : falseItems).push({ json: item.json, pairedItem: { item: i } });
    }

    return [trueItems, falseItems];
  }
}
