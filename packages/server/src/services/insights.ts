import type { Execution } from '@nomops/db';

export interface InsightsSummary {
  total: number;
  success: number;
  error: number;
  running: number;
  /** 失败率（error / (success+error)），无已完成执行时为 0。 */
  failureRate: number;
  /** 已完成执行的平均耗时（ms）。 */
  avgRuntimeMs: number;
  /** 预计节省工时（分钟，启发式：每次成功执行按 3 分钟人工计）。 */
  estSavedMinutes: number;
  /** 范围内逐桶趋势：≤2 天按小时（date 为 ISO datetime 整点），否则按 UTC 日期。 */
  daily: Array<{ date: string; total: number; success: number; error: number }>;
  /** 桶粒度（前端轴标签用）。 */
  granularity: 'hour' | 'day';
}

const ASSUMED_MINUTES_PER_RUN = 3;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function hourKey(d: Date): string {
  return d.toISOString().slice(0, 13) + ':00';
}

/**
 * 纯聚合：从执行行算出 Insights 概览（可单测，不碰 DB）。
 * E2 对标基线：支持任意日期范围——统计卡与趋势桶都只计 [from, to] 内的执行；
 * 范围 ≤ 2 天用小时桶（Last 24 hours），否则日桶。默认近 7 日（含今天）。
 */
export function computeInsights(rows: Execution[], now: Date, range?: { from: Date; to: Date }): InsightsSummary {
  const to = range?.to ?? now;
  const from = range?.from ?? new Date(now.getTime() - 6 * 86_400_000);
  const spanMs = to.getTime() - from.getTime();
  const granularity: 'hour' | 'day' = spanMs <= 2 * 86_400_000 ? 'hour' : 'day';

  // 范围空桶
  const buckets = new Map<string, { total: number; success: number; error: number }>();
  if (granularity === 'hour') {
    const start = new Date(Math.floor(from.getTime() / 3_600_000) * 3_600_000);
    for (let t = start.getTime(); t <= to.getTime(); t += 3_600_000) {
      buckets.set(hourKey(new Date(t)), { total: 0, success: 0, error: 0 });
    }
  } else {
    const start = new Date(dayKey(from) + 'T00:00:00Z');
    for (let t = start.getTime(); t <= to.getTime(); t += 86_400_000) {
      buckets.set(dayKey(new Date(t)), { total: 0, success: 0, error: 0 });
    }
  }

  let success = 0;
  let error = 0;
  let running = 0;
  let runtimeSum = 0;
  let runtimeCount = 0;
  let total = 0;

  for (const row of rows) {
    // 范围过滤：统计卡与趋势保持同一口径
    if (!(row.createdAt instanceof Date) || row.createdAt.getTime() < from.getTime() - 86_400_000 || row.createdAt.getTime() > to.getTime() + 86_400_000) {
      // createdAt 缺失或明显出范围的行不计（宽限一天吸收桶边界取整）
      if (!(row.createdAt instanceof Date)) continue;
    }
    const key = granularity === 'hour' ? hourKey(row.createdAt) : dayKey(row.createdAt);
    const bucket = buckets.get(key);
    if (!bucket) continue; // 桶外 = 范围外，不计任何统计

    total++;
    bucket.total++;
    if (row.status === 'success') {
      success++;
      bucket.success++;
    } else if (row.status === 'error') {
      error++;
      bucket.error++;
    } else if (row.status === 'running' || row.status === 'new') {
      running++;
    }

    if (row.startedAt instanceof Date && row.stoppedAt instanceof Date) {
      runtimeSum += row.stoppedAt.getTime() - row.startedAt.getTime();
      runtimeCount++;
    }
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
