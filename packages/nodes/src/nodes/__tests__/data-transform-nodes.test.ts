import { describe, expect, it } from 'vitest';
import type { IExecuteContext, INodeExecutionData } from '@nomops/workflow';
import { Sort } from '../Sort/Sort.node.js';
import { Limit } from '../Limit/Limit.node.js';
import { RemoveDuplicates } from '../RemoveDuplicates/RemoveDuplicates.node.js';
import { RenameKeys } from '../RenameKeys/RenameKeys.node.js';
import { Summarize } from '../Summarize/Summarize.node.js';
import { CompareDatasets } from '../CompareDatasets/CompareDatasets.node.js';

function stubContext(
  inputs: INodeExecutionData[][],
  params: Record<string, unknown | ((itemIndex: number) => unknown)> = {},
): IExecuteContext {
  return {
    getInputData: (index = 0) => inputs[index] ?? [],
    getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
      if (!(name in params)) return fallback;
      const value = params[name];
      return typeof value === 'function' ? (value as (index: number) => unknown)(itemIndex) : value;
    },
    getCredentials: async () => ({}),
    getWorkflowStaticData: () => ({}),
    getContext: () => ({}),
    helpers: {} as IExecuteContext['helpers'],
  } as IExecuteContext;
}

describe('Sort 节点', () => {
  it('按多字段稳定排序，支持数值方向', async () => {
    const items = [
      { json: { team: 'beta', score: 2 } },
      { json: { team: 'alpha', score: 1 } },
      { json: { team: 'alpha', score: 3 } },
    ];
    const output = await new Sort().execute!.call(stubContext([items], {
      sortFields: {
        fields: [
          { fieldName: 'team', direction: 'ascending', compareAs: 'text' },
          { fieldName: 'score', direction: 'descending', compareAs: 'number' },
        ],
      },
    }));
    expect(output[0]!.map((item) => item.json)).toEqual([
      { team: 'alpha', score: 3 },
      { team: 'alpha', score: 1 },
      { team: 'beta', score: 2 },
    ]);
  });

  it('自定义顺序优先，未声明值排在末尾', async () => {
    const items = ['low', 'urgent', 'other', 'normal'].map((priority) => ({ json: { priority } }));
    const output = await new Sort().execute!.call(stubContext([items], {
      sortFields: { fields: [{ fieldName: 'priority', compareAs: 'customOrder', customOrder: 'urgent, normal, low' }] },
    }));
    expect(output[0]!.map((item) => item.json['priority'])).toEqual(['urgent', 'normal', 'low', 'other']);
  });

  it('没有排序字段时给出可读错误', async () => {
    await expect(new Sort().execute!.call(stubContext([[{ json: {} }]]))).rejects.toThrow(/at least one field/i);
  });
});

describe('Limit 节点', () => {
  const items = [1, 2, 3, 4].map((id) => ({ json: { id } }));

  it('保留前 N 条或后 N 条', async () => {
    const first = await new Limit().execute!.call(stubContext([items], { maxItems: 2, keep: 'firstItems' }));
    const last = await new Limit().execute!.call(stubContext([items], { maxItems: 2, keep: 'lastItems' }));
    expect(first[0]!.map((item) => item.json['id'])).toEqual([1, 2]);
    expect(last[0]!.map((item) => item.json['id'])).toEqual([3, 4]);
  });

  it('0 返回空输出，负数被拒绝', async () => {
    expect((await new Limit().execute!.call(stubContext([items], { maxItems: 0 })))[0]).toEqual([]);
    await expect(new Limit().execute!.call(stubContext([items], { maxItems: -1 }))).rejects.toThrow(/non-negative/);
  });
});

describe('Remove Duplicates 节点', () => {
  it('All Fields 使用稳定对象键顺序去重', async () => {
    const items = [{ json: { id: 1, name: 'Ada' } }, { json: { name: 'Ada', id: 1 } }, { json: { id: 2 } }];
    const output = await new RemoveDuplicates().execute!.call(stubContext([items]));
    expect(output[0]!.map((item) => item.json)).toEqual([{ id: 1, name: 'Ada' }, { id: 2 }]);
  });

  it('Selected Fields 支持深路径', async () => {
    const items = [
      { json: { profile: { email: 'a@example.test' }, version: 1 } },
      { json: { profile: { email: 'a@example.test' }, version: 2 } },
    ];
    const output = await new RemoveDuplicates().execute!.call(stubContext([items], {
      compare: 'selectedFields', fields: 'profile.email',
    }));
    expect(output[0]).toHaveLength(1);
  });

  it('Keep Last 保留最后一条重复项', async () => {
    const items = [{ json: { id: 1, value: 'old' } }, { json: { id: 1, value: 'new' } }];
    const output = await new RemoveDuplicates().execute!.call(stubContext([items], {
      compare: 'selectedFields', fields: 'id', keep: 'last',
    }));
    expect(output[0]![0]!.json['value']).toBe('new');
  });
});

