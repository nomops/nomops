import type { INodeExecutionData } from '@nomops/workflow';

export type TransformFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'mixed';
export interface TransformInputField { path: string; type: TransformFieldType }

function valueType(value: unknown): Exclude<TransformFieldType, 'mixed'> {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'object') return 'object';
  return 'string';
}

/** Build a bounded path/type summary without copying any input value. */
export function describeTransformInputSchema(items: INodeExecutionData[]): TransformInputField[] {
  const fields = new Map<string, TransformFieldType>();
  const visit = (value: unknown, path: string, depth: number) => {
    if (!path || fields.size >= 100) return;
    const nextType = valueType(value);
    const current = fields.get(path);
    fields.set(path, current && current !== nextType ? 'mixed' : nextType);
    if (depth >= 3 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 3)) visit(item, `${path}[]`, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      visit(child, `${path}.${key}`, depth + 1);
      if (fields.size >= 100) break;
    }
  };
  for (const item of items.slice(0, 20)) {
    for (const [key, value] of Object.entries(item.json).slice(0, 100)) {
      visit(value, key, 0);
      if (fields.size >= 100) break;
    }
    if (fields.size >= 100) break;
  }
  return [...fields.entries()].map(([path, type]) => ({ path, type })).sort((a, b) => a.path.localeCompare(b.path));
}
