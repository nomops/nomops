import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { setupOwner, inviteUser } from './helpers.js';

/**
 * 许可证激活（对标 n8n「Enter activation key」）：运行时激活/移除，企业功能即时解锁/关闭。
 * 起点社区版（无 LICENSE_KEY）；激活后从 DB 生效，无需重启。实例 admin 门控。
 */

let boot: BootstrapResult;
let app: Express;
let owner: string;
let member: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, licenseKey: null });
  app = createApp(boot.services);
  owner = (await setupOwner(app, 'owner@lic.dev')).token;
  member = (await inviteUser(app, owner, 'member@lic.dev')).token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('起点：社区版', () => {
  it('/api/license → community，未激活', async () => {
    const res = await request(app).get('/api/license').set(bearer(owner)).expect(200);
    expect(res.body.plan).toBe('community');
    expect(res.body.activated).toBe(false);
    expect(res.body.features).toHaveLength(0);
  });

  it('企业功能端点被功能门挡下（403 feature）', async () => {
    const res = await request(app).get('/api/source-control').set(bearer(owner)).expect(403);
    expect(res.body.feature).toBe('sourceControl');
  });
});

describe('激活', () => {
  it('非 admin 激活 → 403', async () => {
    await request(app).post('/api/license/activate').set(bearer(member)).send({ activationKey: 'ent-key' }).expect(403);
  });

  it('空 key → 400', async () => {
    await request(app).post('/api/license/activate').set(bearer(owner)).send({ activationKey: '' }).expect(400);
  });

  it('owner 激活 → enterprise，功能位齐全，且落库', async () => {
    const res = await request(app).post('/api/license/activate').set(bearer(owner)).send({ activationKey: 'ent-key-123' }).expect(200);
    expect(res.body.plan).toBe('enterprise');
    expect(res.body.activated).toBe(true);
    expect(res.body.features).toContain('sourceControl');
    // 落库（重启后仍生效）
    expect(await boot.services.repos.settings.get('license.activationKey')).toBe('ent-key-123');
  });

  it('激活后企业端点即时解锁（不再 403 feature）', async () => {
    const res = await request(app).get('/api/source-control').set(bearer(owner)).expect(200);
    expect(res.body.connected).toBe(false); // 未连接，但功能门已放行
  });
});

describe('移除', () => {
  it('owner 移除 → 回落 community，功能门恢复', async () => {
    const res = await request(app).delete('/api/license').set(bearer(owner)).expect(200);
    expect(res.body.plan).toBe('community');
    expect(res.body.activated).toBe(false);
    await request(app).get('/api/source-control').set(bearer(owner)).expect(403);
    expect((await boot.services.repos.settings.get('license.activationKey')) || '').toBe('');
  });
});
