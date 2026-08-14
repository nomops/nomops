import { parseExpression } from '@babel/parser';

export interface IExpressionExtensionDoc {
  name: string;
  types: Array<'Array' | 'Boolean' | 'DateTime' | 'Number' | 'Object' | 'String'>;
  description: string;
  returnType: string;
  example: string;
}

/** 首批覆盖 n8n 最常用的数据转换方法；同时作为前端补全的单一真源。 */
export const EXPRESSION_EXTENSION_DOCS: IExpressionExtensionDoc[] = [
  { name: 'isEmpty', types: ['Array', 'Object', 'String'], description: 'Returns true when the value is empty.', returnType: 'boolean', example: '$json.value.isEmpty()' },
  { name: 'isNotEmpty', types: ['Array', 'Object', 'String'], description: 'Returns true when the value is not empty.', returnType: 'boolean', example: '$json.value.isNotEmpty()' },
  { name: 'first', types: ['Array'], description: 'Returns the first array item.', returnType: 'unknown', example: '$json.items.first()' },
  { name: 'last', types: ['Array'], description: 'Returns the last array item.', returnType: 'unknown', example: '$json.items.last()' },
  { name: 'pluck', types: ['Array'], description: 'Returns one field from every object in an array.', returnType: 'Array', example: "$json.users.pluck('email')" },
  { name: 'unique', types: ['Array'], description: 'Removes duplicate array values.', returnType: 'Array', example: '$json.tags.unique()' },
  { name: 'compact', types: ['Array', 'Object'], description: 'Removes null, undefined and empty-string values.', returnType: 'Array | Object', example: '$json.value.compact()' },
  { name: 'sum', types: ['Array'], description: 'Adds all numeric array values.', returnType: 'number', example: '$json.values.sum()' },
  { name: 'average', types: ['Array'], description: 'Returns the mean of numeric array values.', returnType: 'number', example: '$json.values.average()' },
  { name: 'min', types: ['Array'], description: 'Returns the smallest numeric array value.', returnType: 'number', example: '$json.values.min()' },
  { name: 'max', types: ['Array'], description: 'Returns the largest numeric array value.', returnType: 'number', example: '$json.values.max()' },
  { name: 'isEmail', types: ['String'], description: 'Checks whether a string is an email address.', returnType: 'boolean', example: '$json.email.isEmail()' },
  { name: 'toNumber', types: ['String'], description: 'Converts a numeric string to a number.', returnType: 'number', example: '$json.amount.toNumber()' },
  { name: 'toBoolean', types: ['Number', 'String'], description: 'Converts a value to a boolean.', returnType: 'boolean', example: '$json.enabled.toBoolean()' },
  { name: 'toSnakeCase', types: ['String'], description: 'Converts text to snake_case.', returnType: 'string', example: '$json.name.toSnakeCase()' },
  { name: 'toTitleCase', types: ['String'], description: 'Converts text to Title Case.', returnType: 'string', example: '$json.name.toTitleCase()' },
  { name: 'toDateTime', types: ['Number', 'String'], description: 'Converts a value to a Luxon-compatible DateTime.', returnType: 'DateTime', example: '$json.createdAt.toDateTime()' },
  { name: 'isEven', types: ['Number'], description: 'Checks whether an integer is even.', returnType: 'boolean', example: '$json.count.isEven()' },
  { name: 'isOdd', types: ['Number'], description: 'Checks whether an integer is odd.', returnType: 'boolean', example: '$json.count.isOdd()' },
  { name: 'round', types: ['Number'], description: 'Rounds to an optional number of decimal places.', returnType: 'number', example: '$json.amount.round(2)' },
  { name: 'ceil', types: ['Number'], description: 'Rounds up to the next integer.', returnType: 'number', example: '$json.amount.ceil()' },
  { name: 'floor', types: ['Number'], description: 'Rounds down to the previous integer.', returnType: 'number', example: '$json.amount.floor()' },
  { name: 'keys', types: ['Object'], description: 'Returns the object keys.', returnType: 'Array', example: '$json.payload.keys()' },
  { name: 'values', types: ['Object'], description: 'Returns the object values.', returnType: 'Array', example: '$json.payload.values()' },
  { name: 'hasField', types: ['Object'], description: 'Checks whether an object has a top-level field.', returnType: 'boolean', example: "$json.payload.hasField('id')" },
  { name: 'plus', types: ['DateTime'], description: 'Adds a Luxon duration object.', returnType: 'DateTime', example: '$now.plus({ days: 1 })' },
  { name: 'minus', types: ['DateTime'], description: 'Subtracts a Luxon duration object.', returnType: 'DateTime', example: '$now.minus({ hours: 2 })' },
  { name: 'startOf', types: ['DateTime'], description: 'Moves to the start of a time unit.', returnType: 'DateTime', example: "$now.startOf('day')" },
  { name: 'endOf', types: ['DateTime'], description: 'Moves to the end of a time unit.', returnType: 'DateTime', example: "$now.endOf('month')" },
  { name: 'toISO', types: ['DateTime'], description: 'Formats a DateTime as ISO 8601.', returnType: 'string', example: '$now.toISO()' },
  { name: 'toISODate', types: ['DateTime'], description: 'Formats a DateTime as an ISO date.', returnType: 'string', example: '$today.toISODate()' },
  { name: 'toFormat', types: ['DateTime'], description: 'Formats a DateTime with Luxon tokens.', returnType: 'string', example: "$now.toFormat('yyyy-MM-dd')" },
];

