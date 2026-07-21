/**
 * 开发启动入口（`pnpm dev` 走这里）。
 *
 * 存在 .dev-license.json 就注入其中的自签公钥，让那张本地企业证书验得过；
 * 不存在则原样以社区版启动——所以没生成证书的机器上行为与生产入口一致。
 *
 * ★与生产入口 main.ts 的唯一差别就是这个注入，且注入源是**本地文件**而非环境变量。
 * 「设个环境变量就解锁」正是 docs/LICENSE-ISSUING.md 要挡的绕过路径，
 * 所以做成独立入口而不是给 main.ts 加开关：生产 `pnpm start` 跑 dist/main.js，
 * 永远读不到这里的任何东西。
 *
 * 生成证书：pnpm --filter @nomops/server dev:license
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from './start.js';

const DEV_LICENSE_PATH = fileURLToPath(new URL('../../../.dev-license.json', import.meta.url));

let devLicense: { licenseKey: string; publicKey: string } | null = null;
try {
  devLicense = JSON.parse(readFileSync(DEV_LICENSE_PATH, 'utf8'));
} catch {
  // 没生成过证书是正常状态，不是错误：社区版照常启动
}

if (devLicense) {
  console.warn('[dev] ⚠ 已加载本地自签 license（Enterprise 全功能）——仅限本机开发');
} else {
  console.log('[dev] 未找到 .dev-license.json，以社区版启动');
  console.log('[dev] 需要企业功能：pnpm --filter @nomops/server dev:license');
}

await startServer(
  devLicense ? { licenseKey: devLicense.licenseKey, licensePublicKey: devLicense.publicKey } : {},
);
