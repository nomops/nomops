import { bootstrap } from './bootstrap.js';
import { startBullWorker } from './queue/execution-queue.js';

/**
 * worker 进程入口（queue 模式）：只消费执行队列，不起 HTTP、不跑触发器调度。
 * 执行状态可序列化（铁律 4）是这里能工作的前提——worker 反序列化落库的
 * RunExecutionData 后经 processRunExecutionData 跑完。
 */
const boot = await bootstrap({ role: 'worker', mode: 'queue' });
if (!boot.redis) throw new Error('worker 需要 Redis（EXECUTIONS_MODE=queue）');

const concurrency = Number(process.env['WORKER_CONCURRENCY'] ?? 5);
const worker = await startBullWorker(
  boot.redis,
  async ({ executionId }) => {
    await boot.services.executions.executeStored(executionId);
  },
  concurrency,
);

console.log(`[nomops-worker] consuming executions (concurrency=${concurrency})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void worker
      .close()
      .then(() => boot.shutdown())
      .finally(() => process.exit(0));
  });
}
