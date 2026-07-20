import type { Repositories } from '@nomops/db';
import { OperationalError } from '@nomops/workflow';
import type { AuditService } from '../ee/services/audit-service.js';
import type { IPaymentEvent } from './payment-provider.js';
import type { AlipayNotify, AlipayProvider } from './alipay-provider.js';

/** 价目表（元/月，字符串精确金额）。 */
export const PLAN_PRICING: Record<string, { monthly: string; label: string }> = {
  pro: { monthly: '99.00', label: 'nomops Pro' },
};

/** 计算订单金额：月单价 × 月数（分精度整数运算，避免浮点）。 */
export function orderAmount(plan: string, months: number): string {
  const pricing = PLAN_PRICING[plan];
  if (!pricing) throw new OperationalError(`Unknown plan: ${plan}`, { status: 400 });
  const cents = Math.round(Number(pricing.monthly) * 100) * months;
  return (cents / 100).toFixed(2);
}

/**
 * 计费编排（支付宝订单式，docs/08）：
 * 下单 → 收银台 URL → 异步 notify（验签在 provider）→ 金额核对 → 幂等入账 →
 * 派发 plan + 有效期（复用 6c project_quotas 管道）。
 */
export class BillingService {
  constructor(
    private readonly repos: Repositories,
    private readonly audit: AuditService,
    private readonly alipay: AlipayProvider | null,
  ) {}

  /** 创建订单并返回支付宝收银台 URL。 */
  async createCheckout(projectId: string, plan: string, months: number): Promise<{ orderId: string; payUrl: string }> {
    if (!this.alipay) {
      throw new OperationalError('Payment is not configured (missing ALIPAY_* environment variables)', { status: 503 });
    }
    if (!Number.isInteger(months) || months < 1 || months > 36) {
      throw new OperationalError('months must be an integer between 1 and 36', { status: 400 });
    }
    const amount = orderAmount(plan, months);
    const order = await this.repos.quotas.createOrder({ projectId, plan, months, amount });
    const payUrl = this.alipay.buildPagePayUrl({
      id: order.id,
      amount,
      subject: `${PLAN_PRICING[plan]!.label} × ${months} months`,
    });
    return { orderId: order.id, payUrl };
  }

  /** 处理支付宝异步通知（已验签）。幂等：已入账订单直接放行（支付宝会重试）。 */
  async handleAlipayNotify(notify: AlipayNotify): Promise<void> {
    const order = await this.repos.quotas.getOrder(notify.outTradeNo);
    if (!order) {
      throw new OperationalError('Notification refers to a non-existent order', { status: 400, outTradeNo: notify.outTradeNo });
    }
    if (order.status === 'paid') return; // 幂等
    if (order.amount !== notify.totalAmount) {
      throw new OperationalError('Notification amount does not match the order', {
        status: 400,
        expected: order.amount,
        got: notify.totalAmount,
      });
    }

    await this.repos.quotas.markOrderPaid(order.id, notify.tradeNo);
    // 续费叠加：现有有效期未过则顺延，否则从现在起算
    const existing = await this.repos.quotas.getQuota(order.projectId);
    const base =
      existing?.expiresAt && existing.expiresAt.getTime() > Date.now()
        ? existing.expiresAt
        : new Date();
    const expiresAt = addMonths(base, order.months);
    await this.repos.quotas.upsertQuota(order.projectId, order.plan, null, expiresAt);

    this.audit.log({
      projectId: order.projectId,
      action: 'billing.plan.change',
      resourceType: 'project',
      resourceId: order.projectId,
      details: {
        plan: order.plan,
        months: order.months,
        amount: order.amount,
        expiresAt: expiresAt.toISOString(),
        alipayTradeNo: notify.tradeNo,
      },
    });
  }

  /** 通用事件入口（ManualPaymentProvider / 未来其他服务商）。 */
  async handleEvent(event: IPaymentEvent): Promise<void> {
    const project = await this.repos.projects.findById(event.projectId);
    if (!project) {
      throw new OperationalError('Billing event refers to a non-existent project', {
        status: 400,
        projectId: event.projectId,
      });
    }
    const plan = event.type === 'subscription.canceled' ? 'free' : event.plan;
    await this.repos.quotas.upsertQuota(event.projectId, plan, null, null);
    this.audit.log({
      projectId: event.projectId,
      action: 'billing.plan.change',
      resourceType: 'project',
      resourceId: event.projectId,
      details: { plan, eventType: event.type, externalRef: event.externalRef ?? null },
    });
  }
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}
