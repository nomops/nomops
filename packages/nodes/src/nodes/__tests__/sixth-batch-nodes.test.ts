import { describe, expect, it } from 'vitest';
import type { IExecuteContext, INodeExecutionData, JsonObject } from '@nomops/workflow';
import { Filter } from '../Filter/Filter.node.js';
import { SplitOut } from '../SplitOut/SplitOut.node.js';
import { Aggregate } from '../Aggregate/Aggregate.node.js';
import { Sort } from '../Sort/Sort.node.js';
import { DEFAULT_SORT_CODE } from '../Sort/Sort.description.js';
import { RemoveDuplicates } from '../RemoveDuplicates/RemoveDuplicates.node.js';

function context(
  items: INodeExecutionData[],
  params: Record<string, unknown | ((index: number) => unknown)> = {},
  staticData: JsonObject = {},
): IExecuteContext {
  return {
    getInputData: () => items,
    getNodeParameter: (name: string, index: number, fallback?: unknown) => {
      if (!(name in params)) return fallback;
      const value = params[name];
      return typeof value === 'function' ? (value as (index: number) => unknown)(index) : value;
    },
    getCredentials: async () => ({}),
    getWorkflowStaticData: (type: string) => {
      const key = type === 'global' ? 'global' : 'node:test';
      const value = staticData[key];
      if (value === null || typeof value !== 'object' || Array.isArray(value)) staticData[key] = {};
      return staticData[key] as JsonObject;
    },
    getContext: () => ({}),
    helpers: {} as IExecuteContext['helpers'],
  } as IExecuteContext;
}