const EXTENSION_METHOD_NAMES = new Set(EXPRESSION_EXTENSION_DOCS.map((doc) => doc.name));

interface AstNode {
  type: string;
  start: number | null;
  end: number | null;
  [key: string]: unknown;
}

function isAstNode(value: unknown): value is AstNode {
  return value !== null && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}

function visitAst(value: unknown, visitor: (node: AstNode) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) visitAst(child, visitor);
    return;
  }
  if (!isAstNode(value)) return;
  visitor(value);
  for (const [key, child] of Object.entries(value)) {
    if (key === 'loc' || key === 'extra' || key === 'comments' || key === 'errors') continue;
    if (Array.isArray(child) || isAstNode(child)) visitAst(child, visitor);
  }
}

function extensionCall(node: AstNode): { receiver: AstNode; method: string; args: AstNode[] } | null {
  if (node.type !== 'CallExpression') return null;
  const callee = node['callee'];
  if (!isAstNode(callee) || callee.type !== 'MemberExpression' || callee['optional'] === true) return null;
  const receiver = callee['object'];
  const property = callee['property'];
  if (!isAstNode(receiver) || !isAstNode(property)) return null;
  let method: string | undefined;
  if (callee['computed'] === false && property.type === 'Identifier') method = String(property['name']);
  if (callee['computed'] === true && property.type === 'StringLiteral') method = String(property['value']);
  if (!method || !EXTENSION_METHOD_NAMES.has(method)) return null;
  const rawArgs = node['arguments'];
  if (!Array.isArray(rawArgs) || !rawArgs.every(isAstNode)) return null;
  return { receiver, method, args: rawArgs };
}

/**
 * 把扩展方法调用改写为显式 `__extend(value, method, args)`，不修改任何原型。
 * 每轮只替换最内层调用并重新解析，因而嵌套 receiver/argument 仍保持正确优先级。
 */
export function rewriteExpressionExtensions(expression: string): string {
  let output = expression;
  for (let pass = 0; pass < 64; pass++) {
    let root: AstNode;
    try {
      root = parseExpression(output) as unknown as AstNode;
    } catch {
      return output;
    }
    const calls: Array<{ node: AstNode; receiver: AstNode; method: string; args: AstNode[] }> = [];
    visitAst(root, (node) => {
      const call = extensionCall(node);
      if (call) calls.push({ node, ...call });
    });
    if (!calls.length) return output;
    const innermost = calls.filter((candidate) => !calls.some((other) =>
      other !== candidate
      && other.node.start !== null
      && other.node.end !== null
      && candidate.node.start !== null
      && candidate.node.end !== null
      && other.node.start >= candidate.node.start
      && other.node.end <= candidate.node.end
      && (other.node.start > candidate.node.start || other.node.end < candidate.node.end),
    ));
    const replacements = innermost.flatMap((call) => {
      const { node, receiver, args } = call;
      if (node.start === null || node.end === null || receiver.start === null || receiver.end === null) return [];
      const argSources = args.flatMap((arg) => arg.start === null || arg.end === null ? [] : [output.slice(arg.start, arg.end)]);
      if (argSources.length !== args.length) return [];
      return [{
        start: node.start,
        end: node.end,
        value: `__extend(${output.slice(receiver.start, receiver.end)},${JSON.stringify(call.method)},[${argSources.join(',')}])`,
      }];
    }).sort((a, b) => b.start - a.start);
    if (!replacements.length) return output;
    for (const replacement of replacements) {
      output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
    }
  }
  return output;
}

