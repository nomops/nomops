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
import { AnthropicChatModel } from '../AnthropicChatModel/AnthropicChatModel.node.js';
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

    expect(out[0]![0]!.json).toEqual({ output: 'answer based on result-for-42', toolRounds: 1 });
    // 第二次模型调用能看到 assistant 的 toolCalls 与 tool 结果
    expect(chatLog[1]!.some((m) => m.role === 'assistant' && m.toolCalls?.length === 1)).toBe(true);
    expect(chatLog[1]!.some((m) => m.role === 'tool' && m.toolCallId === 't1')).toBe(true);
    // 记忆里存了完整回合（system 由 memory 实现自行过滤，Agent 原样传）
    expect(saved['s1']!.some((m) => m.role === 'user' && m.content === 'find 42')).toBe(true);
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
});

describe('Anthropic Chat Model 子节点', () => {
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
    const model = await new AnthropicChatModel().supplyData!.call(ctx);

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
    const model = await new AnthropicChatModel().supplyData!.call(ctx);
    await model.chat([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'f', arguments: {} }] },
      { role: 'tool', content: 'r', toolCallId: 'c1' },
    ]);
    const messages = (requests[0]!.body as { messages: Array<{ role: string; content: unknown }> }).messages;
    expect(messages[1]!.content).toEqual([{ type: 'tool_use', id: 'c1', name: 'f', input: {} }]);
    expect(messages[2]!.content).toEqual([{ type: 'tool_result', tool_use_id: 'c1', content: 'r' }]);
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
    expect(result).toBe('{"hits":3}');
    expect(tool.spec.name).toBe('search');
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
