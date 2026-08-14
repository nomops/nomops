import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { getPath } from '../../lib/object-path.js';
import { parseFieldList, stableStringify } from '../../lib/data-transform.js';
import { sortIndexesByCode } from './code-sandbox.js';
import { sortDescription } from './Sort.description.js';

interface SortField {
  fieldName?: unknown; order?: unknown; direction?: unknown; compareAs?: unknown; customOrder?: unknown;
}

function compareValues(left: unknown, right: unknown, field: SortField, legacyCaseSensitive: boolean): number {
  if (left === right) return 0;
  if (left === undefined || left === null) return 1;
  if (right === undefined || right === null) return -1;
  if (field.compareAs === 'customOrder') {
    const order = parseFieldList(field.customOrder);
    const a = order.indexOf(String(left));
    const b = order.indexOf(String(right));
    if (a !== b) return a < 0 ? 1 : b < 0 ? -1 : a - b;
  }
  if (field.compareAs === 'number') {
    const a = Number(left); const b = Number(right);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new OperationalError('Sort: Number comparison received a non-numeric value', {});
    return a - b;
  }
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left !== 'string' && typeof right !== 'string') return stableStringify(left).localeCompare(stableStringify(right));
  const a = legacyCaseSensitive ? String(left) : String(left).toLocaleLowerCase();
  const b = legacyCaseSensitive ? String(right) : String(right).toLocaleLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

export class Sort implements INodeType {
  description = sortDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = [...this.getInputData()];
    const typeParam = this.getNodeParameter('type', 0, undefined);
    const type = typeParam === undefined ? 'legacy' : String(typeParam);
    if (type === 'random') {
      for (let index = items.length - 1; index > 0; index--) {
        const target = Math.floor(Math.random() * (index + 1));
        [items[index], items[target]] = [items[target]!, items[index]!];
      }
      return [items];
    }
    if (type === 'code') {
      const code = String(this.getNodeParameter('code', 0, '') ?? '');
      if (!/\breturn\b/.test(code)) throw new OperationalError("Sort code doesn't return. Please add a 'return' statement", {});
      try {
        const indexes = await sortIndexesByCode(items.map((item) => item.json), code);
        return [indexes.map((index) => items[index]!)];
      } catch (error) {
        throw new OperationalError(`Sort code failed: ${(error as Error).message}`, {});
      }
    }

    const legacy = type === 'legacy';
    const fields: SortField[] = legacy
      ? (this.getNodeParameter('sortFields', 0, { fields: [] }) as { fields?: SortField[] }).fields ?? []
      : (this.getNodeParameter('sortFieldsUi', 0, {}) as { sortField?: SortField[] }).sortField ?? [];
    if (fields.length === 0 || fields.some((field) => !String(field.fieldName ?? '').trim())) {
      throw new OperationalError('Sort: add at least one field to sort by', {});
    }
    const disableDots = (this.getNodeParameter('options', 0, {}) as { disableDotNotation?: boolean }).disableDotNotation === true;
    const caseSensitive = legacy && Boolean(this.getNodeParameter('caseSensitive', 0, false));
    for (const field of fields) {
      const name = String(field.fieldName);
      if (!items.some((item) => (disableDots ? item.json[name] : getPath(item.json, name)) !== undefined)) {
        throw new OperationalError(`Sort: couldn't find the field '${name}' in the input data`, {});
      }
    }
    items.sort((left, right) => {
      for (const field of fields) {
        const name = String(field.fieldName);
        const result = compareValues(
          disableDots ? left.json[name] : getPath(left.json, name),
          disableDots ? right.json[name] : getPath(right.json, name),
          field,
          caseSensitive,
        );
        if (result !== 0) return result * ((field.order ?? field.direction) === 'descending' ? -1 : 1);
      }
      return 0;
    });
    return [items];
  }
}
