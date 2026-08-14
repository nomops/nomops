import type { INodeExecutionData, JsonObject } from '../interfaces.js';
import type { IRunData } from '../execution-interfaces.js';
import { DateTime } from 'luxon';
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
  /** 工作流时区；$now/$today 按此时区构造，缺省 UTC。 */
  timezone?: string;
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
  /**
   * $fromAI 模式（#19,AI 工具「让模型填参」）：
   * - collect:模式下 $fromAI(name,desc,type) 登记参数并返回占位值（供构造工具 JSON schema）;
   * - provided:模式下 $fromAI(name) 返回模型这次调用给的实参。
   * 两者都缺省时 $fromAI 返回 undefined（AI 上下文之外安全降级,不崩表达式）。
   */
  fromAI?: {
    collect?: (name: string, description: string, type: string) => void;
    provided?: JsonObject;
  };
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
function nodeAccessorData(ctx: IExpressionContext, name: string): Record<string, unknown> {
  const items = nodeOutputItems(ctx.runData, name);
  return {
    items,
    item: (() => {
      const previousNode = ctx.prevNode?.name;
      if (!previousNode) return items[0];
      if (previousNode === name) return items[ctx.itemIndex] ?? items[0];
      return itemInAncestor(ctx.runData, previousNode, ctx.itemIndex, name) ?? items[0];
    })(),
  };
}

/** 构造表达式作用域（仅纯数据，跨 VM 边界时会再次 JSON 深拷贝）。 */
function buildScope(ctx: IExpressionContext): Record<string, unknown> {
  const nodeData = Object.fromEntries(
    Object.keys(ctx.runData).map((name) => [name, nodeAccessorData(ctx, name)]),
  );

  const requestedZone = ctx.timezone ?? 'UTC';
  const zonedNow = DateTime.now().setZone(requestedZone);
  const now = zonedNow.isValid ? zonedNow : DateTime.utc();

  return {
    $json: ctx.json,
    $itemIndex: ctx.itemIndex,
    $items: ctx.items,
    __nodeData: nodeData,
    $runIndex: ctx.runIndex ?? 0,
    $prevNode: ctx.prevNode ?? {},
    $now: now.toISO(),
    $today: now.startOf('day').toISO(),
    $timezone: now.zoneName,
    $workflow: { id: ctx.workflow.id, name: ctx.workflow.name },
    $vars: ctx.vars ?? {},
    $parameter: ctx.parameters ?? {},
    $execution: ctx.execution ?? {},
    items: ctx.items,
  };
}

function evaluate(expression: string, scope: Record<string, unknown>, ctx: IExpressionContext): unknown {
  return evaluateInSandbox(expression, scope, {
    fromAi: {
      provided: ctx.fromAI?.provided,
      collect: ctx.fromAI?.collect,
    },
  });
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
    return evaluate(single[1]!.trim(), scope, ctx);
  }

  return template.replace(TEMPLATE_RE, (_m, expr: string) => {
    const result = evaluate(expr.trim(), scope, ctx);
    return result === null || result === undefined ? '' : String(result);
  });
}
