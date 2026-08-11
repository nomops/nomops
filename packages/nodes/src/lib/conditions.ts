import { OperationalError } from '@nomops/workflow';

/** 条件行（If / Filter / Switch 共用）：left/right 由引擎在取参时求值表达式。 */
export interface ICondition {
  left: unknown;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'isEmpty' | 'isNotEmpty';
  right?: unknown;
}

function coercePair(left: unknown, right: unknown): [unknown, unknown] {
  if (typeof left === typeof right) return [left, right];
  if (typeof left === 'number' || typeof right === 'number') {
    const a = Number(left);
    const b = Number(right);
    if (Number.isFinite(a) && Number.isFinite(b)) return [a, b];
  }
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    const bool = (value: unknown) => value === true || value === 'true' || value === 1 || value === '1';
    return [bool(left), bool(right)];
  }
  return [String(left), String(right)];
}

export function compareCondition(c: ICondition, convertTypes = false): boolean {
  let { left, right } = c;
  const { op } = c;
  if (convertTypes && op !== 'isEmpty' && op !== 'isNotEmpty') [left, right] = coercePair(left, right);
  switch (op) {
    case 'eq':
      return left === right;
    case 'ne':
      return left !== right;
    case 'gt':
      return (left as number) > (right as number);
    case 'gte':
      return (left as number) >= (right as number);
    case 'lt':
      return (left as number) < (right as number);
    case 'lte':
      return (left as number) <= (right as number);
    case 'contains':
      return String(left).includes(String(right));
    case 'isEmpty':
      return left === null || left === undefined || left === '';
    case 'isNotEmpty':
      return !(left === null || left === undefined || left === '');
    default:
      throw new OperationalError(`Unsupported comparison operator: ${String(op)}`, { op });
  }
}

/** 条件组判定：空条件组 = 通过（与 If 既有语义一致）。 */
export function conditionsPass(conditions: ICondition[], combine: 'and' | 'or', convertTypes = false): boolean {
  if (conditions.length === 0) return true;
  const results = conditions.map((condition) => compareCondition(condition, convertTypes));
  return combine === 'and' ? results.every(Boolean) : results.some(Boolean);
}
