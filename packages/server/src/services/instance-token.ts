import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { JsonObject } from '@nomops/workflow';

/**
 * 实例信任密钥链 · 令牌原语（backlog #47）。
 * 实例用自己的 Ed25519「部署密钥」签紧凑 EdDSA 令牌（JWT 形态,header.payload.sig）;
 * 对端凭「信任密钥」(按 kid 匹配的公钥)验签。复用 license-cert 同款 Ed25519(DER/SPKI/PKCS8)。
 * 手搓紧凑令牌而非引第三方,与 license-cert / MCP / SMTP 同一取舍。
 */

const b64urlJson = (o: unknown): string => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

/** 部署密钥对（base64 DER）。私钥落库前经 Cipher 加密（铁律 3 精神）。 */
export interface DeploymentKeypair {
  kid: string;
  publicKey: string; // base64 DER SPKI
  privateKey: string; // base64 DER PKCS8（明文,调用方负责加密落库）
}

/** kid = 公钥 sha256 前 16 hex（稳定、可从公钥独立推出,便于对端匹配）。 */
export function kidFor(publicKeyBase64Der: string): string {
  return createHash('sha256').update(Buffer.from(publicKeyBase64Der, 'base64')).digest('hex').slice(0, 16);
}

export function generateDeploymentKeypair(): DeploymentKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  return { kid: kidFor(pub), publicKey: pub, privateKey: priv };
}

/** 用部署私钥签紧凑 EdDSA 令牌。payload 应含 iss/sub/aud/jti/iat/exp。 */
export function signInstanceToken(payload: JsonObject, privateKeyBase64: string, kid: string): string {
  const header = { alg: 'EdDSA', typ: 'JWT', kid };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = createPrivateKey({ key: Buffer.from(privateKeyBase64, 'base64'), format: 'der', type: 'pkcs8' });
  const sig = sign(null, Buffer.from(signingInput, 'utf8'), key).toString('base64url');
  return `${signingInput}.${sig}`;
}

export interface DecodedToken {
  header: { alg?: string; kid?: string };
  payload: JsonObject;
}

/** 只解不验（拿 kid 找信任公钥）。格式非法返回 null。 */
export function decodeInstanceToken(token: string): DecodedToken | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as DecodedToken['header'];
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as JsonObject;
    return { header, payload };
  } catch {
    return null;
  }
}

export type VerifyResult =
  | { ok: true; payload: JsonObject }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired'; message: string };

/** 用给定公钥（base64 DER SPKI）验签 + 校验 exp。now 可注入（测试）。 */
export function verifyInstanceToken(token: string, publicKeyBase64: string, now: number = Date.now()): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed', message: 'Token must have 3 segments' };
  const signingInput = `${parts[0]}.${parts[1]}`;
  let payload: JsonObject;
  try {
    payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as JsonObject;
  } catch {
    return { ok: false, reason: 'malformed', message: 'Bad payload' };
  }
  let sigOk = false;
  try {
    const pub = createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' });
    sigOk = verify(null, Buffer.from(signingInput, 'utf8'), pub, Buffer.from(parts[2]!, 'base64url'));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, reason: 'bad-signature', message: 'Signature verification failed' };
  const exp = Number(payload['exp'] ?? 0);
  if (exp && exp * 1000 < now) return { ok: false, reason: 'expired', message: 'Token expired' };
  return { ok: true, payload };
}
