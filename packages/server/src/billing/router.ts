import { Router, raw, type NextFunction, type Request, type Response } from 'express';
import type { AppServices } from '../app-services.js';
import { WebhookVerifyError } from './payment-provider.js';

/**
 * 计费 webhook 公开入口：POST /billing/webhook。
 * 用 raw body（Stripe 等真实服务商需要原文验签）；验签由 provider 负责 → 失败 401。
 */
export function createBillingRouter(services: AppServices): Router {
  const router = Router();

  router.post(
    '/billing/webhook',
    raw({ type: '*/*', limit: '1mb' }),
    (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
        const event = await services.payments.parseWebhook(req.headers, rawBody);
        if (!event) {
          res.json({ received: true, ignored: true });
          return;
        }
        await services.billing.handleEvent(event);
        res.json({ received: true });
      })().catch((error: Error) => {
        if (error instanceof WebhookVerifyError) {
          res.status(401).json({ error: error.message });
          return;
        }
        if (error instanceof SyntaxError) {
          res.status(400).json({ error: 'Webhook body is not valid JSON' });
          return;
        }
        next(error);
      });
    },
  );

  // 支付宝异步通知：form-encoded 原文验签；应答必须是裸文本 "success"（否则支付宝重试）
  router.post(
    '/billing/alipay/notify',
    raw({ type: '*/*', limit: '1mb' }),
    (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        if (!services.alipay) {
          res.status(503).send('fail');
          return;
        }
        const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
        const notify = services.alipay.parseNotify(rawBody);
        if (notify) await services.billing.handleAlipayNotify(notify);
        res.type('text/plain').send('success');
      })().catch((error: Error) => {
        if (error instanceof WebhookVerifyError) {
          res.status(401).type('text/plain').send('fail');
          return;
        }
        next(error);
      });
    },
  );

  return router;
}
