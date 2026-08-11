import { describe, expect, it, vi } from 'vitest';
import type { IExecuteContext, INodeExecutionData, JsonObject } from '@nomops/workflow';
import { ExecutionPause } from '@nomops/workflow';
import { Merge } from '../Merge/Merge.node.js';
import { mergeDescription } from '../Merge/Merge.description.js';
import { Wait } from '../Wait/Wait.node.js';
import { waitDescription } from '../Wait/Wait.description.js';
import { ExecuteWorkflow } from '../ExecuteWorkflow/ExecuteWorkflow.node.js';
import { executeWorkflowDescription } from '../ExecuteWorkflow/ExecuteWorkflow.description.js';
import { RespondToWebhook } from '../RespondToWebhook/RespondToWebhook.node.js';
import { respondToWebhookDescription } from '../RespondToWebhook/RespondToWebhook.description.js';
import { Form } from '../Form/Form.node.js';
import { formDescription } from '../Form/Form.description.js';
import { formTriggerDescription } from '../FormTrigger/FormTrigger.description.js';
import { formDefinitionFrom } from '../Form/form-utils.js';

function context(
  inputs: INodeExecutionData[][],
  params: Record<string, unknown> = {},
  overrides: Partial<IExecuteContext> & { helpers?: Partial<IExecuteContext['helpers']> } = {},
): IExecuteContext {
  const nodeContext: JsonObject = {};
  return {
    getInputData: (index = 0) => inputs[index] ?? [],
    getNodeParameter: (name: string, _index: number, fallback?: unknown) => name in params ? params[name] : fallback,
    getCredentials: overrides.getCredentials ?? (async () => ({})),
    getWorkflowStaticData: () => ({}),
    getContext: () => nodeContext,
    isResumed: overrides.isResumed ?? (() => false),
    getInputConnectionData: async () => [],
    helpers: { ...overrides.helpers } as IExecuteContext['helpers'],
  } as IExecuteContext;
}

describe('第四批 n8n NDV 参数基线', () => {
  it('六组节点公开 n8n 的主参数和动态模式', () => {
    const values = (description: typeof mergeDescription, name: string) =>
      description.properties.find((property) => property.name === name)?.options?.map((option) => option.value);
    expect(values(mergeDescription, 'mode')).toEqual(['append', 'combine', 'combineBySql', 'chooseBranch']);
    expect(values(waitDescription as typeof mergeDescription, 'resume')).toEqual(['timeInterval', 'specificTime', 'webhook', 'form']);
    expect(values(respondToWebhookDescription as typeof mergeDescription, 'respondWith')).toEqual([
      'allIncomingItems', 'binary', 'firstIncomingItem', 'json', 'jwt', 'noData', 'redirect', 'text',
    ]);
    expect(executeWorkflowDescription.properties.map((property) => property.name)).toEqual(['source', 'workflowId', 'workflowJson', 'mode', 'options']);
    expect(formTriggerDescription.properties.some((property) => property.name === 'formFields')).toBe(true);
    expect(values(formDescription as typeof mergeDescription, 'operation')).toEqual(['nextPage', 'completion']);
  });
});

describe('Merge n8n modes', () => {
  const inputs = [
    [{ json: { id: 1, left: 'a' } }, { json: { id: 2, left: 'b' } }],
    [{ json: { id: 2, right: 'B' } }, { json: { id: 3, right: 'C' } }],
  ];

  it('Matching Fields 支持 matches/everything 和来源合并', async () => {
    const matches = await new Merge().execute.call(context(inputs, {
      mode: 'combine', combineBy: 'matchingFields', fieldsToMatchString: 'id', joinMode: 'keepMatches', outputDataFrom: 'both',
    }));
    expect(matches[0]?.map((item) => item.json)).toEqual([{ id: 2, left: 'b', right: 'B' }]);

    const everything = await new Merge().execute.call(context(inputs, {
      mode: 'combine', combineBy: 'matchingFields', fieldsToMatchString: 'id', joinMode: 'keepEverything',
    }));
    expect(everything[0]?.map((item) => item.json)).toEqual([
      { id: 1, left: 'a' }, { id: 2, left: 'b', right: 'B' }, { id: 3, right: 'C' },
    ]);
  });

  it('All Possible Combinations 和 Choose Branch 按 n8n 参数执行', async () => {
    const all = await new Merge().execute.call(context(inputs, { mode: 'combine', combineBy: 'all' }));
    expect(all[0]).toHaveLength(4);
    const branch = await new Merge().execute.call(context(inputs, { mode: 'chooseBranch', output: 'specifiedInput', useDataOfInput: 2 }));
    expect(branch[0]).toEqual(inputs[1]);
  });
});

