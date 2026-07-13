import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * 支付适配层（docs/08 计费骨架的落地，选型「只做抽象层」）。
 * 真实服务商（Stripe/Paddle…）各自实现本接口：验签、解析事件、映射 plan——
 * 业务管道（BillingService → 配额派发）零改动。
 */

export type BillingPlan = 'free' | 'pro' | 'unlimited';

export interface IPaymentEvent {
  type: 'subscription.activated' | 'subscription.changed' | 'subscription.canceled';
  projectId: string;
  plan: BillingPlan;
  /** 服务商侧引用（订阅 id 等），审计用。 */
  externalRef?: string;
}

export interface IPaymentProvider {
  readonly name: string;
  /**
   * 解析并验证 webhook。验签失败抛错（→401）；与订阅无关的事件返回 null（→忽略）。
   * rawBody 为原始字符串——真实服务商（如 Stripe）需要原文验签。
   */
  parseWebhook(headers: IncomingHttpHeaders, rawBody: string): Promise<IPaymentEvent | null>;
}

export class WebhookVerifyError extends Error {}

/**
 * 手动模式 provider：共享密钥验签（x-nomops-billing-secret 头），
 * body 即事件本体。用于：无服务商时的人工/脚本派发、真实适配器接入前的全链路联调。
 */
export class ManualPaymentProvider implements IPaymentProvider {
  readonly name = 'manual';

  constructor(private readonly secret: string) {
    if (!secret) throw new Error('ManualPaymentProvider 需要非空 secret');
  }

  async parseWebhook(headers: IncomingHttpHeaders, rawBody: string): Promise<IPaymentEvent | null> {
    const given = String(headers['x-nomops-billing-secret'] ?? '');
    const expected = this.secret;
    const ok =
      given.length === expected.length &&
      timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) throw new WebhookVerifyError('Billing webhook signature verification failed');

    const body = JSON.parse(rawBody) as Partial<IPaymentEvent>;
    if (
      !body.type ||
      !['subscription.activated', 'subscription.changed', 'subscription.canceled'].includes(body.type) ||
      typeof body.projectId !== 'string' ||
      !['free', 'pro', 'unlimited'].includes(body.plan ?? '')
    ) {
      return null; // 无关/不完整事件：忽略
    }
    return {
      type: body.type,
      projectId: body.projectId,
      plan: body.plan as BillingPlan,
      externalRef: body.externalRef,
    };
  }
}
