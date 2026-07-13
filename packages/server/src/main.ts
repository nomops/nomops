import { createServer } from 'node:http';
import { bootstrap } from './bootstrap.js';
import { createApp } from './app.js';
import { attachWebSocket } from './ws/attach.js';

/**
 * main 进程启动入口：HTTP + WS + 触发器调度（leader）。
 * regular 模式（默认）一个进程包揽全部；queue 模式下执行交给 worker 进程。
 * 端口默认 5678；可用 PORT 环境变量覆盖。
 */
const PORT = Number(process.env.PORT ?? 5678);

const boot = await bootstrap({ role: 'main' });
const { services } = boot;
const app = createApp(services);
const server = createServer(app);
attachWebSocket(server, services);

// 先竞选 leader，再恢复已激活工作流的触发器（定时型只在 leader 上起）
await boot.leader.start();
await services.activeWorkflows.init();

server.listen(PORT, () => {
  console.log(
    `[nomops] server listening on http://localhost:${PORT} (mode=${boot.mode}, leader=${boot.leader.isLeader()})`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void boot.shutdown().finally(() => process.exit(0));
  });
}
