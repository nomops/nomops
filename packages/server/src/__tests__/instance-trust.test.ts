import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { licensedBoot, setupOwner } from './helpers.js';
import {
  decodeInstanceToken,
  generateDeploymentKeypair,
  signInstanceToken,
  verifyInstanceToken,
} from '../services/instance-token.js';

/**
 * backlog #47：实例信任密钥链 —— 部署密钥签名 + 信任对端公钥 + 令牌交换(RFC 8693 简化)防重放。
 * 验收：实例 A 签令牌 → 实例 B 信任 A 的公钥 → 交换成 B 令牌；重放/不信任/过期一律拒。
 */

describe('令牌原语（#47 单元）', () => {
  it('签→验往返 + 过期 + 篡改', () => {
    const kp = generateDeploymentKeypair();
    const now = 1_000_000_000_000;
    const tok = signInstanceToken({ sub: 'u1', jti: 'j1', exp: Math.floor(now / 1000) + 300 }, kp.privateKey, kp.kid);
    const ok = verifyInstanceToken(tok, kp.publicKey, now);
    expect(ok.ok).toBe(true);
    // 过期
    const expired = signInstanceToken({ sub: 'u1', jti: 'j2', exp: Math.floor(now / 1000) - 10 }, kp.privateKey, kp.kid);
    expect(verifyInstanceToken(expired, kp.publicKey, now)).toMatchObject({ ok: false, reason: 'expired' });
    // 篡改签名
    const tampered = `${tok.slice(0, -4)}AAAA`;
    expect(verifyInstanceToken(tampered, kp.publicKey, now).ok).toBe(false);
    // 别的公钥验不过
    const other = generateDeploymentKeypair();
    expect(verifyInstanceToken(tok, other.publicKey, now).ok).toBe(false);
  });
});

