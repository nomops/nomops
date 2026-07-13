import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
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
 * AI Agent 节点：逐 item 调 Claude Messages API。
 * 凭证经 getCredentials('anthropicApi') 注入（明文只在执行瞬间存在——铁律 3）；
 * HTTP 经 helpers.httpRequest（可测：桩掉即断言请求形状）。
 */
export class AiAgent implements INodeType {
  description = aiAgentDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
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
}
