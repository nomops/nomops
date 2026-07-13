import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { totp, verifyTotp } from '../services/mfa-service.js';

/**
 * 两步验证（TOTP）：setup → enable → 登录需第二因素 → 备份码 → 停用。
 * in-memory SQLite。
 */

let boot: BootstrapResult;
let app: Express;
let jwt: string;
let secret: string;
let backupCodes: string[];

const EMAIL = 'mfa@demo.dev';
const PASSWORD = 'password-123';

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: EMAIL, password: PASSWORD }).expect(201);
  jwt = (await request(app).post('/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.dbHandle.close();
});

const bearer = () => ({ Authorization: `Bearer ${jwt}` });

describe('TOTP 算法', () => {
  it('生成码可被校验；异窗口/错码不过', () => {
    const s = 'JBSWY3DPEHPK3PXP'; // 常见测试 secret
    const now = 1_700_000_000_000;
    expect(verifyTotp(s, totp(s, now), now)).toBe(true);
    expect(verifyTotp(s, '000000', now)).toBe(false);
    // 远离当前窗口（+10 分钟）的码不被接受
    expect(verifyTotp(s, totp(s, now + 600_000), now)).toBe(false);
    // 相邻窗口容忍（±30s）
    expect(verifyTotp(s, totp(s, now - 30_000), now)).toBe(true);
  });
});

describe('设置 → 启用', () => {
  it('setup 返回 secret/otpauth/备份码，此时未启用', async () => {
    const res = await request(app).post('/api/mfa/setup').set(bearer()).expect(200);
    secret = res.body.secret;
    backupCodes = res.body.backupCodes;
    expect(res.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(res.body.otpauthUri).toContain(`secret=${secret}`);
    expect(backupCodes).toHaveLength(10);
    const me = await request(app).get('/api/me').set(bearer()).expect(200);
    expect(me.body.mfaEnabled).toBe(false);
  });

  it('错码 enable → 400；正确码 → 启用，/me 显示已开', async () => {
    await request(app).post('/api/mfa/enable').set(bearer()).send({ code: '000000' }).expect(400);
    await request(app).post('/api/mfa/enable').set(bearer()).send({ code: totp(secret) }).expect(200);
    const me = await request(app).get('/api/me').set(bearer()).expect(200);
    expect(me.body.mfaEnabled).toBe(true);
  });
});

describe('登录需第二因素', () => {
  it('无码 → mfaRequired（无 token）；错码 → 401；正确 TOTP → 发 token', async () => {
    const r1 = await request(app).post('/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
    expect(r1.body.mfaRequired).toBe(true);
    expect(r1.body.token).toBeUndefined();

    await request(app).post('/auth/login').send({ email: EMAIL, password: PASSWORD, mfaCode: '000000' }).expect(401);

    const r2 = await request(app)
      .post('/auth/login')
      .send({ email: EMAIL, password: PASSWORD, mfaCode: totp(secret) })
      .expect(200);
    expect(r2.body.token).toBeTruthy();
  });

  it('备份码登录成功且一次性（复用即失效）', async () => {
    const code = backupCodes[0]!;
    const ok = await request(app).post('/auth/login').send({ email: EMAIL, password: PASSWORD, mfaCode: code }).expect(200);
    expect(ok.body.token).toBeTruthy();
    // 同一备份码再用 → 401
    await request(app).post('/auth/login').send({ email: EMAIL, password: PASSWORD, mfaCode: code }).expect(401);
  });
});

describe('停用', () => {
  it('错码 → 400；正确码 → 停用；之后登录不再需码', async () => {
    await request(app).post('/api/mfa/disable').set(bearer()).send({ code: '000000' }).expect(400);
    await request(app).post('/api/mfa/disable').set(bearer()).send({ code: totp(secret) }).expect(200);
    const login = await request(app).post('/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
    expect(login.body.token).toBeTruthy();
    expect(login.body.mfaRequired).toBeUndefined();
  });
});
