import { describe, expect, it } from 'vitest';
import type { IExecuteContext, INodeExecutionData } from '@nomops/workflow';
import { Switch } from '../Switch/Switch.node.js';
import { Filter } from '../Filter/Filter.node.js';
import { SplitOut } from '../SplitOut/SplitOut.node.js';
import { Aggregate } from '../Aggregate/Aggregate.node.js';
import { Loop } from '../Loop/Loop.node.js';

/** 最小上下文桩（同 core-nodes.test.ts）：params 支持函数按 itemIndex 取值。 */
function stubContext(
  inputs: INodeExecutionData[][],
  params: Record<string, unknown | ((i: number) => unknown)> = {},
  context: Record<string, unknown> = {},
): IExecuteContext {
  return {
    getInputData: (index = 0) => inputs[index] ?? [],
    getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
      if (!(name in params)) return fallback;
      const v = params[name];
      return typeof v === 'function' ? (v as (i: number) => unknown)(itemIndex) : v;
    },
    getCredentials: async () => ({}),
    getWorkflowStaticData: () => ({}),
    getContext: () => context,
    helpers: {} as IExecuteContext['helpers'],
  } as IExecuteContext;
}

describe('Switch 节点', () => {
  const items = [{ json: { kind: 'a' } }, { json: { kind: 'b' } }, { json: { kind: 'x' } }];
  const rules = (i: number) => [
    { left: items[i]!.json['kind'], op: 'eq', right: 'a' },
    { left: items[i]!.json['kind'], op: 'eq', right: 'b' },
  ];

  it('规则 i 命中 → 输出 i(首中即停);无命中默认丢弃', async () => {
    const out = await new Switch().execute!.call(stubContext([items], { rules }));
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual([{ json: { kind: 'a' }, pairedItem: { item: 0 } }]);
    expect(out[1]).toEqual([{ json: { kind: 'b' }, pairedItem: { item: 1 } }]);
    expect(out[2]).toEqual([]);
    expect(out[3]).toEqual([]); // kind:'x' 无命中且 fallback=none → 丢弃
  });

  it('fallbackOutput 承接未命中 item', async () => {
    const out = await new Switch().execute!.call(stubContext([items], { rules, fallbackOutput: '3' }));
    expect(out[3]).toEqual([{ json: { kind: 'x' }, pairedItem: { item: 2 } }]);
  });

  it('规则超过 4 条报错', async () => {
    const five = Array.from({ length: 5 }, () => ({ left: 1, op: 'eq', right: 1 }));
    await expect(new Switch().execute!.call(stubContext([items], { rules: five }))).rejects.toThrow(/at most 4/);
  });
});

