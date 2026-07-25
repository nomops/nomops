import { createPublicKey, randomUUID } from 'node:crypto';
import type { DeploymentKey, Repositories, TrustedKey, TrustedKeySource } from '@nomops/db';
import type { Credentials } from '@nomops/core';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import {
  decodeInstanceToken,
  generateDeploymentKeypair,
  signInstanceToken,
  verifyInstanceToken,
} from '../../services/instance-token.js';

/**
 * 实例信任密钥链（backlog #47）：实例联邦的信任底座（Cloud/企业）。
 * - 部署密钥：本实例 Ed25519 签名密钥（私钥经 Cipher 加密落库,铁律 3 精神）。签发实例令牌。
 * - 信任密钥：信任的对端公钥（手动加或从 JWKS 源拉），按 kid 匹配验签。
 * - 令牌交换（RFC 8693 简化）：对端令牌 → 验签(信任密钥) + jti 防重放 → 换发本实例令牌。
 * 令牌原语在 services/instance-token.ts（复用 license-cert 同款 Ed25519）。
 */

const TOKEN_TTL_SEC = 300; // 交换出的本实例令牌有效期 5 分钟

/** JWKS 单条：标准 OKP + der 便于 nomops↔nomops 直用。 */
export interface JwkEntry {
  kid: string;
  kty: 'OKP';
  crv: 'Ed25519';
  use: 'sig';
  alg: 'EdDSA';
  x: string; // 原始公钥 base64url（标准）
}

export interface TrustedKeyView {
  id: string;
  kid: string;
  issuer: string;
  sourceId: string | null;
  createdAt: Date;
}

export interface TrustStatus {
  activeKid: string | null;
  jwksUrl: string;
  trustedKeys: TrustedKeyView[];
  sources: Array<{ id: string; name: string; jwksUrl: string; lastFetchedAt: Date | null }>;
}

