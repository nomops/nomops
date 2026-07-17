import type { IAiTool, INodeType, INodeTypeDescription, ISupplyDataContext, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

export const httpToolDescription: INodeTypeDescription = {
  displayName: 'HTTP Tool',
  name: 'httpTool',
  group: ['ai'],
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
    { displayName: 'URL', name: 'url', type: 'string', default: '', required: true, placeholder: 'https://api.example.com/search' },
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
  ],
};

/**
 * HTTP 工具子节点：把一个 HTTP 端点包装成 Agent 可调用的工具。
 * 模型给的参数：GET → query string；POST → JSON body。响应原样转文本还给模型。
 */
export class HttpTool implements INodeType {
  description = httpToolDescription;

  async supplyData(this: ISupplyDataContext): Promise<IAiTool> {
    const name = String(this.getNodeParameter('toolName', '')).trim();
    const description = String(this.getNodeParameter('toolDescription', '')).trim();
    const url = String(this.getNodeParameter('url', ''));
    const method = String(this.getNodeParameter('method', 'GET')) as 'GET' | 'POST';
    if (!name || !url) {
      throw new OperationalError('HTTP Tool requires both Tool Name and URL');
    }
    const httpRequest = this.helpers.httpRequest.bind(this.helpers);

    return {
      spec: {
        name,
        description: description || `Call ${url}`,
        parameters: {
          type: 'object',
          properties: { input: { type: 'string', description: 'Query or payload for the endpoint' } },
          required: ['input'],
        },
      },
      invoke: async (args: JsonObject): Promise<string> => {
        const response =
          method === 'GET'
            ? await httpRequest({ url, method, qs: args })
            : await httpRequest({ url, method, body: args });
        return typeof response === 'string' ? response : JSON.stringify(response);
      },
    };
  }
}
