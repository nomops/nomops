import { createPublicKey, createPrivateKey, sign, verify } from 'node:crypto';

/**
 * License 证书：离线验签，不联网、不回调签发服务器。
 *
 * 格式 `NOMOPS1.<payload>.<signature>`，两段都是 base64url：
 * - payload = 证书 JSON 的 UTF-8 字节
 * - signature = Ed25519 对 **payload 原始字节**（不是 JSON 重新序列化的结果）的签名
 *
 * 签名覆盖 payload 字节而非解析后的对象，是为了避开 JSON 规范化陷阱——
 * 键序/空白/数字表示的任何差异都会让重新序列化的字节与签名时不一致。
 */

const PREFIX = 'NOMOPS1';

/**
 * 内置签发公钥（公钥可公开，进仓库无风险）。
 * 自托管者若自行签发，用 NOMOPS_LICENSE_PUBLIC_KEY 覆盖（base64 DER/SPKI）。
 */
export const DEFAULT_LICENSE_PUBLIC_KEY =
  'MCowBQYDK2VwAyEAeB0eukxQtAJFR0QcYKL/cAQiFfHOzbvd5qH5bl0+UmI=';

/** 证书载荷。quotas 里 -1 表示不限。 */
export interface ILicensePayload {
  /** 证书 id（审计与吊销用）。 */
  id: string;
  /** 套餐显示名，如 'Business' / 'Enterprise'。 */
  plan: string;
  /** 解锁的功能位。 */
  features: string[];
  /** 配额；-1 = 不限。只放引擎/服务真正强制的项。 */
  quotas: Record<string, number>;
  /** 签发对象（公司名/邮箱），仅展示。 */
  issuedTo?: string;
  /** 生效时刻（ISO）。 */
  validFrom: string;
  /** 失效时刻（ISO）。 */
  validTo: string;
}

export type CertFailureReason =
  | 'malformed' // 结构不对（段数/前缀/base64/JSON）
  | 'badSignature' // 签名验不过（伪造或改过内容）
  | 'badPayload'; // 结构对、签名对，但字段不合法

export type CertResult =
  | { ok: true; payload: ILicensePayload }
  | { ok: false; reason: CertFailureReason; message: string };

const b64urlEncode = (buf: Buffer): string => buf.toString('base64url');
const b64urlDecode = (s: string): Buffer => Buffer.from(s, 'base64url');

function publicKeyFrom(base64Der: string) {
  return createPublicKey({
    key: Buffer.from(base64Der, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** 结构校验：签名过了也不代表字段合法（签发端 bug 同样要拦）。 */
function validatePayload(raw: unknown): ILicensePayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p['id'] !== 'string' || p['id'] === '') return null;
  if (typeof p['plan'] !== 'string' || p['plan'] === '') return null;
  if (!Array.isArray(p['features']) || p['features'].some((f) => typeof f !== 'string')) return null;
  if (!isIsoDate(p['validFrom']) || !isIsoDate(p['validTo'])) return null;
  if (Date.parse(p['validTo']) <= Date.parse(p['validFrom'])) return null;

  const quotas: Record<string, number> = {};
  const rawQuotas = p['quotas'];
  if (rawQuotas !== undefined) {
    if (typeof rawQuotas !== 'object' || rawQuotas === null || Array.isArray(rawQuotas)) return null;
    for (const [key, value] of Object.entries(rawQuotas)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      quotas[key] = Math.trunc(value);
    }
  }

  return {
    id: p['id'],
    plan: p['plan'],
    features: p['features'] as string[],
    quotas,
    ...(typeof p['issuedTo'] === 'string' ? { issuedTo: p['issuedTo'] } : {}),
    validFrom: p['validFrom'],
    validTo: p['validTo'],
  };
}

/**
 * 验证并解析证书。**不检查是否在有效期内**——那是随时间变化的运行时判断，
 * 由 LicenseService 在每次功能查询时做，好让长跑实例无需重启即可自然降级。
 */
export function verifyLicenseCert(cert: string, publicKeyBase64: string): CertResult {
  const parts = cert.trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return { ok: false, reason: 'malformed', message: 'License key format not recognized' };
  }

  const [, payloadPart, signaturePart] = parts as [string, string, string];
  let payloadBytes: Buffer;
  let signatureBytes: Buffer;
  try {
    payloadBytes = b64urlDecode(payloadPart);
    signatureBytes = b64urlDecode(signaturePart);
  } catch {
    return { ok: false, reason: 'malformed', message: 'License key is not valid base64url' };
  }
  if (payloadBytes.length === 0 || signatureBytes.length === 0) {
    return { ok: false, reason: 'malformed', message: 'License key is empty' };
  }

  let signatureOk = false;
  try {
    signatureOk = verify(null, payloadBytes, publicKeyFrom(publicKeyBase64), signatureBytes);
  } catch {
    // 公钥配错或签名字节非法都会抛——对调用方而言都是「验不过」
    signatureOk = false;
  }
  if (!signatureOk) {
    return { ok: false, reason: 'badSignature', message: 'License key signature is invalid' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed', message: 'License payload is not valid JSON' };
  }

  const payload = validatePayload(parsed);
  if (!payload) {
    return { ok: false, reason: 'badPayload', message: 'License payload is missing required fields' };
  }
  return { ok: true, payload };
}

/**
 * 签发证书。**只给签发方用**（scripts/license-sign.mjs 与测试），
 * 产品运行时永远不签只验——私钥不该出现在实例上。
 */
export function signLicenseCert(payload: ILicensePayload, privateKeyBase64: string): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const key = createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const signatureBytes = sign(null, payloadBytes, key);
  return `${PREFIX}.${b64urlEncode(payloadBytes)}.${b64urlEncode(signatureBytes)}`;
}