export class InstanceTrustService {
  constructor(
    private readonly repos: Repositories,
    private readonly credentials: Credentials,
    private readonly baseUrl: string,
    /** JWKS 源拉取的 fetch（缺省真实；测试注入假实现）。 */
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /* ── 部署密钥 ── */
  /** 确保有活跃部署密钥（首次生成 + 私钥加密落库），返回它。 */
  async ensureDeploymentKey(): Promise<DeploymentKey> {
    const existing = await this.repos.instanceTrust.activeDeploymentKey();
    if (existing) return existing;
    const kp = generateDeploymentKeypair();
    const encPriv = await this.credentials.encrypt({ pk: kp.privateKey }, {});
    return this.repos.instanceTrust.addDeploymentKey({ kid: kp.kid, publicKey: kp.publicKey, privateKey: encPriv });
  }

  private derToJwk(kid: string, publicKeyDer: string): JwkEntry {
    const jwk = createPublicKey({ key: Buffer.from(publicKeyDer, 'base64'), format: 'der', type: 'spki' }).export({ format: 'jwk' }) as { x?: string };
    return { kid, kty: 'OKP', crv: 'Ed25519', use: 'sig', alg: 'EdDSA', x: String(jwk.x ?? '') };
  }

  /** 公开 JWKS：所有部署公钥（对端据此建立信任 / 验证本实例令牌）。 */
  async publicJwks(): Promise<{ keys: JwkEntry[] }> {
    await this.ensureDeploymentKey();
    const keys = await this.repos.instanceTrust.listDeploymentKeys();
    return { keys: keys.map((k) => this.derToJwk(k.kid, k.publicKey)) };
  }

  /** 轮换部署密钥：旧钥留验证窗口（不删），新钥变活跃。 */
  async rotateDeploymentKey(): Promise<DeploymentKey> {
    await this.repos.instanceTrust.deactivateAllDeploymentKeys();
    const kp = generateDeploymentKeypair();
    const encPriv = await this.credentials.encrypt({ pk: kp.privateKey }, {});
    return this.repos.instanceTrust.addDeploymentKey({ kid: kp.kid, publicKey: kp.publicKey, privateKey: encPriv });
  }

  /** 用活跃部署密钥签一枚本实例令牌（供对端交换）。 */
  async signToken(claims: { sub: string; aud?: string; ttlSec?: number; [k: string]: unknown }): Promise<string> {
    const key = await this.ensureDeploymentKey();
    const nowS = Math.floor(this.now() / 1000);
    const payload: JsonObject = {
      ...claims,
      iss: key.kid,
      jti: randomUUID(),
      iat: nowS,
      exp: nowS + (Number(claims.ttlSec) || TOKEN_TTL_SEC),
    } as JsonObject;
    delete (payload as Record<string, unknown>)['ttlSec'];
    const priv = String((await this.credentials.decrypt(key.privateKey, {}))['pk'] ?? '');
    return signInstanceToken(payload, priv, key.kid);
  }

  /* ── 信任密钥 ── */
  private view(k: TrustedKey): TrustedKeyView {
    return { id: k.id, kid: k.kid, issuer: k.issuer, sourceId: k.sourceId, createdAt: k.createdAt };
  }

  async addTrustedKey(input: { kid?: string; issuer?: string; jwk?: JwkEntry; publicKeyDer?: string }): Promise<TrustedKeyView> {
    let der = input.publicKeyDer ?? '';
    let kid = input.kid ?? '';
    if (input.jwk) {
      der = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: input.jwk.x }, format: 'jwk' }).export({ format: 'der', type: 'spki' }).toString('base64');
      kid = kid || input.jwk.kid;
    }
    if (!der || !kid) throw new OperationalError('Provide a JWK or (kid + publicKeyDer)', { status: 400 });
    await this.repos.instanceTrust.upsertTrustedKey({ kid, issuer: input.issuer ?? '', publicKey: der, sourceId: null });
    return this.view((await this.repos.instanceTrust.findTrustedKey(kid))!);
  }

  async listTrustedKeys(): Promise<TrustedKeyView[]> {
    return (await this.repos.instanceTrust.listTrustedKeys()).map((k) => this.view(k));
  }

  async removeTrustedKey(kid: string): Promise<void> {
    await this.repos.instanceTrust.deleteTrustedKey(kid);
  }

  /* ── JWKS 源 ── */
  async addSource(name: string, jwksUrl: string): Promise<TrustedKeySource> {
    if (!/^https?:\/\//.test(jwksUrl)) throw new OperationalError('jwksUrl must be http(s)', { status: 400 });
    const src = await this.repos.instanceTrust.addSource({ name: name.trim() || jwksUrl, jwksUrl });
    await this.refreshSource(src.id).catch(() => undefined); // 首拉尽力,失败不阻塞建源
    return src;
  }

  /** 从 JWKS 源拉公钥,upsert 进信任密钥（按 kid）。返回导入条数。 */
  async refreshSource(id: string): Promise<{ imported: number }> {
    const src = await this.repos.instanceTrust.findSource(id);
    if (!src) throw new OperationalError('Source not found', { status: 404 });
    const res = await this.fetchImpl(src.jwksUrl, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new OperationalError(`JWKS source → HTTP ${res.status}`, { status: 502 });
    const body = (await res.json()) as { keys?: Array<{ kid?: string; x?: string; crv?: string }> };
    const keys = (body.keys ?? []).filter((k) => k.crv === 'Ed25519' && k.x && k.kid);
    for (const k of keys) {
      const der = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: k.x! }, format: 'jwk' }).export({ format: 'der', type: 'spki' }).toString('base64');
      await this.repos.instanceTrust.upsertTrustedKey({ kid: k.kid!, issuer: src.name, publicKey: der, sourceId: src.id });
    }
    await this.repos.instanceTrust.markSourceFetched(src.id);
    return { imported: keys.length };
  }

  async removeSource(id: string): Promise<void> {
    await this.repos.instanceTrust.deleteSource(id);
  }

  async status(): Promise<TrustStatus> {
    const active = await this.repos.instanceTrust.activeDeploymentKey();
    const [trusted, sources] = await Promise.all([this.listTrustedKeys(), this.repos.instanceTrust.listSources()]);
    return {
      activeKid: active?.kid ?? null,
      jwksUrl: `${this.baseUrl}/instance-trust/jwks`,
      trustedKeys: trusted,
      sources: sources.map((s) => ({ id: s.id, name: s.name, jwksUrl: s.jwksUrl, lastFetchedAt: s.lastFetchedAt })),
    };
  }

  /* ── 令牌交换（RFC 8693 简化）── */
  /**
   * 对端令牌 → 按 kid 找信任密钥验签 + exp 校验 + jti 防重放 → 换发本实例令牌。
   * 返回本实例签名的新令牌（含 act={iss:对端} 标注委托来源）。
   */
  async exchangeToken(presentedToken: string): Promise<{ token: string; actor: string; subject: string }> {
    const decoded = decodeInstanceToken(presentedToken);
    if (!decoded?.header.kid) throw new OperationalError('Malformed token (no kid)', { status: 400 });
    const trusted = await this.repos.instanceTrust.findTrustedKey(decoded.header.kid);
    if (!trusted) throw new OperationalError('Token signed by an untrusted key', { status: 401 });
    const verified = verifyInstanceToken(presentedToken, trusted.publicKey, this.now());
    if (!verified.ok) throw new OperationalError(`Token rejected: ${verified.reason}`, { status: 401 });

    const jti = String(verified.payload['jti'] ?? '');
    const exp = Number(verified.payload['exp'] ?? 0);
    if (!jti) throw new OperationalError('Token missing jti', { status: 400 });
    // 防重放：jti 记一次即拒复用（保留到令牌本身过期）
    const fresh = await this.repos.instanceTrust.recordJtiIfNew(jti, new Date((exp || Math.floor(this.now() / 1000) + TOKEN_TTL_SEC) * 1000));
    if (!fresh) throw new OperationalError('Token replay detected (jti already used)', { status: 409 });
    await this.repos.instanceTrust.pruneExpiredJti(new Date(this.now())).catch(() => undefined);

    const subject = String(verified.payload['sub'] ?? '');
    const actor = String(verified.payload['iss'] ?? decoded.header.kid);
    const token = await this.signToken({ sub: subject, aud: 'self', act: { iss: actor } });
    return { token, actor, subject };
  }
}
