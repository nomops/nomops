import type { JsonObject } from '../interfaces.js';
import { resolveParameterValue } from './evaluator.js';

/**
 * $fromAI 参数收集/解析（#19,AI 工具「让模型填参」）。
 *
 * 工具子节点（HttpTool 等）的参数值里可写 `={{ $fromAI('city','城市名','string') }}`。
 * - supplyData 构造工具 spec 时：collect 模式扫出所有 $fromAI 声明 → 拼成 JSON schema;
 * - Agent 调用工具时：provided 模式用模型给的实参替换,得到真实参数值。
 */

export interface IFromAiParam {
  name: string;
  description: string;
  type: string; // string | number | boolean | json
}

const SCHEMA_TYPE: Record<string, string> = { string: 'string', number: 'number', boolean: 'boolean', json: 'object' };

/** 扫一组参数值里的所有 $fromAI 声明（去重,按首次出现序）。 */
export function collectFromAiParams(values: unknown[]): IFromAiParam[] {
  const found = new Map<string, IFromAiParam>();
  const collect = (name: string, description: string, type: string) => {
    if (!found.has(name)) found.set(name, { name, description, type });
  };
  for (const value of values) {
    // 在 collect 模式下求值一次:$fromAI 触发登记,其余表达式取占位上下文（不真联网/不读节点）
    resolveParameterValue(value, {
      json: {},
      itemIndex: 0,
      items: [],
      runData: {},
      workflow: {},
      fromAI: { collect },
    });
  }
  return [...found.values()];
}

/** 把收集到的 $fromAI 参数拼成 OpenAI/Anthropic 风格的工具 JSON schema。 */
export function fromAiSchema(params: IFromAiParam[]): JsonObject {
  const properties: JsonObject = {};
  for (const p of params) {
    properties[p.name] = { type: SCHEMA_TYPE[p.type] ?? 'string', ...(p.description ? { description: p.description } : {}) };
  }
  return { type: 'object', properties, required: params.map((p) => p.name) };
}

/** 用模型给的实参解析一个参数值（provided 模式:$fromAI(name) → args[name]）。 */
export function resolveWithAiArgs(value: unknown, args: JsonObject): unknown {
  return resolveParameterValue(value, {
    json: {},
    itemIndex: 0,
    items: [],
    runData: {},
    workflow: {},
    fromAI: { provided: args },
  });
}
