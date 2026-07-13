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
  /** 近 7 日逐日趋势（UTC 日期）。 */
  daily: Array<{ date: string; total: number; success: number; error: number }>;
}

const ASSUMED_MINUTES_PER_RUN = 3;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 纯聚合：从执行行算出 Insights 概览（可单测，不碰 DB）。 */
export function computeInsights(rows: Execution[], now: Date): InsightsSummary {
  let success = 0;
  let error = 0;
  let running = 0;
  let runtimeSum = 0;
  let runtimeCount = 0;

  // 近 7 日空桶（含今天）
  const buckets = new Map<string, { total: number; success: number; error: number }>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    buckets.set(dayKey(d), { total: 0, success: 0, error: 0 });
  }

  for (const row of rows) {
    if (row.status === 'success') success++;
    else if (row.status === 'error') error++;
    else if (row.status === 'running' || row.status === 'new') running++;

    if (row.startedAt instanceof Date && row.stoppedAt instanceof Date) {
      runtimeSum += row.stoppedAt.getTime() - row.startedAt.getTime();
      runtimeCount++;
    }

    if (row.createdAt instanceof Date) {
      const bucket = buckets.get(dayKey(row.createdAt));
      if (bucket) {
        bucket.total++;
        if (row.status === 'success') bucket.success++;
        else if (row.status === 'error') bucket.error++;
      }
    }
  }

  const completed = success + error;
  return {
    total: rows.length,
    success,
    error,
    running,
    failureRate: completed > 0 ? error / completed : 0,
    avgRuntimeMs: runtimeCount > 0 ? Math.round(runtimeSum / runtimeCount) : 0,
    estSavedMinutes: success * ASSUMED_MINUTES_PER_RUN,
    daily: [...buckets.entries()].map(([date, v]) => ({ date, ...v })),
  };
}
