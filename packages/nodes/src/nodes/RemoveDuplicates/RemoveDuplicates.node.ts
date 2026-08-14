import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { getPath } from '../../lib/object-path.js';
import { parseFieldList, setPath, stableStringify, withoutPaths } from '../../lib/data-transform.js';
import { removeDuplicatesDescription } from './RemoveDuplicates.description.js';

interface HistoryStore { entries?: string[]; latestIncrementalKey?: number; latestDate?: number }

function read(json: JsonObject, path: string, disableDots: boolean): unknown {
  return disableDots ? json[path] : getPath(json, path);
}

function comparisonValue(json: JsonObject, mode: string, fields: string[], disableDots: boolean): unknown {
  if (mode === 'selectedFields') return fields.map((field) => read(json, field, disableDots));
  if (mode === 'allFieldsExcept') {
    if (!disableDots) return withoutPaths(json, fields);
    return Object.fromEntries(Object.entries(json).filter(([key]) => !fields.includes(key)));
  }
  return json;
}

function projectedJson(json: JsonObject, mode: string, fields: string[], disableDots: boolean): JsonObject {
  if (mode === 'selectedFields') {
    const output: JsonObject = {};
    for (const field of fields) {
      if (disableDots) output[field] = json[field];
      else setPath(output, field, getPath(json, field));
    }
    return output;
  }
  return mode === 'allFieldsExcept' ? comparisonValue(json, mode, fields, disableDots) as JsonObject : json;
}

function historyStore(context: IExecuteContext, scope: unknown): HistoryStore {
  const root = context.getWorkflowStaticData(scope === 'workflow' ? 'global' : 'node');
  const key = 'removeDuplicatesHistory';
  const current = root[key];
  if (current === null || typeof current !== 'object' || Array.isArray(current)) root[key] = {};
  return root[key] as HistoryStore;
}

export class RemoveDuplicates implements INodeType {
  description = removeDuplicatesDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const operation = String(this.getNodeParameter('operation', 0, 'removeDuplicateInputItems'));
    const options = this.getNodeParameter('options', 0, {}) as {
      disableDotNotation?: boolean; removeOtherFields?: boolean; scope?: string; historySize?: number;
    };

    if (operation === 'clearDeduplicationHistory') {
      const root = this.getWorkflowStaticData(options.scope === 'workflow' ? 'global' : 'node');
      delete root['removeDuplicatesHistory'];
      return [items];
    }

    if (operation === 'removeItemsSeenInPreviousExecutions') {
      const store = historyStore(this, options.scope);
      const logic = String(this.getNodeParameter('logic', 0, 'removeItemsWithAlreadySeenKeyValues'));
      const kept: INodeExecutionData[] = [];
      const discarded: INodeExecutionData[] = [];
      if (logic === 'removeItemsWithAlreadySeenKeyValues') {
        const groups = new Map<string, INodeExecutionData[]>();
        for (const [index, item] of items.entries()) {
          const key = String(this.getNodeParameter('dedupeValue', index, '') ?? '');
          const group = groups.get(key) ?? [];
          group.push(item); groups.set(key, group);
        }
        const history = new Set(store.entries ?? []);
        const max = Number(options.historySize ?? 10000);
        if (!Number.isFinite(max) || max < 0) throw new OperationalError('Remove Duplicates: History Size must be non-negative', {});
        if (history.size + items.length > max) {
          throw new OperationalError('Remove Duplicates: items exceed the maximum history size', {});
        }
        for (const [key, group] of groups) {
          (history.has(key) ? discarded : kept).push(...group);
          history.add(key);
        }
        store.entries = [...history];
        return [kept, discarded];
      }

      if (logic === 'removeItemsUpToStoredIncrementalKey') {
        const previous = store.latestIncrementalKey;
        let next = previous;
        for (const [index, item] of items.entries()) {
          const raw = this.getNodeParameter('incrementalDedupeValue', index, '');
          if (String(raw ?? '') === '') throw new OperationalError('Remove Duplicates: Value to Dedupe On is empty', {});
          const value = Number(raw);
          if (!Number.isFinite(value)) throw new OperationalError(`Remove Duplicates: '${String(raw)}' is not a number`, {});
          (previous === undefined || value > previous ? kept : discarded).push(item);
          next = next === undefined ? value : Math.max(next, value);
        }
        store.latestIncrementalKey = next;
        return [kept, discarded];
      }

      if (logic === 'removeItemsUpToStoredDate') {
        const previous = store.latestDate;
        let next = previous;
        for (const [index, item] of items.entries()) {
          const raw = String(this.getNodeParameter('dateDedupeValue', index, '') ?? '');
          const value = Date.parse(raw);
          if (!raw || !Number.isFinite(value)) throw new OperationalError(`Remove Duplicates: '${raw}' is not a valid date`, {});
          (previous === undefined || value > previous ? kept : discarded).push(item);
          next = next === undefined ? value : Math.max(next, value);
        }
        store.latestDate = next;
        return [kept, discarded];
      }
      return [items, []];
    }

    const compare = String(this.getNodeParameter('compare', 0, 'allFields'));
    const baselineFields = compare === 'selectedFields'
      ? this.getNodeParameter('fieldsToCompare', 0, undefined)
      : this.getNodeParameter('fieldsToExclude', 0, undefined);
    const fields = parseFieldList(baselineFields ?? this.getNodeParameter('fields', 0, ''));
    if (compare !== 'allFields' && fields.length === 0) {
      throw new OperationalError('Remove Duplicates: please add a field to compare or exclude', {});
    }

    const keepLast = this.getNodeParameter('keep', 0, 'first') === 'last';
    const candidates = keepLast ? [...items].reverse() : items;
    const seen = new Set<string>();
    const kept: INodeExecutionData[] = [];
    const discarded: INodeExecutionData[] = [];
    for (const item of candidates) {
      const key = stableStringify(comparisonValue(item.json, compare, fields, options.disableDotNotation === true));
      if (seen.has(key)) discarded.push(item);
      else {
        seen.add(key);
        kept.push(options.removeOtherFields ? {
          ...item,
          json: projectedJson(item.json, compare, fields, options.disableDotNotation === true),
        } : item);
      }
    }
    return [keepLast ? kept.reverse() : kept];
  }
}
