import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { respondToWebhookDescription } from './RespondToWebhook.description.js';

/**
 * 自定义 webhook 响应：把 {statusCode, contentType, body} 交给 helpers.setWebhookResponse
 * （由 webhook 路由注入;手动运行/队列模式无此 helper → 原样透传,不报错）。
 * items 原样透传到下游。
 */
export class RespondToWebhook implements INodeType {
  description = respondToWebhookDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const respondWith = String(this.getNodeParameter('respondWith', 0, 'firstIncomingItem') ?? 'firstIncomingItem');
    const statusCode = Math.floor(Number(this.getNodeParameter('responseCode', 0, 200)) || 200);

    let body: unknown;
    let contentType = 'application/json';
    switch (respondWith) {
      case 'firstIncomingItem':
        body = items[0]?.json ?? {};
        break;
      case 'json': {
        const raw = String(this.getNodeParameter('responseBody', 0, '') ?? '');
        try {
          body = raw.trim() ? JSON.parse(raw) : {};
        } catch {
          throw new OperationalError('Respond to Webhook: "Response Body" is not valid JSON', {});
        }
        break;
      }
      case 'text':
        body = String(this.getNodeParameter('responseBody', 0, '') ?? '');
        contentType = 'text/plain';
        break;
      case 'noData':
        body = null;
        contentType = '';
        break;
      default:
        throw new OperationalError(`Respond to Webhook: unknown mode "${respondWith}"`, {});
    }

    this.helpers.setWebhookResponse?.({
      statusCode,
      contentType,
      body: body as JsonObject[keyof JsonObject],
    });
    return [items];
  }
}
