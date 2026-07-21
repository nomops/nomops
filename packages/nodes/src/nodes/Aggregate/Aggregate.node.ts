import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { getPath } from '../../lib/object-path.js';
import { aggregateDescription } from './Aggregate.description.js';

/** 全部输入 item 聚成单个 item：整包进列表字段,或逐字段收成列表。 */
export class Aggregate implements INodeType {
  description = aggregateDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    if (items.length === 0) return [[]];
    const pairedItem = items.map((_, i) => ({ item: i }));

    const mode = (this.getNodeParameter('mode', 0, 'allItemData') ?? 'allItemData') as string;

    if (mode === 'allItemData') {
      const dest = String(this.getNodeParameter('destinationFieldName', 0, 'data') ?? 'data').trim() || 'data';
      return [[{ json: { [dest]: items.map((it) => it.json) }, pairedItem }]];
    }

    const fieldsRaw = String(this.getNodeParameter('fieldsToAggregate', 0, '') ?? '');
    const fields = fieldsRaw.split(',').map((f) => f.trim()).filter(Boolean);
    if (fields.length === 0) {
      throw new OperationalError('Aggregate: "Fields To Aggregate" is required in individual-fields mode', {});
    }
    const json: JsonObject = {};
    for (const path of fields) {
      const leaf = path.split('.').at(-1)!;
      json[leaf] = items.map((it) => (getPath(it.json, path) ?? null) as JsonObject[keyof JsonObject]);
    }
    return [[{ json, pairedItem }]];
  }
}
