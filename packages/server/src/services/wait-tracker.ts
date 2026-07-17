import type { Repositories } from '@nomops/db';
import type { ExecutionService } from './execution-service.js';

/**
 * 等待唤醒器：周期扫描到点的 waiting 执行并续跑。
 * 只在 leader 进程运行（多实例下由 LeaderElection 保证唯一）；
 * 等外部信号（waitTill=null）的执行不归它管，由 resume API 唤醒。
 */
export class WaitTracker {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 正在唤醒中的执行（防同一 tick 内重复触发）。 */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly repos: Repositories,
    private readonly executions: ExecutionService,
    private readonly intervalMs = 10_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.(); // 不阻止进程退出
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 单轮扫描（测试可直接调用，无需等定时器）。 */
  async tick(): Promise<void> {
    const due = await this.repos.executions.findDueWaiting(new Date());
    for (const execution of due) {
      if (this.inFlight.has(execution.id)) continue;
      this.inFlight.add(execution.id);
      try {
        await this.executions.resume(execution.id);
      } catch (error) {
        console.error(`[nomops] 唤醒执行失败 ${execution.id}:`, (error as Error).message);
      } finally {
        this.inFlight.delete(execution.id);
      }
    }
  }
}
