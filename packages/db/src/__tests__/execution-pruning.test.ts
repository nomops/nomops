import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, type DatabaseHandle } from '../client.js';
import { runMigrations } from '../migrate.js';
import { createRepositories, type Repositories } from '../repositories.js';

/**
 * 执行历史清理（ExecutionRepository.prune）。
 *
 * executions / execution_data 无限增长是自托管长期运行的必然故障——后者存整份
 * runData，单行可能很大。两条策略（时长 + 条数）取并集，红线是：
 * 非终态执行（waiting / running / new）绝不能被删，删了就再也唤不醒。
 *
 * 跑在两种方言上：按条数清理刻意绕开了 SQL OFFSET（SQLite 要求它与 LIMIT 同现），
 * 这组用例就是那个决定的守卫。
 */
const dialects = ['sqlite', 'postgres'] as const;

describe.each(dialects)('执行历史清理 @ %s', (type) => {
  let handle: DatabaseHandle;
  let repos: Repositories;
  let workflowId: string;

  beforeAll(async () => {
    handle = await createDatabase({ type });
    await runMigrations(handle);
    repos = createRepositories(handle);
    const project = await repos.projects.create({ name: 'prune-proj' });
    const wf = await repos.workflows.create({ name: 'wf', nodes: [], connections: {} }, project.id);
    workflowId = wf.id;
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await handle.db.delete(handle.schema.executionData);
    await handle.db.delete(handle.schema.executions);
  });

  /** 建一条执行，可指定状态与「多少小时前创建」。 */
  async function seed(status: string, hoursAgo = 0): Promise<string> {
    const exec = await repos.executions.create(
      { workflowId, status, mode: 'manual' },
      { workflowData: { name: 'wf' }, data: { resultData: { runData: {} } } },
    );
    if (hoursAgo > 0) {
      await handle.db
        .update(handle.schema.executions)
        .set({ createdAt: new Date(Date.now() - hoursAgo * 3_600_000) })
        .where(eq(handle.schema.executions.id, exec.id));
    }
    return exec.id;
  }

  async function remainingIds(): Promise<string[]> {
    const rows = await handle.db
      .select({ id: handle.schema.executions.id })
      .from(handle.schema.executions);
    return (rows as Array<{ id: string }>).map((r) => r.id);
  }

  async function hasDataRow(id: string): Promise<boolean> {
    const rows = await handle.db
      .select({ id: handle.schema.executionData.executionId })
      .from(handle.schema.executionData)
      .where(eq(handle.schema.executionData.executionId, id));
    return rows.length > 0;
  }

  describe('按时长', () => {
    it('早于保留期的终态执行被删，期内的保留', async () => {
      const old = await seed('success', 48);
      const fresh = await seed('success', 1);

      expect(await repos.executions.prune({ maxAgeHours: 24 })).toBe(1);
      expect(await remainingIds()).toEqual([fresh]);
      // execution_data 无 FK 约束，必须手动级联，否则孤儿行照样撑爆库
      expect(await hasDataRow(old)).toBe(false);
    });

    it('0 或缺省时不按时长删', async () => {
      await seed('success', 9999);

      expect(await repos.executions.prune({ maxAgeHours: 0 })).toBe(0);
      expect(await repos.executions.prune({})).toBe(0);
      expect(await remainingIds()).toHaveLength(1);
    });
  });

  describe('按条数', () => {
    it('只保留最近 N 条，更旧的删掉', async () => {
      const oldest = await seed('success', 3);
      const middle = await seed('success', 2);
      const newest = await seed('success', 1);

      expect(await repos.executions.prune({ maxCount: 2 })).toBe(1);
      const left = await remainingIds();
      expect(left).toHaveLength(2);
      expect(left).toEqual(expect.arrayContaining([newest, middle]));
      expect(left).not.toContain(oldest);
    });

    it('未超过上限时不删', async () => {
      await seed('success', 2);
      await seed('success', 1);

      expect(await repos.executions.prune({ maxCount: 5 })).toBe(0);
      expect(await remainingIds()).toHaveLength(2);
    });
  });

  describe('★非终态执行不可删', () => {
    it('waiting / running / new 无论多老都保留', async () => {
      const waiting = await seed('waiting', 9999);
      const running = await seed('running', 9999);
      const fresh = await seed('new', 9999);
      const done = await seed('success', 9999);

      expect(await repos.executions.prune({ maxAgeHours: 1, maxCount: 1 })).toBe(1);
      const left = await remainingIds();
      expect(left).toHaveLength(3);
      expect(left).toEqual(expect.arrayContaining([waiting, running, fresh]));
      expect(left).not.toContain(done);
    });

    it('canceled 视为终态，可被清理', async () => {
      await seed('canceled', 9999);

      expect(await repos.executions.prune({ maxAgeHours: 1 })).toBe(1);
    });
  });

  describe('两条策略并集', () => {
    it('任一策略命中即删，不重复计数', async () => {
      await seed('success', 100);
      await seed('success', 3);
      await seed('success', 2);
      const newest = await seed('success', 1);

      expect(await repos.executions.prune({ maxAgeHours: 24, maxCount: 1 })).toBe(3);
      expect(await remainingIds()).toEqual([newest]);
    });
  });
});