describe('Wait / Execute Workflow / Respond / Form', () => {
  it('Wait 支持指定时间和有限期 webhook 等待', async () => {
    const node = new Wait();
    const target = new Date(Date.now() + 60_000).toISOString();
    await expect(node.execute.call(context([[{ json: {} }]], { resume: 'specificTime', dateTime: target })))
      .rejects.toMatchObject<ExecutionPause>({ name: 'ExecutionPause', waitTill: expect.any(Number) });
    await expect(node.execute.call(context([[{ json: {} }]], {
      resume: 'webhook', limitWaitTime: true, maxWaitTime: 2, maxWaitTimeUnit: 'minutes',
    }))).rejects.toMatchObject<ExecutionPause>({ name: 'ExecutionPause', waitTill: expect.any(Number) });
  });

  it('Execute Workflow 解析 resource locator 并可逐 item 调用', async () => {
    const executeSubWorkflow = vi.fn(async (_id: string, items: INodeExecutionData[]) => items);
    const items = [{ json: { n: 1 } }, { json: { n: 2 } }];
    const out = await new ExecuteWorkflow().execute.call(context([items], {
      source: 'database', workflowId: { mode: 'url', value: 'http://localhost:5678/workflow/child-1' }, mode: 'each',
    }, { helpers: { executeSubWorkflow } }));
    expect(executeSubWorkflow).toHaveBeenCalledTimes(2);
    expect(executeSubWorkflow).toHaveBeenNthCalledWith(1, 'child-1', [items[0]]);
    expect(out[0]).toHaveLength(2);
  });

  it('Respond to Webhook 支持 all items、redirect 和自定义 headers', async () => {
    const setWebhookResponse = vi.fn();
    const items = [{ json: { a: 1 } }, { json: { a: 2 } }];
    await new RespondToWebhook().execute.call(context([items], {
      respondWith: 'allIncomingItems', options: { responseCode: 202, responseHeaders: { entries: [{ name: 'X-Test', value: 'yes' }] } },
    }, { helpers: { setWebhookResponse } }));
    expect(setWebhookResponse).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 202, headers: { 'X-Test': 'yes' }, body: [{ a: 1 }, { a: 2 }] }));

    await new RespondToWebhook().execute.call(context([items], { respondWith: 'redirect', redirectURL: 'https://example.test' }, { helpers: { setWebhookResponse } }));
    expect(setWebhookResponse).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 302, headers: { Location: 'https://example.test' } }));
  });

  it('Form 接受 n8n Form Elements，Form Ending 设置完成页响应', async () => {
    const definition = formDefinitionFrom({ values: [{
      fieldLabel: 'Plan', fieldName: 'plan', fieldType: 'dropdown', requiredField: true,
      fieldOptions: { values: [{ option: 'Free' }, { option: 'Pro' }] },
    }] }, { title: 'Choose', description: '', submitLabel: 'Next' });
    expect(definition.fields[0]).toMatchObject({ name: 'plan', type: 'select', options: ['Free', 'Pro'], required: true });

    const setWebhookResponse = vi.fn();
    const items = [{ json: { ok: true } }];
    const output = await new Form().execute.call(context([items], {
      operation: 'completion', respondWith: 'text', completionTitle: '<Done>', completionMessage: 'Saved',
    }, { helpers: { setWebhookResponse } }));
    expect(output[0]).toEqual(items);
    expect(setWebhookResponse).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('&lt;Done&gt;') }));
  });
});
