import type { Repositories } from '@nomops/db';

/** 环境变量缺省值：保留 336 小时（14 天）与最近 10000 条，取并集。 */
const DEFAULT_MAX_AGE_HOURS = 336;
const DEFAULT_MAX_COUNT = 10_000;
const DEFAULT_INTERVAL_MS = 3_600_000; // 1 小时

export interface IExecutionPrunerOptions {
  /** 保留时长（小时）；<=0 关闭按时长清理。 */
  maxAgeHours?: number;
  /** 保留条数；<=0 关闭按条数清理。 */
  maxCount?: number;
  intervalMs?: number;
  /** binary 孤儿清理（#22）：与执行清理同周期、同 leader 门控;返回删除数。 */
  sweepOrphanBinaries?: () => Promise<number>;
}

/**
 * 执行历史清理器：周期删除过期的终态执行记录。
 *
 * 没有它，executions / execution_data 会无限增长——后者存的是整份 runData，
 * 单行可能很大，自托管长期运行必然撑爆库。这不是优化，是必需品。
 *
 * 与 WaitTracker 一样只在 leader 进程运行，避免多实例重复删。
 */
export class ExecutionPruner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private readonly maxAgeHours: number;
  private readonly maxCount: number;
  private readonly intervalMs: number;

  constructor(
    private readonly repos: Repositories,
    /** 仅 leader 执行清理；多实例下由 LeaderElection 保证唯一。 */
    private readonly isLeader: () => boolean,
    options: IExecutionPrunerOptions = {},
  ) {
    this.maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
    this.maxCount = options.maxCount ?? DEFAULT_MAX_COUNT;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.sweepOrphanBinaries = options.sweepOrphanBinaries;
  }

  private readonly sweepOrphanBinaries?: () => Promise<number>;

  /** 两条策略都关掉 = 整个清理器停用（自托管用户可显式选择无限保留）。
      有 binary 孤儿清理时,即便执行清理都关也保持定时器运转（孤儿仍要扫）。 */
  get enabled(): boolean {
    return this.maxAgeHours > 0 || this.maxCount > 0 || Boolean(this.sweepOrphanBinaries);
  }

  start(): void {
    if (this.timer || !this.enabled) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.(); // 不阻止进程退出
    void this.tick(); // 启动即清一次，别等满一个周期
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 单轮清理（测试可直接调用，无需等定时器）。返回删除条数。 */
  async tick(): Promise<number> {
    if (!this.enabled || this.running || !this.isLeader()) return 0;
    this.running = true;
    try {
      const deleted =
        this.maxAgeHours > 0 || this.maxCount > 0
          ? await this.repos.executions.prune({ maxAgeHours: this.maxAgeHours, maxCount: this.maxCount })
          : 0;
      if (deleted > 0) {
        console.log(`[nomops] 清理历史执行 ${deleted} 条`);
      }
      // binary 孤儿清理（#22;执行清理已在 delete 级联清引用,此处兜进程崩溃/旧数据残留）
      if (this.sweepOrphanBinaries) {
        const swept = await this.sweepOrphanBinaries().catch((e: Error) => {
          console.error('[nomops] binary 孤儿清理失败:', e.message);
          return 0;
        });
        if (swept > 0) console.log(`[nomops] 清理孤儿 binary ${swept} 个`);
      }
      return deleted;
    } catch (error) {
      // 清理失败不该影响任何业务流程，告警即可
      console.error('[nomops] 执行历史清理失败:', (error as Error).message);
      return 0;
    } finally {
      this.running = false;
    }
  }
}

/** 从环境变量读配置（显式 0 = 关闭该策略）。 */
export function prunerOptionsFromEnv(env: NodeJS.ProcessEnv): IExecutionPrunerOptions {
  const num = (key: string): number | undefined => {
    const raw = env[key];
    if (raw === undefined || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    maxAgeHours: num('NOMOPS_EXECUTIONS_MAX_AGE_HOURS'),
    maxCount: num('NOMOPS_EXECUTIONS_MAX_COUNT'),
    intervalMs: num('NOMOPS_EXECUTIONS_PRUNE_INTERVAL_MS'),
  };
}
