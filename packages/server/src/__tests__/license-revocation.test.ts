import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { licensedBoot } from './helpers.js';

describe('license certificate revocation bridge', () => {
  let boot: BootstrapResult;
  let app: ReturnType<typeof createApp>;
  const secret = 'revocation-bridge-secret';

  beforeAll(async () => {
    process.env['NOMOPS_INTERNAL_TOKEN'] = secret;
    boot = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot() });
    app = createApp(boot.services);
  });

  afterAll(async () => {
    delete process.env['NOMOPS_INTERNAL_TOKEN'];
    await boot.shutdown();
  });

  it('鉴权同步证书 id 黑名单并立即关闭功能位，同时持久化', async () => {
    expect(boot.services.license.isFeatureEnabled('quotas')).toBe(true);
    await request(app).post('/internal/license/revocations').send({ ids: ['test-license'] }).expect(401);
    const response = await request(app)
      .post('/internal/license/revocations')
      .set('x-internal-token', secret)
      .send({ ids: ['test-license', 'test-license'] })
      .expect(200);
    expect(response.body).toMatchObject({ revoked: 1, license: { status: 'revoked', plan: 'community' } });
    expect(boot.services.license.isFeatureEnabled('quotas')).toBe(false);
    expect(await boot.services.repos.settings.get('license.revokedIds')).toBe('["test-license"]');
  });
});
