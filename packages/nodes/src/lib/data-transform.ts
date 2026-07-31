import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

export function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseFieldList(value: unknown): string[] {
  return String(value ?? '')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
}

export function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]));
}

export function cloneJsonObject(value: JsonObject): JsonObject {
  return cloneJsonValue(value) as JsonObject;
}

export function setPath(target: JsonObject, path: string, value: unknown): void {
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) return;

  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!isPlainObject(next)) current[segment] = {};
    current = current[segment] as JsonObject;
  }
  current[segments.at(-1)!] = value;
}

export function deletePath(target: JsonObject, path: string): boolean {
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) return false;

  let current: JsonObject = target;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!isPlainObject(next)) return false;
    current = next;
  }
  return delete current[segments.at(-1)!];
}

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (value === undefined) return { $type: 'undefined' };
  if (typeof value === 'number' && Number.isNaN(value)) return { $type: 'nan' };
  if (typeof value === 'number' && !Number.isFinite(value)) return { $type: String(value) };
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new OperationalError('Node input must be JSON-serializable', {});

  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((child) => canonicalize(child, seen));
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize((value as JsonObject)[key], seen)]),
    );
  } finally {
    seen.delete(value);
  }
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()));
}

export function withoutPaths(value: JsonObject, paths: string[]): JsonObject {
  const copy = cloneJsonObject(value);
  for (const path of paths) deletePath(copy, path);
  return copy;
}

export function assertSafeRegex(pattern: string, flags: string): RegExp {
  if (!pattern || pattern.length > 128) {
    throw new OperationalError('Rename Keys: regex must contain 1 to 128 characters', {});
  }
  if ([...flags].some((flag) => flag !== 'g' && flag !== 'i') || new Set(flags).size !== flags.length) {
    throw new OperationalError('Rename Keys: regex flags may only contain g and i once each', {});
  }
  if (/\\[1-9]|\(\?[=!<]|\([^)]*[+*][^)]*\)[+*{]|(?:\.\*){2,}/.test(pattern)) {
    throw new OperationalError('Rename Keys: regex uses an unsafe construct', {});
  }
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new OperationalError(`Rename Keys: invalid regex (${(error as Error).message})`, {});
  }
}
