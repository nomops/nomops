import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #37：登出令牌黑名单 —— 登出后旧 token 立即 401。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'lo@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'lo@test.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('登出令牌黑名单（backlog #37）', () => {
  it('登出前 token 可用', async () => {
    await request(app).get('/api/me').set({ Authorization: `Bearer ${token}` }).expect(200);
  });

  it('登出后旧 token 立即 401', async () => {
    await request(app).post('/auth/logout').set({ Authorization: `Bearer ${token}` }).expect(200);
    const res = await request(app).get('/api/me').set({ Authorization: `Bearer ${token}` }).expect(401);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it('重新登录拿到的新 token 不受影响', async () => {
    const fresh = (await request(app).post('/auth/login').send({ email: 'lo@test.dev', password: 'password-123' }).expect(200)).body.token;
    await request(app).get('/api/me').set({ Authorization: `Bearer ${fresh}` }).expect(200);
  });

  it('登出无 token → 幂等 200', async () => {
    await request(app).post('/auth/logout').expect(200);
  });
});
