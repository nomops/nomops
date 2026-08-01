import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { z } from 'zod';
import { META_KEY } from '../SetMetadata/SetMetadata.node.js';
import { executionDataDescription } from './ExecutionData.description.js';

const operationSchema = z.enum(['set', 'get', 'getAll']);
const fieldSchema = z.string().trim().min(1).max(256).refine((value) => !value.includes('.'), 'Nested fields are not supported');

function metadataFrom(item: INodeExecutionData): Record<string, string> {
  const value = item.json[META_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export class ExecutionData implements INodeType {
  description = executionDataDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const output: INodeExecutionData[] = [];
    for (const [itemIndex, item] of this.getInputData().entries()) {
      const parsedOperation = operationSchema.safeParse(this.getNodeParameter('operation', itemIndex, 'set'));
      if (!parsedOperation.success) throw new OperationalError('Execution Data operation is invalid', {});
      const existing = metadataFrom(item);
      if (parsedOperation.data === 'set') {
        const raw = this.getNodeParameter('metadata', itemIndex, {});
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new OperationalError('Execution Data metadata must be an object', {});
        }
        const next = { ...existing };
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          const parsedKey = fieldSchema.safeParse(key);
          if (!parsedKey.success) throw new OperationalError('Execution Data metadata key is invalid', {});
          const serialized = stringValue(value);
          if (serialized !== undefined) next[parsedKey.data] = serialized;
        }
        output.push({ json: { ...item.json, [META_KEY]: next }, binary: item.binary, pairedItem: { item: itemIndex } });
        continue;
      }
      const parsedField = fieldSchema.safeParse(this.getNodeParameter('outputField', itemIndex, 'executionData'));
      if (!parsedField.success) throw new OperationalError('Execution Data output field is invalid', {});
      const value = parsedOperation.data === 'getAll'
        ? existing
        : existing[String(this.getNodeParameter('key', itemIndex, ''))];
      output.push({
        json: { ...item.json, [parsedField.data]: value ?? null },
        binary: item.binary,
        pairedItem: { item: itemIndex },
      });
    }
    return [output];
  }
}
