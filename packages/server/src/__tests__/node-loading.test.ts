import { describe, expect, it } from 'vitest';
import { NodeLoader } from '@nomops/core';
import { builtinNodeManifest } from '@nomops/nodes';
import type {
  IAiTool,
  IBinaryData,
  IExecuteContext,
  IHttpRequestOptions,
  INodeExecutionData,
  ISupplyDataContext,
} from '@nomops/workflow';

/**
 * Phase 1 验收（跨包，server 是唯一同时依赖 core + nodes 的组合根）：
 * 加载器 + 内置节点清单接上后，能拿到可执行的 Set 类并跑出正确结果。
 */
describe('内置节点通过加载器可用', () => {
  it('getAllDescriptions 含全部内置节点', async () => {
    const loader = new NodeLoader(builtinNodeManifest);
    await loader.loadAll();

    const names = loader.getAllDescriptions().map((d) => d.name).sort();
    expect(names).toEqual([
      'aggregate',
      'aiAgent',
      'aiTransform',
      'chatModel',
      'chatTrigger',
      'code',
      'compareDatasets',
      'compression',
      'convertToFile',
      'crypto',
      'dataTable',
      'dataTableTool',
      'dateTime',
      'editImage',
      'emailTrigger',
      'errorTrigger',
      'evaluation',
      'evaluationTrigger',
      'executeWorkflow',
      'executeWorkflowTrigger',
      'executionData',
      'extractFromFile',
      'filter',
      'form',
      'formTrigger',
      'ftp',
      'git',
      'github',
      'githubTool',
      'googleSheets',
      'googleSheetsTool',
      'hackerNews',
      'hackerNewsTool',
      'html',
      'httpRequest',
      'httpRequestTool',
      'httpTool',
      'if',
      'limit',
      'loop',
      'manualTrigger',
      'markdown',
      'merge',
      'noOp',
      'notion',
      'notionTool',
      'pollingTrigger',
      'readWriteFile',
      'removeDuplicates',
      'renameKeys',
      'respondToWebhook',
      'rssFeedRead',
      'rssFeedReadTrigger',
      'schedule',
      'sendEmail',
      'sendGrid',
      'sendGridTool',
      'set',
      'setMetadata',
      'slack',
      'slackTool',
      'sort',
      'splitOut',
      'sseTrigger',
      'ssh',
      'stickyNote',
      'stopAndError',
      'stripe',
      'stripeTool',
      'summarize',
      'switch',
      'telegram',
      'telegramTool',
      'totp',
      'wait',
      'webhook',
      'windowMemory',
      'xml',
    ]);
  });

  it('getByNameAndVersion("nomops.set", 1) 返回可执行的 Set 类', async () => {
    const loader = new NodeLoader(builtinNodeManifest);
    const setNode = await loader.getByNameAndVersion('nomops.set', 1);
    expect(typeof setNode.execute).toBe('function');

    const items: INodeExecutionData[] = [{ json: { a: 1 } }];
    const context = {
      getInputData: () => items,
      getNodeParameter: () => ({ b: 2 }),
      getCredentials: async () => ({}),
      getWorkflowStaticData: () => ({}),
      helpers: { httpRequest: async () => ({}) },
    } as unknown as IExecuteContext;

    const output = await setNode.execute!.call(context);
    expect(output).toEqual([[{ json: { a: 1, b: 2 }, pairedItem: { item: 0 } }]]);
  });

  it('8 个集成 + HTTP Request 派生工具可见，SlackTool 可真实走 routing/凭证/分页调用', async () => {
    const loader = new NodeLoader(builtinNodeManifest);
    const expected = [
      'nomops.slackTool', 'nomops.githubTool', 'nomops.sendGridTool', 'nomops.stripeTool',
      'nomops.notionTool', 'nomops.hackerNewsTool', 'nomops.telegramTool', 'nomops.googleSheetsTool',
      'nomops.httpRequestTool',
    ];
    expect(loader.getAllTypes()).toEqual(expect.arrayContaining(expected));

    const node = await loader.getByNameAndVersion('nomops.slackTool', 1);
    const parameters: Record<string, unknown> = {
      toolName: 'list_slack_channels',
      toolDescription: 'List every Slack channel',
      operation: 'listChannels',
      limit: 1,
    };
    const calls: IHttpRequestOptions[] = [];
    const supply: ISupplyDataContext = {
      getNodeParameter(name: string, fallback?: unknown) { return parameters[name] ?? fallback; },
      getRawNodeParameter(name: string) { return parameters[name]; },
      getCredentials: async () => ({ accessToken: 'slack-secret' }),
      getWorkflowStaticData: () => ({}),
      getInputConnectionData: async () => [],
      helpers: {
        httpRequest: async (options) => {
          calls.push(options);
          return options.qs?.['cursor'] === 'c2'
            ? { channels: [{ id: 'C2', name: 'ops' }], response_metadata: { next_cursor: '' } }
            : { channels: [{ id: 'C1', name: 'general' }], response_metadata: { next_cursor: 'c2' } };
        },
        binaryToBuffer: async (binary: IBinaryData) => Buffer.from(binary.data ?? '', 'base64'),
        bufferToBinary: async (buffer, meta) => ({ data: Buffer.from(buffer).toString('base64'), ...meta }),
      },
    };
    const tool = await node.supplyData!.call(supply) as IAiTool;
    expect(tool.spec.name).toBe('list_slack_channels');
    await expect(tool.invoke({})).resolves.toBe('[{"id":"C1","name":"general","isPrivate":false},{"id":"C2","name":"ops","isPrivate":false}]');
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.headers?.['authorization'] === 'Bearer slack-secret')).toBe(true);
  });
});
