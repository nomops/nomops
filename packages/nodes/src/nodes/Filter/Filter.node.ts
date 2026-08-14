import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { conditionsPass, type ICondition } from '../../lib/conditions.js';
import { filterDescription } from './Filter.description.js';

type StructuredCondition = {
  leftValue?: unknown;
  rightValue?: unknown;
  operator?: { operation?: unknown };
};

function normalizeConditions(value: unknown): { conditions: ICondition[]; combine: 'and' | 'or' } {
  if (Array.isArray(value)) return { conditions: value as ICondition[], combine: 'and' };
  if (value === null || typeof value !== 'object') return { conditions: [], combine: 'and' };
  const group = value as { conditions?: StructuredCondition[]; combinator?: unknown };
  const aliases: Record<string, ICondition['op']> = {
    equals: 'eq', notEquals: 'ne', larger: 'gt', largerEqual: 'gte', smaller: 'lt', smallerEqual: 'lte',
    contains: 'contains', empty: 'isEmpty', notEmpty: 'isNotEmpty',
  };
  return {
    combine: group.combinator === 'or' ? 'or' : 'and',
    conditions: (group.conditions ?? []).map((condition) => ({
      left: condition.leftValue,
      right: condition.rightValue,
      op: aliases[String(condition.operator?.operation ?? 'eq')] ?? String(condition.operator?.operation ?? 'eq') as ICondition['op'],
    })),
  };
}

/** 过滤：条件命中的 item 通过，其余丢弃（If 的单输出变体）。 */
export class Filter implements INodeType {
  description = filterDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const kept: INodeExecutionData[] = [];
    const discarded: INodeExecutionData[] = [];

    for (const [i, item] of items.entries()) {
      const normalized = normalizeConditions(this.getNodeParameter('conditions', i, []));
      const legacyCombine = this.getNodeParameter('combine', i, undefined);
      const combine = legacyCombine === 'or' ? 'or' : normalized.combine;
      const convertTypes = Boolean(this.getNodeParameter('looseTypeValidation', i, false));
      const options = this.getNodeParameter('options', i, {}) as { ignoreCase?: boolean };
      const output = item.pairedItem === undefined ? { ...item, pairedItem: { item: i } } : item;
      if (conditionsPass(normalized.conditions, combine, convertTypes, options.ignoreCase === true)) kept.push(output);
      else discarded.push(output);
    }

    return [kept, discarded];
  }
}
