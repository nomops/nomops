/**
 * 生成**本地开发专用**的自签企业证书。
 *
 * ★这不是也不可能是一张真证书：真签发私钥不在本仓库（见 docs/LICENSE-ISSUING.md），
 * 内置公钥也刻意没有运行时覆盖入口。这里另生成一副一次性密钥对自签自验，
 * 只有配套的 dev 入口（src/dev-main.ts）会注入这副公钥——
 * 生产入口 main.ts 走内置公钥，这张证书在任何正式构建里都是 invalid。
 *
 * 产物 .dev-license.json 已进 .gitignore：私钥不该进版本库，
 * 且每次重新生成都会换一副，泄漏面仅限本机。
 *
 * 用法：pnpm --filter @nomops/server dev:license
 */
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { signLicenseCert } from '../src/ee/license/license-cert.js';
import { LICENSE_FEATURES, LICENSE_QUOTAS } from '../src/ee/license/license-service.js';

const OUT_PATH = fileURLToPath(new URL('../../../.dev-license.json', import.meta.url));

const DAYS = Number(process.env.DEV_LICENSE_DAYS ?? 365);

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const privateKeyBase64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

const now = Date.now();
const payload = {
  id: `dev-${now}`,
  plan: 'Enterprise',
  // 取当前功能位/配额全集：新增 feature 后重跑本脚本即自动覆盖，不用手抄清单
  features: [...LICENSE_FEATURES],
  quotas: Object.fromEntries(LICENSE_QUOTAS.map((q) => [q, -1])), // -1 = 不限
  issuedTo: 'Local Development',
  validFrom: new Date(now - 86_400_000).toISOString(),
  validTo: new Date(now + DAYS * 86_400_000).toISOString(),
};

const licenseKey = signLicenseCert(payload, privateKeyBase64);

writeFileSync(
  OUT_PATH,
  `${JSON.stringify({ licenseKey, publicKey: publicKeyBase64, payload }, null, 2)}\n`,
  { mode: 0o600 },
);

console.log(`[dev-license] 已写入 ${OUT_PATH}`);
console.log(`[dev-license] plan=${payload.plan} features=${payload.features.length} 个 有效期至 ${payload.validTo}`);
console.log('[dev-license] 重启 pnpm dev 即生效');
