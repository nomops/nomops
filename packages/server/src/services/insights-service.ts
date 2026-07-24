import type { Repositories, InsightsRawEvent, InsightsPeriodRow } from '@nomops/db';
import type { InsightsSummary } from './insights.js';

/**
 * Insights 预聚合管线（backlog #39b）：卷积旧 raw → 日桶(insights_by_period)并剪旧 raw,
 * 让 insights_raw 保持有界;读取合并 by_period(旧) + 未卷积 raw(近期)。
 *
 * 卷积边界取整到 UTC 日：raw 只留最近 RETENTION_DAYS 天(全保真,可小时视图),更早折进日桶。
 * findRawInRange 只返回未卷积 raw,by_period 持已卷积 → 两源天然不重叠。now 可注入测试。
 */
const RETENTION_DAYS = 7;
const ASSUMED_MINUTES_PER_RUN = 3;

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
const hourKey = (d: Date): string => d.toISOString().slice(0, 13) + ':00';

export class InsightsService {
  constructor(
    private readonly repos: Repositories,
    private readonly opts: { now?: () => Date; retentionDays?: number } = {},
  ) {}

  private now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  /** 卷积边界：今天(UTC)往前 retentionDays 天的 00:00。早于此的 raw 折进日桶。 */
  private boundary(): Date {
    const days = this.opts.retentionDays ?? RETENTION_DAYS;
    const today = new Date(dayKey(this.now()) + 'T00:00:00Z');
    return new Date(today.getTime() - days * 86_400_000);
  }

  /** 卷积：把边界前未卷积的 raw 按项目×日累加进 by_period,标记并剪除。返回处理数。 */
  async rollup(): Promise<{ rolled: number; pruned: number }> {
    const before = this.boundary();
    const events = await this.repos.insights.findUnrolledBefore(before);
    // 按 项目×日 聚合
    const buckets = new Map<string, { projectId: string; period: string; total: number; success: number; error: number; runtimeSum: number; runtimeCount: number }>();
    for (const ev of events) {
      const period = dayKey(ev.at);
      const key = `${ev.projectId}|${period}`;
      let b = buckets.get(key);
      if (!b) {
        b = { projectId: ev.projectId, period, total: 0, success: 0, error: 0, runtimeSum: 0, runtimeCount: 0 };
        buckets.set(key, b);
      }
      b.total++;
      if (ev.status === 'success') b.success++;
      else if (ev.status === 'error') b.error++;
      if (ev.runtimeMs != null) {
        b.runtimeSum += ev.runtimeMs;
        b.runtimeCount++;
      }
    }
    for (const b of buckets.values()) {
      await this.repos.insights.addToPeriod(b.projectId, b.period, {
        total: b.total,
        success: b.success,
        error: b.error,
        runtimeSum: b.runtimeSum,
        runtimeCount: b.runtimeCount,
      });
    }
    await this.repos.insights.markRolledUp(events.map((e) => e.id));
    const pruned = await this.repos.insights.pruneRolledBefore(before);
    return { rolled: events.length, pruned };
  }

  /** 合并 raw + by_period 聚合出 Insights 概览（读路径）。 */
  async summary(from: Date, to: Date, projectId?: string): Promise<InsightsSummary> {
    const now = this.now();
    const spanMs = to.getTime() - from.getTime();
    const granularity: 'hour' | 'day' = spanMs <= 2 * 86_400_000 ? 'hour' : 'day';

    // 略前扩一天吸收桶边界
    const rawEvents = await this.repos.insights.findRawInRange(new Date(from.getTime() - 86_400_000), to, projectId);
    // 小时粒度只可能落在近期(全在 raw);日粒度才需并入 by_period 旧日桶
    const periodRows = granularity === 'day' ? await this.repos.insights.findPeriodsInRange(dayKey(from), dayKey(to), projectId) : [];

    return aggregate(rawEvents, periodRows, now, { from, to }, granularity);
  }
}

/** 单遍聚合：raw 事件(逐条) + by_period(日汇总) → InsightsSummary。 */
function aggregate(
  rawEvents: InsightsRawEvent[],
  periodRows: InsightsPeriodRow[],
  _now: Date,
  range: { from: Date; to: Date },
  granularity: 'hour' | 'day',
): InsightsSummary {
  const buckets = new Map<string, { total: number; success: number; error: number }>();
  const bucketOf = (d: Date): string => (granularity === 'hour' ? hourKey(d) : dayKey(d));
  // 建空桶
  if (granularity === 'hour') {
    const start = Math.floor(range.from.getTime() / 3_600_000) * 3_600_000;
    for (let t = start; t <= range.to.getTime(); t += 3_600_000) buckets.set(hourKey(new Date(t)), { total: 0, success: 0, error: 0 });
  } else {
    const start = new Date(dayKey(range.from) + 'T00:00:00Z').getTime();
    for (let t = start; t <= range.to.getTime(); t += 86_400_000) buckets.set(dayKey(new Date(t)), { total: 0, success: 0, error: 0 });
  }

  let total = 0;
  let success = 0;
  let error = 0;
  let running = 0;
  let runtimeSum = 0;
  let runtimeCount = 0;

  for (const ev of rawEvents) {
    const b = buckets.get(bucketOf(ev.at));
    if (!b) continue;
    total++;
    b.total++;
    if (ev.status === 'success') {
      success++;
      b.success++;
    } else if (ev.status === 'error') {
      error++;
      b.error++;
    } else if (ev.status === 'running' || ev.status === 'new') {
      running++;
    }
    if (ev.runtimeMs != null) {
      runtimeSum += ev.runtimeMs;
      runtimeCount++;
    }
  }

  for (const p of periodRows) {
    const b = buckets.get(p.period); // period 是 'YYYY-MM-DD'，与日桶键一致
    if (b) {
      b.total += p.total;
      b.success += p.success;
      b.error += p.error;
    }
    total += p.total;
    success += p.success;
    error += p.error;
    runtimeSum += p.runtimeSum;
    runtimeCount += p.runtimeCount;
  }

  const completed = success + error;
  return {
    total,
    success,
    error,
    running,
    failureRate: completed > 0 ? error / completed : 0,
    avgRuntimeMs: runtimeCount > 0 ? Math.round(runtimeSum / runtimeCount) : 0,
    estSavedMinutes: success * ASSUMED_MINUTES_PER_RUN,
    daily: [...buckets.entries()].map(([date, v]) => ({ date, ...v })),
    granularity,
  };
}