describe('第六批节点基线', () => {
  it('Filter 使用结构化条件对象、忽略大小写并输出 Kept/Discarded', async () => {
    const items = [{ json: { name: 'Ada' } }, { json: { name: 'Bo' } }];
    const output = await new Filter().execute!.call(context(items, {
      conditions: (index: number) => ({
        combinator: 'and',
        conditions: [{ leftValue: items[index]!.json.name, rightValue: 'ada', operator: { type: 'string', operation: 'equals' } }],
      }),
      options: { ignoreCase: true },
    }));
    expect(output.map((port) => port.map((item) => item.json))).toEqual([[{ name: 'Ada' }], [{ name: 'Bo' }]]);
  });

  it('Split Out 按位置拆多个字段并保留指定字段', async () => {
    const output = await new SplitOut().execute!.call(context([{
      json: { ids: [1, 2], users: [{ name: 'Ada' }, { name: 'Bo' }], batch: 7, ignored: true },
    }], {
      fieldToSplitOut: 'ids, users',
      include: 'selectedOtherFields',
      fieldsToInclude: 'batch',
      options: { destinationFieldName: 'id,user' },
    }));
    expect(output[0]!.map((item) => item.json)).toEqual([
      { id: 1, user: { name: 'Ada' }, batch: 7 },
      { id: 2, user: { name: 'Bo' }, batch: 7 },
    ]);
  });

  it('Split Out 支持 $binary', async () => {
    const output = await new SplitOut().execute!.call(context([{
      json: { id: 1 },
      binary: {
        first: { id: 'one', mimeType: 'text/plain' },
        second: { id: 'two', mimeType: 'image/png' },
      },
    }], { fieldToSplitOut: '$binary' }));
    expect(output[0]).toHaveLength(2);
    expect(Object.keys(output[0]![0]!.binary ?? {})).toEqual(['first']);
    expect(Object.keys(output[0]![1]!.binary ?? {})).toEqual(['second']);
  });

  it('Aggregate 独立字段支持重命名、扁平列表、缺值与二进制', async () => {
    const items = [
      { json: { user: { tags: ['a', null] } }, binary: { file: { id: '1', mimeType: 'text/plain' } } },
      { json: {}, binary: { file: { id: '2', mimeType: 'image/png' } } },
    ];
    const output = await new Aggregate().execute!.call(context(items, {
      aggregate: 'aggregateIndividualFields',
      fieldsToAggregate: { fieldToAggregate: [{ fieldToAggregate: 'user.tags', renameField: true, outputFieldName: 'tags' }] },
      options: { mergeLists: true, keepMissing: true, includeBinaries: true },
    }));
    expect(output[0]![0]!.json).toEqual({ tags: ['a', null, null] });
    expect(Object.keys(output[0]![0]!.binary ?? {})).toEqual(['file', 'file_1']);
  });

  it('Aggregate 全量模式按 Include 过滤字段', async () => {
    const output = await new Aggregate().execute!.call(context([
      { json: { id: 1, secret: 'x' } }, { json: { id: 2, secret: 'y' } },
    ], {
      aggregate: 'aggregateAllItemData', include: 'specifiedFields', fieldsToInclude: 'id', destinationFieldName: 'rows',
    }));
    expect(output[0]![0]!.json).toEqual({ rows: [{ id: 1 }, { id: 2 }] });
  });

  it('Sort 支持 Simple、Random 和受限 Code', async () => {
    const items = [{ json: { score: 2 } }, { json: { score: 1 } }, { json: { score: 3 } }];
    const simple = await new Sort().execute!.call(context(items, {
      type: 'simple', sortFieldsUi: { sortField: [{ fieldName: 'score', order: 'descending' }] },
    }));
    expect(simple[0]!.map((item) => item.json.score)).toEqual([3, 2, 1]);

    const code = await new Sort().execute!.call(context(items, {
      type: 'code', code: 'return b.json.score - a.json.score;',
    }));
    expect(code[0]!.map((item) => item.json.score)).toEqual([3, 2, 1]);

    const defaultCode = await new Sort().execute!.call(context(
      [{ json: { myField: 2 } }, { json: { myField: 1 } }],
      { type: 'code', code: DEFAULT_SORT_CODE },
    ));
    expect(defaultCode[0]!.map((item) => item.json.myField)).toEqual([1, 2]);

    const random = await new Sort().execute!.call(context(items, { type: 'random' }));
    expect(random[0]!.map((item) => item.json.score).sort()).toEqual([1, 2, 3]);
  });

  it('Remove Duplicates 当前输入只返回保留项', async () => {
    const output = await new RemoveDuplicates().execute!.call(context([
      { json: { id: 1, value: 'first' } }, { json: { id: 1, value: 'second' } }, { json: { id: 2, value: 'third' } },
    ], { operation: 'removeDuplicateInputItems', compare: 'selectedFields', fieldsToCompare: 'id' }));
    expect(output[0]!.map((item) => item.json.value)).toEqual(['first', 'third']);
    expect(output).toHaveLength(1);
  });

  it('Remove Duplicates 持久化新值、增量值并可清理历史', async () => {
    const staticData: JsonObject = {};
    const firstItems = [{ json: { id: 'a' } }, { json: { id: 'b' } }];
    const base = {
      operation: 'removeItemsSeenInPreviousExecutions',
      logic: 'removeItemsWithAlreadySeenKeyValues',
      dedupeValue: (index: number) => firstItems[index]!.json.id,
      options: { scope: 'workflow', historySize: 10 },
    };
    expect((await new RemoveDuplicates().execute!.call(context(firstItems, base, staticData)))[0]).toHaveLength(2);
    expect((await new RemoveDuplicates().execute!.call(context(firstItems, base, staticData)))[1]).toHaveLength(2);

    await new RemoveDuplicates().execute!.call(context([], {
      operation: 'clearDeduplicationHistory', mode: 'cleanDatabase', options: { scope: 'workflow' },
    }, staticData));
    expect((await new RemoveDuplicates().execute!.call(context(firstItems, base, staticData)))[0]).toHaveLength(2);

    const incremental = [{ json: { id: 2 } }, { json: { id: 4 } }];
    const incrementalParams = {
      operation: 'removeItemsSeenInPreviousExecutions', logic: 'removeItemsUpToStoredIncrementalKey',
      incrementalDedupeValue: (index: number) => incremental[index]!.json.id, options: { scope: 'node' },
    };
    await new RemoveDuplicates().execute!.call(context(incremental, incrementalParams, staticData));
    const next = [{ json: { id: 3 } }, { json: { id: 5 } }];
    const output = await new RemoveDuplicates().execute!.call(context(next, {
      ...incrementalParams, incrementalDedupeValue: (index: number) => next[index]!.json.id,
    }, staticData));
    expect(output[0]!.map((item) => item.json.id)).toEqual([5]);
    expect(output[1]!.map((item) => item.json.id)).toEqual([3]);
  });
});
