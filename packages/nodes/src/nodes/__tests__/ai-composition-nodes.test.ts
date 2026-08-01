import { describe, expect, it } from 'vitest';
import type {
  IAiLanguageModel,
  IAiMemory,
  IAiMessage,
  IAiTool,
  IExecuteContext,
  IHttpRequestOptions,
  INodeExecutionData,
  ISupplyDataContext,
  JsonObject,
} from '@nomops/workflow';
import { AiAgent } from '../AiAgent/AiAgent.node.js';
import { ChatModel } from '../ChatModel/ChatModel.node.js';
import { HttpTool } from '../HttpTool/HttpTool.node.js';
import { WindowMemory } from '../WindowMemory/WindowMemory.node.js';

/* ── 通用 stub ── */

function execContext(args: {
  inputs: INodeExecutionData[];
  params: Record<string, unknown>;
  connections: Record<string, unknown[]>;
}): IExecuteContext {
  return {
    getInputData: () => args.inputs,
    getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
      name in args.params ? args.params[name] : fallback,
    getCredentials: async () => ({}),
    getWorkflowStaticData: () => ({}),
    isResumed: () => false,
    getInputConnectionData: async (type: string) => args.connections[type] ?? [],
    helpers: {
      httpRequest: async () => ({}),
      binaryToBuffer: async () => new Uint8Array(),
      bufferToBinary: async () => ({ mimeType: 'application/octet-stream' }),
    },
  } as unknown as IExecuteContext;
}

function supplyContext(args: {
  params: Record<string, unknown>;
  credentials?: JsonObject;
  httpRequest?: (o: IHttpRequestOptions) => Promise<unknown>;
  staticData?: JsonObject;
}): ISupplyDataContext {
  const staticData = args.staticData ?? {};
  return {
    getNodeParameter: (name: string, fallback?: unknown) =>
      name in args.params ? args.params[name] : fallback,
    getRawNodeParameter: (name: string) => args.params[name],
    getCredentials: async () => args.credentials ?? {},
    getWorkflowStaticData: (type: string) => {
      const key = type === 'global' ? 'global' : 'node:test';
      staticData[key] ??= {};
      return staticData[key] as JsonObject;
    },
    getInputConnectionData: async () => [],
    helpers: { httpRequest: args.httpRequest ?? (async () => ({})) },
  } as unknown as ISupplyDataContext;
}