describe('Filter 节点', () => {
  it('条件命中的 item 通过,其余丢弃', async () => {
    const items = [{ json: { amount: 150 } }, { json: { amount: 50 } }];
    const out = await new Filter().execute!.call(
      stubContext([items], {
        conditions: (i: number) => [{ left: items[i]!.json['amount'], op: 'gt', right: 100 }],
      }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual([{ json: { amount: 150 }, pairedItem: { item: 0 } }]);
    expect(out[1]).toEqual([{ json: { amount: 50 }, pairedItem: { item: 1 } }]);
  });

  it('空条件组全部通过（与 If 语义一致）', async () => {
    const out = await new Filter().execute!.call(stubContext([[{ json: { a: 1 } }]]));
    expect(out[0]).toHaveLength(1);
  });
});

describe('SplitOut 节点', () => {
  it('数组字段拆成逐元素 item;对象元素展开为顶层 json', async () => {
    const out = await new SplitOut().execute!.call(
      stubContext([[{ json: { batch: 7, users: [{ name: 'Ada' }, { name: 'Bo' }] } }]], {
        fieldToSplitOut: 'users',
      }),
    );
    expect(out[0]).toEqual([
      { json: { name: 'Ada' }, pairedItem: { item: 0 } },
      { json: { name: 'Bo' }, pairedItem: { item: 0 } },
    ]);
  });

  it('allOtherFields 保留其余字段;标量元素落到字段名下', async () => {
    const out = await new SplitOut().execute!.call(
      stubContext([[{ json: { batch: 7, ids: [1, 2] } }]], {
        fieldToSplitOut: 'ids',
        include: 'allOtherFields',
      }),
    );
    expect(out[0]).toEqual([
      { json: { batch: 7, ids: 1 }, pairedItem: { item: 0 } },
      { json: { batch: 7, ids: 2 }, pairedItem: { item: 0 } },
    ]);
  });

  it('深路径 + destinationFieldName;缺字段的 item 跳过', async () => {
    const out = await new SplitOut().execute!.call(
      stubContext(
        [[{ json: { data: { rows: ['x'] } } }, { json: { other: 1 } }]],
        { fieldToSplitOut: 'data.rows', destinationFieldName: 'row' },
      ),
    );
    expect(out[0]).toEqual([{ json: { row: 'x' }, pairedItem: { item: 0 } }]);
  });

  it('缺 fieldToSplitOut 报错', async () => {
    await expect(new SplitOut().execute!.call(stubContext([[{ json: {} }]]))).rejects.toThrow(/required/);
  });
});

describe('Loop 节点（分批循环）', () => {
  it('首帧吐第一批 → 环回收结果吐下批 → 队尽走 done', async () => {
    const loop = new Loop();
    const ctx = {}; // 同一执行内共享的节点上下文
    const seed = [{ json: { id: 1 } }, { json: { id: 2 } }, { json: { id: 3 } }];

    // 首帧:全量入队,吐第一批(batchSize 2)
    let out = await loop.execute!.call(stubContext([seed], { batchSize: 2 }, ctx));
    expect(out[0]).toEqual([]); // done 空
    expect(out[1]!.map((it) => it.json)).toEqual([{ id: 1 }, { id: 2 }]);

    // 环回帧 1:交回处理结果,吐第二批
    out = await loop.execute!.call(
      stubContext([[{ json: { id: 1, done: true } }, { json: { id: 2, done: true } }]], {}, ctx),
    );
    expect(out[1]!.map((it) => it.json)).toEqual([{ id: 3 }]);

    // 环回帧 2:队列吐尽 → 全部处理结果走 done
    out = await loop.execute!.call(stubContext([[{ json: { id: 3, done: true } }]], {}, ctx));
    expect(out[1]).toEqual([]);
    expect(out[0]!.map((it) => it.json)).toEqual([
      { id: 1, done: true },
      { id: 2, done: true },
      { id: 3, done: true },
    ]);
  });

  it('batchSize 非法值回落为 1;空输入直接收尾', async () => {
    const loop = new Loop();
    const ctx = {};
    const out = await loop.execute!.call(stubContext([[{ json: { a: 1 } }]], { batchSize: 0 }, ctx));
    expect(out[1]).toHaveLength(1); // 0 → 1
    const empty = await loop.execute!.call(stubContext([[]], {}, {}));
    expect(empty).toEqual([[], []]);
  });
});

describe('Aggregate 节点', () => {
  const items = [{ json: { id: 1, u: { name: 'Ada' } } }, { json: { id: 2, u: { name: 'Bo' } } }];

  it('allItemData:整包收进目标字段,pairedItem 对齐全部输入', async () => {
    const out = await new Aggregate().execute!.call(stubContext([items], { mode: 'allItemData' }));
    expect(out[0]).toEqual([
      {
        json: { data: [{ id: 1, u: { name: 'Ada' } }, { id: 2, u: { name: 'Bo' } }] },
        pairedItem: [{ item: 0 }, { item: 1 }],
      },
    ]);
  });

  it('individualFields:逐字段收列表(深路径取叶名,缺值默认跳过)', async () => {
    const out = await new Aggregate().execute!.call(
      stubContext([[...items, { json: { id: 3 } }]], {
        mode: 'individualFields',
        fieldsToAggregate: 'id, u.name',
      }),
    );
    expect(out[0]![0]!.json).toEqual({ id: [1, 2, 3], name: ['Ada', 'Bo'] });
  });

  it('空输入 → 空输出;individualFields 缺字段声明报错', async () => {
    expect((await new Aggregate().execute!.call(stubContext([[]])))[0]).toEqual([]);
    await expect(
      new Aggregate().execute!.call(stubContext([items], { mode: 'individualFields' })),
    ).rejects.toThrow(/add a field/);
  });
});
