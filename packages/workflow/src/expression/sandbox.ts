import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import type { QuickJSSyncVariant } from 'quickjs-emscripten-core';
import { OperationalError } from '../errors.js';

export class ExpressionError extends OperationalError {}

const EXPRESSION_TIMEOUT_MS = 5_000;
const EXPRESSION_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
const EXPRESSION_STACK_LIMIT_BYTES = 512 * 1024;

const releaseSyncModule = await import('@jitl/quickjs-wasmfile-release-sync');
const quickJsReleaseSync = releaseSyncModule.default as unknown as QuickJSSyncVariant;
const QuickJS = await newQuickJSWASMModuleFromVariant(quickJsReleaseSync);

export interface IExpressionSandboxOptions {
  timeoutMs?: number;
  memoryLimitBytes?: number;
  fromAi?: {
    provided?: Record<string, unknown>;
    collect?: (name: string, description: string, type: string) => void;
  };
}

interface ISandboxResult {
  hasValue: boolean;
  value?: unknown;
  fromAiCalls: Array<[name: string, description: string, type: string]>;
}

function sandboxSource(expression: string): string {
  const statement = /^\s*(?:while|for)\s*\(/.test(expression)
    ? `(() => { ${expression}\n })()`
    : `(${expression})`;

  return `
"use strict";
(() => {
  const __payload = JSON.parse(__nomopsPayloadJson);
  const __scope = __payload.scope;
  const __guestGlobal = globalThis;
  const __forbidden = () => { throw new Error('表达式禁止访问危险原型或代码构造器'); };
  const __protectedPrototypes = [
    Object.getPrototypeOf(function() {}),
    Object.getPrototypeOf(async function() {}),
    Object.getPrototypeOf(function*() {}),
    Object.getPrototypeOf(async function*() {}),
  ];
  for (const __prototype of __protectedPrototypes) {
    const __descriptor = Object.getOwnPropertyDescriptor(__prototype, 'constructor');
    if (!__descriptor || __descriptor.configurable) {
      Object.defineProperty(__prototype, 'constructor', {
        configurable: false,
        enumerable: false,
        get: __forbidden,
      });
    }
    Object.freeze(__prototype);
  }
  const __protoDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__');
  if (!__protoDescriptor || __protoDescriptor.configurable) {
    Object.defineProperty(Object.prototype, '__proto__', {
      configurable: false,
      enumerable: false,
      get: __forbidden,
      set: __forbidden,
    });
  }

  const $json = __scope.$json ?? {};
  const $itemIndex = __scope.$itemIndex ?? 0;
  const $items = __scope.$items ?? [];
  const $workflow = __scope.$workflow ?? {};
  const $vars = __scope.$vars ?? {};
  const $parameter = __scope.$parameter ?? {};
  const $execution = __scope.$execution ?? {};
  const $runIndex = __scope.$runIndex ?? 0;
  const $prevNode = __scope.$prevNode ?? {};
  const items = __scope.items ?? $items;
  const $now = __scope.$now ?? new Date().toISOString();

  const __nodeData = __scope.__nodeData ?? {};
  const __nodeAccessor = (name) => {
    const data = __nodeData[name];
    if (!data) throw new Error('表达式引用的节点 "' + name + '" 尚未执行或不存在');
    return {
      json: data.items[0]?.json ?? {},
      first: () => data.items[0],
      last: () => data.items[data.items.length - 1],
      all: () => data.items,
      itemMatching: (index) => data.items[index],
      item: data.item,
    };
  };
  const $node = new Proxy(Object.create(null), {
    get: (_target, name) => typeof name === 'string' ? __nodeAccessor(name) : undefined,
    has: () => true,
  });
  const $ = (name) => __nodeAccessor(name);
  const $input = {
    all: () => $items,
    first: () => $items[0],
    last: () => $items[$items.length - 1],
    item: $items[$itemIndex],
    length: $items.length,
  };

  const __fromAiCalls = [];
  const __fromAiPlaceholders = {
    string: '', number: 0, boolean: false, json: {},
  };
  const $fromAI = (name, description = '', type = 'string') => {
    if (__payload.fromAiProvided && Object.prototype.hasOwnProperty.call(__payload.fromAiProvided, name)) {
      return __payload.fromAiProvided[name];
    }
    if (__payload.collectFromAi) {
      __fromAiCalls.push([name, description, type]);
      return __fromAiPlaceholders[type] ?? '';
    }
    return undefined;
  };

  const process = undefined;
  const require = undefined;
  const global = undefined;
  const module = undefined;
  const exports = undefined;
  const fetch = undefined;
  const WebAssembly = undefined;
  const setTimeout = undefined;
  const setInterval = undefined;
  const setImmediate = undefined;
  __guestGlobal.Function = undefined;
  __guestGlobal.eval = undefined;
  __guestGlobal.globalThis = undefined;

  const __value = ${statement};
  if (__value !== undefined && (typeof __value === 'function' || typeof __value === 'symbol')) {
    throw new Error('表达式返回了不可序列化的结果');
  }
  return JSON.stringify({
    hasValue: __value !== undefined,
    value: __value,
    fromAiCalls: __fromAiCalls,
  });
})()
`;
}

/**
 * 沙箱求值一段 JS 表达式。
 *
 * 每次求值创建独立 QuickJS 堆与全局域，作用域只以 JSON 深拷贝传入，
 * 不暴露任何宿主函数/对象；硬超时、内存与栈上限阻断死循环和资源耗尽。
 */
export function evaluateInSandbox(
  expression: string,
  scope: Record<string, unknown>,
  options: IExpressionSandboxOptions = {},
): unknown {
  const timeoutMs = options.timeoutMs ?? EXPRESSION_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const context = QuickJS.newContext();
  context.runtime.setMemoryLimit(options.memoryLimitBytes ?? EXPRESSION_MEMORY_LIMIT_BYTES);
  context.runtime.setMaxStackSize(EXPRESSION_STACK_LIMIT_BYTES);
  context.runtime.setInterruptHandler(() => Date.now() >= deadline);

  try {
    const payload = JSON.stringify({
      scope,
      fromAiProvided: options.fromAi?.provided,
      collectFromAi: options.fromAi?.collect !== undefined,
    });
    const payloadHandle = context.newString(payload);
    context.setProp(context.global, '__nomopsPayloadJson', payloadHandle);
    payloadHandle.dispose();

    const result = context.evalCode(sandboxSource(expression), 'expression.js');
    if (result.error) {
      const dumped = context.dump(result.error) as { message?: string } | string;
      result.error.dispose();
      const message = typeof dumped === 'string' ? dumped : dumped.message ?? String(dumped);
      const timedOut = Date.now() >= deadline || /interrupted/i.test(message);
      throw new ExpressionError(
        timedOut ? `表达式求值超时（>${timeoutMs}ms）` : `表达式求值失败: ${message}`,
        { expression, timeoutMs, timedOut },
      );
    }

    const serialized = context.dump(result.value);
    result.value.dispose();
    if (typeof serialized !== 'string') {
      throw new ExpressionError('表达式返回了不可序列化的结果', { expression });
    }
    const sandboxResult = JSON.parse(serialized) as ISandboxResult;
    for (const [name, description, type] of sandboxResult.fromAiCalls) {
      options.fromAi?.collect?.(name, description, type);
    }
    return sandboxResult.hasValue ? sandboxResult.value : undefined;
  } catch (error) {
    if (error instanceof ExpressionError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = Date.now() >= deadline || /interrupted/i.test(message);
    throw new ExpressionError(
      timedOut ? `表达式求值超时（>${timeoutMs}ms）` : `表达式求值失败: ${message}`,
      { expression, timeoutMs, timedOut },
    );
  } finally {
    context.dispose();
  }
}
