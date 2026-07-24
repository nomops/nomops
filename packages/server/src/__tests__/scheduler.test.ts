import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations, createRepositories, type DatabaseHandle, type Repositories } from '@nomops/db';
import { SchedulerService, computeNextRun } from '../services/scheduler-service.js';

/**
 * backlog #38a：DB 调度器引擎 —— 下次时刻计算、多实例只触发一次、重启恢复、失败重试。
 * 用内存 sqlite 真库验证租约乐观锁的原子性。
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

const seedJob = (nextRunAt: Date, extra: Record<string, unknown> = {}) =>
  repos.scheduler.createJob({
    kind: 'workflow-schedule',
    workflowId: 'wf-1',
    nodeName: 'Schedule',
    config: { mode: 'interval', everySeconds: 60 },
    nextRunAt,
    maxAttempts: 1,
    ...extra,
  });

describe('computeNextRun（#38a）', () => {
  it('interval：+everySeconds', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(computeNextRun({ mode: 'interval', everySeconds: 30 }, 'UTC', from)).toEqual(new Date('2026-01-01T00:00:30Z'));
  });
  it('cron：下一个匹配时刻（每小时整点）', () => {
    const from = new Date('2026-01-01T10:15:00Z');
    expect(computeNextRun({ mode: 'cron', cron: '0 * * * *' }, 'UTC', from)).toEqual(new Date('2026-01-01T11:00:00Z'));
  });
  it('once：触发后无下次', () => {
    expect(computeNextRun({ mode: 'once' }, 'UTC', new Date())).toBeNull();
  });
});

describe('SchedulerService（#38a）', () => {
  it('单实例：到期作业触发一次并推进 nextRunAt', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const job = await seedJob(t0);
    const fired: string[] = [];
    const sched = new SchedulerService(repos, async (j) => {
      fired.push(j.id);
      return 'exec-1';
    }, { now: () => new Date('2026-01-01T00:00:05Z'), instanceId: 'A' });

    const r = await sched.tick();
    expect(r.fired).toBe(1);
    expect(fired).toEqual([job.id]);
    // nextRunAt 从 scheduledFor(t0) 推进了 60s，并持久化
    const after = await repos.scheduler.findJobById(job.id);
    expect(after!.nextRunAt).toEqual(new Date('2026-01-01T00:01:00Z'));
    // task 落 done + executionId
    const tasks = await repos.scheduler.listTasksForJob(job.id);
    expect(tasks[0]).toMatchObject({ status: 'done', executionId: 'exec-1' });
  });

  it('多实例并发同一到期作业只触发一次（租约乐观锁）', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    await seedJob(t0);
    const now = () => new Date('2026-01-01T00:00:05Z');
    let fireCount = 0;
    const mk = (id: string) => new SchedulerService(repos, async () => { fireCount++; return `e-${id}`; }, { now, instanceId: id });
    const a = mk('A');
    const b = mk('B');
    // 两实例都跑一轮
    const [ra, rb] = [await a.tick(), await b.tick()];
    expect(fireCount).toBe(1);
    expect(ra.fired + rb.fired).toBe(1);
  });

  it('claim 原子性：同一 task 两次认领,第二次落空', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const job = await seedJob(t0);
    await repos.scheduler.materializeTask(job.id, t0);
    const [task] = await repos.scheduler.findClaimableTasks(new Date('2026-01-01T00:00:05Z'));
    const lease = new Date('2026-01-01T00:01:05Z');
    const first = await repos.scheduler.claimTask(task!.id, task!.leaseEpoch, 'A', lease);
    const second = await repos.scheduler.claimTask(task!.id, task!.leaseEpoch, 'B', lease);
    expect(first).not.toBeNull();
    expect(second).toBeNull(); // epoch 已被 A +1，B 落空
  });

  it('重启恢复：nextRunAt 持久化,新实例接着从该时刻触发', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const job = await seedJob(t0);
    // 第一次触发,nextRunAt 推进到 00:01:00
    await new SchedulerService(repos, async () => 'e1', { now: () => new Date('2026-01-01T00:00:05Z'), instanceId: 'A' }).tick();
    expect((await repos.scheduler.findJobById(job.id))!.nextRunAt).toEqual(new Date('2026-01-01T00:01:00Z'));

    // “重启”：全新 SchedulerService 实例（同库）——到 00:01:05 再触发
    let fired = 0;
    const fresh = new SchedulerService(repos, async () => { fired++; return 'e2'; }, { now: () => new Date('2026-01-01T00:01:05Z'), instanceId: 'B' });
    await fresh.tick();
    expect(fired).toBe(1);
    expect((await repos.scheduler.findJobById(job.id))!.nextRunAt).toEqual(new Date('2026-01-01T00:02:00Z'));
  });

  it('失败重试：fire 抛错 + maxAttempts=2 → task 回 pending,下轮成功', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    await seedJob(t0, { maxAttempts: 2 });
    let calls = 0;
    const sched = new SchedulerService(
      repos,
      async () => {
        calls++;
        if (calls === 1) throw new Error('boom');
        return 'ok';
      },
      { now: () => new Date('2026-01-01T00:00:05Z'), instanceId: 'A' },
    );
    await sched.tick(); // 第一轮：物化+触发失败→回 pending
    await sched.tick(); // 第二轮：重试成功
    expect(calls).toBe(2);
  });
});
