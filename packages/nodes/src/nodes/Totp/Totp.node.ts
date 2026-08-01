import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { z } from 'zod';
import { generateTotp, verifyTotpCode } from '../../lib/totp.js';
import { totpDescription } from './Totp.description.js';

const parametersSchema = z.object({
  operation: z.enum(['generate', 'verify']),
  algorithm: z.enum(['sha1', 'sha256', 'sha512']),
  digits: z.union([z.literal(6), z.literal(8)]),
  period: z.number().int().min(1).max(3600),
  window: z.number().int().min(0).max(10),
  outputField: z.string().trim().min(1).max(256).refine((value) => !value.includes('.')),
});

export class Totp implements INodeType {
  description = totpDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const credentials = await this.getCredentials('totp');
    const secret = typeof credentials['secret'] === 'string' ? credentials['secret'] : '';
    if (!secret) throw new OperationalError('TOTP credential does not contain a secret', {});
    const output: INodeExecutionData[] = [];
    for (const [itemIndex, item] of this.getInputData().entries()) {
      const parsed = parametersSchema.safeParse({
        operation: this.getNodeParameter('operation', itemIndex, 'generate'),
        algorithm: this.getNodeParameter('algorithm', itemIndex, 'sha1'),
        digits: this.getNodeParameter('digits', itemIndex, 6),
        period: this.getNodeParameter('period', itemIndex, 30),
        window: this.getNodeParameter('window', itemIndex, 1),
        outputField: this.getNodeParameter('outputField', itemIndex, 'totp'),
      });
      if (!parsed.success) throw new OperationalError('TOTP parameters are invalid', {});
      const options = {
        algorithm: parsed.data.algorithm,
        digits: parsed.data.digits,
        period: parsed.data.period,
      };
      const value = parsed.data.operation === 'generate'
        ? generateTotp(secret, options)
        : verifyTotpCode(secret, String(this.getNodeParameter('code', itemIndex, '')), {
            ...options,
            window: parsed.data.window,
          });
      output.push({ json: { ...item.json, [parsed.data.outputField]: value }, binary: item.binary, pairedItem: { item: itemIndex } });
    }
    return [output];
  }
}
