import { describe, expect, it } from 'vitest';
import {
  ConcurrencyGate,
  DEFAULT_PRODUCTION_LIMIT,
  UNLIMITED,
  concurrencyLimitFromEnv,
  queueDepthFromEnv,
} from '../services/concurrency-gate.js';

/**
 * 实例级并发闸门（B7）。
 *
 * 两级响应：超出并发上限的排队等待，连队列也满了才拒绝（503）。所以用例分两组：
 * 「排队」这一级要证明不丢执行、不饿死；「上界」这一级要证明它真的会拒绝——
 * 无界排队看着温和，实则仍是 OOM 路径。外加那条不能受管的模式（error）。
 */

/** 跑一个占住槽位 ms 毫秒的执行。 */
async function occupy(gate: ConcurrencyGate, mode: Parameters<ConcurrencyGate['acquire']>[0], ms = 0) {
  await gate.acquire(mode);
  try {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  } finally {
    gate.release(mode);
  }
}

describe('闸门开关', () => {
  it('-1 = 不限，闸门整体停用', () => {
    const gate = new ConcurrencyGate(UNLIMITED);

    expect(gate.enabled).toBe(false);
  });

  it('0 无意义（等于永久阻塞），按不限处理而非把实例卡死', () => {
    expect(new ConcurrencyGate(0).enabled).toBe(false);
  });

  it('小于 -1 的怪值同样按不限处理', () => {
    expect(new ConcurrencyGate(-99).enabled).toBe(false);
  });

  it('不限时任意并发都不排队', async () => {
    const gate = new ConcurrencyGate(UNLIMITED);

    await Promise.all(Array.from({ length: 50 }, () => gate.acquire('webhook')));
    expect(gate.active).toBe(0); // 未受管 → 不计数
    expect(gate.waiting).toBe(0);
  });
});

describe('受管模式', () => {
  it('webhook / trigger / chat / mcp 受管（外部可触发的都算生产流量）', async () => {
    for (const mode of ['webhook', 'trigger', 'chat', 'mcp'] as const) {
      const gate = new ConcurrencyGate(1);
      await gate.acquire(mode);
      expect(gate.active, mode).toBe(1);
    }
  });

  it('★error 不受管：否则槽位被失败执行占满时，处理它们的错误流永远等不到槽位（死锁）', async () => {
    const gate = new ConcurrencyGate(1);
    await gate.acquire('webhook'); // 槽位占满

    // 错误流必须立刻放行，不能挂起
    await expect(
      Promise.race([
        gate.acquire('error').then(() => 'passed'),
        new Promise((r) => setTimeout(() => r('blocked'), 50)),
      ]),
    ).resolves.toBe('passed');
  });

  it('retry 不受管（用户手动发起，不该被生产流量堵住）', async () => {
    const gate = new ConcurrencyGate(1);
    await gate.acquire('webhook');

    await expect(
      Promise.race([
        gate.acquire('retry').then(() => 'passed'),
        new Promise((r) => setTimeout(() => r('blocked'), 50)),
      ]),
    ).resolves.toBe('passed');
  });
});

describe('排队而非拒绝', () => {
  it('超限的执行挂起等待，槽位释放后继续（一个都不丢）', async () => {
    const gate = new ConcurrencyGate(2);
    const order: number[] = [];

    const runs = [0, 1, 2, 3, 4].map(async (i) => {
      await gate.acquire('webhook');
      order.push(i);
      await new Promise((r) => setTimeout(r, 10));
      gate.release('webhook');
    });

    // 起跑瞬间只有 2 个拿到槽位
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual([0, 1]);
    expect(gate.waiting).toBe(3);

    await Promise.all(runs);
    expect(order).toHaveLength(5); // 全部跑完，无一被拒
    expect(gate.active).toBe(0);
    expect(gate.waiting).toBe(0);
  });

  it('★任意时刻并发不超过上限', async () => {
    // 队列给足,本例只验并发天花板;上界另有一组用例
    const gate = new ConcurrencyGate(3, 30);
    let inFlight = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 30 }, async () => {
        await gate.acquire('webhook');
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        gate.release('webhook');
      }),
    );

    expect(peak).toBe(3);
    expect(gate.active).toBe(0);
  });

  it('FIFO：先到先得，后来的不插队（防饿死）', async () => {
    const gate = new ConcurrencyGate(1, 10);
    const finished: string[] = [];

    await gate.acquire('webhook'); // 占满
    const queued = ['a', 'b', 'c'].map(async (tag) => {
      await gate.acquire('webhook');
      finished.push(tag);
      gate.release('webhook');
    });

    await new Promise((r) => setTimeout(r, 5));
    gate.release('webhook'); // 放行队首
    await Promise.all(queued);

    expect(finished).toEqual(['a', 'b', 'c']);
  });

  it('未受管模式的 release 不会误伤计数', async () => {
    const gate = new ConcurrencyGate(2);
    await gate.acquire('webhook');
    expect(gate.active).toBe(1);

    gate.release('error'); // 未受管，应为 no-op
    expect(gate.active).toBe(1);
  });

  it('多余的 release 不会把计数压成负数', () => {
    const gate = new ConcurrencyGate(2);

    gate.release('webhook');
    gate.release('webhook');
    expect(gate.active).toBe(0);
  });
});

