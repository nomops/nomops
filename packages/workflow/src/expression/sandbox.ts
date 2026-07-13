import { OperationalError } from '../errors.js';

export class ExpressionError extends OperationalError {}

/** 表达式里禁止出现的标识符（第一道防线：静态拒绝）。 */
const FORBIDDEN_IDENTIFIERS = [
  'process',
  'require',
  'globalThis',
  'global',
  'module',
  'exports',
  'Function',
  'eval',
  'constructor',
  'prototype',
  '__proto__',
  'import',
  'fetch',
  'setTimeout',
  'setInterval',
  'setImmediate',
];

const FORBIDDEN_PATTERN = new RegExp(`(?:^|[^\\w$.])(${FORBIDDEN_IDENTIFIERS.join('|')})\\b|\\.(constructor|prototype|__proto__)\\b`);

/**
 * 沙箱求值一段 JS 表达式。
 *
 * 三道防线：
 * 1. 静态拒绝危险标识符（process/require/constructor 等）；
 * 2. `new Function` 编译，作用域里把全局逃逸口显式遮蔽为 undefined；
 * 3. 严格模式 —— 函数内 `this` 为 undefined，无法借 this 摸到全局。
 *
 * 注意：这是表达式沙箱（拦「表达式参数」这种半可信输入），
 * 完全不可信的用户代码走 Code 节点的独立进程沙箱（Phase 5）。
 */
export function evaluateInSandbox(
  expression: string,
  scope: Record<string, unknown>,
): unknown {
  const match = FORBIDDEN_PATTERN.exec(expression);
  if (match) {
    throw new ExpressionError(`表达式禁止访问 "${match[1] ?? match[2]}"`, {
      expression,
      forbidden: match[1] ?? match[2],
    });
  }

  const scopeNames = Object.keys(scope);
  // 遮蔽层：即使静态检查被绕过，这些名字在作用域里也解析为 undefined。
  // 排除不能作参数名的：保留字（import）、严格模式禁用参数名（eval）、属性名（constructor 等）。
  const NOT_SHADOWABLE = new Set(['constructor', 'prototype', '__proto__', 'import', 'eval']);
  const shadowNames = FORBIDDEN_IDENTIFIERS.filter((name) => !NOT_SHADOWABLE.has(name));

  let fn: (...args: unknown[]) => unknown;
  try {
    fn = new Function(
      ...scopeNames,
      ...shadowNames,
      `"use strict"; return (${expression});`,
    ) as (...args: unknown[]) => unknown;
  } catch (error) {
    throw new ExpressionError(
      `表达式语法错误: ${(error as Error).message}`,
      { expression },
    );
  }

  try {
    return fn(...scopeNames.map((n) => scope[n]), ...shadowNames.map(() => undefined));
  } catch (error) {
    if (error instanceof ExpressionError) throw error;
    throw new ExpressionError(
      `表达式求值失败: ${(error as Error).message}`,
      { expression },
    );
  }
}
