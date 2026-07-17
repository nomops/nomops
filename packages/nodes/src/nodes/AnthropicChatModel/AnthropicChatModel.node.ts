import type {
  IAiChatResponse,
  IAiLanguageModel,
  IAiMessage,
  IAiToolSpec,
  INodeType,
  INodeTypeDescription,
  ISupplyDataContext,
  JsonObject,
} from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export const anthropicChatModelDescription: INodeTypeDescription = {
  displayName: 'Anthropic Chat Model',
  name: 'anthropicChatModel',
  group: ['ai'],
  version: 1,
  description: 'Claude chat model — attach to an AI Agent via the Model input',
  defaults: { name: 'Anthropic Chat Model' },
  inputs: [],
  outputs: ['ai_languageModel'],
  credentials: [{ name: 'anthropicApi', required: true }],
  properties: [
    {
      displayName: 'Model',
      name: 'model',
      type: 'options',
      default: 'claude-sonnet-5',
      options: [
        { name: 'Claude Sonnet 5', value: 'claude-sonnet-5' },
        { name: 'Claude Opus 4.8', value: 'claude-opus-4-8' },
        { name: 'Claude Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
      ],
    },
    { displayName: 'Max Tokens', name: 'maxTokens', type: 'number', default: 1024 },
    { displayName: 'Temperature', name: 'temperature', type: 'number', default: 1 },
  ],
};

/** Anthropic Messages API 的消息形态（仅本节点内部使用）。 */
interface IApiContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: JsonObject;
  tool_use_id?: string;
  content?: string;
}

/** 把通用 IAiMessage 序列翻译成 Anthropic Messages 请求体。 */
function toApiMessages(messages: IAiMessage[]): { system?: string; messages: Array<{ role: string; content: unknown }> } {
  let system: string | undefined;
  const out: Array<{ role: string; content: unknown }> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system = system ? `${system}\n${m.content}` : m.content;
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks: IApiContentBlock[] = [];
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
    out.push({ role: m.role, content: m.content });
  }
  return { ...(system ? { system } : {}), messages: out };
}

/**
 * Anthropic 模型子节点：supplyData 返回 IAiLanguageModel。
 * 凭证在能力对象闭包里按调用即取即用（明文不出节点——铁律 3）。
 */
export class AnthropicChatModel implements INodeType {
  description = anthropicChatModelDescription;

  async supplyData(this: ISupplyDataContext): Promise<IAiLanguageModel> {
    const model = String(this.getNodeParameter('model', 'claude-sonnet-5'));
    const maxTokens = Number(this.getNodeParameter('maxTokens', 1024));
    const temperature = Number(this.getNodeParameter('temperature', 1));
    const getCredentials = (type: string) => this.getCredentials(type);
    const httpRequest = this.helpers.httpRequest.bind(this.helpers);

    return {
      chat: async (messages: IAiMessage[], options?: { tools?: IAiToolSpec[] }): Promise<IAiChatResponse> => {
        const credentials = await getCredentials('anthropicApi');
        const apiKey = String(credentials['apiKey'] ?? '');
        if (!apiKey) throw new OperationalError('The anthropicApi credential is missing the apiKey field');

        const { system, messages: apiMessages } = toApiMessages(messages);
        const tools = (options?.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters ?? {
            type: 'object',
            properties: { input: { type: 'string', description: 'Tool input' } },
            required: ['input'],
          },
        }));

        const response = (await httpRequest({
          url: API_URL,
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
          body: {
            model,
            max_tokens: maxTokens,
            temperature,
            ...(system ? { system } : {}),
            ...(tools.length > 0 ? { tools } : {}),
            messages: apiMessages,
          },
        })) as { content?: IApiContentBlock[] };

        const blocks = response.content ?? [];
        const content = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
        const toolCalls = blocks
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({ id: b.id ?? '', name: b.name ?? '', arguments: (b.input ?? {}) as JsonObject }));
        return { content, ...(toolCalls.length > 0 ? { toolCalls } : {}) };
      },
    };
  }
}
