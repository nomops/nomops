import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { getPath } from '../../lib/object-path.js';
import {
  assertSafeRegex,
  cloneJsonObject,
  deletePath,
  isPlainObject,
  setPath,
} from '../../lib/data-transform.js';
import { renameKeysDescription } from './RenameKeys.description.js';

interface IRenameRule {
  currentKey?: unknown;
  newKey?: unknown;
}

interface IRegexRule {
  pattern?: unknown;
  replacement?: unknown;
  flags?: unknown;
  maxDepth?: unknown;
}

function renameObjectKeys(value: unknown, regex: RegExp, replacement: string, maxDepth: number, depth = 0): unknown {
  if (Array.isArray(value)) {
    return value.map((child) => (maxDepth < 0 || depth < maxDepth
      ? renameObjectKeys(child, regex, replacement, maxDepth, depth + 1)
      : child));
  }
  if (!isPlainObject(value)) return value;

  const output: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    regex.lastIndex = 0;
    const nextKey = key.replace(regex, replacement);
    output[nextKey] = maxDepth < 0 || depth < maxDepth
      ? renameObjectKeys(child, regex, replacement, maxDepth, depth + 1)
      : child;
  }
  return output;
}

export class RenameKeys implements INodeType {
  description = renameKeysDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];

    for (const [itemIndex, item] of items.entries()) {
      let json = cloneJsonObject(item.json);
      const explicit = this.getNodeParameter('keys', itemIndex, { renames: [] }) as { renames?: IRenameRule[] };
      const regexRules = this.getNodeParameter('regexReplacements', itemIndex, { replacements: [] }) as {
        replacements?: IRegexRule[];
      };

      for (const rule of explicit.renames ?? []) {
        const currentKey = String(rule.currentKey ?? '').trim();
        const newKey = String(rule.newKey ?? '').trim();
        if (!currentKey || !newKey || currentKey === newKey) continue;
        const value = getPath(json, currentKey);
        if (value === undefined) continue;
        deletePath(json, currentKey);
        setPath(json, newKey, value);
      }

      for (const rule of regexRules.replacements ?? []) {
        const regex = assertSafeRegex(String(rule.pattern ?? ''), String(rule.flags ?? ''));
        const maxDepth = Math.floor(Number(rule.maxDepth ?? -1));
        json = renameObjectKeys(json, regex, String(rule.replacement ?? ''), Number.isFinite(maxDepth) ? maxDepth : -1) as JsonObject;
      }

      output.push({
        json,
        ...(item.binary ? { binary: item.binary } : {}),
        pairedItem: { item: itemIndex },
      });
    }
    return [output];
  }
}
