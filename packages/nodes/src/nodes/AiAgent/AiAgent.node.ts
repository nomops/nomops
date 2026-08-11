import type {
  IAiImageAttachment,
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

/** 从 item 的 binary 里挑出图片附件转 base64（多模态，backlog #32）；非图片忽略。 */
async function collectImages(ctx: IExecuteContext, item: INodeExecutionData): Promise<IAiImageAttachment[]> {
  const out: IAiImageAttachment[] = [];
  for (const bin of Object.values(item.binary ?? {})) {
    if (!bin.mimeType?.startsWith('image/')) continue;
    const bytes = await ctx.helpers.binaryToBuffer(bin);
    out.push({ mimeType: bin.mimeType, data: Buffer.from(bytes).toString('base64') });
  }
  return out;
}

const LEGACY_ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const LEGACY_ANTHROPIC_VERSION = '2023-06-01';

interface ILegacyAnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  model?: string;
  usage?: JsonObject;
  stop_reason?: string;
}

/**
 * AI Agent 节点：模型/工具/记忆均由能力子节点提供，Agent 本身不绑定任何模型厂商凭证。
 */
export class AiAgent implements INodeType {
  description = aiAgentDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const models = (await this.getInputConnectionData('ai_languageModel')) as IAiLanguageModel[];
    if (models.length === 0) {
      // 仅迁移兼容：旧工作流保存过显式 model 参数时继续执行；新节点描述不再暴露这些字段。
      const legacyModel = this.getNodeParameter('model', 0, undefined);
      if (legacyModel) return legacyDirectCall.call(this);
      throw new OperationalError('AI Agent requires a Chat Model. Connect one using the Chat Model + button.');
    }

    const model = models[0]!;
    const tools = (await this.getInputConnectionData('ai_tool')) as IAiTool[];
    const memories = (await this.getInputConnectionData('ai_memory')) as IAiMemory[];
    const memory = memories[0];
    const toolByName = new Map(tools.map((t) => [t.spec.name, t]));

    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const legacyPrompt = this.getNodeParameter('prompt', i, '');
      const prompt = String(this.getNodeParameter('text', i, legacyPrompt) ?? '');
      if (!prompt) throw new OperationalError(`AI Agent: prompt is empty (item ${i})`, { itemIndex: i });
      const options = (this.getNodeParameter('options', i, {}) ?? {}) as Record<string, unknown>;
      const system = String(options['systemMessage'] ?? this.getNodeParameter('system', i, '') ?? '');
      const maxIterations = Math.max(1, Number(options['maxIterations'] ?? this.getNodeParameter('maxIterations', i, 10)));
      const sessionId = String(options['sessionId'] ?? this.getNodeParameter('sessionId', i, 'default') ?? 'default');

      // 会话组装：system + 记忆里的历史 + 本轮用户输入（含图片附件）
      const history = memory ? await memory.load(sessionId) : [];
      const images = await collectImages(this, items[i]!);
      const messages: IAiMessage[] = [
        ...(system ? [{ role: 'system', content: system } as IAiMessage] : []),
        ...history,
        { role: 'user', content: prompt, ...(images.length ? { images } : {}) },
      ];

      // Agent 循环：模型请求工具 → 逐个执行 → 结果回喂，直到纯文本或到达上限
      // token 用量跨轮累加（成本核算，backlog #44 M2）
      let toolRounds = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      const addUsage = (r: typeof reply) => {
        if (r.usage) {
          inputTokens += r.usage.inputTokens;
          outputTokens += r.usage.outputTokens;
        }
      };
      let reply = await model.chat(messages, { tools: tools.map((t) => t.spec) });
      addUsage(reply);
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
        addUsage(reply);
      }

      messages.push({ role: 'assistant', content: reply.content });
      if (memory) await memory.save(sessionId, messages);

      returnData.push({
        // _nmUsage 保留键：AgentRunService 跑完从 runData 提取 → 成本核算（#44 M2）
        json: { output: reply.content, toolRounds, _nmUsage: { inputTokens, outputTokens } },
        pairedItem: { item: i },
      });
    }

    return [returnData];
  }
}

/** 迁移兼容旧工作流；当前节点描述不会再创建或展示这些厂商直连字段。 */
async function legacyDirectCall(this: IExecuteContext): Promise<INodeExecutionData[][]> {
  const credentials = await this.getCredentials('anthropicApi');
  const apiKey = String(credentials['apiKey'] ?? '');
  if (!apiKey) throw new OperationalError('The legacy anthropicApi credential is missing the apiKey field');

  const items = this.getInputData();
  const returnData: INodeExecutionData[] = [];
  for (let i = 0; i < items.length; i++) {
    const model = String(this.getNodeParameter('model', i, 'claude-sonnet-5'));
    const prompt = String(this.getNodeParameter('prompt', i, ''));
    const system = String(this.getNodeParameter('system', i, ''));
    const maxTokens = Number(this.getNodeParameter('maxTokens', i, 1024));
    if (!prompt) throw new OperationalError(`AI Agent: prompt is empty (item ${i})`, { itemIndex: i });

    const response = (await this.helpers.httpRequest({
      url: LEGACY_ANTHROPIC_URL,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': LEGACY_ANTHROPIC_VERSION,
      },
      body: {
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
      },
    })) as ILegacyAnthropicResponse;

    const text = (response.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
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
