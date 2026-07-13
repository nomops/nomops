import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * docs/11 Phase C：控制平面指标只读接口 GET /internal/usage。
 * 共享密钥（NOMOPS_INTERNAL_TOKEN）鉴权，非用户会话；未注入密钥（自托管）→ 端点 404。
 */

const OWNER = 'NOMOPS_OWNER_EMAIL';
const PLAN = 'NOMOPS_PLAN';
const QUOTA = 'NOMOPS_PLAN_QUOTA';
const TOKEN = 'NOMOPS_INTERNAL_TOKEN';
const SECRET = 'cp-internal-secret';

let boot: BootstrapResult;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  process.env[OWNER] = 'boss@corp.com';
  process.env[PLAN] = 'pro';
  process.env[QUOTA] = '10000';
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
});

afterEach(() => {
  process.env[TOKEN] = SECRET; // 多数用例需要密钥启用；个别用例内部临时删除
});

afterAll(async () => {
  for (const k of [OWNER, PLAN, QUOTA, TOKEN]) delete process.env[k];
  await boot.shutdown();
});

describe('GET /internal/usage', () => {
  it('未注入 NOMOPS_INTERNAL_TOKEN（自托管）→ 端点 404', async () => {
    delete process.env[TOKEN];
    await request(app).get('/internal/usage').set('x-internal-token', SECRET).expect(404);
  });

  it('缺密钥头 / 错密钥 → 401', async () => {
    process.env[TOKEN] = SECRET;
    await request(app).get('/internal/usage').expect(401);
    await request(app).get('/internal/usage').set('x-internal-token', 'wrong').expect(401);
  });

  it('正确密钥 → 200，返回 owner 项目聚合用量（未跑执行 used=0，limit/plan 来自下发）', async () => {
    process.env[TOKEN] = SECRET;
    const res = await request(app).get('/internal/usage').set('x-internal-token', SECRET).expect(200);
    expect(res.body.period).toMatch(/^\d{4}-\d{2}$/);
    expect(res.body.used).toBe(0);
    expect(res.body.limit).toBe(10000);
    expect(res.body.plan).toBe('pro');
    // 铁律 3：只回聚合计数，不含任何密钥/凭证
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });
});
