/**
 * 执行队列抽象（docs/01 队列模式）：main 只入队，worker 消费执行。
 * BullMQ 相关代码全部动态 import——regular 模式不加载、不要求 Redis。
 */

export interface IExecutionJob {
  executionId: string;
}

export interface IExecutionQueue {
  enqueue(job: IExecutionJob): Promise<void>;
  close(): Promise<void>;
}

const QUEUE_NAME = 'nomops-executions';

export interface RedisOptions {
  host: string;
  port: number;
}

/** 生产者（main 进程）。 */
export async function createBullQueue(redis: RedisOptions): Promise<IExecutionQueue> {
  const { Queue } = await import('bullmq');
  const queue = new Queue<IExecutionJob>(QUEUE_NAME, {
    connection: { host: redis.host, port: redis.port },
  });
  return {
    enqueue: async (job) => {
      await queue.add('execute', job, {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 1,
      });
    },
    close: () => queue.close(),
  };
}

/** 消费者（worker 进程）。handler 抛错即任务失败（BullMQ 记录）。 */
export async function startBullWorker(
  redis: RedisOptions,
  handler: (job: IExecutionJob) => Promise<void>,
  concurrency = 5,
): Promise<{ close(): Promise<void> }> {
  const { Worker } = await import('bullmq');
  const worker = new Worker<IExecutionJob>(
    QUEUE_NAME,
    async (job) => handler(job.data),
    { connection: { host: redis.host, port: redis.port }, concurrency },
  );
  worker.on('failed', (job, error) => {
    console.error(`[nomops-worker] 任务失败 execution=${job?.data.executionId}:`, error.message);
  });
  return { close: () => worker.close() };
}

/** Redis 锁存储（leader 选举用）。仅队列模式加载 ioredis。 */
export async function createRedisLockStore(redis: RedisOptions) {
  const { Redis } = await import('ioredis');
  const client = new Redis({ host: redis.host, port: redis.port });
  return {
    async acquire(key: string, holder: string, ttlMs: number): Promise<boolean> {
      // 新取锁 或 已持有则续期（GET 比较后 PEXPIRE）
      const ok = await client.set(key, holder, 'PX', ttlMs, 'NX');
      if (ok) return true;
      const current = await client.get(key);
      if (current === holder) {
        await client.pexpire(key, ttlMs);
        return true;
      }
      return false;
    },
    async release(key: string, holder: string): Promise<void> {
      const current = await client.get(key);
      if (current === holder) await client.del(key);
    },
    close: () => client.quit(),
  };
}
