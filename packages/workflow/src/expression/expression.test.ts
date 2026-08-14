import { describe, expect, it } from 'vitest';
import type { IExpressionContext } from './evaluator.js';
import { resolveParameterValue } from './evaluator.js';
import { evaluateInSandbox, ExpressionError } from './sandbox.js';
import { EXPRESSION_EXTENSION_DOCS, rewriteExpressionExtensions } from './extensions.js';

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
    `={{ []['con'+'structor']['con'+'structor']('return this')() }}`,
    `={{ ({})['con'+'structor']['con'+'structor']('return process')() }}`,
  ];

  for (const expr of dangerous) {
    it(`拦截 ${expr}`, () => {
      expect(() => resolveParameterValue(expr, ctx())).toThrow(ExpressionError);
    });
  }

  it('正常算术/字符串操作不受影响', () => {
    expect(resolveParameterValue('={{ [1,2,3].map(x => x * 2).join(",") }}', ctx())).toBe('2,4,6');
  });

  it('死循环触发硬超时且后续表达式仍可求值', () => {
    expect(() => evaluateInSandbox('while(true){}', {}, { timeoutMs: 100 })).toThrowError(/超时/);
    expect(resolveParameterValue('={{ 1 + 1 }}', ctx())).toBe(2);
  });

  it('内存限制阻断资源耗尽且不影响宿主进程', () => {
    expect(() => evaluateInSandbox(
      'new ArrayBuffer(32 * 1024 * 1024)',
      {},
      { timeoutMs: 500, memoryLimitBytes: 8 * 1024 * 1024 },
    )).toThrow(ExpressionError);
    expect(resolveParameterValue('={{ 6 * 7 }}', ctx())).toBe(42);
  });

  it('函数结果被拒绝，执行状态不会混入不可序列化值', () => {
    expect(() => resolveParameterValue('={{ () => 1 }}', ctx())).toThrowError(/不可序列化/);
  });
});

/* ── #20 表达式访问增强 + #21 pairedItem 血缘 ── */

describe('表达式访问增强（#20/#21）', () => {
  /** 三级链 A→B→C:B 把 A 的 2 个 item 反序输出(pairedItem 交叉),当前节点是 C。 */
  const lineageRunData: IExpressionContext['runData'] = {
    A: [
      {
        startTime: 0,
        executionTime: 1,
        source: [],
        data: { main: [[{ json: { tag: 'a0' } }, { json: { tag: 'a1' } }]] },
      },
    ],
    B: [
      {
        startTime: 0,
        executionTime: 1,
        source: [{ previousNode: 'A' }],
        data: {
          main: [
            [
              { json: { from: 'a1' }, pairedItem: { item: 1 } }, // B 输出0 来自 A 输入1（反序）
              { json: { from: 'a0' }, pairedItem: { item: 0 } },
            ],
          ],
        },
      },
    ],
  };
  const cCtx = (itemIndex: number): IExpressionContext => ({
    json: { i: itemIndex },
    itemIndex,
    items: [{ json: { i: 0 } }, { json: { i: 1 } }],
    runData: lineageRunData,
    workflow: {},
    runIndex: 0,
    prevNode: { name: 'B', outputIndex: 0 },
  });

  it('$input.first/last/all/item/length', () => {
    const c = cCtx(1);
    expect(resolveParameterValue('={{ $input.length }}', c)).toBe(2);
    expect(resolveParameterValue('={{ $input.first().json.i }}', c)).toBe(0);
    expect(resolveParameterValue('={{ $input.last().json.i }}', c)).toBe(1);
    expect(resolveParameterValue('={{ $input.item.json.i }}', c)).toBe(1);
    expect(resolveParameterValue('={{ $input.all().length }}', c)).toBe(2);
  });

  it('$runIndex / $prevNode', () => {
    const c = { ...cCtx(0), runIndex: 3 };
    expect(resolveParameterValue('={{ $runIndex }}', c)).toBe(3);
    expect(resolveParameterValue('={{ $prevNode.name }}', c)).toBe('B');
  });

  it('$("X").first/last/all/itemMatching;.json 兼容旧语义', () => {
    const c = cCtx(0);
    expect(resolveParameterValue('={{ $("A").json.tag }}', c)).toBe('a0');
    expect(resolveParameterValue('={{ $("A").first().json.tag }}', c)).toBe('a0');
    expect(resolveParameterValue('={{ $("A").last().json.tag }}', c)).toBe('a1');
    expect(resolveParameterValue('={{ $("A").all().length }}', c)).toBe(2);
    expect(resolveParameterValue('={{ $("A").itemMatching(1).json.tag }}', c)).toBe('a1');
    expect(resolveParameterValue('={{ $node["A"].last().json.tag }}', c)).toBe('a1');
  });

  it('★$("A").item 按血缘定位:C 的 item0 ← B 输出0(pairedItem→A 输入1) → A 的 a1', () => {
    expect(resolveParameterValue('={{ $("A").item.json.tag }}', cCtx(0))).toBe('a1');
    expect(resolveParameterValue('={{ $("A").item.json.tag }}', cCtx(1))).toBe('a0');
    // 直接上游:同序直取
    expect(resolveParameterValue('={{ $("B").item.json.from }}', cCtx(1))).toBe('a0');
  });

  it('血缘断链回退首 item（不硬崩）', () => {
    const broken = cCtx(0);
    // B 的输出去掉 pairedItem → 走不到 A → 回退 A 首 item
    broken.runData = {
      ...lineageRunData,
      B: [{ startTime: 0, executionTime: 1, source: [{ previousNode: 'A' }], data: { main: [[{ json: { from: 'x' } }]] } }],
    };
    expect(resolveParameterValue('={{ $("A").item.json.tag }}', broken)).toBe('a0');
  });
});

