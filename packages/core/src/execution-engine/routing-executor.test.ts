import { describe, expect, it } from 'vitest';
import type {
  IHttpRequestOptions,
  ILoadableNodeType,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from '@nomops/workflow';
import { Workflow } from '@nomops/workflow';
import { NodeLoader } from '../nodes-loader/node-loader.js';
import { WorkflowExecute } from './workflow-execute.js';

/**
 * 声明式 routing 节点：无 execute，description 声明 operation→请求。
 * 桩掉 httpRequest 断言请求形状；凭证注入经 getCredentials 回调。
 */

const chatDescription: INodeTypeDescription = {
  displayName: 'Chat Service',
  name: 'chatService',
  group: ['transform'],
  version: 1,
  description: 'declarative test node',
  defaults: { name: 'Chat Service' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [{ name: 'chatApi', required: true }],
  requestDefaults: { baseUrl: 'https://chat.example.com/api', headers: { accept: 'application/json' } },
  credentialInjection: { credentialName: 'chatApi', in: 'header', key: 'authorization', template: 'Bearer {{token}}' },
  properties: [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'send',
      options: [
        {
          name: 'Send Message',
          value: 'send',
          routing: {
            method: 'POST',
            url: '/messages',
            body: { channel: '={{ $parameter.channel }}', text: '={{ $json.text }}' },
          },
        },
        {
          name: 'List Channels',
          value: 'list',
          routing: { method: 'GET', url: '/channels', qs: { limit: '={{ $parameter.limit }}' } },
        },
      ],
    },
    { displayName: 'Channel', name: 'channel', type: 'string', default: '' },
    { displayName: 'Limit', name: 'limit', type: 'number', default: 50 },
  ],
};

const loadable: ILoadableNodeType = {
  type: 't.chat',
  description: chatDescription,
  load: async () =>
    class implements INodeType {
      description = chatDescription; // 注意：没有 execute —— 走声明式执行器
    },
};

const node = (name: string, parameters: Record<string, unknown>) => ({
  id: name, name, type: 't.chat', typeVersion: 1, position: [0, 0] as [number, number], parameters,
});

function runWith(parameters: Record<string, unknown>, items: INodeExecutionData[], calls: IHttpRequestOptions[]) {
  const wf = new Workflow({ name: 'r', nodes: [node('Svc', parameters)], connections: {} });
  const engine = new WorkflowExecute(new NodeLoader([loadable]), {
    additionalData: {
      getCredentials: async () => ({ token: 'tok-123' }),
      httpRequest: async (o) => {
        calls.push(o);
        return { ok: true, echo: (o.body as { text?: string } | undefined)?.text ?? null };
      },
    },
  });
  return engine.run(wf, undefined, undefined, items);
}

describe('声明式 routing 执行器', () => {
  it('POST：baseUrl 拼接、$parameter/$json 求值、凭证注入 header、逐 item 请求', async () => {
    const calls: IHttpRequestOptions[] = [];
    const run = await runWith(
      { operation: 'send', channel: 'general' },
      [{ json: { text: 'hello' } }, { json: { text: 'world' } }],
      calls,
    );

    expect(run.status).toBe('success');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://chat.example.com/api/messages');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers).toEqual({ accept: 'application/json', authorization: 'Bearer tok-123' });
    expect(calls[0]!.body).toEqual({ channel: 'general', text: 'hello' });
    expect(calls[1]!.body).toEqual({ channel: 'general', text: 'world' });

    const out = run.data.resultData.runData['Svc']![0]!.data!['main']![0]!;
    expect(out.map((it) => it.json['echo'])).toEqual(['hello', 'world']);
  });

  it('GET：qs 求值 + 空输入也发一次请求', async () => {
    const calls: IHttpRequestOptions[] = [];
    const run = await runWith({ operation: 'list', limit: 7 }, [{ json: {} }], calls);
    expect(run.status).toBe('success');
    expect(calls[0]!.url).toBe('https://chat.example.com/api/channels');
    expect(calls[0]!.qs).toEqual({ limit: 7 });
    expect(calls[0]!.body).toBeUndefined();
  });

  it('未知 operation → 明确报错', async () => {
    const calls: IHttpRequestOptions[] = [];
    const run = await runWith({ operation: 'nope' }, [{ json: {} }], calls);
    expect(run.status).toBe('error');
    expect(run.data.resultData.error?.message).toContain('routing');
  });
});

/* ── path 注入（Telegram 形态:token 在 URL）+ 错误打码（铁律 3） ── */

const botDescription: INodeTypeDescription = {
  displayName: 'Bot Service',
  name: 'botService',
  group: ['output'],
  version: 1,
  description: 'path-injection test node',
  defaults: { name: 'Bot Service' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [{ name: 'botApi', required: true }],
  requestDefaults: { baseUrl: 'https://bot.example.com' },
  credentialInjection: { credentialName: 'botApi', in: 'path', key: 'botToken', template: '{{accessToken}}' },
  properties: [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'send',
      options: [{ name: 'Send', value: 'send', routing: { method: 'POST', url: '/bot{botToken}/send' } }],
    },
  ],
};

const botLoadable: ILoadableNodeType = {
  type: 't.bot',
  description: botDescription,
  load: async () =>
    class implements INodeType {
      description = botDescription;
    },
};

describe('凭证 path 注入', () => {
  const SECRET = '99887:AAsecret-token';
  const botWf = () =>
    new Workflow({
      name: 'b',
      nodes: [{ id: 'Bot', name: 'Bot', type: 't.bot', typeVersion: 1, position: [0, 0], parameters: { operation: 'send' } }],
      connections: {},
    });

  it('URL 占位符 {key} 被凭证模板值替换', async () => {
    const calls: IHttpRequestOptions[] = [];
    const engine = new WorkflowExecute(new NodeLoader([botLoadable]), {
      additionalData: {
        getCredentials: async () => ({ accessToken: SECRET }),
        httpRequest: async (o) => {
          calls.push(o);
          return { ok: true };
        },
      },
    });
    const run = await engine.run(botWf(), undefined, undefined, [{ json: {} }]);
    expect(run.status).toBe('success');
    expect(calls[0]!.url).toBe(`https://bot.example.com/bot${SECRET}/send`);
  });

  it('HTTP 失败:错误消息与 url 里的凭证值被打码,明文不进执行数据', async () => {
    const engine = new WorkflowExecute(new NodeLoader([botLoadable]), {
      additionalData: {
        getCredentials: async () => ({ accessToken: SECRET }),
        httpRequest: async (o) => {
          throw new Error(`HTTP 401 Unauthorized at ${o.url}`);
        },
      },
    });
    const run = await engine.run(botWf(), undefined, undefined, [{ json: {} }]);
    expect(run.status).toBe('error');
    // 整份可序列化执行状态里都不许出现明文 token
    expect(JSON.stringify(run.data)).not.toContain(SECRET);
    expect(run.data.resultData.error?.message).toContain('***');
  });
});