/** 注入 QuickJS guest 的 DateTime 与扩展运行时；只依赖沙箱内建对象，可在浏览器同构运行。 */
export const EXPRESSION_GUEST_RUNTIME_SOURCE = String.raw`
  const __unsafeExtensionNames = new Set(['__proto__', 'prototype', 'constructor', 'caller', 'arguments']);
  const __pad = (value, length = 2) => String(value).padStart(length, '0');
  const __parseOffset = (value) => {
    const match = String(value).match(/([+-])(\d{2}):(\d{2})(?:\[[^\]]+\])?$/);
    if (!match) return 0;
    const offset = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === '-' ? -offset : offset;
  };
  const __durationNumber = (duration, singular, plural) => Number(duration?.[plural] ?? duration?.[singular] ?? 0);

  class DateTime {
    constructor(timestamp, zone = 'UTC', offsetMinutes = 0, valid = true) {
      this.ts = Number(timestamp);
      this.zoneName = zone || 'UTC';
      this.offset = Number(offsetMinutes) || 0;
      this.isValid = Boolean(valid) && Number.isFinite(this.ts);
      this.invalidReason = this.isValid ? null : 'invalid input';
    }
    static now() { return new DateTime(Date.now(), 'UTC', 0); }
    static local() { return DateTime.now(); }
    static fromMillis(value, options = {}) { return new DateTime(Number(value), options.zone ?? 'UTC', 0); }
    static fromSeconds(value, options = {}) { return DateTime.fromMillis(Number(value) * 1000, options); }
    static fromJSDate(value, options = {}) { return DateTime.fromMillis(value?.getTime?.(), options); }
    static fromISO(value, options = {}) {
      const raw = String(value ?? '');
      const timestamp = Date.parse(raw);
      const offset = options.zone === 'UTC' ? 0 : __parseOffset(raw);
      return new DateTime(timestamp, options.zone ?? (offset === 0 ? 'UTC' : 'fixed'), offset, Number.isFinite(timestamp));
    }
    static isDateTime(value) { return value instanceof DateTime; }
    _localDate() { return new Date(this.ts + this.offset * 60000); }
    _fromLocalDate(value) { return new DateTime(value.getTime() - this.offset * 60000, this.zoneName, this.offset, this.isValid); }
    plus(duration = {}) {
      const local = this._localDate();
      const years = __durationNumber(duration, 'year', 'years');
      const months = __durationNumber(duration, 'month', 'months') + __durationNumber(duration, 'quarter', 'quarters') * 3;
      if (years) local.setUTCFullYear(local.getUTCFullYear() + years);
      if (months) local.setUTCMonth(local.getUTCMonth() + months);
      const milliseconds = __durationNumber(duration, 'millisecond', 'milliseconds')
        + __durationNumber(duration, 'second', 'seconds') * 1000
        + __durationNumber(duration, 'minute', 'minutes') * 60000
        + __durationNumber(duration, 'hour', 'hours') * 3600000
        + __durationNumber(duration, 'day', 'days') * 86400000
        + __durationNumber(duration, 'week', 'weeks') * 604800000;
      local.setTime(local.getTime() + milliseconds);
      return this._fromLocalDate(local);
    }
    minus(duration = {}) {
      const negative = {};
      for (const [key, value] of Object.entries(duration)) negative[key] = -Number(value);
      return this.plus(negative);
    }
    startOf(unit) {
      const local = this._localDate();
      if (unit === 'year') local.setUTCMonth(0, 1);
      if (unit === 'year' || unit === 'month') local.setUTCDate(1);
      if (unit === 'week') {
        const weekday = local.getUTCDay() || 7;
        local.setUTCDate(local.getUTCDate() - weekday + 1);
      }
      if (['year', 'month', 'week', 'day'].includes(unit)) local.setUTCHours(0);
      if (['year', 'month', 'week', 'day', 'hour'].includes(unit)) local.setUTCMinutes(0);
      if (['year', 'month', 'week', 'day', 'hour', 'minute'].includes(unit)) local.setUTCSeconds(0);
      if (['year', 'month', 'week', 'day', 'hour', 'minute', 'second'].includes(unit)) local.setUTCMilliseconds(0);
      return this._fromLocalDate(local);
    }
    endOf(unit) {
      const next = { year: 'years', month: 'months', week: 'weeks', day: 'days', hour: 'hours', minute: 'minutes', second: 'seconds' }[unit];
      return next ? this.startOf(unit).plus({ [next]: 1 }).minus({ milliseconds: 1 }) : this;
    }
    set(values = {}) {
      const local = this._localDate();
      if (values.year !== undefined) local.setUTCFullYear(Number(values.year));
      if (values.month !== undefined) local.setUTCMonth(Number(values.month) - 1);
      if (values.day !== undefined) local.setUTCDate(Number(values.day));
      if (values.hour !== undefined) local.setUTCHours(Number(values.hour));
      if (values.minute !== undefined) local.setUTCMinutes(Number(values.minute));
      if (values.second !== undefined) local.setUTCSeconds(Number(values.second));
      if (values.millisecond !== undefined) local.setUTCMilliseconds(Number(values.millisecond));
      return this._fromLocalDate(local);
    }
    setZone(zone) {
      if (zone === 'UTC' || zone === 'utc') return new DateTime(this.ts, 'UTC', 0, this.isValid);
      const match = String(zone).match(/^([+-])(\d{2}):(\d{2})$/);
      if (!match) return new DateTime(this.ts, String(zone), this.offset, this.isValid);
      const offset = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1);
      return new DateTime(this.ts, String(zone), offset, this.isValid);
    }
    toMillis() { return this.ts; }
    toSeconds() { return this.ts / 1000; }
    toISODate() {
      const date = this._localDate();
      return __pad(date.getUTCFullYear(), 4) + '-' + __pad(date.getUTCMonth() + 1) + '-' + __pad(date.getUTCDate());
    }
    toISO() {
      if (!this.isValid) return null;
      const date = this._localDate();
      const offset = this.offset === 0 ? 'Z' : (this.offset < 0 ? '-' : '+') + __pad(Math.floor(Math.abs(this.offset) / 60)) + ':' + __pad(Math.abs(this.offset) % 60);
      return this.toISODate() + 'T' + __pad(date.getUTCHours()) + ':' + __pad(date.getUTCMinutes()) + ':' + __pad(date.getUTCSeconds()) + '.' + __pad(date.getUTCMilliseconds(), 3) + offset;
    }
    toFormat(format) {
      const date = this._localDate();
      const tokens = {
        yyyy: __pad(date.getUTCFullYear(), 4), MM: __pad(date.getUTCMonth() + 1), dd: __pad(date.getUTCDate()),
        HH: __pad(date.getUTCHours()), mm: __pad(date.getUTCMinutes()), ss: __pad(date.getUTCSeconds()), SSS: __pad(date.getUTCMilliseconds(), 3),
      };
      return String(format).replace(/yyyy|SSS|MM|dd|HH|mm|ss/g, (token) => tokens[token]);
    }
    toJSON() { return this.toISO(); }
    toString() { return this.toISO() ?? 'Invalid DateTime'; }
    valueOf() { return this.ts; }
    get year() { return this._localDate().getUTCFullYear(); }
    get month() { return this._localDate().getUTCMonth() + 1; }
    get day() { return this._localDate().getUTCDate(); }
    get hour() { return this._localDate().getUTCHours(); }
    get minute() { return this._localDate().getUTCMinutes(); }
    get second() { return this._localDate().getUTCSeconds(); }
    get millisecond() { return this._localDate().getUTCMilliseconds(); }
    get weekday() { return this._localDate().getUTCDay() || 7; }
  }

  const __isEmptyValue = (value) => value === null || value === undefined || value === ''
    || (Array.isArray(value) && value.length === 0)
    || (value && typeof value === 'object' && !(value instanceof DateTime) && Object.keys(value).length === 0);
  const __ensureNumbers = (value, name) => {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'number')) throw new Error(name + '(): all array elements must be numbers');
  };
  const __compactValue = (value) => {
    if (Array.isArray(value)) return value.filter((entry) => !__isEmptyValue(entry)).map((entry) => entry && typeof entry === 'object' ? __compactValue(entry) : entry);
    const output = {};
    for (const [key, entry] of Object.entries(value ?? {})) if (!__isEmptyValue(entry)) output[key] = entry && typeof entry === 'object' ? __compactValue(entry) : entry;
    return output;
  };
  const __extensions = {
    Array: {
      isEmpty: (value) => value.length === 0,
      isNotEmpty: (value) => value.length > 0,
      first: (value) => value[0], last: (value) => value[value.length - 1],
      pluck: (value, args) => value.map((entry) => entry && typeof entry === 'object' ? entry[args[0]] : undefined),
      unique: (value) => value.filter((entry, index) => value.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(entry)) === index),
      compact: (value) => __compactValue(value),
      sum: (value) => { __ensureNumbers(value, 'sum'); return value.reduce((total, entry) => total + entry, 0); },
      average: (value) => { __ensureNumbers(value, 'average'); return value.length ? value.reduce((total, entry) => total + entry, 0) / value.length : 0; },
      min: (value) => { __ensureNumbers(value, 'min'); return Math.min(...value); },
      max: (value) => { __ensureNumbers(value, 'max'); return Math.max(...value); },
    },
    String: {
      isEmpty: (value) => value.length === 0, isNotEmpty: (value) => value.length > 0,
      isEmail: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      toNumber: (value) => { const number = Number(value); if (!Number.isFinite(number)) throw new Error('toNumber(): value is not numeric'); return number; },
      toBoolean: (value) => { const normalized = value.trim().toLowerCase(); if (['true', '1'].includes(normalized)) return true; if (['false', '0'].includes(normalized)) return false; throw new Error('toBoolean(): value must be true, false, 1 or 0'); },
      toSnakeCase: (value) => value.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').toLowerCase(),
      toTitleCase: (value) => value.toLowerCase().replace(/(^|[\s_-])([\p{L}\p{N}])/gu, (_match, prefix, letter) => (prefix ? ' ' : '') + letter.toUpperCase()),
      toDateTime: (value, args) => args[0] === 's' ? DateTime.fromSeconds(Number(value)) : args[0] === 'ms' ? DateTime.fromMillis(Number(value)) : DateTime.fromISO(value),
    },
    Number: {
      isEven: (value) => { if (!Number.isInteger(value)) throw new Error('isEven() is only callable on integers'); return value % 2 === 0; },
      isOdd: (value) => { if (!Number.isInteger(value)) throw new Error('isOdd() is only callable on integers'); return Math.abs(value) % 2 === 1; },
      round: (value, args) => Number(value.toFixed(Number(args[0] ?? 0))), ceil: (value) => Math.ceil(value), floor: (value) => Math.floor(value),
      toBoolean: (value) => value !== 0,
      toDateTime: (value, args) => args[0] === 's' ? DateTime.fromSeconds(value) : args[0] === 'us' ? DateTime.fromMillis(value / 1000) : DateTime.fromMillis(value),
    },
    Object: {
      isEmpty: (value) => Object.keys(value).length === 0, isNotEmpty: (value) => Object.keys(value).length > 0,
      keys: (value) => Object.keys(value), values: (value) => Object.values(value),
      hasField: (value, args) => Object.prototype.hasOwnProperty.call(value, args[0]), compact: (value) => __compactValue(value),
    },
  };
  const __typeOfExtensionValue = (value) => Array.isArray(value) ? 'Array'
    : typeof value === 'string' ? 'String'
    : typeof value === 'number' ? 'Number'
    : typeof value === 'boolean' ? 'Boolean'
    : value !== null && typeof value === 'object' ? 'Object' : null;
  const __extend = (input, name, args) => {
    if (__unsafeExtensionNames.has(name)) throw new Error('Cannot access unsafe expression method "' + name + '"');
    if (input === null || input === undefined) throw new Error(name + '() cannot be called on ' + String(input));
    const type = __typeOfExtensionValue(input);
    const extension = type ? __extensions[type]?.[name] : undefined;
    if (extension) return extension(input, args);
    const native = input[name];
    if (typeof native === 'function') return native.apply(input, args);
    throw new Error(name + '() is not available on type ' + (type ?? typeof input));
  };
`;
