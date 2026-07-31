import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { limitDescription } from './Limit.description.js';

export class Limit implements INodeType {
  description = limitDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const rawLimit = Number(this.getNodeParameter('maxItems', 0, 1));
    if (!Number.isFinite(rawLimit) || rawLimit < 0) {
      throw new OperationalError('Limit: Max Items must be a non-negative number', {});
    }
    const maxItems = Math.floor(rawLimit);
    const keep = String(this.getNodeParameter('keep', 0, 'firstItems'));
    if (maxItems >= items.length) return [items];
    return [keep === 'lastItems' ? items.slice(-maxItems || items.length) : items.slice(0, maxItems)];
  }
}
