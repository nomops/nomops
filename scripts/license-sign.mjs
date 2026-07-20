#!/usr/bin/env node
/**
 * 签发一张 License 证书。
 *
 * 私钥从 NOMOPS_LICENSE_PRIVATE_KEY 读（base64 DER/PKCS8，由 license-keygen.mjs 产出）。
 *
 * 用法：
 *   NOMOPS_LICENSE_PRIVATE_KEY=... node scripts/license-sign.mjs \
 *     --plan Business \
 *     --features rbac,auditLogs,sso,ldap,sourceControl \
 *     --quotas teamProjects=6,users=-1 \
 *     --days 365 \
 *     --to "Acme Inc"
 *
 * 配额 -1 = 不限。未列出的功能位即未解锁。
 */
import { randomUUID } from 'node:crypto';
import { signLicenseCert } from '../packages/server/dist/license/license-cert.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const privateKey = process.env.NOMOPS_LICENSE_PRIVATE_KEY;
if (!privateKey) {
  console.error('缺少 NOMOPS_LICENSE_PRIVATE_KEY（见 scripts/license-keygen.mjs）');
  process.exit(1);
}

const plan = arg('plan', 'Enterprise');
const features = arg('features', '').split(',').map((s) => s.trim()).filter(Boolean);
const days = Number(arg('days', '365'));
const issuedTo = arg('to', undefined);

const quotas = {};
for (const pair of arg('quotas', '').split(',').map((s) => s.trim()).filter(Boolean)) {
  const [key, value] = pair.split('=');
  if (!key || value === undefined) {
    console.error(`配额格式应为 key=number，收到：${pair}`);
    process.exit(1);
  }
  quotas[key] = Number(value);
}

if (features.length === 0) {
  console.error('至少要给一个 --features（否则这张证书什么都解锁不了）');
  process.exit(1);
}

const now = new Date();
const payload = {
  id: randomUUID(),
  plan,
  features,
  quotas,
  ...(issuedTo ? { issuedTo } : {}),
  validFrom: now.toISOString(),
  validTo: new Date(now.getTime() + days * 86_400_000).toISOString(),
};

console.log(signLicenseCert(payload, privateKey));
console.error(`\n# 已签发 ${plan}，${features.length} 项功能，${days} 天，至 ${payload.validTo}`);
