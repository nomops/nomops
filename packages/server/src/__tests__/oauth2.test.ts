import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/** 凭证 OAuth2（Connect my account）流程：授权 URL → 回调换 token → 连接状态；token 绝不出 API。 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'oauth@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'oauth@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.dbHandle.close();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

async function createDemoCred(): Promise<string> {
  const res = await request(app)
    .post('/api/credentials')
    .set(authed())
    .send({ name: 'Demo OAuth2 account', type: 'demoOAuth2', data: { provider: 'demo', clientId: 'demo' } })
    .expect(201);
  return res.body.id as string;
}

describe('凭证 OAuth2', () => {
  it('create → auth URL → callback 换 token → connected 变 true', async () => {
    const id = await createDemoCred();

    const before = await request(app).get(`/api/credentials/${id}/oauth-status`).set(authed()).expect(200);
    expect(before.body).toEqual({ connected: false });

    const auth = await request(app).get(`/api/oauth2/auth?id=${id}`).set(authed()).expect(200);
    const authUrl = new URL(auth.body.authUrl);
    expect(authUrl.pathname).toBe('/oauth2/demo/authorize');
    expect(authUrl.searchParams.get('redirect_uri')).toContain('/oauth2/callback');
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    // 回调会向 demo token URL 发请求换 token——mock 掉这次 fetch
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: 'demo-abc', token_type: 'Bearer', expires_in: 3600, refresh_token: 'r' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await request(app).get(`/oauth2/callback?code=demo-code&state=${state}`).expect(200);
    fetchSpy.mockRestore();

    const after = await request(app).get(`/api/credentials/${id}/oauth-status`).set(authed()).expect(200);
    expect(after.body).toEqual({ connected: true });
  });

  it('oauth-status 只回 connected，绝不泄露 token（铁律 3）', async () => {
    const id = await createDemoCred();
    const res = await request(app).get(`/api/credentials/${id}/oauth-status`).set(authed()).expect(200);
    expect(Object.keys(res.body)).toEqual(['connected']);
    expect(JSON.stringify(res.body)).not.toMatch(/access_token|token/i);
  });

  it('缺 Authorization URL / Client ID → 400', async () => {
    const res = await request(app)
      .post('/api/credentials')
      .set(authed())
      .send({ name: 'empty oauth', type: 'oauth2Api', data: {} })
      .expect(201);
    await request(app).get(`/api/oauth2/auth?id=${res.body.id}`).set(authed()).expect(400);
  });

  it('过期/未知 state 的回调 → 报错（不写入 token）', async () => {
    const callback = await request(app).get('/oauth2/callback?code=x&state=bogus-state');
    // 回调渲染 HTML 提示失败（弹窗页），不 500
    expect(callback.status).toBe(200);
    expect(callback.text).toContain('failed');
  });
});
