import { OperationalError } from '@nomops/workflow';
import type { TriggerMode } from './execution-service.js';

/**
 * 实例级执行并发闸门（B7）。
 *
 * regular 模式下没有任何并发上限：webhook 洪峰会让进程同时跑起成百上千个执行，
 * 每个都在内存里攥着自己的 runData，最终 OOM 把整个实例打挂——已经排队等着的
 * 执行也跟着一起死。
 *
 * 两级响应：超出并发上限的**排队等待**（对调用方透明，慢一点但不丢）；
 * 连队列都满了才**拒绝**（503）。
 *
 * queue 模式下本闸门不生效——那里由 worker 的 BullMQ 并发度管，
 * 再加一层只会互相打架。
 *
 * ★等待队列有上界。无界排队不是善意：webhook 调用方（GitHub/Stripe 之类）
 * 通常 10 秒超时，排队 60 秒的结果是它超时后**重试**，反而放大洪峰；
 * 而堆在队列里的每个请求仍攥着一条连接和一份工作流状态，依旧是 OOM 路径。
 * 所以浅队列吸收抖动，深洪峰快速拒绝（503 + Retry-After），
 * 把退避交给调用方本就有的重试逻辑。
 */

/**
 * 受管的执行模式 = 外部可触发的那些。
 *
 * ★`error` 刻意不受管：错误处理流必须随时能跑。若它也排队，当所有槽位都被
 * 正在失败的执行占满时，处理这些失败的错误流永远等不到槽位——死锁。
 * `retry` 是用户手动发起的，同理不受管；手动运行走的是另一条入口，本就不经这里。
 */
const GOVERNED_MODES: readonly TriggerMode[] = ['webhook', 'trigger', 'chat', 'mcp'];

/**
 * regular 模式的缺省上限。
 *
 * 单个 Node 进程同时跑 100 个执行已经远超合理负载——这个值的用途是拦住
 * 病态情形（几千个并发 webhook），而不是给正常流量设限。真要调优的实例
 * 应该显式配置，或者干脆上 queue 模式。
 */
export const DEFAULT_PRODUCTION_LIMIT = 100;

/**
 * 等待队列深度上限，缺省 = 2× 并发上限。
 * 取 2 倍是让短促抖动（一次批量触发）能被吸收，而持续洪峰很快撞上界。
 */
export const DEFAULT_QUEUE_DEPTH_FACTOR = 2;

/** 建议调用方多久后重试（秒）。写进 Retry-After 头。 */
export const RETRY_AFTER_SECONDS = 5;

/** 队列已满：HTTP 层映射为 503 + Retry-After。 */
export class ConcurrencyOverloadError extends OperationalError {
  constructor(active: number, waiting: number) {
    super('Server is at capacity, please retry', {
      status: 503,
      retryAfter: RETRY_AFTER_SECONDS,
      active,
      waiting,
    });
  }
}

/** -1 = 不限。 */
export const UNLIMITED = -1;

export class ConcurrencyGate {
  private activeCount = 0;
  /** FIFO 等待队列：先到先得，避免后来的执行插队饿死早到的。 */
  private readonly waiters: Array<() => void> = [];

  private readonly maxQueueDepth: number;

  /**
   * @param limit 并发上限；-1 = 不限。0 无意义（等于永久阻塞），按不限处理。
   * @param maxQueueDepth 等待队列上限；缺省 2× limit。<=0 视为不排队（满即拒）。
   */
  constructor(
    private readonly limit: number = DEFAULT_PRODUCTION_LIMIT,
    maxQueueDepth?: number,
  ) {
    if (limit === 0 || limit < UNLIMITED) this.limit = UNLIMITED;
    this.maxQueueDepth = Math.max(
      0,
      maxQueueDepth ?? Math.max(0, this.limit) * DEFAULT_QUEUE_DEPTH_FACTOR,
    );
  }

  get enabled(): boolean {
    return this.limit !== UNLIMITED;
  }

  /** 当前占用的槽位数。 */
  get active(): number {
    return this.activeCount;
  }

  /** 当前排队等待的执行数。持续 > 0 说明该上 queue 模式了。 */
  get waiting(): number {
    return this.waiters.length;
  }

  private governs(mode: TriggerMode): boolean {
    return this.enabled && GOVERNED_MODES.includes(mode);
  }

  /**
   * 取槽位。有空位直接拿；没有则排队等待；队列也满了则抛 503——
   * 到这一步继续排队只会把内存耗尽，且调用方早已超时。
   */
  async acquire(mode: TriggerMode): Promise<void> {
    if (!this.governs(mode)) return;
    if (this.activeCount < this.limit) {
      this.activeCount++;
      return;
    }
    if (this.waiters.length >= this.maxQueueDepth) {
      throw new ConcurrencyOverloadError(this.activeCount, this.waiters.length);
    }
    // 槽位由 release 直接交棒（见下），所以被唤醒时不再自增
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  /**
   * 还槽位。有人在等就**直接把槽位交棒**给队首，activeCount 不变——
   * 若先减后加会出现一个瞬时空档，让第三方在此刻抢走本该属于队首的槽位。
   */
  release(mode: TriggerMode): void {
    if (!this.governs(mode)) return;
    const next = this.waiters.shift();
    if (next) next();
    else this.activeCount = Math.max(0, this.activeCount - 1);
  }
}

/** `NOMOPS_CONCURRENCY_QUEUE_DEPTH`：未设置 = 缺省（2× 并发上限）。 */
export function queueDepthFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env['NOMOPS_CONCURRENCY_QUEUE_DEPTH'];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/**
 * 从环境变量读上限。`NOMOPS_CONCURRENCY_PRODUCTION_LIMIT`：
 * 正整数 = 上限；-1 = 不限；未设置 = 缺省值。
 */
export function concurrencyLimitFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = env['NOMOPS_CONCURRENCY_PRODUCTION_LIMIT'];
  if (raw === undefined || raw === '') return DEFAULT_PRODUCTION_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PRODUCTION_LIMIT;
  return Math.trunc(n);
}
