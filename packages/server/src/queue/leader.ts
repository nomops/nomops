/**
 * Leader 选举（docs/01 队列模式约束：定时/轮询触发器只能由 leader 跑，
 * 否则 N 个进程会把一个 cron 触发 N 次）。
 *
 * 锁存储抽象：单进程/测试用内存实现；队列模式用 Redis（SET NX PX）。
 */
export interface ILockStore {
  /** 尝试获取/续期锁。持有者相同则续期成功。 */
  acquire(key: string, holder: string, ttlMs: number): Promise<boolean>;
  release(key: string, holder: string): Promise<void>;
}

/** 进程内锁（regular 模式 / 多实例单测）。多个 LeaderElection 共享同一实例即可模拟竞争。 */
export class InMemoryLockStore implements ILockStore {
  private locks = new Map<string, { holder: string; expiresAt: number }>();

  async acquire(key: string, holder: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const current = this.locks.get(key);
    if (!current || current.expiresAt <= now || current.holder === holder) {
      this.locks.set(key, { holder, expiresAt: now + ttlMs });
      return true;
    }
    return false;
  }

  async release(key: string, holder: string): Promise<void> {
    if (this.locks.get(key)?.holder === holder) this.locks.delete(key);
  }
}

const LOCK_KEY = 'nomops:leader';
const TTL_MS = 10_000;
const RENEW_MS = 4_000;

export class LeaderElection {
  private leader = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly holder = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

  constructor(
    private readonly store: ILockStore,
    private readonly onChange?: (isLeader: boolean) => void | Promise<void>,
  ) {}

  isLeader(): boolean {
    return this.leader;
  }

  /** 立刻竞选一次，然后按周期续期/重试。 */
  async start(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => void this.tick(), RENEW_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.leader) {
      await this.store.release(LOCK_KEY, this.holder);
      await this.setLeader(false);
    }
  }

  private async tick(): Promise<void> {
    const acquired = await this.store.acquire(LOCK_KEY, this.holder, TTL_MS);
    if (acquired !== this.leader) await this.setLeader(acquired);
  }

  private async setLeader(value: boolean): Promise<void> {
    this.leader = value;
    await this.onChange?.(value);
  }
}