describe('AI Agent — 组合模式', () => {
  it('模型请求工具 → 执行 → 结果回喂 → 收敛；记忆保存会话', async () => {
    const chatLog: IAiMessage[][] = [];
    const model: IAiLanguageModel = {
      chat: async (messages) => {
        chatLog.push(messages.map((m) => ({ ...m })));
        // 第一次：请求调 lookup 工具；第二次：给最终答案
        if (!messages.some((m) => m.role === 'tool')) {
          return { content: '', toolCalls: [{ id: 't1', name: 'lookup', arguments: { input: '42' } }] };
        }
        const toolResult = messages.find((m) => m.role === 'tool')!.content;
        return { content: `answer based on ${toolResult}` };
      },
    };
    const tool: IAiTool = {
      spec: { name: 'lookup', description: 'look things up' },
      invoke: async (a) => `result-for-${(a as { input: string }).input}`,
    };
    const saved: Record<string, IAiMessage[]> = {};
    const memory: IAiMemory = {
      load: async (sid) => saved[sid] ?? [],
      save: async (sid, msgs) => {
        saved[sid] = msgs;
      },
    };

    const out = await new AiAgent().execute!.call(
      execContext({
        inputs: [{ json: {} }],
        params: { prompt: 'find 42', system: 'be brief', sessionId: 's1', maxIterations: 5 },
        connections: { ai_languageModel: [model], ai_tool: [tool], ai_memory: [memory] },
      }),
    );

    expect(out[0]![0]!.json).toMatchObject({ output: 'answer based on result-for-42', toolRounds: 1 });
    expect(out[0]![0]!.json['_nmUsage']).toEqual({ inputTokens: 0, outputTokens: 0 }); // fake 模型无 usage（#44 M2）
    // 第二次模型调用能看到 assistant 的 toolCalls 与 tool 结果
    expect(chatLog[1]!.some((m) => m.role === 'assistant' && m.toolCalls?.length === 1)).toBe(true);
    expect(chatLog[1]!.some((m) => m.role === 'tool' && m.toolCallId === 't1')).toBe(true);
    // 记忆里存了完整回合（system 由 memory 实现自行过滤，Agent 原样传）
    expect(saved['s1']!.some((m) => m.role === 'user' && m.content === 'find 42')).toBe(true);
  });

  it('token 用量跨轮累加 → _nmUsage（成本核算，#44 M2）', async () => {
    let round = 0;
    const model: IAiLanguageModel = {
      chat: async () => {
        round++;
        // 第一轮请求工具(usage 10/5)，第二轮给答案(usage 8/3)
        if (round === 1) return { content: '', toolCalls: [{ id: 't1', name: 'noop', arguments: {} }], usage: { inputTokens: 10, outputTokens: 5 } };
        return { content: 'done', usage: { inputTokens: 8, outputTokens: 3 } };
      },
    };
    const tool: IAiTool = { spec: { name: 'noop', description: 'x' }, invoke: async () => 'ok' };
    const out = await new AiAgent().execute!.call(
      execContext({ inputs: [{ json: {} }], params: { prompt: 'go', maxIterations: 3 }, connections: { ai_languageModel: [model], ai_tool: [tool] } }),
    );
    expect(out[0]![0]!.json['_nmUsage']).toEqual({ inputTokens: 18, outputTokens: 8 }); // 10+8, 5+3
  });

  it('超过 maxIterations 停止循环；未知工具回错误文本', async () => {
    let calls = 0;
    const stubborn: IAiLanguageModel = {
      chat: async () => {
        calls++;
        return { content: 'loop', toolCalls: [{ id: `t${calls}`, name: 'ghost', arguments: {} }] };
      },
    };
    const out = await new AiAgent().execute!.call(
      execContext({
        inputs: [{ json: {} }],
        params: { prompt: 'go', maxIterations: 2 },
        connections: { ai_languageModel: [stubborn], ai_tool: [] },
      }),
    );
    expect(out[0]![0]!.json['toolRounds']).toBe(2);
    expect(calls).toBe(3); // 初始 1 + 两轮循环
  });

  it('多模态（#32）：item 上的图片 binary → user 消息 images；非图片 binary 忽略', async () => {
    const chatLog: IAiMessage[][] = [];
    const model: IAiLanguageModel = {
      chat: async (messages) => {
        chatLog.push(messages.map((m) => ({ ...m })));
        return { content: 'a cat' };
      },
    };
    const b64 = Buffer.from('PNGBYTES').toString('base64');
    const ctx = {
      getInputData: () => [
        {
          json: {},
          binary: {
            photo: { mimeType: 'image/png', data: b64 },
            doc: { mimeType: 'application/pdf', data: 'ignored' },
          },
        },
      ],
      getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
        ({ prompt: 'describe', system: '', maxIterations: 5, sessionId: 'default' } as Record<string, unknown>)[name] ?? fallback,
      getCredentials: async () => ({}),
      getWorkflowStaticData: () => ({}),
      isResumed: () => false,
      getInputConnectionData: async (type: string) => (type === 'ai_languageModel' ? [model] : []),
      helpers: {
        httpRequest: async () => ({}),
        binaryToBuffer: async (b: { data?: string }) => new Uint8Array(Buffer.from(b.data ?? '', 'base64')),
        bufferToBinary: async () => ({ mimeType: 'application/octet-stream' }),
      },
    } as unknown as IExecuteContext;

    await new AiAgent().execute!.call(ctx);
    const user = chatLog[0]!.find((m) => m.role === 'user')!;
    expect(user.images).toEqual([{ mimeType: 'image/png', data: b64 }]);
  });
});

