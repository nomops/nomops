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
  sourceName: string | null;
  createdAt: Date;
}

export interface TrustStatus {
  activeKid: string | null;
  jwksUrl: string;
  trustedKeys: TrustedKeyView[];
  sources: Array<{ id: string; name: string; type: string; status: string; lastError: string | null; lastFetchedAt: Date | null }>;
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
  private view(k: TrustedKey, sourceName?: string): TrustedKeyView {
    return { id: k.id, kid: k.kid, issuer: k.issuer, sourceId: k.sourceId, sourceName: sourceName ?? null, createdAt: k.createdAt };
  }

  /** 手动加信任密钥 = 建一个 static 源（#47 M2 对齐 n8n：信任密钥都源域化,无游离密钥）。 */
  async addTrustedKey(input: { kid?: string; issuer?: string; jwk?: JwkEntry; publicKeyDer?: string }): Promise<TrustedKeyView> {
    let der = input.publicKeyDer ?? '';
    let kid = input.kid ?? '';
    if (input.jwk) {
      der = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: input.jwk.x }, format: 'jwk' }).export({ format: 'der', type: 'spki' }).toString('base64');
      kid = kid || input.jwk.kid;
    }
    if (!der || !kid) throw new OperationalError('Provide a JWK or (kid + publicKeyDer)', { status: 400 });
    // issuer 是这枚密钥的展示标签（源名）,不是 iss 校验策略——手动加密钥即信任,策略经 addSource 显式开
    const src = await this.addSource({ type: 'static', name: input.issuer || `static:${kid}`, config: { kid, key: der } });
    return this.view((await this.repos.instanceTrust.findTrustedKey(kid))!, src.name);
  }

  async listTrustedKeys(): Promise<TrustedKeyView[]> {
    return (await this.repos.instanceTrust.listTrustedKeys()).map((k) => this.view(k));
  }

  async removeTrustedKey(kid: string): Promise<void> {
    await this.repos.instanceTrust.deleteTrustedKey(kid);
  }

  /* ── 信任密钥源（多态：jwks 拉远端 / static 内联公钥），带校验策略 + 健康态 ── */
  /**
   * 建源。type=jwks：config.url 拉 JWKS；type=static：config.{kid,key(base64 DER)} 直接物化。
   * config 还可带校验策略 issuer/expectedAudience/allowedRoles（交换时对令牌 claims 强校验）。
   */
  async addSource(input: { type?: string; name: string; config: JsonObject }): Promise<TrustedKeySource> {
    const type = input.type === 'static' ? 'static' : 'jwks';
    const config = input.config ?? {};
    if (type === 'jwks') {
      const url = String(config['url'] ?? '');
      if (!/^https?:\/\//.test(url)) throw new OperationalError('jwks source needs config.url (http/s)', { status: 400 });
      const src = await this.repos.instanceTrust.addSource({ name: input.name.trim() || url, type, jwksUrl: url, config });
      await this.refreshSource(src.id).catch(() => undefined); // 首拉尽力,健康态记在源上,不阻塞建源
      return (await this.repos.instanceTrust.findSource(src.id))!;
    }
    // static：内联公钥（base64 DER SPKI 或 JWK x）→ 立即物化到信任密钥
    const kid = String(config['kid'] ?? '');
    let der = String(config['key'] ?? '');
    if (!kid) throw new OperationalError('static source needs config.kid', { status: 400 });
    if (config['x'] && !der) der = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: String(config['x']) }, format: 'jwk' }).export({ format: 'der', type: 'spki' }).toString('base64');
    if (!der) throw new OperationalError('static source needs config.key (base64 DER)', { status: 400 });
    const src = await this.repos.instanceTrust.addSource({ name: input.name.trim() || `static:${kid}`, type, jwksUrl: '', config });
    await this.repos.instanceTrust.upsertTrustedKey({ kid, issuer: String(config['issuer'] ?? src.name), publicKey: der, sourceId: src.id });
    await this.repos.instanceTrust.setSourceStatus(src.id, 'healthy', null);
    return (await this.repos.instanceTrust.findSource(src.id))!;
  }

  /** 刷新源：jwks 拉公钥 upsert;static 从 config 重新物化。成功 healthy / 失败 error+lastError。 */
  async refreshSource(id: string): Promise<{ imported: number }> {
    const src = await this.repos.instanceTrust.findSource(id);
    if (!src) throw new OperationalError('Source not found', { status: 404 });
    try {
      let imported = 0;
      if (src.type === 'static') {
        const cfg = src.config as JsonObject;
        const kid = String(cfg['kid'] ?? '');
        const der = String(cfg['key'] ?? '');
        if (kid && der) {
          await this.repos.instanceTrust.upsertTrustedKey({ kid, issuer: String(cfg['issuer'] ?? src.name), publicKey: der, sourceId: src.id });
          imported = 1;
        }
      } else {
        const url = String((src.config as JsonObject)['url'] ?? src.jwksUrl);
        const res = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new OperationalError(`JWKS source → HTTP ${res.status}`, { status: 502 });
        const body = (await res.json()) as { keys?: Array<{ kid?: string; x?: string; crv?: string }> };
        const keys = (body.keys ?? []).filter((k) => k.crv === 'Ed25519' && k.x && k.kid);
        for (const k of keys) {
          const der = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: k.x! }, format: 'jwk' }).export({ format: 'der', type: 'spki' }).toString('base64');
          await this.repos.instanceTrust.upsertTrustedKey({ kid: k.kid!, issuer: String((src.config as JsonObject)['issuer'] ?? src.name), publicKey: der, sourceId: src.id });
        }
        imported = keys.length;
      }
      await this.repos.instanceTrust.markSourceFetched(src.id);
      await this.repos.instanceTrust.setSourceStatus(src.id, 'healthy', null);
      return { imported };
    } catch (e) {
      await this.repos.instanceTrust.setSourceStatus(src.id, 'error', (e as Error).message).catch(() => undefined);
      throw e;
    }
  }

  async removeSource(id: string): Promise<void> {
    await this.repos.instanceTrust.deleteSource(id);
  }

  async status(): Promise<TrustStatus> {
    const active = await this.repos.instanceTrust.activeDeploymentKey();
    const [trustedRows, sources] = await Promise.all([this.repos.instanceTrust.listTrustedKeys(), this.repos.instanceTrust.listSources()]);
    const srcName = new Map(sources.map((s) => [s.id, s.name]));
    return {
      activeKid: active?.kid ?? null,
      jwksUrl: `${this.baseUrl}/instance-trust/jwks`,
      trustedKeys: trustedRows.map((k) => this.view(k, k.sourceId ? srcName.get(k.sourceId) : undefined)),
      sources: sources.map((s) => ({ id: s.id, name: s.name, type: s.type, status: s.status, lastError: s.lastError, lastFetchedAt: s.lastFetchedAt })),
    };
  }

  /** 按源的校验策略强校验令牌 claims（#47 M2 对齐 n8n：iss/aud/role）。 */
  private validateClaims(payload: JsonObject, source: TrustedKeySource | null): void {
    const cfg = (source?.config as JsonObject) ?? {};
    const wantIss = cfg['issuer'] ? String(cfg['issuer']) : '';
    if (wantIss && String(payload['iss'] ?? '') !== wantIss) {
      throw new OperationalError('Token issuer not allowed by source policy', { status: 403 });
    }
    const wantAud = cfg['expectedAudience'] ? String(cfg['expectedAudience']) : '';
    if (wantAud) {
      const aud = payload['aud'];
      const ok = Array.isArray(aud) ? aud.map(String).includes(wantAud) : String(aud ?? '') === wantAud;
      if (!ok) throw new OperationalError('Token audience not allowed by source policy', { status: 403 });
    }
    const roles = Array.isArray(cfg['allowedRoles']) ? (cfg['allowedRoles'] as unknown[]).map(String) : null;
    if (roles && roles.length && !roles.includes(String(payload['role'] ?? ''))) {
      throw new OperationalError('Token role not allowed by source policy', { status: 403 });
    }
  }

  /* ── 令牌交换（RFC 8693 简化）── */
  /**
   * 对端令牌 → 按 kid 找信任密钥验签 + exp + 源策略(iss/aud/role) + jti 防重放 → 换发本实例令牌。
   * 携带身份 claims（email/name/role）供宿主 provision;act={iss:对端} 标委托来源。
   */
  async exchangeToken(presentedToken: string): Promise<{ token: string; actor: string; subject: string; claims: JsonObject }> {
    const decoded = decodeInstanceToken(presentedToken);
    if (!decoded?.header.kid) throw new OperationalError('Malformed token (no kid)', { status: 400 });
    const trusted = await this.repos.instanceTrust.findTrustedKey(decoded.header.kid);
    if (!trusted) throw new OperationalError('Token signed by an untrusted key', { status: 401 });
    const verified = verifyInstanceToken(presentedToken, trusted.publicKey, this.now());
    if (!verified.ok) throw new OperationalError(`Token rejected: ${verified.reason}`, { status: 401 });

    // 源策略强校验（iss/aud/role）——#47 M2 对齐 n8n
    const source = trusted.sourceId ? await this.repos.instanceTrust.findSource(trusted.sourceId) : null;
    this.validateClaims(verified.payload, source);

    const jti = String(verified.payload['jti'] ?? '');
    const exp = Number(verified.payload['exp'] ?? 0);
    if (!jti) throw new OperationalError('Token missing jti', { status: 400 });
    const fresh = await this.repos.instanceTrust.recordJtiIfNew(jti, new Date((exp || Math.floor(this.now() / 1000) + TOKEN_TTL_SEC) * 1000));
    if (!fresh) throw new OperationalError('Token replay detected (jti already used)', { status: 409 });
    await this.repos.instanceTrust.pruneExpiredJti(new Date(this.now())).catch(() => undefined);

    const subject = String(verified.payload['sub'] ?? '');
    const actor = String(verified.payload['iss'] ?? decoded.header.kid);
    // 透传身份 claims（供宿主 provision 用户）——对齐 n8n embed 语义
    const identity: JsonObject = {};
    for (const c of ['email', 'given_name', 'family_name', 'role'] as const) {
      if (verified.payload[c] !== undefined) identity[c] = verified.payload[c] as JsonObject[string];
    }
    const token = await this.signToken({ sub: subject, aud: 'self', act: { iss: actor }, ...identity });
    return { token, actor, subject, claims: identity };
  }
}
