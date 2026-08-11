import type {
  IExecuteContext,
  IHttpRequestOptions,
  INodeExecutionData,
  INodeType,
  JsonObject,
} from '@nomops/workflow';
import { httpRequestDescription } from './HttpRequest.description.js';

function fixedRows(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const rows = (value as { parameters?: unknown }).parameters;
  return Array.isArray(rows)
    ? rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row))
    : [];
}

function rowsToObject(value: unknown): Record<string, unknown> {
  return Object.fromEntries(fixedRows(value).map((row) => [String(row['name'] ?? ''), row['value']]).filter(([name]) => name));
}

/** 逐 item 发请求（URL/headers/body 支持表达式，按 item 求值）。 */
export class HttpRequest implements INodeType {
  description = httpRequestDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const url = this.getNodeParameter('url', i) as string;
      const method = (this.getNodeParameter('method', i, 'GET') ?? 'GET') as IHttpRequestOptions['method'];
      const legacyHeaders = (this.getNodeParameter('headers', i, {}) ?? {}) as Record<string, string>;
      const specifyHeaders = String(this.getNodeParameter('specifyHeaders', i, 'keypair') ?? 'keypair');
      const declaredHeaders = specifyHeaders === 'json'
        ? (this.getNodeParameter('headerJson', i, {}) ?? {}) as Record<string, unknown>
        : rowsToObject(this.getNodeParameter('headerParameters', i, {}));
      const headers: Record<string, string> = Object.fromEntries(
        Object.entries({ ...legacyHeaders, ...declaredHeaders }).map(([key, value]) => [key, String(value ?? '')]),
      );
      const authentication = String(this.getNodeParameter('authentication', i, 'none') ?? 'none');
      if (authentication === 'basic') {
        const credential = await this.getCredentials('httpBasicAuth');
        headers['Authorization'] = `Basic ${Buffer.from(`${String(credential['user'] ?? '')}:${String(credential['password'] ?? '')}`).toString('base64')}`;
      } else if (authentication === 'header') {
        const credential = await this.getCredentials('httpHeaderAuth');
        const name = String(credential['name'] ?? '');
        if (name) headers[name] = String(credential['value'] ?? '');
      }
      const rawQueryParameters = this.getNodeParameter('queryParameters', i, {}) ?? {};
      const specifyQuery = String(this.getNodeParameter('specifyQuery', i, 'keypair') ?? 'keypair');
      const queryParameters = specifyQuery === 'json'
        ? (this.getNodeParameter('queryJson', i, {}) ?? {}) as Record<string, unknown>
        : fixedRows(rawQueryParameters).length > 0
          ? rowsToObject(rawQueryParameters)
          : rawQueryParameters as Record<string, unknown>;
      const sendQuery = this.getNodeParameter('sendQuery', i, undefined);
      const sendHeaders = this.getNodeParameter('sendHeaders', i, undefined);
      const sendBody = this.getNodeParameter('sendBody', i, undefined);
      let body = this.getNodeParameter('body', i, undefined);
      const contentType = String(this.getNodeParameter('contentType', i, 'json') ?? 'json');
      const specifyBody = String(this.getNodeParameter('specifyBody', i, 'keypair') ?? 'keypair');
      if (sendBody === true) {
        const bodyParameters = this.getNodeParameter('bodyParameters', i, undefined);
        const jsonBody = this.getNodeParameter('jsonBody', i, undefined);
        const rawBody = this.getNodeParameter('rawBody', i, undefined);
        const hasModernBody = bodyParameters !== undefined || jsonBody !== undefined || rawBody !== undefined;
        if (contentType === 'raw' && hasModernBody) {
          body = String(this.getNodeParameter('rawBody', i, '') ?? '');
        } else if (specifyBody === 'json' && hasModernBody) {
          body = this.getNodeParameter('jsonBody', i, {}) ?? {};
        } else if (hasModernBody) {
          body = rowsToObject(bodyParameters);
        }
        if (contentType === 'form-urlencoded') {
          headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
          const pairs: Array<[string, string]> = Object.entries(body as Record<string, unknown>)
            .map(([key, value]) => [key, String(value ?? '')]);
          body = new URLSearchParams(pairs).toString();
        } else if (contentType === 'json') {
          headers['Content-Type'] ??= 'application/json';
        }
      }
      const options = (this.getNodeParameter('options', i, {}) ?? {}) as Record<string, unknown>;

      const response = await this.helpers.httpRequest({
        url,
        method,
        headers: sendHeaders === false && authentication === 'none' && Object.keys(headers).length === 0 ? undefined : headers,
        qs: sendQuery === true || Object.keys(queryParameters).length > 0 ? queryParameters : undefined,
        body: sendBody === false || (sendBody === undefined && (method === 'GET' || method === 'HEAD')) ? undefined : body,
        responseFormat: (options['responseFormat'] ?? 'auto') as IHttpRequestOptions['responseFormat'],
        urlTrust: 'user-controlled',
      });

      if (options['responseFormat'] === 'binary' && response instanceof Uint8Array) {
        const binary = await this.helpers.bufferToBinary(response, { mimeType: 'application/octet-stream' });
        returnData.push({ json: {}, binary: { data: binary }, pairedItem: { item: i } });
        continue;
      }

      const json: JsonObject =
        response !== null && typeof response === 'object' && !Array.isArray(response)
          ? (response as JsonObject)
          : { data: response };
      returnData.push({ json, pairedItem: { item: i } });
    }

    return [returnData];
  }
}
