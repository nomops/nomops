import { describe, expect, it } from 'vitest';
import type { IExecuteContext, INodeExecutionData } from '@nomops/workflow';
import { validateAiTransformCode } from '../../lib/ai-transform-code.js';
import { AiTransform } from '../AiTransform/AiTransform.node.js';
import { aiTransformDescription } from '../AiTransform/AiTransform.description.js';

function context(items: INodeExecutionData[], parameters: Record<string, unknown>): IExecuteContext {
  return {
    getInputData: () => items,
    getNodeParameter: (name: string, _index: number, fallback?: unknown) => parameters[name] ?? fallback,
    getCredentials: async () => ({}),
    getWorkflowStaticData: () => ({}),
    helpers: { httpRequest: async () => ({}) },
  } as IExecuteContext;
}

describe('AI Transform node', () => {
  it('declares a metadata-driven generation action and read-only code', () => {
    const instructions = aiTransformDescription.properties.find((property) => property.name === 'instructions');
    const code = aiTransformDescription.properties.find((property) => property.name === 'generatedCode');
    expect(instructions?.typeOptions?.action).toMatchObject({
      type: 'generateAiTransform', target: 'generatedCode', generatedForTarget: 'generatedForPrompt',
    });
    expect(code?.typeOptions?.readOnly).toBe(true);
  });

  it('runs matching generated code in the existing subprocess sandbox', async () => {
    const instructions = 'Double n and add a processed flag';
    const result = await new AiTransform().execute!.call(context(
      [{ json: { n: 2 } }, { json: { n: 4 } }],
      {
        instructions,
        generatedForPrompt: instructions,
        generatedCode: 'return items.map(item => ({ json: { n: item.json.n * 2, processed: true } }));',
      },
    ));
    expect(result[0]!.map((item) => item.json)).toEqual([
      { n: 4, processed: true },
      { n: 8, processed: true },
    ]);
  });

  it('refuses missing, stale or unsafe generated code', async () => {
    await expect(new AiTransform().execute!.call(context([{ json: {} }], {
      instructions: 'new instructions', generatedForPrompt: 'old instructions', generatedCode: 'return items;',
    }))).rejects.toThrow(/generate code again/);
    await expect(new AiTransform().execute!.call(context([{ json: {} }], {
      instructions: 'same', generatedForPrompt: 'same', generatedCode: '',
    }))).rejects.toThrow(/invalid/);
    expect(() => validateAiTransformCode('return [process.env];')).toThrow(/safety policy/);
    expect(() => validateAiTransformCode('return globalThis.constructor;')).toThrow(/safety policy/);
  });
});
