import { createHmac } from 'node:crypto';
import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { respondToWebhookDescription } from './RespondToWebhook.description.js';

function parseJson(value: unknown, label: string): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject;
  try {
    const parsed = JSON.parse(String(value ?? '{}')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as JsonObject;
  } catch {
    throw new OperationalError(`Respond to Webhook: "${label}" is not valid JSON`, {});
  }
}

function headersFrom(options: JsonObject): Record<string, string> {
  const collection = options['responseHeaders'] as { entries?: Array<{ name?: unknown; value?: unknown }> } | undefined;
  return Object.fromEntries((collection?.entries ?? [])
    .map((entry) => [String(entry.name ?? '').trim(), String(entry.value ?? '')] as const)
    .filter(([name]) => name.length > 0));
}

function jwt(payload: JsonObject, secret: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

export class RespondToWebhook implements INodeType {
  description = respondToWebhookDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const respondWith = String(this.getNodeParameter('respondWith', 0, 'firstIncomingItem'));
    const options = this.getNodeParameter('options', 0, {}) as JsonObject;
    const legacyCode = Number(this.getNodeParameter('responseCode', 0, 200));
    let statusCode = Math.floor(Number(options['responseCode'] ?? legacyCode) || 200);
    const headers = headersFrom(options);
    let body: unknown;
    let contentType = 'application/json';

    switch (respondWith) {
      case 'allIncomingItems': body = items.map((item) => item.json); break;
      case 'firstIncomingItem': body = items[0]?.json ?? {}; break;
      case 'json': body = parseJson(this.getNodeParameter('responseBody', 0, '{}'), 'Response Body'); break;
      case 'jwt': {
        const credentials = await this.getCredentials('webhookJwtAuth');
        const secret = String(credentials['secret'] ?? '');
        if (!secret) throw new OperationalError('Respond to Webhook: JWT credential is missing a signing secret');
        body = jwt(parseJson(this.getNodeParameter('payload', 0, '{}'), 'Payload'), secret);
        contentType = 'text/plain';
        break;
      }
      case 'text': body = String(this.getNodeParameter('responseBody', 0, '')); contentType = 'text/plain'; break;
      case 'noData': body = null; contentType = ''; break;
      case 'redirect':
        statusCode = statusCode === 200 ? 302 : statusCode;
        headers['Location'] = String(this.getNodeParameter('redirectURL', 0, ''));
        body = null;
        contentType = '';
        break;
      case 'binary': {
        const source = String(this.getNodeParameter('responseDataSource', 0, 'automatically'));
        const field = source === 'set' ? String(this.getNodeParameter('inputDataFieldName', 0, 'data')) : Object.keys(items[0]?.binary ?? {})[0];
        const binary = field ? items[0]?.binary?.[field] : undefined;
        if (!binary) throw new OperationalError('Respond to Webhook: no input binary data is available');
        body = await this.helpers.binaryToBuffer(binary);
        contentType = binary.mimeType;
        if (binary.fileName) headers['Content-Disposition'] = `attachment; filename="${binary.fileName.replace(/["\\]/g, '_')}"`;
        break;
      }
      default: throw new OperationalError(`Respond to Webhook: unknown mode "${respondWith}"`, {});
    }

    this.helpers.setWebhookResponse?.({ statusCode, contentType, headers, body });
    return [items];
  }
}
