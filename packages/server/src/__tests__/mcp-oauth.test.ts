import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * MCP OAuth 2.0 授权码 + PKCE（backlog #25）：
 * 元数据发现 → authorize(redirect 允许清单+PKCE) → token(code_verifier) → OAuth token 可访问 MCP。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const REDIRECT = 'http://localhost:9999/callback';

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'mcpoauth@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'mcpoauth@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
  // 启用 MCP + 配 redirect 允许清单
  await request(app).post('/api/mcp/enable').set({ Authorization: `Bearer ${token}` }).expect(200);
  await request(app)
    .put('/api/mcp/redirect-urls')
    .set({ Authorization: `Bearer ${token}` })
    .send({ redirectUrls: [REDIRECT] })
    .expect(200);
});

afterAll(async () => {
  await boot.shutdown();
});

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

describe('MCP OAuth', () => {
  it('元数据发现暴露 authorize/token 端点 + S256', async () => {
    const meta = await request(app).get('/.well-known/oauth-authorization-server').expect(200);
    expect(meta.body.authorization_endpoint).toContain('/mcp-server/oauth/authorize');
    expect(meta.body.token_endpoint).toContain('/mcp-server/oauth/token');
    expect(meta.body.code_challenge_methods_supported).toContain('S256');
  });

  it('全流程:authorize → code → token → OAuth token 访问 MCP', async () => {
    const { verifier, challenge } = pkce();
    // authorize:302 回 redirect 带 code
    const auth = await request(app)
      .get('/mcp-server/oauth/authorize')
      .query({
        client_id: 'my-mcp-client',
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'xyz',
      })
      .expect(302);
    const loc = new URL(auth.headers['location']!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get('state')).toBe('xyz');
    const code = loc.searchParams.get('code')!;
    expect(code).toBeTruthy();

    // token:code + verifier → access_token
    const tok = await request(app)
      .post('/mcp-server/oauth/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT })
      .expect(200);
    expect(tok.body.token_type).toBe('Bearer');
    expect(tok.body.access_token).toMatch(/^nmcp_oauth_/);
    const oauthToken = tok.body.access_token as string;

    // OAuth token 可访问 MCP（initialize）
    const rpc = await request(app)
      .post('/mcp-server/http')
      .set('Authorization', `Bearer ${oauthToken}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'c', version: '1' } } })
      .expect(200);
    expect(rpc.body.result.serverInfo.name).toBe('nomops');

    // 授权码一次性:重放 → 400
    await request(app)
      .post('/mcp-server/oauth/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT })
      .expect(400);
  });

  it('redirect 不在允许清单 → 400', async () => {
    const { challenge } = pkce();
    await request(app)
      .get('/mcp-server/oauth/authorize')
      .query({ client_id: 'c', redirect_uri: 'http://evil.com/cb', code_challenge: challenge, code_challenge_method: 'S256' })
      .expect(400);
  });

  it('PKCE verifier 不匹配 → 400', async () => {
    const { challenge } = pkce();
    const auth = await request(app)
      .get('/mcp-server/oauth/authorize')
      .query({ client_id: 'c', redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' })
      .expect(302);
    const code = new URL(auth.headers['location']!).searchParams.get('code')!;
    await request(app)
      .post('/mcp-server/oauth/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code, code_verifier: 'wrong-verifier', redirect_uri: REDIRECT })
      .expect(400);
  });

  it('S256 之外的 method → 400;non-authorization_code grant → 400', async () => {
    await request(app)
      .get('/mcp-server/oauth/authorize')
      .query({ client_id: 'c', redirect_uri: REDIRECT, code_challenge: 'x', code_challenge_method: 'plain' })
      .expect(400);
    await request(app).post('/mcp-server/oauth/token').type('form').send({ grant_type: 'password' }).expect(400);
  });
});
