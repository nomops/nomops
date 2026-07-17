import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/** 首访引导：无用户 needsSetup=true → 注册 owner（带姓名）→ false；第二人注册被 403。 */
let boot: BootstrapResult;
let app: Express;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
});

afterAll(async () => {
  await boot.shutdown();
});

describe('GET /auth/needs-setup', () => {
  it('空实例 true → 建 owner（firstName/lastName 落库）→ false → 开放注册关闭', async () => {
    let res = await request(app).get('/auth/needs-setup').expect(200);
    expect(res.body).toEqual({ needsSetup: true });

    const reg = await request(app)
      .post('/auth/register')
      .send({ email: 'owner@setup.dev', password: 'Password-123', firstName: 'Demo', lastName: 'Owner' })
      .expect(201);
    expect(reg.body.user.firstName).toBe('Demo');
    expect(reg.body.user.lastName).toBe('Owner');

    res = await request(app).get('/auth/needs-setup').expect(200);
    expect(res.body).toEqual({ needsSetup: false });

    await request(app)
      .post('/auth/register')
      .send({ email: 'second@setup.dev', password: 'Password-123' })
      .expect(403);
  });
});

describe('Personal settings（改姓名 / 改口令）', () => {
  it('PATCH /api/me 更新姓名；改口令先验当前口令', async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'owner@setup.dev', password: 'Password-123' })
      .expect(200);
    const authed = { Authorization: `Bearer ${login.body.token as string}` };

    const updated = await request(app)
      .patch('/api/me')
      .set(authed)
      .send({ firstName: 'Renamed', lastName: 'User' })
      .expect(200);
    expect(updated.body.firstName).toBe('Renamed');

    // 错误旧口令 → 403，口令不变
    await request(app)
      .post('/api/me/password')
      .set(authed)
      .send({ currentPassword: 'wrong-password', newPassword: 'NewPassword-456' })
      .expect(403);
    await request(app).post('/auth/login').send({ email: 'owner@setup.dev', password: 'Password-123' }).expect(200);

    // 正确旧口令 → 换密成功，旧密失效新密可登录
    await request(app)
      .post('/api/me/password')
      .set(authed)
      .send({ currentPassword: 'Password-123', newPassword: 'NewPassword-456' })
      .expect(200);
    await request(app).post('/auth/login').send({ email: 'owner@setup.dev', password: 'Password-123' }).expect(400);
    await request(app).post('/auth/login').send({ email: 'owner@setup.dev', password: 'NewPassword-456' }).expect(200);
  });
});
