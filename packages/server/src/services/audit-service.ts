import type { CreateAuditLogInput, Repositories } from '@nomops/db';

/**
 * 审计（docs/06）：写入始终进行（查询才受 license 门控）。
 * fire-and-forget——审计失败只告警，绝不阻断业务。
 * ★铁律 3：调用方传入的 details 只放元数据，绝不含凭证明文/密文。
 */
export class AuditService {
  /** onEvent：审计事件的旁路观察者（docs/10 B3 日志流）。可选，注入后每条审计也会被广播。 */
  constructor(
    private readonly repos: Repositories,
    private readonly onEvent?: (entry: CreateAuditLogInput) => void,
  ) {}

  log(entry: CreateAuditLogInput): void {
    void this.repos.auditLogs.append(entry).catch((error: Error) => {
      console.error(`[nomops] 审计写入失败 (${entry.action}):`, error.message);
    });
    // 旁路推送同样 fire-and-forget，绝不阻断/影响审计主流程
    try {
      this.onEvent?.(entry);
    } catch (error) {
      console.error(`[nomops] 审计事件旁路失败 (${entry.action}):`, (error as Error).message);
    }
  }
}