describe('★队列上界', () => {
  it('队列满了就拒绝，而不是继续堆积（无界排队仍是 OOM 路径）', async () => {
    const gate = new ConcurrencyGate(1, 2); // 1 并发 + 最多 2 个排队
    await gate.acquire('webhook'); // 占满槽位
    void gate.acquire('webhook'); // 排队 1
    void gate.acquire('webhook'); // 排队 2
    await new Promise((r) => setTimeout(r, 5));
    expect(gate.waiting).toBe(2);

    await expect(gate.acquire('webhook')).rejects.toThrow(/at capacity/i);
    expect(gate.waiting).toBe(2); // 被拒的没有进队列
  });

  it('拒绝时带 503 + Retry-After，让调用方退避而非立刻重试', async () => {
    const gate = new ConcurrencyGate(1, 0); // 不排队,满即拒
    await gate.acquire('webhook');

    try {
      await gate.acquire('webhook');
      expect.unreachable('应该抛出');
    } catch (error) {
      expect((error as { context: Record<string, unknown> }).context).toMatchObject({
        status: 503,
        retryAfter: expect.any(Number),
        active: 1,
      });
    }
  });

  it('腾出槽位后又能接受新请求（拒绝是暂时的）', async () => {
    const gate = new ConcurrencyGate(1, 0);
    await gate.acquire('webhook');
    await expect(gate.acquire('webhook')).rejects.toThrow();

    gate.release('webhook');
    await expect(gate.acquire('webhook')).resolves.toBeUndefined();
  });

  it('缺省队列深度 = 2× 并发上限', async () => {
    const gate = new ConcurrencyGate(2); // → 队列 4
    await Promise.all([gate.acquire('webhook'), gate.acquire('webhook')]);
    for (let i = 0; i < 4; i++) void gate.acquire('webhook');
    await new Promise((r) => setTimeout(r, 5));

    expect(gate.waiting).toBe(4);
    await expect(gate.acquire('webhook')).rejects.toThrow(/at capacity/i);
  });

  it('不受管的模式不受队列上界影响（error 永远放行）', async () => {
    const gate = new ConcurrencyGate(1, 0);
    await gate.acquire('webhook');

    await expect(gate.acquire('error')).resolves.toBeUndefined();
    await expect(gate.acquire('retry')).resolves.toBeUndefined();
  });
});

describe('环境变量', () => {
  it('未设置时用缺省上限（不是不限——默认就要有熔断）', () => {
    expect(concurrencyLimitFromEnv({})).toBe(DEFAULT_PRODUCTION_LIMIT);
  });

  it('读正整数', () => {
    expect(concurrencyLimitFromEnv({ NOMOPS_CONCURRENCY_PRODUCTION_LIMIT: '5' })).toBe(5);
  });

  it('-1 = 显式关闭闸门', () => {
    expect(concurrencyLimitFromEnv({ NOMOPS_CONCURRENCY_PRODUCTION_LIMIT: '-1' })).toBe(-1);
  });

  it('非法值回落缺省，不让实例带着坏配置起来', () => {
    expect(concurrencyLimitFromEnv({ NOMOPS_CONCURRENCY_PRODUCTION_LIMIT: 'abc' })).toBe(
      DEFAULT_PRODUCTION_LIMIT,
    );
  });

  it('队列深度未设置时返回 undefined，由构造函数按 2× 算', () => {
    expect(queueDepthFromEnv({})).toBeUndefined();
    expect(queueDepthFromEnv({ NOMOPS_CONCURRENCY_QUEUE_DEPTH: '50' })).toBe(50);
    expect(queueDepthFromEnv({ NOMOPS_CONCURRENCY_QUEUE_DEPTH: 'abc' })).toBeUndefined();
  });
});
