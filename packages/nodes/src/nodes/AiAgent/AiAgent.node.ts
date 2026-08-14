import type {
  IAiChatResponse,
  IAiImageAttachment,
  IAiLanguageModel,
  IAiMemory,
  IAiMessage,
  IAiTool,
  IAiToolCall,
  IExecuteContext,
  INodeExecutionData,
  INodeType,
  JsonObject,
} from '@nomops/workflow';
import {
  AI_AGENT_STATE_CONTEXT_KEY,
  AI_TOOL_RESULTS_CONTEXT_KEY,
  ExecutionAiToolRequest,
  OperationalError,
} from '@nomops/workflow';
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

interface IAgentItemState {
  itemIndex: number;
  messages: IAiMessage[];
  sessionId: string;
  maxIterations: number;
  toolRounds: number;
  inputTokens: number;
  outputTokens: number;
  replyContent: string;
  pendingCalls: IAiToolCall[];
  pendingCallIndex: number;
}

interface IAgentExecutionState {
  nextItemIndex: number;
  returnData: INodeExecutionData[];
  current?: IAgentItemState;
}

function addUsage(state: IAgentItemState, reply: IAiChatResponse): void {
  if (!reply.usage) return;
  state.inputTokens += reply.usage.inputTokens;
  state.outputTokens += reply.usage.outputTokens;
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
    const context = this.getContext();
    const stored = context[AI_AGENT_STATE_CONTEXT_KEY] as unknown as IAgentExecutionState | undefined;
    const state: IAgentExecutionState = stored ?? { nextItemIndex: 0, returnData: [] };
    if (!stored) context[AI_AGENT_STATE_CONTEXT_KEY] = state as unknown as JsonObject;
    const toolResults =
      context[AI_TOOL_RESULTS_CONTEXT_KEY] &&
      typeof context[AI_TOOL_RESULTS_CONTEXT_KEY] === 'object' &&
      !Array.isArray(context[AI_TOOL_RESULTS_CONTEXT_KEY])
        ? (context[AI_TOOL_RESULTS_CONTEXT_KEY] as JsonObject)
        : ((context[AI_TOOL_RESULTS_CONTEXT_KEY] = {}) as JsonObject);

    while (state.nextItemIndex < items.length) {
      if (!state.current) {
        const i = state.nextItemIndex;
        const legacyPrompt = this.getNodeParameter('prompt', i, '');
        const prompt = String(this.getNodeParameter('text', i, legacyPrompt) ?? '');
        if (!prompt) throw new OperationalError(`AI Agent: prompt is empty (item ${i})`, { itemIndex: i });
        const options = (this.getNodeParameter('options', i, {}) ?? {}) as Record<string, unknown>;
        const system = String(options['systemMessage'] ?? this.getNodeParameter('system', i, '') ?? '');
        const maxIterations = Math.max(1, Number(options['maxIterations'] ?? this.getNodeParameter('maxIterations', i, 10)));
        const sessionId = String(options['sessionId'] ?? this.getNodeParameter('sessionId', i, 'default') ?? 'default');
        const history = memory ? await memory.load(sessionId) : [];
        const images = await collectImages(this, items[i]!);
        state.current = {
          itemIndex: i,
          messages: [
            ...(system ? [{ role: 'system', content: system } as IAiMessage] : []),
            ...history,
            { role: 'user', content: prompt, ...(images.length ? { images } : {}) },
          ],
          sessionId,
          maxIterations,
          toolRounds: 0,
          inputTokens: 0,
          outputTokens: 0,
          replyContent: '',
          pendingCalls: [],
          pendingCallIndex: 0,
        };
        const reply = await model.chat(state.current.messages, { tools: tools.map((tool) => tool.spec) });
        addUsage(state.current, reply);
        state.current.replyContent = reply.content;
        if (reply.toolCalls?.length && state.current.toolRounds < state.current.maxIterations) {
          state.current.toolRounds++;
          state.current.messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls });
          state.current.pendingCalls = reply.toolCalls;
        }
      }

      const current = state.current;
      if (current.pendingCallIndex < current.pendingCalls.length) {
        const call = current.pendingCalls[current.pendingCallIndex]!;
        let result = toolResults[call.id];
        if (typeof result !== 'string') {
          const tool = toolByName.get(call.name);
          if (!tool) {
            result = `Unknown tool: ${call.name}`;
          } else if (tool.sourceNodeName) {
            // 关键边界：不在节点内 invoke。把动作交回 WorkflowExecute 主循环，真实工具
            // 节点会获得 retry/cancel/HITL/runData；Agent 帧随后以 resume 恢复。
            throw new ExecutionAiToolRequest({
              parentNodeName: this.getNode().name,
              sourceNodeName: tool.sourceNodeName,
              toolName: call.name,
              toolCallId: call.id,
              args: call.arguments,
              itemIndex: current.itemIndex,
            });
          } else {
            // 仅供直接调用节点实现/旧第三方能力对象兼容；画布连接由 core 注入 sourceNodeName。
            result = await tool.invoke(call.arguments).catch((error: Error) => `Tool error: ${error.message}`);
          }
        } else {
          delete toolResults[call.id];
        }
        current.messages.push({ role: 'tool', content: String(result), toolCallId: call.id });
        current.pendingCallIndex++;
        continue;
      }

      if (current.pendingCalls.length > 0) {
        current.pendingCalls = [];
        current.pendingCallIndex = 0;
        const reply = await model.chat(current.messages, { tools: tools.map((tool) => tool.spec) });
        addUsage(current, reply);
        current.replyContent = reply.content;
        if (reply.toolCalls?.length && current.toolRounds < current.maxIterations) {
          current.toolRounds++;
          current.messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls });
          current.pendingCalls = reply.toolCalls;
          continue;
        }
      }

      current.messages.push({ role: 'assistant', content: current.replyContent });
      if (memory) await memory.save(current.sessionId, current.messages);
      state.returnData.push({
        json: {
          output: current.replyContent,
          toolRounds: current.toolRounds,
          _nmUsage: { inputTokens: current.inputTokens, outputTokens: current.outputTokens },
        },
        pairedItem: { item: current.itemIndex },
      });
      state.nextItemIndex++;
      delete state.current;
    }

    const returnData = state.returnData;
    delete context[AI_AGENT_STATE_CONTEXT_KEY];
    delete context[AI_TOOL_RESULTS_CONTEXT_KEY];
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
