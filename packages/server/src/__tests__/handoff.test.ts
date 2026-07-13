import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/** docs/11 Phase 2.5：实例侧 /auth/handoff 落地——验签控制平面签的令牌 → 给 owner 签发会话。 */

const SECRET = 'shared-handoff-secret';
const SLUG = 'acme';
const OWNER = 'boss@corp.com';

/** 复刻控制平面的 mintHandoff（两包无共享代码）。 */
function mint(claims: { email: string; slug: string }, exp: number): string {
  const payload = Buffer.from(JSON.stringify({ ...claims, exp })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

let boot: BootstrapResult;
let app: Express;

beforeEach(() => {
  process.env['NOMOPS_HANDOFF_SECRET'] = SECRET;
  process.env['NOMOPS_TENANT_SLUG'] = SLUG;
  process.env['NOMOPS_OWNER_EMAIL'] = OWNER;
});
afterEach(async () => {
  for (const k of ['NOMOPS_HANDOFF_SECRET', 'NOMOPS_TENANT_SLUG', 'NOMOPS_OWNER_EMAIL']) delete process.env[k];
  await boot.shutdown();
});

async function start() {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
}

describe('实例 /auth/handoff', () => {
  it('有效令牌 → 200 HTML 含会话令牌，且会话可访问 API', async () => {
    await start();
    const token = mint({ email: OWNER, slug: SLUG }, Date.now() + 60_000);
    const res = await request(app).get(`/auth/handoff?token=${encodeURIComponent(token)}`).expect(200);
    expect(res.headers['content-type']).toMatch(/html/);
    const m = res.text.match(/"token":"([^"]+)"/);
    expect(m).toBeTruthy();
    await request(app).get('/api/workflows').set({ Authorization: `Bearer ${m![1]}` }).expect(200);
  });

  it('过期令牌 → 401', async () => {
    await start();
    const token = mint({ email: OWNER, slug: SLUG }, Date.now() - 1000);
    await request(app).get(`/auth/handoff?token=${encodeURIComponent(token)}`).expect(401);
  });

  it('slug 不匹配 → 401（令牌不是给本实例的）', async () => {
    await start();
    const token = mint({ email: OWNER, slug: 'other-instance' }, Date.now() + 60_000);
    await request(app).get(`/auth/handoff?token=${encodeURIComponent(token)}`).expect(401);
  });

  it('异密钥签的令牌 → 401', async () => {
    await start();
    const payload = Buffer.from(JSON.stringify({ email: OWNER, slug: SLUG, exp: Date.now() + 60_000 })).toString('base64url');
    const badSig = createHmac('sha256', 'wrong-secret').update(payload).digest('base64url');
    await request(app).get(`/auth/handoff?token=${payload}.${badSig}`).expect(401);
  });

  it('未知邮箱 → 401（本实例无此账户）', async () => {
    await start();
    const token = mint({ email: 'nobody@corp.com', slug: SLUG }, Date.now() + 60_000);
    await request(app).get(`/auth/handoff?token=${encodeURIComponent(token)}`).expect(401);
  });
});
