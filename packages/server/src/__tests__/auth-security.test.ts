import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

describe('账户与会话安全', () => {
  let boot: BootstrapResult;
  let app: Express;
  let token: string;
  const email = 'auth-security@test.dev';

  beforeAll(async () => {
    boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
    app = createApp(boot.services);
    const registered = await request(app)
      .post('/auth/register')
      .send({ email, password: 'password-123' })
      .expect(201);
    token = registered.body.token as string;
  });

  afterAll(async () => {
    await boot.shutdown();
  });

  it('改密递增 tokenVersion，所有旧 JWT 立即失效', async () => {
    await request(app)
      .post('/api/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'password-123', newPassword: 'password-456' })
      .expect(200);
    await request(app).get('/api/me').set('Authorization', `Bearer ${token}`).expect(401);
    const fresh = await request(app)
      .post('/auth/login')
      .send({ email, password: 'password-456' })
      .expect(200);
    token = fresh.body.token as string;
    await request(app).get('/api/me').set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('登录失败同时按账户和 IP 持久限流', async () => {
    const target = 'victim@test.dev';
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/auth/login').send({ email: target, password: 'wrong-password' }).expect(400);
    }
    await request(app).post('/auth/login').send({ email: target, password: 'wrong-password' }).expect(429);
    await expect(boot.services.authRateLimit.assertAllowed(target, 'different-ip')).rejects.toThrow(/too many/i);
  });
});
