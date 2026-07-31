import type { IExecuteContext, INodeExecutionData, INodeType, INodeTypeDescription, JsonObject } from '@nomops/workflow';

/**
 * 执行自定义元数据（backlog #35）：工作流内写 KV，跑完由 ExecutionService 提取落
 * execution_metadata，执行列表可按键值检索。
 *
 * 引擎零耦合（守铁律五）：节点只把 KV 合并进 item.json 的保留键 `_nmMetadata`，
 * 服务层从 runData 提取——不需要引擎/服务对本节点做任何特判。值统一转字符串
 * （metadata 值是 text）。
 */
export const META_KEY = '_nmMetadata';

export const setMetadataDescription: INodeTypeDescription = {
  displayName: 'Set Metadata',
  name: 'setMetadata',
  group: ['transform'],
  categories: ['core', 'dataTransformation'],
  version: 1,
  description: 'Attach key/value metadata to this execution (searchable in the execution list)',
  defaults: { name: 'Set Metadata' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Metadata',
      name: 'metadata',
      type: 'assignmentCollection',
      default: {},
      description: 'Key → value (values may be expressions, e.g. ={{ $json.customerId }})',
    },
  ],
};

export class SetMetadata implements INodeType {
  description = setMetadataDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    for (const [i, item] of items.entries()) {
      const raw = (this.getNodeParameter('metadata', i, {}) ?? {}) as Record<string, unknown>;
      const meta: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (value === undefined || value === null) continue;
        meta[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
      returnData.push({
        json: { ...item.json, [META_KEY]: { ...(item.json[META_KEY] as JsonObject), ...meta } },
        pairedItem: { item: i },
      });
    }
    return [returnData];
  }
}
