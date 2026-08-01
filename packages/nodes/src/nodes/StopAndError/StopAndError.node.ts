import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { z } from 'zod';
import { stopAndErrorDescription } from './StopAndError.description.js';

const stopInputSchema = z.object({
  message: z.string().trim().min(1).max(10_000),
  description: z.string().max(20_000),
});

export class StopAndError implements INodeType {
  description = stopAndErrorDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const parsed = stopInputSchema.safeParse({
      message: this.getNodeParameter('errorMessage', 0, ''),
      description: this.getNodeParameter('errorDescription', 0, ''),
    });
    if (!parsed.success) throw new OperationalError('Stop and Error parameters are invalid', {});
    throw new OperationalError(parsed.data.message, {
      ...(parsed.data.description ? { description: parsed.data.description } : {}),
    });
  }
}
