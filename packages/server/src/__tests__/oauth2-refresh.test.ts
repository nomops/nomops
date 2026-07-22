import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * OAuth2 token 临期自动续期（backlog #16）：
 * - 过期 + 有 refresh_token → 执行注入前经 demo 提供方真 HTTP 刷新并存回（含轮换）;
 * - 未过期不动;无 oauthTokenData 的普通凭证完全不受影响;
 * - 注入视图把 oauthTokenData 摊平到顶层（声明式 Bearer {{access_token}} 直接可用）。
 */
let boot: BootstrapResult;
let app: Express;
let server: Server;
let token: string;
let projectId: string;
const PORT = 41000 + Math.floor(Math.random() * 800);

const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  process.env['NOMOPS_BASE_URL'] = `http://127.0.0.1:${PORT}`;
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  server = app.listen(PORT); // demo token 端点要真 HTTP 可达（refreshIfNeeded 用 fetch）
  const reg = await request(app).post('/auth/register').send({ email: 'oauth@test.dev', password: 'password-123' }).expect(201);
  token = reg.body.token;
  projectId = reg.body.projectId;
});

afterAll(async () => {
  delete process.env['NOMOPS_BASE_URL'];
  server.close();
  await boot.shutdown();
});

describe('OAuth2 自动续期', () => {
  it('过期 → 刷新并轮换;未过期不动;注入视图摊平 oauthTokenData', async () => {
    const cred = await request(app)
      .post('/api/credentials')
      .set(authed())
      .send({ name: 'demo-oauth', type: 'demoOAuth2', data: { provider: 'demo', clientId: 'c1', clientSecret: 's1', scope: 'demo' } })
      .expect(201);

    // 模拟「已连接但 token 已过期」状态
    await boot.services.credentials.updateData(cred.body.id as string, projectId, {
      oauthTokenData: {
        access_token: 'stale-token',
        token_type: 'Bearer',
        refresh_token: 'old-refresh',
        scope: 'demo',
        expires_at: Date.now() - 1000,
      },
    });

    // 执行注入路径 → 触发刷新（demo 端点发新 token）+ 摊平
    const injected = await boot.services.credentials.getDecryptedData(cred.body.id as string, projectId);
    expect(String(injected['access_token'])).toMatch(/^demo-access-/); // 顶层可用 & 已换新
    expect(String(injected['access_token'])).not.toBe('stale-token');

    const stored = await boot.services.credentials.rawData(cred.body.id as string, projectId);
    const tok = stored['oauthTokenData'] as Record<string, unknown>;
    expect(String(tok['access_token'])).toMatch(/^demo-access-/);
    expect(String(tok['refresh_token'])).toMatch(/^demo-refresh-/); // 轮换生效
    expect(Number(tok['expires_at'])).toBeGreaterThan(Date.now());

    // 未过期:再注入不再刷新（token 稳定）
    const again = await boot.services.credentials.getDecryptedData(cred.body.id as string, projectId);
    expect(again['access_token']).toBe(injected['access_token']);
  });

  it('普通凭证（无 oauthTokenData）不受影响', async () => {
    const cred = await request(app)
      .post('/api/credentials')
      .set(authed())
      .send({ name: 'plain', type: 'httpHeaderAuth', data: { apiKey: 'plain-key' } })
      .expect(201);
    const injected = await boot.services.credentials.getDecryptedData(cred.body.id as string, projectId);
    expect(injected['apiKey']).toBe('plain-key');
  });
});
