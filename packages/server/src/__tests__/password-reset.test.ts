import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * 忘记密码（实例内，对标 n8n 自托管）：请求 → 重置 → 新口令生效/旧失效 → 一次性 / 过期 / 不枚举。
 * 明文 token 不入 API（走投递/日志），测试直接经 service 取 token 控制时间。
 */

let boot: BootstrapResult;
let app: Express;
const EMAIL = 'reset@demo.dev';

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: EMAIL, password: 'old-password-1' }).expect(201);
});

afterAll(async () => {
  await boot.dbHandle.close();
});

const login = (password: string, mfaCode?: string) =>
  request(app).post('/auth/login').send({ email: EMAIL, password, ...(mfaCode ? { mfaCode } : {}) });

describe('忘记密码', () => {
  it('/auth/forgot 恒回 ok（存在与否都不枚举）', async () => {
    await request(app).post('/auth/forgot').send({ email: EMAIL }).expect(200).expect({ ok: true });
    await request(app).post('/auth/forgot').send({ email: 'nobody@x.dev' }).expect(200).expect({ ok: true });
  });

  it('requestReset：未知邮箱 → null', async () => {
    expect(await boot.services.auth.requestReset('nobody@x.dev', Date.now())).toBeNull();
  });

  it('重置：新口令生效、旧失效、token 一次性', async () => {
    const r = await boot.services.auth.requestReset(EMAIL, Date.now());
    expect(r).not.toBeNull();

    await request(app).post('/auth/reset').send({ token: r!.token, password: 'new-password-2' }).expect(200);

    await login('old-password-1').expect(400); // 旧口令失效（无效凭据 → 400）
    const ok = await login('new-password-2').expect(200);
    expect(ok.body.token).toBeTruthy();

    // token 一次性：再用即失效
    await request(app).post('/auth/reset').send({ token: r!.token, password: 'x-password-3' }).expect(400);
  });

  it('无效 token → 400；弱密码 → 400；过期 → 400', async () => {
    await request(app).post('/auth/reset').send({ token: 'bogus', password: 'password-123' }).expect(400);
    const r = await boot.services.auth.requestReset(EMAIL, 0);
    // 弱密码
    await request(app).post('/auth/reset').send({ token: r!.token, password: 'short' }).expect(400);
    // 过期（超过 1h）—— 经 service 控时间
    await expect(boot.services.auth.resetPassword(r!.token, 'password-123', 3_600_001)).rejects.toMatchObject({
      context: { status: 400 },
    });
  });
});
