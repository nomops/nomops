import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { setDescription } from './Set.description.js';

/** 给每个输入 item 合并一组字段，输出到单一端口。带 pairedItem 溯源。 */
export class Set implements INodeType {
  description = setDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    for (const [i, item] of items.entries()) {
      const mode = String(this.getNodeParameter('mode', i, 'manual') ?? 'manual');
      const candidate = mode === 'raw'
        ? this.getNodeParameter('jsonOutput', i, {})
        : this.getNodeParameter('fields', i, {});
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new OperationalError('Edit Fields JSON Output must be an object', { itemIndex: i });
      }
      const fields = candidate as Record<string, unknown>;
      const includeOtherFields = Boolean(this.getNodeParameter('includeOtherFields', i, true));
      const options = (this.getNodeParameter('options', i, {}) ?? {}) as Record<string, unknown>;
      const dotNotation = options['dotNotation'] !== false;
      const assigned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (!dotNotation || !key.includes('.')) {
          assigned[key] = value;
          continue;
        }
        const parts = key.split('.').filter(Boolean);
        let target = assigned;
        for (const part of parts.slice(0, -1)) {
          const next = target[part];
          target[part] = next && typeof next === 'object' && !Array.isArray(next) ? next : {};
          target = target[part] as Record<string, unknown>;
        }
        if (parts.at(-1)) target[parts.at(-1)!] = value;
      }
      returnData.push({
        json: includeOtherFields ? { ...item.json, ...assigned } : assigned,
        pairedItem: { item: i },
      });
    }
    return [returnData];
  }
}
