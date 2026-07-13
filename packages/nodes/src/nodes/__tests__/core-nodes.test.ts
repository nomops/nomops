import { describe, expect, it } from 'vitest';
import type { IExecuteContext, INodeExecutionData, JsonObject } from '@nomops/workflow';
import { If } from '../If/If.node.js';
import { Merge } from '../Merge/Merge.node.js';
import { Code } from '../Code/Code.node.js';
import { HttpRequest } from '../HttpRequest/HttpRequest.node.js';

/** 最小上下文桩。params 支持函数（按 itemIndex 取值），模拟引擎已求值的表达式。 */
function stubContext(
  inputs: INodeExecutionData[][],
  params: Record<string, unknown | ((i: number) => unknown)> = {},
  httpRequest: (opts: unknown) => Promise<unknown> = async () => ({}),
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
    helpers: { httpRequest: httpRequest as IExecuteContext['helpers']['httpRequest'] },
  } as IExecuteContext;
}

describe('If 节点', () => {
  it('gt 条件：真走输出0，假走输出1', async () => {
    const items = [{ json: { amount: 150 } }, { json: { amount: 50 } }];
    const output = await new If().execute!.call(
      stubContext([items], {
        // 模拟引擎对 "={{ $json.amount }}" 求值后的结果
        conditions: (i: number) => [{ left: items[i]!.json['amount'], op: 'gt', right: 100 }],
      }),
    );
    expect(output[0]).toEqual([{ json: { amount: 150 }, pairedItem: { item: 0 } }]);
    expect(output[1]).toEqual([{ json: { amount: 50 }, pairedItem: { item: 1 } }]);
  });

  it('OR 组合与 contains', async () => {
    const items = [{ json: { tag: 'urgent-fix' } }];
    const output = await new If().execute!.call(
      stubContext([items], {
        conditions: [
          { left: 'urgent-fix', op: 'contains', right: 'urgent' },
          { left: 1, op: 'eq', right: 2 },
        ],
        combine: 'or',
      }),
    );
    expect(output[0]).toHaveLength(1);
    expect(output[1]).toHaveLength(0);
  });
});

describe('Merge 节点', () => {
  it('append 拼接两路输入', async () => {
    const output = await new Merge().execute!.call(
      stubContext([[{ json: { a: 1 } }], [{ json: { b: 2 } }]]),
    );
    expect(output[0]!.map((it) => it.json)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('combineByPosition 按位置合并 json', async () => {
    const output = await new Merge().execute!.call(
      stubContext([[{ json: { a: 1 } }, { json: { a: 2 } }], [{ json: { b: 10 } }]], {
        mode: 'combineByPosition',
      }),
    );
    expect(output[0]!.map((it) => it.json)).toEqual([{ a: 1, b: 10 }, { a: 2 }]);
  });
});

describe('Code 节点（vm 临时沙箱）', () => {
  it('运行用户代码变换 items', async () => {
    const output = await new Code().execute!.call(
      stubContext([[{ json: { n: 1 } }, { json: { n: 2 } }]], {
        code: 'return items.map(it => ({ json: { n: it.json.n * 10 } }));',
      }),
    );
    expect(output[0]!.map((it) => it.json)).toEqual([{ n: 10 }, { n: 20 }]);
  });

  it('允许 return 裸对象数组', async () => {
    const output = await new Code().execute!.call(
      stubContext([[{ json: {} }]], { code: 'return [{ hello: "world" }];' }),
    );
    expect(output[0]![0]!.json).toEqual({ hello: 'world' });
  });

  it('沙箱内访问不到 require / process', async () => {
    for (const code of ['return [require("fs")];', 'return [process.env];']) {
      await expect(
        new Code().execute!.call(stubContext([[{ json: {} }]], { code })),
      ).rejects.toThrow(/Code node execution failed/);
    }
  });

  it('用户代码改不到引擎的输入数据（深拷贝隔离）', async () => {
    const input = [{ json: { keep: true } }];
    await new Code().execute!.call(
      stubContext([input], { code: 'items[0].json.keep = false; return items;' }),
    );
    expect(input[0]!.json['keep']).toBe(true);
  });

  it('非数组返回值报可读错误', async () => {
    await expect(
      new Code().execute!.call(stubContext([[{ json: {} }]], { code: 'return 42;' })),
    ).rejects.toThrow(/must return an items array/);
  });

  it('死循环被超时熔断，子进程被杀（进程级隔离）', async () => {
    await expect(
      new Code().execute!.call(stubContext([[{ json: {} }]], { code: 'while(true){}' })),
    ).rejects.toThrow(/timed out|execution failed/);
  }, 10_000);

  it('用户代码看不到父进程环境变量', async () => {
    process.env['NOMOPS_TEST_SECRET'] = 'leak-me';
    try {
      await expect(
        new Code().execute!.call(
          stubContext([[{ json: {} }]], { code: 'return [process.env];' }),
        ),
      ).rejects.toThrow(/execution failed/); // process 本身不可见
    } finally {
      delete process.env['NOMOPS_TEST_SECRET'];
    }
  });
});

describe('HttpRequest 节点', () => {
  it('逐 item 调 helpers.httpRequest 并包装响应', async () => {
    const calls: unknown[] = [];
    const output = await new HttpRequest().execute!.call(
      stubContext(
        [[{ json: { id: 1 } }, { json: { id: 2 } }]],
        { url: (i: number) => `https://api.test/items/${i + 1}`, method: 'GET' },
        async (opts) => {
          calls.push(opts);
          return { ok: true, url: (opts as JsonObject)['url'] };
        },
      ),
    );
    expect(calls).toHaveLength(2);
    expect(output[0]![0]!.json).toEqual({ ok: true, url: 'https://api.test/items/1' });
    expect(output[0]![1]!.pairedItem).toEqual({ item: 1 });
  });

  it('非对象响应包成 { data }', async () => {
    const output = await new HttpRequest().execute!.call(
      stubContext([[{ json: {} }]], { url: 'https://api.test', method: 'GET' }, async () => 'plain-text'),
    );
    expect(output[0]![0]!.json).toEqual({ data: 'plain-text' });
  });
});
