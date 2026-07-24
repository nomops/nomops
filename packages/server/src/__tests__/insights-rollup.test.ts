import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations, createRepositories, type DatabaseHandle, type Repositories } from '@nomops/db';
import { InsightsService } from '../services/insights-service.js';

/**
 * backlog #39b：Insights 卷积 —— 旧 raw 折进 by_period + 剪旧,读取合并两源数字不变。
 */
let handle: DatabaseHandle;
let repos: Repositories;

beforeEach(async () => {
  handle = await createDatabase({ type: 'sqlite' });
  await runMigrations(handle);
  repos = createRepositories(handle);
});
afterEach(async () => {
  await handle.close();
});

const seed = (at: string, status: string, runtimeMs: number | null) =>
  repos.insights.recordEvent({
    executionId: `e-${at}-${status}`,
    workflowId: 'wf-1',
    projectId: 'proj-1',
    status,
    runtimeMs,
    at: new Date(at),
    workflowName: 'WF',
    projectName: 'Proj',
  });

describe('Insights 卷积（backlog #39b）', () => {
  it('卷积旧 raw → by_period + 剪旧;summary 合并两源数字不变', async () => {
    const now = new Date('2026-02-01T12:00:00Z'); // 边界 = 2026-01-25T00:00:00Z（-7 天）
    const svc = new InsightsService(repos, { now: () => now, retentionDays: 7 });

    await seed('2026-01-10T00:00:00Z', 'success', 100); // 旧（应卷积）
    await seed('2026-01-30T00:00:00Z', 'error', 200); // 近期（留 raw）

    const from = new Date('2026-01-01T00:00:00Z');
    const before = await svc.summary(from, now);
    expect(before).toMatchObject({ total: 2, success: 1, error: 1, avgRuntimeMs: 150 });

    // 卷积
    const r = await svc.rollup();
    expect(r).toEqual({ rolled: 1, pruned: 1 });

    // raw 只剩近期一条;by_period 有旧日桶
    const raw = await repos.insights.findRawInRange(from, now);
    expect(raw.length).toBe(1);
    const periods = await repos.insights.findPeriodsInRange('2026-01-01', '2026-02-01');
    expect(periods.find((p) => p.period === '2026-01-10')).toMatchObject({ total: 1, success: 1, runtimeSum: 100, runtimeCount: 1 });

    // summary 卷积后合并 by_period + raw,数字不变
    const after = await svc.summary(from, now);
    expect(after).toMatchObject({ total: 2, success: 1, error: 1, avgRuntimeMs: 150 });
    // 趋势日桶：旧日与近期日各有一条
    expect(after.daily.find((d) => d.date === '2026-01-10')?.total).toBe(1);
    expect(after.daily.find((d) => d.date === '2026-01-30')?.total).toBe(1);
  });

  it('近期范围（小时粒度）不受卷积影响,只读 raw', async () => {
    const now = new Date('2026-02-01T12:00:00Z');
    const svc = new InsightsService(repos, { now: () => now, retentionDays: 7 });
    await seed('2026-02-01T10:00:00Z', 'success', 50);
    await svc.rollup(); // 近期不该被卷积
    const s = await svc.summary(new Date('2026-01-31T12:00:00Z'), now); // 24h → hour 粒度
    expect(s.granularity).toBe('hour');
    expect(s.total).toBe(1);
  });
});
