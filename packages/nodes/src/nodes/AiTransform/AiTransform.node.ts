import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { validateAiTransformCode } from '../../lib/ai-transform-code.js';
import { runJavaScriptInChildProcess } from '../Code/Code.node.js';
import { aiTransformDescription } from './AiTransform.description.js';

export class AiTransform implements INodeType {
  description = aiTransformDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const instructions = String(this.getNodeParameter('instructions', 0, '')).trim();
    const generatedForPrompt = String(this.getNodeParameter('generatedForPrompt', 0, '')).trim();
    if (!instructions) throw new OperationalError('AI Transform instructions are required');
    if (instructions !== generatedForPrompt) {
      throw new OperationalError('AI Transform instructions changed; generate code again before running');
    }
    const code = validateAiTransformCode(this.getNodeParameter('generatedCode', 0, ''));
    const input = this.getInputData();
    const result = await runJavaScriptInChildProcess(code, input);
    if (!Array.isArray(result)) throw new OperationalError('AI Transform must return an items array');
    return [result.map((item, index) => {
      if (item !== null && typeof item === 'object' && 'json' in item) {
        return { json: (item as INodeExecutionData).json, pairedItem: { item: index } };
      }
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        throw new OperationalError(`AI Transform item ${index} must be an object`);
      }
      return { json: item as Record<string, unknown>, pairedItem: { item: index } };
    })];
  }
}