describe('Chat Model 子节点（多 provider）', () => {
  it('supplyData→chat：请求形状（tools/system/messages）与 tool_use 解析', async () => {
    const requests: IHttpRequestOptions[] = [];
    const ctx = supplyContext({
      params: { model: 'claude-sonnet-5', maxTokens: 512, temperature: 0.5 },
      credentials: { apiKey: 'sk-test' },
      httpRequest: async (o) => {
        requests.push(o);
        return {
          content: [
            { type: 'text', text: 'let me check' },
            { type: 'tool_use', id: 'call_1', name: 'lookup', input: { input: 'x' } },
          ],
        };
      },
    });
    const model = await new ChatModel().supplyData!.call(ctx);

    const reply = await model.chat(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      { tools: [{ name: 'lookup', description: 'd' }] },
    );

    const body = requests[0]!.body as Record<string, unknown>;
    expect(requests[0]!.headers?.['x-api-key']).toBe('sk-test');
    expect(body['system']).toBe('sys');
    expect(body['max_tokens']).toBe(512);
    expect((body['tools'] as unknown[]).length).toBe(1);
    expect(reply.content).toBe('let me check');
    expect(reply.toolCalls).toEqual([{ id: 'call_1', name: 'lookup', arguments: { input: 'x' } }]);
  });

  it('工具结果消息翻译成 tool_result 块', async () => {
    const requests: IHttpRequestOptions[] = [];
    const ctx = supplyContext({
      params: {},
      credentials: { apiKey: 'k' },
      httpRequest: async (o) => {
        requests.push(o);
        return { content: [{ type: 'text', text: 'done' }] };
      },
    });
    const model = await new ChatModel().supplyData!.call(ctx);
    await model.chat([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'f', arguments: {} }] },
      { role: 'tool', content: 'r', toolCallId: 'c1' },
    ]);
    const messages = (requests[0]!.body as { messages: Array<{ role: string; content: unknown }> }).messages;
    expect(messages[1]!.content).toEqual([{ type: 'tool_use', id: 'c1', name: 'f', input: {} }]);
    expect(messages[2]!.content).toEqual([{ type: 'tool_result', tool_use_id: 'c1', content: 'r' }]);
  });

  it('多模态（#32）：带图片的 user 消息翻译成 text + image block 数组', async () => {
    const requests: IHttpRequestOptions[] = [];
    const ctx = supplyContext({
      params: {},
      credentials: { apiKey: 'k' },
      httpRequest: async (o) => {
        requests.push(o);
        return { content: [{ type: 'text', text: 'a cat' }] };
      },
    });
    const model = await new ChatModel().supplyData!.call(ctx);
    await model.chat([
      { role: 'user', content: 'describe', images: [{ mimeType: 'image/png', data: 'BASE64DATA' }] },
    ]);
    const messages = (requests[0]!.body as { messages: Array<{ role: string; content: unknown }> }).messages;
    expect(messages[0]!.content).toEqual([
      { type: 'text', text: 'describe' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BASE64DATA' } },
    ]);
  });

  it('多模态（#32）：无图片的 user 消息仍是纯字符串（不回归）', async () => {
    const requests: IHttpRequestOptions[] = [];
    const ctx = supplyContext({
      params: {},
      credentials: { apiKey: 'k' },
      httpRequest: async (o) => {
        requests.push(o);
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    });
    const model = await new ChatModel().supplyData!.call(ctx);
    await model.chat([{ role: 'user', content: 'hi' }]);
    const messages = (requests[0]!.body as { messages: Array<{ role: string; content: unknown }> }).messages;
    expect(messages[0]!.content).toBe('hi');
  });

  it('多 provider：openai 兼容走 Chat Completions（Bearer + choices 解析 + 工具/图片格式）', async () => {
    const requests: IHttpRequestOptions[] = [];
    const ctx = supplyContext({
      params: { provider: 'deepseek', model: 'deepseek-chat' },
      credentials: { apiKey: 'sk-ds' },
      httpRequest: async (o) => {
        requests.push(o);
        return {
          choices: [
            {
              message: {
                content: 'sure',
                tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }],
              },
            },
          ],
        };
      },
    });
    const model = await new ChatModel().supplyData!.call(ctx);
    const reply = await model.chat(
      [{ role: 'user', content: 'see this', images: [{ mimeType: 'image/png', data: 'B64' }] }],
      { tools: [{ name: 'lookup', description: 'd' }] },
    );

    // 打 DeepSeek 端点、Bearer 鉴权
    expect(requests[0]!.url).toBe('https://api.deepseek.com/chat/completions');
    expect(requests[0]!.headers?.['authorization']).toBe('Bearer sk-ds');
    const body = requests[0]!.body as Record<string, unknown>;
    // OpenAI 工具格式（type:function）
    expect((body['tools'] as Array<{ type: string }>)[0]!.type).toBe('function');
    // OpenAI 多模态格式（image_url data URI）
    const userMsg = (body['messages'] as Array<{ role: string; content: unknown }>)[0]!;
    expect(userMsg.content).toEqual([
      { type: 'text', text: 'see this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,B64' } },
    ]);
    // choices → content + tool_calls(实参 JSON 解析)
    expect(reply.content).toBe('sure');
    expect(reply.toolCalls).toEqual([{ id: 'tc1', name: 'lookup', arguments: { q: 'x' } }]);
  });
});

