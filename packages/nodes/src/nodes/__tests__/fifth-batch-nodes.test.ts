import { describe, expect, it, vi } from 'vitest';
import type { IExecuteContext, IInlineWorkflowDefinition, INodeExecutionData, JsonObject } from '@nomops/workflow';
import { ExecuteWorkflow } from '../ExecuteWorkflow/ExecuteWorkflow.node.js';
import { Merge } from '../Merge/Merge.node.js';
import { formDefinitionFrom, handleFormRequest, renderForm } from '../Form/form-utils.js';

function context(
  inputs: INodeExecutionData[][],
  params: Record<string, unknown>,
  helpers: Partial<IExecuteContext['helpers']> = {},
): IExecuteContext {
  return {
    getInputData: (index = 0) => inputs[index] ?? [],
    getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) => name in params ? params[name] : fallback,
    getCredentials: async () => ({}),
    getWorkflowStaticData: () => ({}),
    getContext: () => ({}),
    isResumed: () => false,
    getInputConnectionData: async () => [],
    helpers: helpers as IExecuteContext['helpers'],
  } as IExecuteContext;
}

describe('第五批节点运行时', () => {
  it('Merge SQL Query 在 input1/input2 上执行 JOIN 并保留溯源', async () => {
    const result = await new Merge().execute.call(context([
      [{ json: { id: 1, customer: 'A' } }, { json: { id: 2, customer: 'B' } }],
      [{ json: { customerId: 2, amount: 99 } }],
    ], {
      mode: 'combineBySql', numberInputs: 2,
      query: 'SELECT input1.id, input1.customer, input2.amount FROM input1 LEFT JOIN input2 ON input1.id = input2.customerId ORDER BY input1.id',
    }));
    expect(result[0]?.map((item) => item.json)).toEqual([
      { id: 1, customer: 'A' },
      { id: 2, customer: 'B', amount: 99 },
    ]);
    expect(result[0]?.[1]?.pairedItem).toEqual(expect.arrayContaining([
      expect.objectContaining({ item: 1 }), expect.objectContaining({ item: 0 }),
    ]));
  });

  it('Execute Workflow Define Below 解析 JSON 并传给服务边界', async () => {
    const inline: IInlineWorkflowDefinition = {
      name: 'Inline child',
      nodes: [{ id: 'in', name: 'In', type: 'nomops.executeWorkflowTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
      connections: {},
    };
    const executeSubWorkflow = vi.fn(async (_workflow: string | IInlineWorkflowDefinition, items: INodeExecutionData[]) => items);
    const items = [{ json: { id: 1 } }];
    const result = await new ExecuteWorkflow().execute.call(context([items], {
      source: 'parameter', workflowJson: JSON.stringify(inline), mode: 'once',
    }, { executeSubWorkflow }));
    expect(executeSubWorkflow).toHaveBeenCalledWith(inline, items);
    expect(result[0]).toEqual([{ json: { id: 1 }, pairedItem: { item: 0 } }]);
  });

  it('Form 文件字段渲染 multipart 并输出 JSON 元数据与 binary', () => {
    const definition = formDefinitionFrom({ values: [{
      fieldLabel: 'Documents', fieldName: 'documents', fieldType: 'file', requiredField: true,
      multipleFiles: true, acceptFileTypes: '.pdf,image/*',
    }] }, { title: 'Upload', description: '', submitLabel: 'Send' });
    const html = renderForm(definition);
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('accept=".pdf,image/*"');
    expect(html).toContain(' multiple');

    const result = handleFormRequest({
      method: 'POST', path: 'upload', headers: {}, query: {}, body: {},
      files: {
        documents: [
          { data: 'QQ==', mimeType: 'application/pdf', fileName: 'a.pdf', fileSize: 1 },
          { data: 'Qg==', mimeType: 'image/png', fileName: 'b.png', fileSize: 1 },
        ],
      },
    }, definition);
    expect(result.workflowData?.[0]?.json['documents']).toEqual([
      { filename: 'a.pdf', mimetype: 'application/pdf', size: 1 },
      { filename: 'b.png', mimetype: 'image/png', size: 1 },
    ]);
    expect(Object.keys(result.workflowData?.[0]?.binary ?? {})).toEqual(['documents_0', 'documents_1']);
  });
});
