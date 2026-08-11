import { describe, expect, it, vi } from 'vitest';
import type { IAiLanguageModel, IExecuteContext, INodeExecutionData, JsonObject } from '@nomops/workflow';
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
  it('旧工作流若保存过显式 model 参数仍可迁移执行，但新描述不再暴露该参数', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const output = await new AiAgent().execute!.call(
      stubContext(
        [{ json: {} }],
        { model: 'claude-sonnet-5', prompt: 'legacy prompt', maxTokens: 200 },
        {
          getCredentials: async () => ({ apiKey: 'legacy-key' }),
          helpers: {
            httpRequest: async (options) => {
              calls.push(options as unknown as Record<string, unknown>);
              return { content: [{ type: 'text', text: 'legacy ok' }], model: 'claude-sonnet-5' };
            },
          },
        },
      ),
    );
    expect(calls).toHaveLength(1);
    expect(output[0]?.[0]?.json).toMatchObject({ text: 'legacy ok', model: 'claude-sonnet-5' });
  });

  it('未连接 Chat Model → 引导使用节点底部的 Chat Model +', async () => {
    await expect(
      new AiAgent().execute!.call(
        stubContext([{ json: {} }], { text: 'hi' }),
      ),
    ).rejects.toThrow(/requires a Chat Model.*Chat Model \+ button/);
  });

  it('prompt 为空 → 带 item 定位的错误', async () => {
    const model: IAiLanguageModel = { chat: async () => ({ content: 'unused' }) };
    await expect(
      new AiAgent().execute!.call(
        stubContext(
          [{ json: {} }],
          { text: '' },
          { getInputConnectionData: async (type) => type === 'ai_languageModel' ? [model] : [] },
        ),
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
