import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser } from './helpers.js';

/**
 * 公共 API 令牌：创建/列出/吊销 + 用令牌鉴权调 /api/*。
 * in-memory SQLite。
 */

let boot: BootstrapResult;
let app: Express;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
});

afterAll(async () => {
  await boot.dbHandle.close();
});

async function registerAndLogin(email: string): Promise<string> {
  await request(app).post('/auth/register').send({ email, password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email, password: 'password-123' }).expect(200);
  return login.body.token as string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const withKey = (key: string) => ({ 'x-nomops-api-key': key });

describe('公共 API 令牌', () => {
  let jwt: string;

  beforeAll(async () => {
    jwt = await registerAndLogin('keys@demo.dev');
  });

  it('创建 → 返回明文令牌（仅一次）+ 公开信息，不含密文', async () => {
    const res = await request(app).post('/api/api-keys').set(bearer(jwt)).send({ label: 'CI 部署' }).expect(201);
    expect(res.body.token).toMatch(/^nmp_/);
    expect(res.body.apiKey.label).toBe('CI 部署');
    expect(res.body.apiKey.prefix).toBe(res.body.token.slice(0, 12));
    // 铁律 3：不回哈希/明文入库字段
    expect(res.body.apiKey.tokenHash).toBeUndefined();
  });

  it('缺 label → 400', async () => {
    await request(app).post('/api/api-keys').set(bearer(jwt)).send({}).expect(400);
  });

  it('列表：只出公开字段（无 token/hash）', async () => {
    const res = await request(app).get('/api/api-keys').set(bearer(jwt)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].tokenHash).toBeUndefined();
    expect(res.body[0].token).toBeUndefined();
    expect(res.body[0].prefix).toMatch(/^nmp_/);
  });

  it('用 API 令牌鉴权调 /api/*（无 Bearer）→ 200', async () => {
    const created = await request(app).post('/api/api-keys').set(bearer(jwt)).send({ label: 'k2' }).expect(201);
    const token = created.body.token as string;
    // 只带 API key 头，不带 Authorization
    const wf = await request(app).get('/api/workflows').set(withKey(token)).expect(200);
    expect(Array.isArray(wf.body)).toBe(true);
    // 令牌能建工作流（写操作也走同一身份）
    await request(app)
      .post('/api/workflows')
      .set(withKey(token))
      .send({ name: 'via-api-key', nodes: [], connections: {} })
      .expect(201);
  });

  it('无效令牌 → 401；完全无鉴权 → 401', async () => {
    await request(app).get('/api/workflows').set(withKey('nmp_bogus')).expect(401);
    await request(app).get('/api/workflows').set(withKey('not-even-prefixed')).expect(401);
    await request(app).get('/api/workflows').expect(401);
  });

  it('吊销 → 204，之后该令牌失效（401）且列表不再含它', async () => {
    const created = await request(app).post('/api/api-keys').set(bearer(jwt)).send({ label: 'to-revoke' }).expect(201);
    const { id } = created.body.apiKey;
    const token = created.body.token as string;
    await request(app).get('/api/workflows').set(withKey(token)).expect(200); // 吊销前可用

    await request(app).delete(`/api/api-keys/${id}`).set(bearer(jwt)).expect(204);
    await request(app).get('/api/workflows').set(withKey(token)).expect(401); // 吊销后失效
    const list = await request(app).get('/api/api-keys').set(bearer(jwt)).expect(200);
    expect(list.body.find((k: { id: string }) => k.id === id)).toBeUndefined();
  });

  it('归属：吊销别人的令牌 → 404', async () => {
    const created = await request(app).post('/api/api-keys').set(bearer(jwt)).send({ label: 'mine' }).expect(201);
    const otherJwt = (await inviteUser(app, jwt, 'other-keys@demo.dev')).token;
    await request(app).delete(`/api/api-keys/${created.body.apiKey.id}`).set(bearer(otherJwt)).expect(404);
  });

  it('readonly 作用域：GET 放行，写请求 403', async () => {
    const created = await request(app)
      .post('/api/api-keys')
      .set(bearer(jwt))
      .send({ label: 'ro', scope: 'readonly', expiresInDays: 30 })
      .expect(201);
    expect(created.body.apiKey.scope).toBe('readonly');
    expect(created.body.apiKey.expiresAt).toBeTruthy();
    const key = created.body.token as string;

    await request(app).get('/api/workflows').set(withKey(key)).expect(200);
    await request(app)
      .post('/api/workflows')
      .set(withKey(key))
      .send({ name: 'x', nodes: [], connections: {} })
      .expect(403);
  });

  it('过期令牌 → 401', async () => {
    const created = await request(app).post('/api/api-keys').set(bearer(jwt)).send({ label: 'exp' }).expect(201);
    const key = created.body.token as string;
    await request(app).get('/api/workflows').set(withKey(key)).expect(200);
    // 直接把过期时间拨到过去（服务层不允许造过去时间，测试走原生连接改库；sqlite timestamp 存秒）
    const { createHash } = await import('node:crypto');
    const row = await boot.services.repos.apiKeys.findByTokenHash(
      createHash('sha256').update(key).digest('hex'),
    );
    (boot.dbHandle.db as { $client: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).$client
      .prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?')
      .run(Math.floor((Date.now() - 60_000) / 1000), row!.id);
    await request(app).get('/api/workflows').set(withKey(key)).expect(401);
  });
});
