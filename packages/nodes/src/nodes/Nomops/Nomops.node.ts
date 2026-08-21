import type {
  IExecuteContext,
  INodeExecutionData,
  INodeType,
  JsonObject,
  NomopsApiOperation,
} from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { nomopsDescription } from './Nomops.description.js';

function json(value: unknown): JsonObject {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject;
  return { value: value as JsonObject[string] };
}

export class Nomops implements INodeType {
  description = nomopsDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    if (!this.helpers.nomopsApiRequest) {
      throw new OperationalError('Nomops self API is unavailable', {});
    }
    const input = this.getInputData();
    const source = input.length > 0 ? input : [{ json: {} }];
    const output: INodeExecutionData[] = [];

    for (let index = 0; index < source.length; index++) {
      const resource = String(this.getNodeParameter('resource', index, 'workflow'));
      const operation = String(this.getNodeParameter('operation', index, 'list'));
      const apiOperation = `${resource}.${operation}` as NomopsApiOperation;
      const credentials = await this.getCredentials('nomopsApi');
      const apiKey = String(credentials['apiKey'] ?? '');
      const resourceId = String(this.getNodeParameter('resourceId', index, '')).trim();
      const response = await this.helpers.nomopsApiRequest({
        operation: apiOperation,
        apiKey,
        ...(resourceId ? { resourceId } : {}),
        ...(apiOperation === 'execution.retry'
          ? { useOriginal: this.getNodeParameter('useOriginal', index, false) === true }
          : {}),
      });
      const values = Array.isArray(response) ? response : [response];
      const returnAll = this.getNodeParameter('returnAll', index, true) === true;
      const limit = Math.max(1, Math.min(500, Number(this.getNodeParameter('limit', index, 50)) || 50));
      for (const value of (returnAll ? values : values.slice(0, limit))) {
        output.push({ json: json(value), pairedItem: { item: index } });
      }
    }
    return [output];
  }
}