describe('HTTP Tool / Window Memory 子节点', () => {
  it('HttpTool：GET 带 query、响应转文本', async () => {
    const seen: IHttpRequestOptions[] = [];
    const ctx = supplyContext({
      params: { toolName: 'search', toolDescription: 'find', url: 'https://x.dev/q', method: 'GET' },
      httpRequest: async (o) => {
        seen.push(o);
        return { hits: 3 };
      },
    });
    const tool = await new HttpTool().supplyData!.call(ctx);
    const result = await tool.invoke({ input: 'cats' });
    expect(seen[0]!.qs).toEqual({ input: 'cats' });
    expect(seen[0]!.urlTrust).toBe('user-controlled');
    expect(result).toBe('{"hits":3}');
    expect(tool.spec.name).toBe('search');
  });

  it('HttpTool + $fromAI（#19）：schema 从声明拼出;模型实参解析进 url/body', async () => {
    const seen: IHttpRequestOptions[] = [];
    const ctx = supplyContext({
      params: {
        toolName: 'get_order',
        toolDescription: 'fetch an order',
        method: 'POST',
        url: "=https://api.dev/orders/{{ $fromAI('orderId', 'The order id', 'string') }}",
        body: "={{ { note: $fromAI('note', 'A note', 'string'), qty: $fromAI('qty', 'quantity', 'number') } }}",
      },
      httpRequest: async (o) => {
        seen.push(o);
        return { ok: true };
      },
    });
    const tool = await new HttpTool().supplyData!.call(ctx);
    // spec schema 由 $fromAI 声明拼出（去重、含 required）
    const params = tool.spec.parameters as { properties: Record<string, { type: string; description?: string }>; required: string[] };
    expect(Object.keys(params.properties).sort()).toEqual(['note', 'orderId', 'qty']);
    expect(params.properties['qty']!.type).toBe('number');
    expect(params.required.sort()).toEqual(['note', 'orderId', 'qty']);

    // 模型给实参 → url path 与 body 用实参解析
    await tool.invoke({ orderId: 'A-99', note: 'urgent', qty: 3 });
    expect(seen[0]!.url).toBe('https://api.dev/orders/A-99');
    expect(seen[0]!.body).toEqual({ note: 'urgent', qty: 3 });
  });

  it('WindowMemory：按会话裁剪窗口、过滤 system', async () => {
    const staticData: JsonObject = {};
    const memory = await new WindowMemory().supplyData!.call(
      supplyContext({ params: { windowSize: 2 }, staticData }),
    );
    await memory.save('s', [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '1' },
      { role: 'assistant', content: '2' },
      { role: 'user', content: '3' },
    ]);
    const loaded = await memory.load('s');
    expect(loaded).toEqual([
      { role: 'assistant', content: '2' },
      { role: 'user', content: '3' },
    ]);
    expect(await memory.load('other')).toEqual([]);
  });
});
