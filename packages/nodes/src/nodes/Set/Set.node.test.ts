import { describe, expect, it } from 'vitest';
import type { IExecuteContext, INodeExecutionData, JsonObject } from '@nomops/workflow';
import { Set } from './Set.node.js';

/** 最小执行上下文桩：只实现 Set 用到的方法。 */
function stubContext(items: INodeExecutionData[], params: JsonObject): IExecuteContext {
  return {
    getInputData: () => items,
    getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
      name in params ? params[name] : fallback,
    getCredentials: async () => ({}),
    getWorkflowStaticData: () => ({}),
    helpers: { httpRequest: async () => ({}) },
  } as IExecuteContext;
}

describe('Set 节点', () => {
  it('把 fields 合并进每个 item，并写入 pairedItem 溯源', async () => {
    const items: INodeExecutionData[] = [{ json: { a: 1 } }, { json: { a: 2 } }];
    const node = new Set();

    const output = await node.execute!.call(stubContext(items, { fields: { b: 9 } }));

    expect(output).toEqual([
      [
        { json: { a: 1, b: 9 }, pairedItem: { item: 0 } },
        { json: { a: 2, b: 9 }, pairedItem: { item: 1 } },
      ],
    ]);
  });

  it('没有 fields 参数时透传原 json', async () => {
    const items: INodeExecutionData[] = [{ json: { x: 1 } }];
    const node = new Set();

    const output = await node.execute!.call(stubContext(items, {}));

    expect(output).toEqual([[{ json: { x: 1 }, pairedItem: { item: 0 } }]]);
  });
});
