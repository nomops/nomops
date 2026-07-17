import type {
  IAiLanguageModel,
  IAiMemory,
  IAiMessage,
  IAiTool,
  IExecuteContext,
  INodeExecutionData,
  INodeType,
  JsonObject,
} from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { aiAgentDescription } from './AiAgent.description.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

interface IAnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  model?: string;
  usage?: JsonObject;
  stop_reason?: string;
}

/**
 * AI Agent 节点，两种形态：
 * - 组合模式（挂了 ai_languageModel 子节点）：模型/工具/记忆可插拔，跑「模型→工具→模型」循环；
 * - 旧直连模式（未挂模型）：沿用原有单轮 Claude 调用（凭证直连），保持既有工作流不破。
 */
export class AiAgent implements INodeType {
  description = aiAgentDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const models = (await this.getInputConnectionData('ai_languageModel')) as IAiLanguageModel[];
    if (models.length === 0) return legacyDirectCall.call(this);

    const model = models[0]!;
    const tools = (await this.getInputConnectionData('ai_tool')) as IAiTool[];
    const memories = (await this.getInputConnectionData('ai_memory')) as IAiMemory[];
    const memory = memories[0];
    const toolByName = new Map(tools.map((t) => [t.spec.name, t]));

    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const prompt = String(this.getNodeParameter('prompt', i) ?? '');
      if (!prompt) throw new OperationalError(`AI Agent: prompt is empty (item ${i})`, { itemIndex: i });
      const system = String(this.getNodeParameter('system', i, '') ?? '');
      const maxIterations = Math.max(1, Number(this.getNodeParameter('maxIterations', i, 5)));
      const sessionId = String(this.getNodeParameter('sessionId', i, 'default') ?? 'default');

      // 会话组装：system + 记忆里的历史 + 本轮用户输入
      const history = memory ? await memory.load(sessionId) : [];
      const messages: IAiMessage[] = [
        ...(system ? [{ role: 'system', content: system } as IAiMessage] : []),
        ...history,
        { role: 'user', content: prompt },
      ];

      // Agent 循环：模型请求工具 → 逐个执行 → 结果回喂，直到纯文本或到达上限
      let toolRounds = 0;
      let reply = await model.chat(messages, { tools: tools.map((t) => t.spec) });
      while (reply.toolCalls?.length && toolRounds < maxIterations) {
        toolRounds++;
        messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls });
        for (const call of reply.toolCalls) {
          const tool = toolByName.get(call.name);
          const result = tool
            ? await tool.invoke(call.arguments).catch((e: Error) => `Tool error: ${e.message}`)
            : `Unknown tool: ${call.name}`;
          messages.push({ role: 'tool', content: result, toolCallId: call.id });
        }
        reply = await model.chat(messages, { tools: tools.map((t) => t.spec) });
      }

      messages.push({ role: 'assistant', content: reply.content });
      if (memory) await memory.save(sessionId, messages);

      returnData.push({
        json: { output: reply.content, toolRounds },
        pairedItem: { item: i },
      });
    }

    return [returnData];
  }
}

/** 旧直连模式：逐 item 单轮调 Claude（历史行为原样保留）。 */
async function legacyDirectCall(this: IExecuteContext): Promise<INodeExecutionData[][]> {
  const credentials = await this.getCredentials('anthropicApi');
  const apiKey = String(credentials['apiKey'] ?? '');
  if (!apiKey) throw new OperationalError('The anthropicApi credential is missing the apiKey field');

  const items = this.getInputData();
  const returnData: INodeExecutionData[] = [];

  for (let i = 0; i < items.length; i++) {
    const model = (this.getNodeParameter('model', i, 'claude-sonnet-5') ?? 'claude-sonnet-5') as string;
    const prompt = (this.getNodeParameter('prompt', i) ?? '') as string;
    const system = (this.getNodeParameter('system', i, '') ?? '') as string;
    const maxTokens = Number(this.getNodeParameter('maxTokens', i, 1024) ?? 1024);
    if (!prompt) {
      throw new OperationalError(`AI Agent: prompt is empty (item ${i})`, { itemIndex: i });
    }

    const response = (await this.helpers.httpRequest({
      url: ANTHROPIC_URL,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: {
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
      },
    })) as IAnthropicResponse;

    const text = (response.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
    returnData.push({
      json: {
        text,
        model: response.model ?? model,
        stopReason: response.stop_reason,
        usage: response.usage ?? null,
      },
      pairedItem: { item: i },
    });
  }

  return [returnData];
}
