import type { INodeExecutionData, JsonObject } from '../interfaces.js';
import type { IRunData } from '../execution-interfaces.js';
import { ExpressionError, evaluateInSandbox } from './sandbox.js';

/** 表达式求值的数据上下文：当前 item + 各节点已产出的数据。 */
export interface IExpressionContext {
  /** 当前 item 的 json（$json）。 */
  json: JsonObject;
  /** 当前 item 索引（$itemIndex）。 */
  itemIndex: number;
  /** 当前节点的全部输入 items（$items）。 */
  items: INodeExecutionData[];
  /** 已执行节点的运行数据，支撑 $node["Name"].json。 */
  runData: IRunData;
  /** 工作流元信息（$workflow.id/name）。 */
  workflow: { id?: string; name?: string };
  /** 项目维度变量（$vars.KEY）。 */
  vars?: Record<string, string>;
}

const EXPRESSION_MARKER = '=';
const TEMPLATE_RE = /\{\{([\s\S]+?)\}\}/g;

/** 从 runData 取某节点最近一次运行、主输出端口 0 的第一个 item 的 json。 */
function nodeOutputJson(runData: IRunData, nodeName: string): JsonObject {
  const runs = runData[nodeName];
  if (!runs || runs.length === 0) {
    throw new ExpressionError(`表达式引用的节点 "${nodeName}" 尚未执行或不存在`, {
      node: nodeName,
    });
  }
  const last = runs[runs.length - 1]!;
  const item = last.data?.['main']?.[0]?.[0];
  return item?.json ?? {};
}

/** 构造表达式作用域（白名单变量，全部为纯数据/纯函数）。 */
function buildScope(ctx: IExpressionContext): Record<string, unknown> {
  const $node = new Proxy(
    {},
    {
      get: (_t, name: string | symbol) =>
        typeof name === 'string' ? { json: nodeOutputJson(ctx.runData, name) } : undefined,
      has: () => true,
    },
  );

  return {
    $json: ctx.json,
    $itemIndex: ctx.itemIndex,
    $items: ctx.items,
    $node,
    // $('Name') 形式与 $node["Name"] 等价
    $: (name: string) => ({ json: nodeOutputJson(ctx.runData, name) }),
    $now: new Date().toISOString(),
    $workflow: { id: ctx.workflow.id, name: ctx.workflow.name },
    $vars: ctx.vars ?? {},
    items: ctx.items,
  };
}

/** 值是否是表达式（以 '=' 开头的字符串，如 "={{ $json.a }}"）。 */
export function isExpression(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(EXPRESSION_MARKER);
}

/**
 * 求值单个参数值：
 * - 非表达式原样返回；
 * - `={{ expr }}`（整串单表达式）→ 返回原始类型（数字/对象不转字符串）；
 * - 混合模板 `=a{{ x }}b{{ y }}` → 逐段求值拼接为字符串；
 * - 数组/对象递归求值每个成员。
 */
export function resolveParameterValue(value: unknown, ctx: IExpressionContext): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => resolveParameterValue(v, ctx));
  }
  if (value !== null && typeof value === 'object') {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveParameterValue(v, ctx);
    return out;
  }
  if (!isExpression(value)) return value;

  const template = value.slice(EXPRESSION_MARKER.length);
  const scope = buildScope(ctx);

  // 整串恰好是单个 {{ expr }} → 保留原始类型（内部不得再含 }} 分界）
  const single = /^\{\{([\s\S]+)\}\}$/.exec(template.trim());
  if (single && !single[1]!.includes('}}')) {
    return evaluateInSandbox(single[1]!.trim(), scope);
  }

  return template.replace(TEMPLATE_RE, (_m, expr: string) => {
    const result = evaluateInSandbox(expr.trim(), scope);
    return result === null || result === undefined ? '' : String(result);
  });
}
