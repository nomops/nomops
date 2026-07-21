import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { bootstrap } from './bootstrap.js';
import type { BootstrapOptions } from './bootstrap.js';
import { createApp } from './app.js';
import { attachWebSocket } from './ws/attach.js';

/**
 * 启动流程本体，供生产入口 main.ts 与开发入口 dev-main.ts 共用。
 *
 * ★抽出来只为消除两份启动代码的漂移风险；bootstrap 选项由调用方决定——
 * 生产入口不传 license 相关项，内置公钥的验签路径不受影响。
 */
export async function startServer(opts: BootstrapOptions = {}): Promise<void> {
  const port = Number(process.env.PORT ?? 5678);

  // npm/Node 直接运行时：默认托管相邻的前端产物（进浏览器即见完整 UI）。
  // 必须在 createApp 之前设置（app 层读取此 env 决定是否托管静态资源）。
  // 依部署布局取第一个存在的：monorepo `pnpm start`（server/dist → ../../frontend/dist）
  // 或独立发布包（dist/ → ../frontend/dist）。
  if (!process.env.NOMOPS_STATIC_DIR) {
    for (const rel of ['../../frontend/dist', '../frontend/dist']) {
      const dir = fileURLToPath(new URL(rel, import.meta.url));
      if (existsSync(dir)) {
        process.env.NOMOPS_STATIC_DIR = dir;
        break;
      }
    }
  }

  const boot = await bootstrap({ role: 'main', ...opts });
  const { services } = boot;
  const app = createApp(services);
  const server = createServer(app);
  attachWebSocket(server, services);

  // 先竞选 leader，再恢复已激活工作流的触发器（定时型只在 leader 上起）
  await boot.leader.start();
  await services.activeWorkflows.init();

  // 端口被占是开发期最常见的启动失败（上一个会话没关干净）。
  // 默认的 EADDRINUSE 堆栈不告诉你占用者是谁，只能人肉 lsof——这里直接给出诊断命令。
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `[nomops] 端口 ${port} 已被占用——多半是上一个 dev 会话还活着。\n` +
          `  查看占用者： lsof -i :${port} -sTCP:LISTEN\n` +
          `  换个端口起： PORT=5681 pnpm dev`,
      );
      process.exit(1);
    }
    throw error;
  });

  server.listen(port, () => {
    console.log(
      `[nomops] server listening on http://localhost:${port} (mode=${boot.mode}, leader=${boot.leader.isLeader()})`,
    );
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void boot.shutdown().finally(() => process.exit(0));
    });
  }
}
