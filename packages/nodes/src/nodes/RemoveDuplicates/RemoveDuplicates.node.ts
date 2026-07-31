import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { getPath } from '../../lib/object-path.js';
import { parseFieldList, stableStringify, withoutPaths } from '../../lib/data-transform.js';
import { removeDuplicatesDescription } from './RemoveDuplicates.description.js';

function comparisonValue(json: JsonObject, mode: string, fields: string[]): unknown {
  if (mode === 'selectedFields') return fields.map((field) => getPath(json, field));
  if (mode === 'allFieldsExcept') return withoutPaths(json, fields);
  return json;
}

export class RemoveDuplicates implements INodeType {
  description = removeDuplicatesDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const compare = String(this.getNodeParameter('compare', 0, 'allFields'));
    const fields = parseFieldList(this.getNodeParameter('fields', 0, ''));
    const keep = String(this.getNodeParameter('keep', 0, 'first'));
    if (compare !== 'allFields' && fields.length === 0) {
      throw new OperationalError('Remove Duplicates: Fields is required for the selected compare mode', {});
    }

    const seen = new Set<string>();
    const kept: INodeExecutionData[] = [];
    const candidates = keep === 'last' ? [...items].reverse() : items;
    for (const item of candidates) {
      const key = stableStringify(comparisonValue(item.json, compare, fields));
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(item);
    }
    return [keep === 'last' ? kept.reverse() : kept];
  }
}
