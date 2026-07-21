import { startServer } from './start.js';

/**
 * main 进程启动入口：HTTP + WS + 触发器调度（leader）。
 * regular 模式（默认）一个进程包揽全部；queue 模式下执行交给 worker 进程。
 * 端口默认 5678；可用 PORT 环境变量覆盖。
 *
 * ★不传 license 相关选项：验签一律用编译进产物的内置公钥。
 */
await startServer();
