import type {
  DisplayCondition,
  DisplayConditionValue,
  IDisplayOptions,
  INodeProperties,
  JsonObject,
} from '@nomops/workflow';

export interface DisplayOptionsContext {
  /** `@version` 使用画布节点自己的 typeVersion，而不是节点类型的最新版本。 */
  nodeVersion?: number;
  /** collection/fixedCollection 中以 `/` 开头的条件从节点根参数读取。 */
  rootParams?: JsonObject;
}

function isCondition(value: DisplayConditionValue): value is DisplayCondition {
  return value !== null
    && typeof value === 'object'
    && '_cnd' in value
    && Object.keys(value).length === 1;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftEntries = Object.entries(left as Record<string, unknown>);
  const rightObject = right as Record<string, unknown>;
  return leftEntries.length === Object.keys(rightObject).length
    && leftEntries.every(([key, value]) => Object.prototype.hasOwnProperty.call(rightObject, key) && deepEqual(value, rightObject[key]));
}

function conditionMatches(condition: DisplayCondition, actualValues: unknown[]): boolean {
  const [operator, target] = Object.entries(condition._cnd)[0] ?? [];
  if (!operator) return false;
  if (actualValues.length === 0) return operator === 'not';

  return actualValues.every((actual) => {
    switch (operator) {
      case 'eq': return deepEqual(actual, target);
      case 'not': return !deepEqual(actual, target);
      case 'gte': return (actual as number) >= (target as number);
      case 'lte': return (actual as number) <= (target as number);
      case 'gt': return (actual as number) > (target as number);
      case 'lt': return (actual as number) < (target as number);
      case 'between': {
        const range = target as { from: number | string; to: number | string };
        return (actual as number) >= (range.from as number) && (actual as number) <= (range.to as number);
      }
      case 'includes': return typeof actual === 'string' && actual.includes(String(target));
      case 'startsWith': return typeof actual === 'string' && actual.startsWith(String(target));
      case 'endsWith': return typeof actual === 'string' && actual.endsWith(String(target));
      case 'regex': {
        if (typeof actual !== 'string') return false;
        try {
          return new RegExp(String(target)).test(actual);
        } catch {
          return false;
        }
      }
      case 'exists': return actual !== null && actual !== undefined && actual !== '';
      default: return false;
    }
  });
}

/** 同一个键的条件是 OR；`_cnd` 面对数组值时要求所有实际值都命中。 */
export function checkDisplayConditions(conditions: DisplayConditionValue[], actualValues: unknown[]): boolean {
  return conditions.some((condition) =>
    isCondition(condition)
      ? conditionMatches(condition, actualValues)
      : actualValues.some((actual) => deepEqual(actual, condition)),
  );
}

function valueAtPath(source: JsonObject, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function defaultAtPath(allProps: INodeProperties[], path: string): unknown {
  const [first, ...rest] = path.split('.');
  const value = allProps.find((property) => property.name === first)?.default;
  if (rest.length === 0 || value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return valueAtPath(value as JsonObject, rest.join('.'));
}

function valuesFor(
  key: string,
  params: JsonObject,
  allProps: INodeProperties[],
  context: DisplayOptionsContext,
): unknown[] {
  if (key === '@version') return [context.nodeVersion ?? 0];
  const path = key.startsWith('/') ? key.slice(1) : key;
  const source = key.startsWith('/') ? (context.rootParams ?? params) : params;
  let value = valueAtPath(source, path);
  if (value === undefined) value = defaultAtPath(allProps, path);

  // 基线 resource locator 的持久化形态；先解出真实 value 再做显示判断。
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const locator = value as Record<string, unknown>;
    if (locator.__rl === true && 'value' in locator) value = locator.value;
  }
  return Array.isArray(value) ? value : [value];
}

function isExpressionValue(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('=');
}

/**
 * 基线兼容的 displayOptions 判断：
 * - show 键之间 AND，hide 任一命中即隐藏；
 * - `@version` 始终用保存于节点上的 typeVersion；
 * - 无法静态求值的表达式控制值按“可能命中”处理，避免误藏配置字段。
 */
export function matchesDisplayOptions(
  displayOptions: IDisplayOptions | undefined,
  params: JsonObject,
  allProps: INodeProperties[],
  context: DisplayOptionsContext = {},
): boolean {
  if (!displayOptions) return true;

  if (displayOptions.show) {
    // 版本门控优先，不能被另一个表达式控制值绕过。
    const entries = Object.entries(displayOptions.show).sort(([left], [right]) =>
      Number(right === '@version') - Number(left === '@version'));
    for (const [key, conditions] of entries) {
      if (!conditions) continue;
      const actualValues = valuesFor(key, params, allProps, context);
      if (key !== '@version' && actualValues.some(isExpressionValue)) continue;
      if (!checkDisplayConditions(conditions, actualValues)) return false;
    }
  }

  if (displayOptions.hide) {
    for (const [key, conditions] of Object.entries(displayOptions.hide)) {
      if (!conditions) continue;
      const actualValues = valuesFor(key, params, allProps, context);
      if (actualValues.some(isExpressionValue)) continue;
      if (checkDisplayConditions(conditions, actualValues)) return false;
    }
  }
  return true;
}

export function isPropertyVisible(
  prop: INodeProperties,
  params: JsonObject,
  allProps: INodeProperties[],
  context: DisplayOptionsContext = {},
): boolean {
  return matchesDisplayOptions(prop.displayOptions, params, allProps, context);
}
