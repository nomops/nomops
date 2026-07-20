import type { Repositories } from '@nomops/db';
import { OperationalError } from '@nomops/workflow';
import type { LicenseService } from '../license/license-service.js';

/** 内置套餐（docs/08 第二节，硬契约）。null = 不限。 */
export const BUILTIN_PLANS: Record<string, number | null> = {
  free: 100,
  pro: 10_000,
  unlimited: null,
};

export type PlanName = 'free' | 'pro' | 'unlimited' | 'custom';

export interface IUsageInfo {
  period: string;
  used: number;
  limit: number | null;
  plan: PlanName | 'unlimited';
}

/** 超额错误：携带 quota 详情，HTTP 层映射为 429。 */
export class QuotaExceededError extends OperationalError {
  constructor(quota: IUsageInfo) {
    super(`Execution quota exhausted (${quota.period}: ${quota.used}/${quota.limit})`, {
      status: 429,
      quota: quota as unknown as Record<string, unknown>,
    });
  }
}

/**
 * 配额网关（docs/08）：唯一强制点是 consume()——所有执行入口共用。
 * - 计数始终进行（社区版也计，用量展示有价值）
 * - 限额只在企业版（quotas 功能）且 project 配了有限套餐时强制
 * - 已知边界：检查与自增间的小竞态窗口（单实例可忽略，多 worker 原子化留给 queue 切片）
 */
export class QuotaService {
  constructor(
    private readonly repos: Repositories,
    private readonly license: LicenseService,
  ) {}

  /** 当前计费周期（UTC 自然月，'YYYY-MM'）。 */
  currentPeriod(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /** project 的生效套餐与上限。无配置行 = unlimited；付费套餐过期 → 回落 free（docs/08 支付宝订单式）。 */
  async resolveLimit(projectId: string): Promise<{ plan: IUsageInfo['plan']; limit: number | null }> {
    const quota = await this.repos.quotas.getQuota(projectId);
    if (!quota) return { plan: 'unlimited', limit: null };
    if (quota.expiresAt && quota.expiresAt.getTime() <= Date.now()) {
      return { plan: 'free', limit: BUILTIN_PLANS['free'] ?? null };
    }
    if (quota.plan === 'custom') {
      return { plan: 'custom', limit: quota.monthlyExecutions ?? null };
    }
    return { plan: quota.plan as PlanName, limit: BUILTIN_PLANS[quota.plan] ?? null };
  }

  async usage(projectId: string): Promise<IUsageInfo> {
    const period = this.currentPeriod();
    const [{ plan, limit }, used] = await Promise.all([
      this.resolveLimit(projectId),
      this.repos.quotas.getUsage(projectId, period),
    ]);
    return { period, used, limit, plan };
  }

  /**
   * 执行入口守门：超额抛 QuotaExceededError（429），否则计数放行。
   * 执行开始即计数，失败的执行也计（docs/08）。
   */
  async consume(projectId: string): Promise<void> {
    const period = this.currentPeriod();
    if (this.license.isFeatureEnabled('quotas')) {
      const { plan, limit } = await this.resolveLimit(projectId);
      if (limit !== null) {
        const used = await this.repos.quotas.getUsage(projectId, period);
        if (used >= limit) {
          throw new QuotaExceededError({ period, used, limit, plan });
        }
      }
    }
    await this.repos.quotas.incrementUsage(projectId, period);
  }
}
