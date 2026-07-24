import { randomBytes } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import type { Repositories, ScheduledJob } from '@nomops/db';
import type { JsonObject } from '@nomops/workflow';

/**
 * DB 调度器（backlog #38 地基项）。取代 Schedule Trigger 的进程内闭包定时器：
 * 作业落库(nextRunAt)重启不丢;到期物化 task + 租约乐观锁抢占,多实例只触发一次。
 *
 * 与 leader 门的区别：不再"只 leader 起定时器"——所有实例都跑循环,靠 unique(jobId,
 * scheduledFor) + claimTask 的 leaseEpoch 乐观锁去重。leader 变更不再漏触发（修复旧设计
 * 只在激活时判 leader 的缺口）。fire/now/instanceId 均可注入,便于单测。
 */
export interface ScheduleConfig {
  mode: 'cron' | 'interval' | 'once';
  cron?: string;
  everySeconds?: number;
  fireAt?: string; // ISO，once 模式
}

/** 触发回调：跑作业对应的工作流,返回 executionId（失败抛出,由调度器按 maxAttempts 重试）。 */
export type SchedulerFire = (job: ScheduledJob) => Promise<string | null>;

/** 从配置 + 时区算下次触发时刻。once 触发过一次即返回 null（不再重复）。 */
export function computeNextRun(config: JsonObject, timezone: string, from: Date): Date | null {
  const c = config as unknown as ScheduleConfig;
  if (c.mode === 'interval') {
    const secs = Math.max(1, Number(c.everySeconds ?? 60));
    return new Date(from.getTime() + secs * 1000);
  }
  if (c.mode === 'once') {
    return null; // fireAt 作为初始 nextRunAt 由创建方设置;触发后不再有下次
  }
  // cron
  const expr = String(c.cron ?? '*/5 * * * *');
  const interval = CronExpressionParser.parse(expr, { currentDate: from, tz: timezone || 'UTC' });
  return interval.next().toDate();
}

export interface SchedulerOptions {
  pollMs?: number;
  leaseTtlMs?: number;
  now?: () => Date;
  instanceId?: string;
}

export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly instanceId: string;

  constructor(
    private readonly repos: Repositories,
    private readonly fire: SchedulerFire,
    private readonly opts: SchedulerOptions = {},
  ) {
    this.instanceId = opts.instanceId ?? `${process.pid}-${randomBytes(4).toString('hex')}`;
  }

  private now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  start(): void {
    const ms = this.opts.pollMs ?? 5000;
    this.timer = setInterval(() => void this.tick().catch((e: Error) => console.error('[nomops] 调度器 tick 失败:', e.message)), ms);
    this.timer.unref?.();
    void this.tick().catch(() => undefined);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 一轮：物化到期作业 → 认领 + 触发到期 task。返回本轮实际触发数（测试可断言）。 */
  async tick(): Promise<{ fired: number }> {
    const now = this.now();

    // 1) 到期作业 → 物化 task（去重）+ 推进 nextRunAt（从 scheduledFor 算,幂等）
    for (const job of await this.repos.scheduler.findDueJobs(now)) {
      if (!job.nextRunAt) continue;
      const scheduledFor = job.nextRunAt;
      await this.repos.scheduler.materializeTask(job.id, scheduledFor);
      const next = computeNextRun(job.config, job.timezone, scheduledFor);
      await this.repos.scheduler.updateJob(job.id, {
        nextRunAt: next,
        lastRunAt: now,
        ...(next === null ? { active: false } : {}), // once：触发后停用
      });
    }

    // 2) 认领到期 task（租约乐观锁）→ 触发
    let fired = 0;
    for (const task of await this.repos.scheduler.findClaimableTasks(now)) {
      const leaseExpiresAt = new Date(now.getTime() + (this.opts.leaseTtlMs ?? 60_000));
      const claimed = await this.repos.scheduler.claimTask(task.id, task.leaseEpoch, this.instanceId, leaseExpiresAt);
      if (!claimed) continue; // 被别的实例抢先——只触发一次的关键

      const job = await this.repos.scheduler.findJobById(task.jobId);
      if (!job) {
        await this.repos.scheduler.completeTask(task.id, null);
        continue;
      }
      try {
        const executionId = await this.fire(job);
        await this.repos.scheduler.completeTask(task.id, executionId);
        fired++;
      } catch (e) {
        const retry = claimed.attempts < job.maxAttempts;
        await this.repos.scheduler.failTask(task.id, (e as Error).message, retry);
      }
    }
    return { fired };
  }
}
