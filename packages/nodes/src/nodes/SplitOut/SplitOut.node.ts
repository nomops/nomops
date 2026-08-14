import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { cloneJsonObject, deletePath, isPlainObject, parseFieldList } from '../../lib/data-transform.js';
import { getPath } from '../../lib/object-path.js';
import { splitOutDescription } from './SplitOut.description.js';

function readField(json: JsonObject, field: string, disableDotNotation: boolean): unknown {
  return disableDotNotation ? json[field] : getPath(json, field);
}

function entities(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === 'object') return Object.values(value as Record<string, unknown>);
  return [value];
}

/** Baseline-compatible multi-field Split Out, including selected fields and binary splitting. */
export class SplitOut implements INodeType {
  description = splitOutDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const out: INodeExecutionData[] = [];
    for (const [itemIndex, input] of this.getInputData().entries()) {
      const fields = parseFieldList(this.getNodeParameter('fieldToSplitOut', itemIndex, ''))
        .map((field) => field.replace(/^\$json\./, ''));
      if (fields.length === 0) throw new OperationalError('Split Out: "Fields To Split Out" is required', {});

      const options = this.getNodeParameter('options', itemIndex, {}) as {
        disableDotNotation?: boolean; destinationFieldName?: string; includeBinary?: boolean;
      };
      const legacyDestination = String(this.getNodeParameter('destinationFieldName', itemIndex, '') ?? '');
      const destinations = parseFieldList(options.destinationFieldName ?? legacyDestination);
      if (destinations.length > 0 && destinations.length !== fields.length) {
        throw new OperationalError(
          'Split Out: if multiple fields are given, the same number of destination fields must be given',
          {},
        );
      }

      const include = String(this.getNodeParameter('include', itemIndex, 'noOtherFields'));
      const disableDots = options.disableDotNotation === true;
      const rows: INodeExecutionData[] = [];
      for (const [fieldIndex, field] of fields.entries()) {
        if (field === '$binary') {
          for (const [elementIndex, [key, binary]] of Object.entries(input.binary ?? {}).entries()) {
            rows[elementIndex] ??= { json: {}, pairedItem: { item: itemIndex } };
            rows[elementIndex]!.binary ??= {};
            rows[elementIndex]!.binary![key] = binary;
          }
          continue;
        }

        const values = entities(readField(input.json, field, disableDots));
        for (const [elementIndex, element] of values.entries()) {
          rows[elementIndex] ??= { json: {}, pairedItem: { item: itemIndex } };
          const destination = destinations[fieldIndex] ?? '';
          if (isPlainObject(element) && include === 'noOtherFields' && !destination && fields.length === 1) {
            Object.assign(rows[elementIndex]!.json, element);
          } else {
            rows[elementIndex]!.json[destination || field] = element;
          }
        }
      }

      for (const row of rows) {
        if (include === 'allOtherFields') {
          const base = cloneJsonObject(input.json);
          for (const field of fields) {
            if (field === '$binary') continue;
            if (disableDots) delete base[field];
            else deletePath(base, field);
          }
          row.json = { ...base, ...row.json };
        } else if (include === 'selectedOtherFields') {
          const selected = parseFieldList(this.getNodeParameter('fieldsToInclude', itemIndex, ''));
          if (selected.length === 0) throw new OperationalError('Split Out: please add a field to include', {});
          for (const field of selected) row.json[field] = readField(input.json, field, disableDots);
        }
        if (options.includeBinary === true && input.binary && !row.binary) row.binary = input.binary;
        out.push(row);
      }
    }
    return [out];
  }
}
