import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 门户→实例免密登录令牌校验（docs/11 Phase 2.5，实例侧）。
 * 与控制平面 `mintHandoff` 的签名逻辑对称（HMAC-SHA256，payload.sig）。两包无共享代码，故各存一份。
 */
export interface HandoffClaims {
  email: string;
  slug: string;
}

export function verifyHandoff(secret: string, token: string, now: number): HandoffClaims | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expected = createHmac('sha256', secret).update(payloadB64!).digest('base64url');
  const a = Buffer.from(sig!);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: { email?: unknown; slug?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString());
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (typeof payload.email !== 'string' || typeof payload.slug !== 'string') return null;
  return { email: payload.email, slug: payload.slug };
}
