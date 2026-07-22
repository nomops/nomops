import type { INodeExecutionData, JsonObject } from '../interfaces.js';
import type { IRunData } from '../execution-interfaces.js';
import { ExpressionError, evaluateInSandbox } from './sandbox.js';
import { itemInAncestor } from './paired-item.js';

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
  /** 当前节点参数（$parameter.xxx——声明式 routing 的 url/body 里引用参数）。 */
  parameters?: JsonObject;
  /** 本次执行元信息（$execution.id / $execution.resumeUrl——审批类流程把恢复 URL 发出去）。 */
  execution?: { id?: string; resumeUrl?: string };
  /** 当前节点已完成的运行次数（$runIndex,循环里区分第几轮）。 */
  runIndex?: number;
  /** 当前输入的直接上游（$prevNode.name/.outputIndex;$('X').item 血缘回溯的起点）。 */
  prevNode?: { name?: string; outputIndex?: number };
}

const EXPRESSION_MARKER = '=';
const TEMPLATE_RE = /\{\{([\s\S]+?)\}\}/g;

/** 从 runData 取某节点最近一次运行、主输出端口 0 的 items（未执行即抛错）。 */
function nodeOutputItems(runData: IRunData, nodeName: string): INodeExecutionData[] {
  const runs = runData[nodeName];
  if (!runs || runs.length === 0) {
    throw new ExpressionError(`表达式引用的节点 "${nodeName}" 尚未执行或不存在`, {
      node: nodeName,
    });
  }
  return runs[runs.length - 1]!.data?.['main']?.[0] ?? [];
}

/**
 * 节点访问器（#20）：$('X') / $node["X"] 的返回值。
 * .json 保持既有语义（首 item json）;.first()/.last()/.all() 取整 item;
 * .item = 按 pairedItem 血缘定位「当前 item 在该节点里的来源 item」（#21）,
 * 血缘断链/走不到时回退首 item（与 .json 同口径,不让表达式硬崩）。
 */
function nodeAccessor(ctx: IExpressionContext, name: string): Record<string, unknown> {
  const items = nodeOutputItems(ctx.runData, name);
  return {
    json: items[0]?.json ?? {},
    first: () => items[0],
    last: () => items[items.length - 1],
    all: () => items,
    itemMatching: (i: number) => items[i],
    get item(): INodeExecutionData | undefined {
      const prev = ctx.prevNode?.name;
      if (!prev) return items[0];
      if (prev === name) return items[ctx.itemIndex] ?? items[0]; // 直接上游:同序直取
      return itemInAncestor(ctx.runData, prev, ctx.itemIndex, name) ?? items[0];
    },
  };
}

/** 构造表达式作用域（白名单变量，全部为纯数据/纯函数）。 */
function buildScope(ctx: IExpressionContext): Record<string, unknown> {
  const $node = new Proxy(
    {},
    {
      get: (_t, name: string | symbol) =>
        typeof name === 'string' ? nodeAccessor(ctx, name) : undefined,
      has: () => true,
    },
  );

  return {
    $json: ctx.json,
    $itemIndex: ctx.itemIndex,
    $items: ctx.items,
    $node,
    // $('Name') 形式与 $node["Name"] 等价
    $: (name: string) => nodeAccessor(ctx, name),
    // 当前节点输入的一等访问（#20,item = 当前 item 整体,含 json/binary）
    $input: {
      all: () => ctx.items,
      first: () => ctx.items[0],
      last: () => ctx.items[ctx.items.length - 1],
      item: ctx.items[ctx.itemIndex],
      length: ctx.items.length,
    },
    $runIndex: ctx.runIndex ?? 0,
    $prevNode: ctx.prevNode ?? {},
    $now: new Date().toISOString(),
    $workflow: { id: ctx.workflow.id, name: ctx.workflow.name },
    $vars: ctx.vars ?? {},
    $parameter: ctx.parameters ?? {},
    $execution: ctx.execution ?? {},
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
