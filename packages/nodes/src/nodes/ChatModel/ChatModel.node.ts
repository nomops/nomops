import type {
  IAiChatResponse,
  IAiLanguageModel,
  IAiMessage,
  IAiToolSpec,
  INodeProperties,
  INodeType,
  INodeTypeDescription,
  ISupplyDataContext,
  JsonObject,
} from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

/**
 * 通用 Chat Model 子节点：挂到 AI Agent 的 Model 输入，供可插拔的聊天补全能力。
 *
 * 多 provider：`provider` 参数决定调用协议与端点——
 *   - Anthropic：Messages API（x-api-key + anthropic-version，content block）
 *   - 其余（DeepSeek/Doubao/Qwen/Kimi/GLM）：OpenAI Chat Completions 兼容
 * 每个 provider 用各自的凭证（NDV 按所选 provider 条件显示对应凭证槽）。
 * 凭证在能力对象闭包里即取即用，明文不出节点（铁律 3）。
 */

interface ProviderInfo {
  id: string;
  label: string;
  /** 调用协议：anthropic = Messages API；openai = Chat Completions 兼容。 */
  kind: 'anthropic' | 'openai';
  baseUrl: string;
  credentialType: string;
  models: string[];
}

/** provider 表（与 server 的 CHAT_PROVIDERS 对齐；节点层自持，不跨层依赖）。 */
const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    credentialType: 'anthropicApi',
    models: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    credentialType: 'openAiApi',
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    credentialType: 'deepseekApi',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'doubao',
    label: 'Doubao 豆包',
    kind: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    credentialType: 'doubaoApi',
    models: ['doubao-seed-1-6-250615', 'doubao-1-5-pro-32k-250115'],
  },
  {
    id: 'qwen',
    label: 'Qwen 千问',
    kind: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    credentialType: 'qwenApi',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    credentialType: 'kimiApi',
    models: ['kimi-k2-turbo-preview', 'moonshot-v1-32k'],
  },
  {
    id: 'glm',
    label: 'GLM 智谱',
    kind: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    credentialType: 'glmApi',
    models: ['glm-4.6', 'glm-4-plus', 'glm-4-flash'],
  },
];

const providerById = (id: string): ProviderInfo => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;

/** 每个 provider 一个 model 下拉，按 provider 条件显示。 */
const modelProps: INodeProperties[] = PROVIDERS.map((p) => ({
  displayName: 'Model',
  name: 'model',
  type: 'options',
  default: p.models[0]!,
  options: p.models.map((m) => ({ name: m, value: m })),
  displayOptions: { show: { provider: [p.id] } },
}));

export const chatModelDescription: INodeTypeDescription = {
  displayName: 'Chat Model',
  name: 'chatModel',
  group: ['ai'],
  categories: ['ai'],
  subcategories: ['Language Models'],
  version: 1,
  description: 'Chat model (Anthropic / OpenAI-compatible) — attach to an AI Agent via the Model input',
  defaults: { name: 'Chat Model' },
  inputs: [],
  outputs: ['ai_languageModel'],
  credentials: PROVIDERS.map((p) => ({
    name: p.credentialType,
    required: true,
    displayOptions: { show: { provider: [p.id] } },
  })),
  properties: [
    {
      displayName: 'Provider',
      name: 'provider',
      type: 'options',
      default: 'anthropic',
      options: PROVIDERS.map((p) => ({ name: p.label, value: p.id })),
    },
    ...modelProps,
    { displayName: 'Max Tokens', name: 'maxTokens', type: 'number', default: 1024 },
    { displayName: 'Temperature', name: 'temperature', type: 'number', default: 1 },
  ],
};

/* ── Anthropic Messages API 形态 ── */
interface IAnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: JsonObject;
  tool_use_id?: string;
  content?: string;
  source?: { type: 'base64'; media_type: string; data: string };
}

/** 通用 IAiMessage[] → Anthropic Messages 请求体。 */
function toAnthropicMessages(messages: IAiMessage[]): {
  system?: string;
  messages: Array<{ role: string; content: unknown }>;
} {
  let system: string | undefined;
  const out: Array<{ role: string; content: unknown }> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system = system ? `${system}\n${m.content}` : m.content;
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks: IAnthropicBlock[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const call of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }],
      });
      continue;
    }
    if (m.role === 'user' && m.images?.length) {
      const blocks: IAnthropicBlock[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const img of m.images) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } });
      }
      out.push({ role: 'user', content: blocks });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return { ...(system ? { system } : {}), messages: out };
}