describe('两实例联邦 + 令牌交换（#47）', () => {
  let a: BootstrapResult;
  let b: BootstrapResult;

  beforeAll(async () => {
    a = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot() });
    b = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot() });
  });
  afterAll(async () => {
    await a.shutdown();
    await b.shutdown();
  });

  it('B 信任 A 的公钥 → A 签令牌 → B 交换成 B 令牌（subject 保留,actor=A,B 签名）', async () => {
    const aJwks = await a.services.instanceTrust.publicJwks();
    await b.services.instanceTrust.addTrustedKey({ jwk: aJwks.keys[0]!, issuer: 'instance-A' });

    const aToken = await a.services.instanceTrust.signToken({ sub: 'tenant-42' });
    const result = await b.services.instanceTrust.exchangeToken(aToken);
    expect(result.subject).toBe('tenant-42');
    // 交换出的令牌由 B 的部署密钥签名
    const bKey = await b.services.repos.instanceTrust.activeDeploymentKey();
    const verified = verifyInstanceToken(result.token, bKey!.publicKey);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload['sub']).toBe('tenant-42');
      expect((verified.payload['act'] as { iss?: string }).iss).toBe(result.actor);
    }
  });

  it('重放：同一令牌交换两次 → 第二次 409', async () => {
    const aJwks = await a.services.instanceTrust.publicJwks();
    await b.services.instanceTrust.addTrustedKey({ jwk: aJwks.keys[0]!, issuer: 'instance-A' });
    const aToken = await a.services.instanceTrust.signToken({ sub: 'once' });
    await b.services.instanceTrust.exchangeToken(aToken); // 首次 OK
    await expect(b.services.instanceTrust.exchangeToken(aToken)).rejects.toMatchObject({ context: { status: 409 } });
  });

  it('不信任的密钥签的令牌 → 401', async () => {
    const stranger = generateDeploymentKeypair();
    const nowS = Math.floor(Date.now() / 1000);
    const rogue = signInstanceToken({ iss: stranger.kid, sub: 'x', jti: 'rogue-1', exp: nowS + 300 }, stranger.privateKey, stranger.kid);
    await expect(b.services.instanceTrust.exchangeToken(rogue)).rejects.toMatchObject({ context: { status: 401 } });
  });

  it('过期令牌（即便密钥被信任）→ 401', async () => {
    const kp = generateDeploymentKeypair();
    const jwk = { kid: kp.kid, kty: 'OKP' as const, crv: 'Ed25519' as const, use: 'sig' as const, alg: 'EdDSA' as const,
      x: (await import('node:crypto')).createPublicKey({ key: Buffer.from(kp.publicKey, 'base64'), format: 'der', type: 'spki' }).export({ format: 'jwk' }).x as string };
    await b.services.instanceTrust.addTrustedKey({ jwk, issuer: 'expiring' });
    const nowS = Math.floor(Date.now() / 1000);
    const expired = signInstanceToken({ iss: kp.kid, sub: 'y', jti: 'exp-1', exp: nowS - 5 }, kp.privateKey, kp.kid);
    await expect(b.services.instanceTrust.exchangeToken(expired)).rejects.toMatchObject({ context: { status: 401 } });
  });

  it('JWKS 源刷新：从 A 的 JWKS URL 拉信任公钥（注入 fetch）', async () => {
    const aJwks = await a.services.instanceTrust.publicJwks();
    const fakeFetch = (async () => new Response(JSON.stringify(aJwks), { status: 200 })) as typeof fetch;
    const c = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot(), instanceTrustFetch: fakeFetch });
    try {
      const src = await c.services.instanceTrust.addSource('instance-A', 'https://a.example/instance-trust/jwks');
      const refreshed = await c.services.instanceTrust.refreshSource(src.id);
      expect(refreshed.imported).toBeGreaterThanOrEqual(1);
      // 拉来的密钥能验 A 的令牌
      const aToken = await a.services.instanceTrust.signToken({ sub: 'via-source' });
      const r = await c.services.instanceTrust.exchangeToken(aToken);
      expect(r.subject).toBe('via-source');
    } finally {
      await c.shutdown();
    }
  });

  it('轮换：旧钥留在 JWKS,对端仍能验旧令牌', async () => {
    const before = await a.services.instanceTrust.signToken({ sub: 'pre-rotate' });
    const oldKey = (await a.services.instanceTrust.publicJwks()).keys[0]!;
    await a.services.instanceTrust.rotateDeploymentKey();
    const jwks = await a.services.instanceTrust.publicJwks();
    expect(jwks.keys.length).toBeGreaterThanOrEqual(2); // 旧+新都在
    expect(jwks.keys.some((k) => k.kid === oldKey.kid)).toBe(true);
    // 旧令牌的 kid 仍能在 JWKS 找到（对端可验）
    const dec = decodeInstanceToken(before);
    expect(jwks.keys.some((k) => k.kid === dec!.header.kid)).toBe(true);
  });
});

describe('路由 + license 门（#47）', () => {
  let boot: BootstrapResult;
  let app: Express;

  beforeAll(async () => {
    boot = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot() });
    app = createApp(boot.services);
  });
  afterAll(async () => {
    await boot.shutdown();
  });

  it('公开 JWKS 路由（无需鉴权,license 开）', async () => {
    const jwks = (await request(app).get('/instance-trust/jwks').expect(200)).body;
    expect(Array.isArray(jwks.keys)).toBe(true);
    expect(jwks.keys[0].kty).toBe('OKP');
  });

  it('公开令牌交换路由：不信任 → 401', async () => {
    const stranger = generateDeploymentKeypair();
    const rogue = signInstanceToken({ sub: 'x', jti: 'r', exp: Math.floor(Date.now() / 1000) + 60 }, stranger.privateKey, stranger.kid);
    await request(app).post('/instance-trust/token/exchange').send({ token: rogue }).expect(401);
  });

  it('无 license → jwks/exchange 403', async () => {
    const unlic = await bootstrap({ dbConfig: { type: 'sqlite' } });
    const app2 = createApp(unlic.services);
    await request(app2).get('/instance-trust/jwks').expect(403);
    await request(app2).post('/instance-trust/token/exchange').send({ token: 'x' }).expect(403);
    await unlic.shutdown();
  });

  it('管理台 status 需 admin + license', async () => {
    const owner = await setupOwner(app, 'trust-admin@dev.dev');
    const st = (await request(app).get('/api/instance-trust').set({ Authorization: `Bearer ${owner.token}` }).expect(200)).body;
    expect(st.activeKid).toBeTruthy();
    expect(st.jwksUrl).toContain('/instance-trust/jwks');
  });
});
