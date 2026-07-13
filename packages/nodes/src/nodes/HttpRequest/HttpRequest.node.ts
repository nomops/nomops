import type {
  IExecuteContext,
  IHttpRequestOptions,
  INodeExecutionData,
  INodeType,
  JsonObject,
} from '@nomops/workflow';
import { httpRequestDescription } from './HttpRequest.description.js';

/** 逐 item 发请求（URL/headers/body 支持表达式，按 item 求值）。 */
export class HttpRequest implements INodeType {
  description = httpRequestDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const url = this.getNodeParameter('url', i) as string;
      const method = (this.getNodeParameter('method', i, 'GET') ?? 'GET') as IHttpRequestOptions['method'];
      const headers = (this.getNodeParameter('headers', i, {}) ?? {}) as Record<string, string>;
      const body = this.getNodeParameter('body', i, undefined);

      const response = await this.helpers.httpRequest({
        url,
        method,
        headers,
        body: method === 'GET' ? undefined : body,
      });

      const json: JsonObject =
        response !== null && typeof response === 'object' && !Array.isArray(response)
          ? (response as JsonObject)
          : { data: response };
      returnData.push({ json, pairedItem: { item: i } });
    }

    return [returnData];
  }
}
