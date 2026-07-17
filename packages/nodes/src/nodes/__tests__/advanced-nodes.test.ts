import { describe, expect, it, vi } from 'vitest';
import type { IExecuteContext, INodeExecutionData, JsonObject } from '@nomops/workflow';
import { AiAgent } from '../AiAgent/AiAgent.node.js';
import { ExecuteWorkflow } from '../ExecuteWorkflow/ExecuteWorkflow.node.js';

function stubContext(
  inputs: INodeExecutionData[],
  params: Record<string, unknown | ((i: number) => unknown)>,
  overrides: Partial<IExecuteContext> & { helpers?: Partial<IExecuteContext['helpers']> } = {},
): IExecuteContext {
  return {
    getInputData: () => inputs,
    getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
      if (!(name in params)) return fallback;
      const v = params[name];
      return typeof v === 'function' ? (v as (i: number) => unknown)(itemIndex) : v;
    },
    getCredentials: overrides.getCredentials ?? (async () => ({})),
    getWorkflowStaticData: () => ({}),
    isResumed: () => false,
    // 缺省不挂能力子节点（AiAgent 走旧直连路径）；组合测试可覆盖
    getInputConnectionData: overrides.getInputConnectionData ?? (async () => []),
    helpers: { httpRequest: async () => ({}), ...overrides.helpers },
  } as IExecuteContext;
}

describe('AI Agent 节点', () => {
  it('逐 item 调 Claude API：请求形状正确、输出映射 text/usage（凭证注入）', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const output = await new AiAgent().execute!.call(
      stubContext(
        [{ json: { topic: '猫' } }, { json: { topic: '狗' } }],
        {
          model: 'claude-sonnet-5',
          prompt: (i: number) => `写一句关于${i === 0 ? '猫' : '狗'}的话`,
          system: '你是诗人',
          maxTokens: 200,
        },
        {
          getCredentials: async () => ({ apiKey: 'sk-test-123' }),
          helpers: {
            httpRequest: async (opts) => {
              calls.push(opts as unknown as Record<string, unknown>);
              return {
                content: [{ type: 'text', text: '好句子' }],
                model: 'claude-sonnet-5',
                usage: { input_tokens: 10, output_tokens: 5 },
                stop_reason: 'end_turn',
              };
            },
          },
        },
      ),
    );

    expect(calls).toHaveLength(2);
    const first = calls[0]! as {
      url: string;
      headers: Record<string, string>;
      body: { model: string; system?: string; max_tokens: number; messages: Array<{ content: string }> };
    };
    expect(first.url).toBe('https://api.anthropic.com/v1/messages');
    expect(first.headers['x-api-key']).toBe('sk-test-123');
    expect(first.headers['anthropic-version']).toBeTruthy();
    expect(first.body.model).toBe('claude-sonnet-5');
    expect(first.body.system).toBe('你是诗人');
    expect(first.body.max_tokens).toBe(200);
    expect(first.body.messages[0]!.content).toBe('写一句关于猫的话');

    expect(output[0]![0]!.json).toMatchObject({ text: '好句子', model: 'claude-sonnet-5' });
    expect(output[0]![1]!.pairedItem).toEqual({ item: 1 });
  });

  it('凭证缺 apiKey → 可读错误', async () => {
    await expect(
      new AiAgent().execute!.call(
        stubContext([{ json: {} }], { prompt: 'hi' }, { getCredentials: async () => ({}) }),
      ),
    ).rejects.toThrow(/missing the apiKey/);
  });

  it('prompt 为空 → 带 item 定位的错误', async () => {
    await expect(
      new AiAgent().execute!.call(
        stubContext([{ json: {} }], { prompt: '' }, { getCredentials: async () => ({ apiKey: 'k' }) }),
      ),
    ).rejects.toThrow(/prompt is empty/);
  });
});

describe('Execute Workflow 节点', () => {
  it('items 交给子流回调，输出重建 pairedItem', async () => {
    const sub = vi.fn(async (_id: string, items: INodeExecutionData[]) =>
      items.map((it) => ({ json: { ...it.json, sub: true } })),
    );
    const output = await new ExecuteWorkflow().execute!.call(
      stubContext([{ json: { a: 1 } }], { workflowId: 'wf-child' }, { helpers: { executeSubWorkflow: sub } }),
    );
    expect(sub).toHaveBeenCalledWith('wf-child', [{ json: { a: 1 } }]);
    expect(output[0]).toEqual([{ json: { a: 1, sub: true }, pairedItem: { item: 0 } }]);
  });

  it('无服务层注入（纯引擎环境）→ 明确报错', async () => {
    await expect(
      new ExecuteWorkflow().execute!.call(stubContext([{ json: {} }], { workflowId: 'x' })),
    ).rejects.toThrow(/does not support sub-workflows/);
  });

  it('缺 workflowId → 报错', async () => {
    await expect(
      new ExecuteWorkflow().execute!.call(
        stubContext([{ json: {} }], {}, { helpers: { executeSubWorkflow: async () => [] } }),
      ),
    ).rejects.toThrow(/missing the workflowId/);
  });
});

// JsonObject 仅用于类型完整性引用
void ({} as JsonObject);