/* ── OpenAI Chat Completions 形态 ── */
interface IOpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** 通用 IAiMessage[] → OpenAI Chat Completions messages。 */
function toOpenAiMessages(messages: IAiMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      });
      continue;
    }
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content });
      continue;
    }
    if (m.role === 'user' && m.images?.length) {
      const parts: Array<Record<string, unknown>> = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      for (const img of m.images) {
        parts.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
      }
      out.push({ role: 'user', content: parts });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

export class ChatModel implements INodeType {
  description = chatModelDescription;

  async supplyData(this: ISupplyDataContext): Promise<IAiLanguageModel> {
    const provider = providerById(String(this.getNodeParameter('provider', 'anthropic')));
    const model = String(this.getNodeParameter('model', provider.models[0]!));
    const maxTokens = Number(this.getNodeParameter('maxTokens', 1024));
    const temperature = Number(this.getNodeParameter('temperature', 1));
    const getCredentials = (type: string) => this.getCredentials(type);
    const httpRequest = this.helpers.httpRequest.bind(this.helpers);

    return {
      chat: async (messages: IAiMessage[], options?: { tools?: IAiToolSpec[] }): Promise<IAiChatResponse> => {
        const credentials = await getCredentials(provider.credentialType);
        const apiKey = String(credentials['apiKey'] ?? '');
        if (!apiKey) {
          throw new OperationalError(`The ${provider.credentialType} credential is missing the apiKey field`);
        }
        const specs = options?.tools ?? [];

        if (provider.kind === 'anthropic') {
          const { system, messages: apiMessages } = toAnthropicMessages(messages);
          const tools = specs.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters ?? {
              type: 'object',
              properties: { input: { type: 'string', description: 'Tool input' } },
              required: ['input'],
            },
          }));
          const response = (await httpRequest({
            url: provider.baseUrl,
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: {
              model,
              max_tokens: maxTokens,
              temperature,
              ...(system ? { system } : {}),
              ...(tools.length > 0 ? { tools } : {}),
              messages: apiMessages,
            },
          })) as { content?: IAnthropicBlock[]; usage?: { input_tokens?: number; output_tokens?: number } };
          const blocks = response.content ?? [];
          const content = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
          const toolCalls = blocks
            .filter((b) => b.type === 'tool_use')
            .map((b) => ({ id: b.id ?? '', name: b.name ?? '', arguments: (b.input ?? {}) as JsonObject }));
          const usage = response.usage
            ? { inputTokens: Number(response.usage.input_tokens ?? 0), outputTokens: Number(response.usage.output_tokens ?? 0) }
            : undefined;
          return { content, ...(toolCalls.length > 0 ? { toolCalls } : {}), ...(usage ? { usage } : {}) };
        }

        // OpenAI Chat Completions 兼容
        const tools = specs.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters ?? {
              type: 'object',
              properties: { input: { type: 'string', description: 'Tool input' } },
              required: ['input'],
            },
          },
        }));
        const response = (await httpRequest({
          url: provider.baseUrl,
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}` },
          body: {
            model,
            max_tokens: maxTokens,
            temperature,
            ...(tools.length > 0 ? { tools } : {}),
            messages: toOpenAiMessages(messages),
          },
        })) as {
          choices?: Array<{ message?: { content?: string | null; tool_calls?: IOpenAiToolCall[] } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const message = response.choices?.[0]?.message;
        const content = message?.content ?? '';
        const toolCalls = (message?.tool_calls ?? []).map((c) => ({
          id: c.id,
          name: c.function.name,
          arguments: parseArgs(c.function.arguments),
        }));
        const usage = response.usage
          ? { inputTokens: Number(response.usage.prompt_tokens ?? 0), outputTokens: Number(response.usage.completion_tokens ?? 0) }
          : undefined;
        return { content, ...(toolCalls.length > 0 ? { toolCalls } : {}), ...(usage ? { usage } : {}) };
      },
    };
  }
}

/** OpenAI 工具实参是 JSON 字符串；解析失败退化为空对象。 */
function parseArgs(raw: string): JsonObject {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as JsonObject) : {};
  } catch {
    return {};
  }
}
