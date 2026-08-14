import type { IBinaryData, IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { getPath } from '../../lib/object-path.js';
import { parseFieldList, setPath } from '../../lib/data-transform.js';
import { aggregateDescription } from './Aggregate.description.js';

interface AggregateField { fieldToAggregate?: unknown; renameField?: unknown; outputFieldName?: unknown }

function addBinaries(output: INodeExecutionData, items: INodeExecutionData[], uniqueOnly: boolean): void {
  const fingerprints = new Set<string>();
  for (const item of items) for (const [originalKey, binary] of Object.entries(item.binary ?? {})) {
    const fingerprint = `${binary.mimeType}|${binary.fileSize ?? ''}|${binary.fileExtension ?? ''}`;
    if (uniqueOnly && fingerprints.has(fingerprint)) continue;
    fingerprints.add(fingerprint);
    output.binary ??= {};
    let key = originalKey;
    for (let suffix = 1; output.binary[key]; suffix++) key = `${originalKey}_${suffix}`;
    output.binary[key] = binary as IBinaryData;
  }
}

export class Aggregate implements INodeType {
  description = aggregateDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    if (items.length === 0) return [[]];
    const aggregateParam = this.getNodeParameter('aggregate', 0, undefined);
    const legacyMode = this.getNodeParameter('mode', 0, undefined);
    const mode = aggregateParam === undefined
      ? (legacyMode === 'allItemData' ? 'aggregateAllItemData' : 'aggregateIndividualFields')
      : String(aggregateParam);
    const options = this.getNodeParameter('options', 0, {}) as {
      disableDotNotation?: boolean; mergeLists?: boolean; includeBinaries?: boolean;
      keepOnlyUnique?: boolean; keepMissing?: boolean;
    };

    if (mode === 'aggregateAllItemData') {
      const destination = String(this.getNodeParameter('destinationFieldName', 0, 'data') ?? '').trim() || 'data';
      const include = String(this.getNodeParameter('include', 0, 'allFields'));
      const includeFields = parseFieldList(this.getNodeParameter('fieldsToInclude', 0, ''));
      const excludeFields = parseFieldList(this.getNodeParameter('fieldsToExclude', 0, ''));
      const aggregated: JsonObject[] = [];
      const pairedItem: Array<{ item: number }> = [];
      for (const [index, item] of items.entries()) {
        const keys = Object.keys(item.json).filter((key) =>
          include === 'specifiedFields' ? includeFields.includes(key)
            : include === 'allFieldsExcept' ? !excludeFields.includes(key) : true,
        );
        const json = Object.fromEntries(keys.map((key) => [key, item.json[key]]));
        if (Object.keys(json).length === 0 && include !== 'allFields') continue;
        aggregated.push(json);
        pairedItem.push({ item: index });
      }
      const output: INodeExecutionData = { json: { [destination]: aggregated }, pairedItem };
      if (options.includeBinaries) addBinaries(output, pairedItem.map(({ item }) => items[item]!), options.keepOnlyUnique === true);
      return [[output]];
    }

    const rawFields = this.getNodeParameter('fieldsToAggregate', 0, { fieldToAggregate: [] });
    const fields: AggregateField[] = typeof rawFields === 'string'
      ? parseFieldList(rawFields).map((fieldToAggregate) => ({ fieldToAggregate, renameField: false }))
      : ((rawFields as { fieldToAggregate?: AggregateField[] })?.fieldToAggregate ?? []);
    if (fields.length === 0 || fields.every((field) => !String(field.fieldToAggregate ?? '').trim())) {
      throw new OperationalError('Aggregate: please add a field to aggregate', {});
    }

    const json: JsonObject = {};
    const outputNames = new Set<string>();
    for (const field of fields) {
      const inputName = String(field.fieldToAggregate ?? '').trim();
      if (!inputName) continue;
      const leaf = options.disableDotNotation ? inputName : inputName.split('.').at(-1)!;
      const outputName = field.renameField ? String(field.outputFieldName ?? '').trim() || leaf : leaf;
      if (outputNames.has(outputName)) throw new OperationalError(`Aggregate: output field '${outputName}' is used more than once`, {});
      outputNames.add(outputName);
      const values: unknown[] = [];
      for (const item of items) {
        let value = options.disableDotNotation ? item.json[inputName] : getPath(item.json, inputName);
        if (!options.keepMissing) {
          if (Array.isArray(value)) value = value.filter((entry) => entry !== null);
          else if (value === null || value === undefined) continue;
        } else if (value === undefined) value = null;
        if (Array.isArray(value) && options.mergeLists) values.push(...value);
        else values.push(value);
      }
      if (options.disableDotNotation) json[outputName] = values;
      else setPath(json, outputName, values);
    }
    const output: INodeExecutionData = { json, pairedItem: items.map((_, item) => ({ item })) };
    if (options.includeBinaries) addBinaries(output, items, options.keepOnlyUnique === true);
    return [[output]];
  }
}
