import type { IAiTool, INodeType, INodeTypeDescription, ISupplyDataContext, JsonObject } from '@nomops/workflow';
import { OperationalError, collectFromAiParams, fromAiSchema, resolveWithAiArgs } from '@nomops/workflow';

export const httpToolDescription: INodeTypeDescription = {
  displayName: 'HTTP Tool',
  name: 'httpTool',
  group: ['ai'],
  categories: ['ai'],
  subcategories: ['Tools'],
  version: 1,
  description: 'Expose an HTTP endpoint as a tool the AI Agent can call',
  defaults: { name: 'HTTP Tool' },
  inputs: [],
  outputs: ['ai_tool'],
  properties: [
    {
      displayName: 'Tool Name',
      name: 'toolName',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'search_orders',
      description: 'Identifier the model uses to call this tool (letters, digits, underscores)',
    },
    {
      displayName: 'Tool Description',
      name: 'toolDescription',
      type: 'string',
      default: '',
      required: true,
      description: 'Tell the model what this tool does and when to use it',
    },
    {
      displayName: 'URL',
      name: 'url',
      type: 'string',
      default: '',
      required: true,
      placeholder: "https://api.example.com/orders/{{ $fromAI('id','Order id','string') }}",
      description: "Supports ={{ $fromAI('name','description','type') }} to let the model fill parts of the request",
    },
    {
      displayName: 'Method',
      name: 'method',
      type: 'options',
      default: 'GET',
      options: [
        { name: 'GET', value: 'GET' },
        { name: 'POST', value: 'POST' },
      ],
    },
    {
      displayName: 'Query',
      name: 'query',
      type: 'json',
      default: '',
      description: "Optional query object; values can use $fromAI(...)",
      displayOptions: { show: { method: ['GET'] } },
    },
    {
      displayName: 'Body',
      name: 'body',
      type: 'json',
      default: '',
      description: "Optional JSON body; values can use $fromAI(...)",
      displayOptions: { show: { method: ['POST'] } },
    },
  ],
};

/**
 * HTTP 工具子节点：把一个 HTTP 端点包装成 Agent 可调用的工具。
 * 参数（url/query/body）里可用 `={{ $fromAI('name','desc','type') }}` 声明「让模型填」（#19）——
 * 工具 spec 的 JSON schema 从这些声明拼出;模型调用时用它给的实参解析出真实请求。
 * 没有任何 $fromAI → 退回单一 `input` 参数（GET→qs / POST→body）的旧行为。
 */
export class HttpTool implements INodeType {
  description = httpToolDescription;

  async supplyData(this: ISupplyDataContext): Promise<IAiTool> {
    const name = String(this.getNodeParameter('toolName', '')).trim();
    const description = String(this.getNodeParameter('toolDescription', '')).trim();
    const method = String(this.getNodeParameter('method', 'GET')) as 'GET' | 'POST';
    // 原始（未求值）参数值:$fromAI 声明藏在表达式里,不能被 getNodeParameter 提前解析掉
    const rawUrl = this.getRawNodeParameter('url');
    const rawQuery = this.getRawNodeParameter('query');
    const rawBody = this.getRawNodeParameter('body');
    if (!name) throw new OperationalError('HTTP Tool requires a Tool Name');

    const scanTargets = [rawUrl, rawQuery, rawBody].filter((v) => v !== undefined && v !== '');
    const aiParams = collectFromAiParams(scanTargets);
    const httpRequest = this.helpers.httpRequest.bind(this.helpers);

    const parameters: JsonObject =
      aiParams.length > 0
        ? fromAiSchema(aiParams)
        : {
            type: 'object',
            properties: { input: { type: 'string', description: 'Query or payload for the endpoint' } },
            required: ['input'],
          };

    return {
      spec: { name, description: description || 'Call the configured endpoint', parameters },
      invoke: async (args: JsonObject): Promise<string> => {
        let url: string;
        let qs: JsonObject | undefined;
        let body: JsonObject | undefined;
        if (aiParams.length > 0) {
          url = String(resolveWithAiArgs(rawUrl, args));
          qs = rawQuery ? (resolveWithAiArgs(rawQuery, args) as JsonObject) : undefined;
          body = rawBody ? (resolveWithAiArgs(rawBody, args) as JsonObject) : undefined;
          if (method === 'GET' && !qs) qs = args; // GET 未显式给 query → AI 实参兜底
        } else {
          url = String(rawUrl ?? '');
          if (method === 'GET') qs = args;
          else body = args;
        }
        if (!url) throw new OperationalError('HTTP Tool: URL resolved empty');
        const response = await httpRequest({
          url,
          method,
          ...(qs ? { qs } : {}),
          ...(body ? { body } : {}),
          urlTrust: 'user-controlled',
        });
        return typeof response === 'string' ? response : JSON.stringify(response);
      },
    };
  }
}