describe('Rename Keys 节点', () => {
  it('显式深路径改名并保留 binary 引用', async () => {
    const binary = { file: { id: 'binary-1', mimeType: 'text/plain' } };
    const output = await new RenameKeys().execute!.call(stubContext([[{
      json: { profile: { oldName: 'Ada' } }, binary,
    }]], {
      keys: { renames: [{ currentKey: 'profile.oldName', newKey: 'user.name' }] },
    }));
    expect(output[0]![0]).toEqual({
      json: { profile: {}, user: { name: 'Ada' } },
      binary,
      pairedItem: { item: 0 },
    });
  });

  it('正则按深度递归重命名对象键', async () => {
    const output = await new RenameKeys().execute!.call(stubContext([[{
      json: { user_id: 1, nested: { order_id: 2 } },
    }]], {
      regexReplacements: { replacements: [{ pattern: '_id$', replacement: 'Id', maxDepth: -1 }] },
    }));
    expect(output[0]![0]!.json).toEqual({ userId: 1, nested: { orderId: 2 } });
  });

  it('潜在灾难回溯正则被拒绝', async () => {
    await expect(new RenameKeys().execute!.call(stubContext([[{ json: { key: 1 } }]], {
      regexReplacements: { replacements: [{ pattern: '(a+)+$', replacement: '' }] },
    }))).rejects.toThrow(/unsafe construct/);
  });
});

describe('Summarize 节点', () => {
  it('按字段分组计算 sum/average/count/concatenate', async () => {
    const items = [
      { json: { team: 'A', amount: 2, member: 'Ada' } },
      { json: { team: 'A', amount: 4, member: 'Bo' } },
      { json: { team: 'B', amount: 3, member: 'Cy' } },
    ];
    const output = await new Summarize().execute!.call(stubContext([items], {
      groupBy: 'team',
      aggregations: { values: [
        { operation: 'sum', field: 'amount', outputField: 'total' },
        { operation: 'average', field: 'amount', outputField: 'average' },
        { operation: 'count', field: '', outputField: 'count' },
        { operation: 'concatenate', field: 'member', outputField: 'members', separator: '|' },
      ] },
    }));
    expect(output[0]!.map((item) => item.json)).toEqual([
      { team: 'A', total: 6, average: 3, count: 2, members: 'Ada|Bo' },
      { team: 'B', total: 3, average: 3, count: 1, members: 'Cy' },
    ]);
  });

  it('无分组时输出单项，空输入输出为空', async () => {
    const aggregation = { values: [{ operation: 'count', field: '', outputField: 'items' }] };
    const output = await new Summarize().execute!.call(stubContext([[{ json: {} }, { json: {} }]], { aggregations: aggregation }));
    expect(output[0]![0]!.json).toEqual({ items: 2 });
    expect((await new Summarize().execute!.call(stubContext([[]], { aggregations: aggregation })))[0]).toEqual([]);
  });
});

describe('Compare Datasets 节点', () => {
  const inputA = [
    { json: { id: 1, value: 'same' } },
    { json: { id: 2, value: 'before' } },
    { json: { id: 3, value: 'left' } },
  ];
  const inputB = [
    { json: { id: 1, value: 'same' } },
    { json: { id: 2, value: 'after' } },
    { json: { id: 4, value: 'right' } },
  ];

  it('输出仅左、相同、不同、仅右四路', async () => {
    const output = await new CompareDatasets().execute!.call(stubContext([inputA, inputB], {
      matchFields: { values: [{ fieldA: 'id', fieldB: 'id' }] },
    }));
    expect(output.map((port) => port.map((item) => item.json))).toEqual([
      [{ id: 3, value: 'left' }],
      [{ id: 1, value: 'same' }],
      [{ inputA: { id: 2, value: 'before' }, inputB: { id: 2, value: 'after' } }],
      [{ id: 4, value: 'right' }],
    ]);
  });

  it('skipFields 忽略非业务差异', async () => {
    const output = await new CompareDatasets().execute!.call(stubContext([
      [{ json: { id: 1, updatedAt: 'old' } }],
      [{ json: { id: 1, updatedAt: 'new' } }],
    ], {
      matchFields: { values: [{ fieldA: 'id', fieldB: 'id' }] }, skipFields: 'updatedAt',
    }));
    expect(output[1]).toHaveLength(1);
    expect(output[2]).toEqual([]);
  });

  it('缺少完整匹配字段时给出可读错误', async () => {
    await expect(new CompareDatasets().execute!.call(stubContext([inputA, inputB]))).rejects.toThrow(/field pair/);
  });
});
