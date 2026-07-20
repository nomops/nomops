import { describe, expect, it } from 'vitest';
import type { Repositories } from '@nomops/db';
import { ExecutionPruner, prunerOptionsFromEnv } from '../services/execution-pruner.js';

/**
 * 清理器的调度语义（清理本身的正确性在 @nomops/db 的 execution-pruning 用例里守）。
 * 关注三件事：只有 leader 干活、可被显式停用、失败不外溢。
 */
function fakeRepos(prune: (o: unknown) => Promise<number>): Repositories {
  return { executions: { prune } } as unknown as Repositories;
}

describe('ExecutionPruner — 调度与门控', () => {
  it('非 leader 不清理（多实例下只由 leader 删）', async () => {
    let called = false;
    const pruner = new ExecutionPruner(
      fakeRepos(async () => {
        called = true;
        return 3;
      }),
      () => false,
      { maxAgeHours: 24 },
    );

    expect(await pruner.tick()).toBe(0);
    expect(called).toBe(false);
  });

  it('leader 清理并返回删除条数', async () => {
    const pruner = new ExecutionPruner(fakeRepos(async () => 7), () => true, { maxAgeHours: 24 });

    expect(await pruner.tick()).toBe(7);
  });

  it('把配置原样传给仓储', async () => {
    let seen: unknown;
    const pruner = new ExecutionPruner(
      fakeRepos(async (o) => {
        seen = o;
        return 0;
      }),
      () => true,
      { maxAgeHours: 12, maxCount: 500 },
    );

    await pruner.tick();
    expect(seen).toEqual({ maxAgeHours: 12, maxCount: 500 });
  });

  it('两条策略都关掉 = 停用（自托管可显式选择无限保留）', async () => {
    let called = false;
    const pruner = new ExecutionPruner(
      fakeRepos(async () => {
        called = true;
        return 1;
      }),
      () => true,
      { maxAgeHours: 0, maxCount: 0 },
    );

    expect(pruner.enabled).toBe(false);
    expect(await pruner.tick()).toBe(0);
    expect(called).toBe(false);
    pruner.start(); // 停用时 start() 不应装上定时器
    pruner.stop();
  });

  it('缺省启用（不配置也要有兜底保留策略）', () => {
    const pruner = new ExecutionPruner(fakeRepos(async () => 0), () => true);

    expect(pruner.enabled).toBe(true);
  });

  it('清理失败不抛出，只告警（不该影响任何业务流程）', async () => {
    const pruner = new ExecutionPruner(
      fakeRepos(async () => {
        throw new Error('db down');
      }),
      () => true,
      { maxAgeHours: 1 },
    );

    await expect(pruner.tick()).resolves.toBe(0);
  });

  it('上一轮未跑完时跳过本轮（长清理不叠加）', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const pruner = new ExecutionPruner(
      fakeRepos(async () => {
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return 1;
      }),
      () => true,
      { maxAgeHours: 1 },
    );

    const [a, b] = await Promise.all([pruner.tick(), pruner.tick()]);
    expect(maxConcurrent).toBe(1);
    expect([a, b].sort()).toEqual([0, 1]);
  });
});

describe('prunerOptionsFromEnv — 环境变量解析', () => {
  it('读三个变量', () => {
    expect(
      prunerOptionsFromEnv({
        NOMOPS_EXECUTIONS_MAX_AGE_HOURS: '72',
        NOMOPS_EXECUTIONS_MAX_COUNT: '2000',
        NOMOPS_EXECUTIONS_PRUNE_INTERVAL_MS: '60000',
      }),
    ).toEqual({ maxAgeHours: 72, maxCount: 2000, intervalMs: 60_000 });
  });

  it('未设置的项返回 undefined，让构造函数用缺省值', () => {
    expect(prunerOptionsFromEnv({})).toEqual({
      maxAgeHours: undefined,
      maxCount: undefined,
      intervalMs: undefined,
    });
  });

  it('显式 0 被保留（用户就是想关掉某条策略）', () => {
    expect(prunerOptionsFromEnv({ NOMOPS_EXECUTIONS_MAX_AGE_HOURS: '0' }).maxAgeHours).toBe(0);
  });

  it('非法值当作未设置', () => {
    expect(prunerOptionsFromEnv({ NOMOPS_EXECUTIONS_MAX_COUNT: 'abc' }).maxCount).toBeUndefined();
  });
});
