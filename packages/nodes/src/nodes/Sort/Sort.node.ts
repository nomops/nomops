import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { getPath } from '../../lib/object-path.js';
import { parseFieldList, stableStringify } from '../../lib/data-transform.js';
import { sortDescription } from './Sort.description.js';

interface ISortField {
  fieldName?: unknown;
  direction?: unknown;
  compareAs?: unknown;
  customOrder?: unknown;
}

function compareValues(left: unknown, right: unknown, field: ISortField, caseSensitive: boolean): number {
  if (left === right) return 0;
  if (left === undefined || left === null) return 1;
  if (right === undefined || right === null) return -1;

  const compareAs = String(field.compareAs ?? 'auto');
  if (compareAs === 'customOrder') {
    const order = parseFieldList(field.customOrder);
    if (order.length === 0) throw new OperationalError('Sort: Custom Order must list at least one value', {});
    const leftIndex = order.indexOf(String(left));
    const rightIndex = order.indexOf(String(right));
    if (leftIndex !== rightIndex) {
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    }
  }

  if (compareAs === 'number') {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
      throw new OperationalError('Sort: Number comparison received a non-numeric value', {});
    }
    return leftNumber - rightNumber;
  }

  if (compareAs === 'auto' && typeof left === 'number' && typeof right === 'number') return left - right;
  if (compareAs === 'auto' && typeof left !== 'string' && typeof right !== 'string') {
    return stableStringify(left).localeCompare(stableStringify(right));
  }

  const leftText = caseSensitive ? String(left) : String(left).toLocaleLowerCase();
  const rightText = caseSensitive ? String(right) : String(right).toLocaleLowerCase();
  return leftText.localeCompare(rightText, undefined, { numeric: true });
}

export class Sort implements INodeType {
  description = sortDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = [...this.getInputData()];
    const raw = this.getNodeParameter('sortFields', 0, { fields: [] }) as { fields?: ISortField[] };
    const fields = raw.fields ?? [];
    const caseSensitive = Boolean(this.getNodeParameter('caseSensitive', 0, false));
    if (fields.length === 0 || fields.some(({ fieldName }) => !String(fieldName ?? '').trim())) {
      throw new OperationalError('Sort: add at least one field to sort by', {});
    }

    items.sort((left, right) => {
      for (const field of fields) {
        const direction = field.direction === 'descending' ? -1 : 1;
        const result = compareValues(
          getPath(left.json, String(field.fieldName)),
          getPath(right.json, String(field.fieldName)),
          field,
          caseSensitive,
        );
        if (result !== 0) return result * direction;
      }
      return 0;
    });
    return [items];
  }
}
