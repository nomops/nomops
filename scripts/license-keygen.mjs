#!/usr/bin/env node
/**
 * 生成 License 签发密钥对（Ed25519）。
 *
 * 公钥进代码（packages/server/src/license/license-cert.ts 的
 * DEFAULT_LICENSE_PUBLIC_KEY），或经 NOMOPS_LICENSE_PUBLIC_KEY 下发给实例。
 * ★私钥只留在签发方手里，绝不进仓库、绝不下发到实例——实例只验不签。
 *
 * 用法：node scripts/license-keygen.mjs
 */
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

console.log('# 公钥（可公开，写进 DEFAULT_LICENSE_PUBLIC_KEY 或 NOMOPS_LICENSE_PUBLIC_KEY）');
console.log(pub);
console.log();
console.log('# 私钥（★保密，只存签发环境，用作 NOMOPS_LICENSE_PRIVATE_KEY）');
console.log(priv);