/* ── #19 $fromAI ── */

describe('$fromAI（#19 AI 工具让模型填参）', () => {
  it('collect 模式:登记参数并返回占位;fromAiSchema 拼 schema', async () => {
    const { collectFromAiParams, fromAiSchema } = await import('./from-ai.js');
    const params = collectFromAiParams([
      "=https://x/{{ $fromAI('id', 'the id', 'string') }}",
      "={{ { n: $fromAI('n', 'count', 'number'), id: $fromAI('id', 'dup', 'string') } }}",
    ]);
    expect(params.map((p) => p.name)).toEqual(['id', 'n']); // 去重、按首现序
    const schema = fromAiSchema(params) as { properties: Record<string, { type: string }>; required: string[] };
    expect(schema.properties['id']!.type).toBe('string');
    expect(schema.properties['n']!.type).toBe('number');
    expect(schema.required.sort()).toEqual(['id', 'n']);
  });

  it('provided 模式:$fromAI(name) → 模型实参', async () => {
    const { resolveWithAiArgs } = await import('./from-ai.js');
    expect(resolveWithAiArgs("=order-{{ $fromAI('id') }}", { id: 'A9' })).toBe('order-A9');
    expect(resolveWithAiArgs("={{ $fromAI('qty') }}", { qty: 5 })).toBe(5); // 单表达式保留类型
  });

  it('AI 上下文之外:$fromAI 安全降级为 undefined（不崩表达式）', () => {
    expect(resolveParameterValue("={{ $fromAI('x') ?? 'fallback' }}", ctx())).toBe('fallback');
  });
});

describe('Luxon DateTime 与表达式扩展（#70）', () => {
  it('$now/$today 是可链式调用的 DateTime，plus 不漂移原值', () => {
    expect(resolveParameterValue('={{ $now.plus({ days: 1 }).toMillis() - $now.toMillis() }}', ctx())).toBe(86_400_000);
    expect(resolveParameterValue('={{ $today.hour }}', ctx())).toBe(0);
    expect(resolveParameterValue('={{ $now.isValid }}', ctx())).toBe(true);
    expect(resolveParameterValue('={{ $now.plus({ days: 1 }) }}', ctx())).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(resolveParameterValue('={{ $now.toISO() }}', { ...ctx(), timezone: 'Asia/Shanghai' })).toMatch(/\+08:00$/);
  });

  it('字符串 toDateTime 后可继续调用 Luxon 方法', () => {
    expect(resolveParameterValue("={{ '2026-08-11'.toDateTime().plus({ days: 1 }).toISODate() }}", ctx()))
      .toBe('2026-08-12');
  });

  it('高频 String/Array/Object/Number 方法统一走 extend', () => {
    expect(resolveParameterValue("={{ 'dev@example.com'.isEmail() }}", ctx())).toBe(true);
    expect(resolveParameterValue('={{ [1, 2, 2].unique().sum() }}', ctx())).toBe(3);
    expect(resolveParameterValue("={{ ({ id: 1, empty: '' }).compact().keys() }}", ctx())).toEqual(['id']);
    expect(resolveParameterValue('={{ (42).isEven() }}', ctx())).toBe(true);
  });

  it('AST 改写支持嵌套且不改写普通原生方法', () => {
    expect(rewriteExpressionExtensions('[1, 2].map(x => x * 2).first()')).toBe(
      '__extend([1, 2].map(x => x * 2),"first",[])',
    );
    expect(rewriteExpressionExtensions('[1, 2].map(x => x * 2)')).toBe('[1, 2].map(x => x * 2)');
  });

  it('扩展元数据供运行时与前端补全共用', () => {
    expect(EXPRESSION_EXTENSION_DOCS.find((doc) => doc.name === 'isEmail')).toMatchObject({
      types: ['String'],
      returnType: 'boolean',
    });
    expect(EXPRESSION_EXTENSION_DOCS.find((doc) => doc.name === 'plus')?.example).toContain('$now.plus');
  });
});
