import { describe, expect, it } from 'vitest';
import type { IExpressionContext } from './evaluator.js';
import { resolveParameterValue } from './evaluator.js';
import { ExpressionError } from './sandbox.js';

function ctx(json: Record<string, unknown> = {}, runData: IExpressionContext['runData'] = {}): IExpressionContext {
  return {
    json,
    itemIndex: 0,
    items: [{ json }],
    runData,
    workflow: { id: 'wf-1', name: 'test' },
  };
}

describe('表达式求值', () => {
  it('{{ $json.a + 1 }} 在 {a:1} 上求值为 2（验收项）', () => {
    expect(resolveParameterValue('={{ $json.a + 1 }}', ctx({ a: 1 }))).toBe(2);
  });

  it('非表达式字符串原样返回', () => {
    expect(resolveParameterValue('hello', ctx())).toBe('hello');
    expect(resolveParameterValue(42, ctx())).toBe(42);
  });

  it('单表达式保留原始类型（对象/布尔）', () => {
    expect(resolveParameterValue('={{ $json.obj }}', ctx({ obj: { x: 1 } }))).toEqual({ x: 1 });
    expect(resolveParameterValue('={{ $json.a > 0 }}', ctx({ a: 5 }))).toBe(true);
  });

  it('混合模板拼接为字符串', () => {
    expect(resolveParameterValue('=id-{{ $json.a }}-{{ $json.b }}', ctx({ a: 1, b: 'x' }))).toBe(
      'id-1-x',
    );
  });

  it('对象与数组递归求值', () => {
    expect(
      resolveParameterValue({ list: ['={{ $json.a }}', 'raw'] }, ctx({ a: 7 })),
    ).toEqual({ list: [7, 'raw'] });
  });

  it('$node["Name"].json 与 $("Name").json 读上游节点输出', () => {
    const runData = {
      Webhook: [
        {
          startTime: 0,
          executionTime: 1,
          source: [],
          data: { main: [[{ json: { amount: 150 } }]] },
        },
      ],
    };
    expect(resolveParameterValue('={{ $node["Webhook"].json.amount }}', ctx({}, runData))).toBe(150);
    expect(resolveParameterValue('={{ $("Webhook").json.amount }}', ctx({}, runData))).toBe(150);
  });

  it('引用不存在的节点给出可读错误（验收项）', () => {
    expect(() => resolveParameterValue('={{ $node["Nope"].json.x }}', ctx())).toThrowError(
      /Nope.*尚未执行或不存在/,
    );
  });
});

describe('表达式沙箱（验收项：拦截危险访问）', () => {
  const dangerous = [
    '={{ process.exit() }}',
    '={{ require("fs") }}',
    '={{ globalThis.process }}',
    '={{ this.constructor.constructor("return process")() }}',
    '={{ ({}).constructor.constructor("return 1")() }}',
    '={{ eval("1") }}',
    '={{ Function("return 1")() }}',
  ];

  for (const expr of dangerous) {
    it(`拦截 ${expr}`, () => {
      expect(() => resolveParameterValue(expr, ctx())).toThrow(ExpressionError);
    });
  }

  it('正常算术/字符串操作不受影响', () => {
    expect(resolveParameterValue('={{ [1,2,3].map(x => x * 2).join(",") }}', ctx())).toBe('2,4,6');
  });
});
