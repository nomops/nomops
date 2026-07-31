import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { getPath } from '../../lib/object-path.js';
import { parseFieldList, setPath, stableStringify } from '../../lib/data-transform.js';
import { summarizeDescription } from './Summarize.description.js';

interface IAggregation {
  operation?: unknown;
  field?: unknown;
  outputField?: unknown;
  separator?: unknown;
}

function defaultOutputName(operation: string, field: string): string {
  const leaf = field.split('.').filter(Boolean).at(-1) ?? 'items';
  return `${operation}_${leaf}`;
}

function numericValues(values: unknown[]): number[] {
  return values
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite);
}

export class Summarize implements INodeType {
  description = summarizeDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    if (items.length === 0) return [[]];
    const configured = this.getNodeParameter('aggregations', 0, { values: [] }) as { values?: IAggregation[] };
    const aggregations = configured.values ?? [];
    if (aggregations.length === 0) throw new OperationalError('Summarize: add at least one aggregation', {});
    const groupBy = parseFieldList(this.getNodeParameter('groupBy', 0, ''));
    const groups = new Map<string, { values: unknown[]; indexes: number[]; groupValues: unknown[] }>();

    for (const [index, item] of items.entries()) {
      const groupValues = groupBy.map((field) => getPath(item.json, field));
      const key = stableStringify(groupValues);
      const group = groups.get(key) ?? { values: [], indexes: [], groupValues };
      group.values.push(item.json);
      group.indexes.push(index);
      groups.set(key, group);
    }

    const output: INodeExecutionData[] = [];
    for (const group of groups.values()) {
      const json: JsonObject = {};
      groupBy.forEach((field, index) => setPath(json, field, group.groupValues[index]));

      for (const aggregation of aggregations) {
        const operation = String(aggregation.operation ?? 'count');
        const field = String(aggregation.field ?? '').trim();
        if (operation !== 'count' && !field) {
          throw new OperationalError(`Summarize: ${operation} requires a field`, {});
        }
        const values = field ? group.values.map((value) => getPath(value, field)) : group.values;
        let result: unknown;
        if (operation === 'sum') {
          result = numericValues(values).reduce((total, value) => total + value, 0);
        } else if (operation === 'average') {
          const numbers = numericValues(values);
          result = numbers.length ? numbers.reduce((total, value) => total + value, 0) / numbers.length : null;
        } else if (operation === 'concatenate') {
          result = values
            .filter((value) => value !== null && value !== undefined && value !== '')
            .map(String)
            .join(String(aggregation.separator ?? ', '));
        } else if (operation === 'count') {
          result = field
            ? values.filter((value) => value !== null && value !== undefined && value !== '').length
            : group.values.length;
        } else {
          throw new OperationalError(`Summarize: unsupported aggregation ${operation}`, {});
        }
        const outputField = String(aggregation.outputField ?? '').trim() || defaultOutputName(operation, field);
        setPath(json, outputField, result);
      }
      output.push({ json, pairedItem: group.indexes.map((item) => ({ item })) });
    }
    return [output];
  }
}
