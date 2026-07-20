import type { Repositories } from '@nomops/db';

/**
 * 执行用量网关（社区侧端口）。
 *
 * ★这里划的是一条容易搞错的线：**计数是社区行为，限额才是付费功能**。
 * 用量展示对社区版同样有价值，所以计数必须在社区侧无条件发生；
 * 企业版在计数之前多一步「超了没有」的检查。
 *
 * 因此社区核心（ExecutionService）只认识这个端口，不认识 ee 的 QuotaService。
 * ee 侧的实现包住社区实现，加上限额检查——与 IEncryptionKeyProvider 同一手法。
 */
export interface IUsageGate {
  /**
   * 执行入口守门。企业版超额时抛 QuotaExceededError（429）；
   * 社区版永不抛，只计数。
   */
  consume(projectId: string): Promise<void>;
}

/** 当前计费周期（UTC 自然月，'YYYY-MM'）。企业版的限额检查复用同一口径。 */
export function currentBillingPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 社区实现：只计数，不设限。
 * 失败的执行也计（执行开始即计数，docs/08）。
 */
export class CountingUsageGate implements IUsageGate {
  constructor(private readonly repos: Repositories) {}

  async consume(projectId: string): Promise<void> {
    await this.repos.quotas.incrementUsage(projectId, currentBillingPeriod());
  }
}
