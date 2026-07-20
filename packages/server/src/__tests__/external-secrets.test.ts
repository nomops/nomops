import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import type { ISecretsProvider } from '../services/secrets-service.js';
import { licensedBoot } from './helpers.js';

/**
 * B4 验收：外部密钥 provider 状态 + 凭证内 {{ $secrets.KEY }} 引用在注入时物化 +
 * license 门 + 密钥值绝不出 API。
 */

function fakeProvider(map: Record<string, string>): ISecretsProvider {
  return {
    name: () => '测试 provider',
    available: () => Object.keys(map).length > 0,
    keys: () => Object.keys(map),
    get: (k) => map[k],
  };
}

let boot: BootstrapResult;
let app: Express;
let token: string;
let projectId: string;

async function setup(opts: { enterprise: boolean; secrets?: Record<string, string> }) {
  boot = await bootstrap({
    dbConfig: { type: 'sqlite' },
    ...(opts.enterprise ? licensedBoot() : { licenseKey: null }),
    secretsProvider: fakeProvider(opts.secrets ?? {}),
  });
  app = createApp(boot.services);
  const reg = await request(app).post('/auth/register').send({ email: 'es@dev.dev', password: 'password-123' }).expect(201);
  token = reg.body.token;
  projectId = reg.body.projectId;
}
const authed = () => ({ Authorization: `Bearer ${token}` });

afterEach(async () => {
  await boot.shutdown();
});

describe('外部密钥（External Secrets）', () => {
  it('社区版 → 状态端点 403 带 feature 标识', async () => {
    await setup({ enterprise: false, secrets: { OPENAI_KEY: 'sk-real' } });
    const res = await request(app).get('/api/external-secrets').set(authed()).expect(403);
    expect(res.body.feature).toBe('externalSecrets');
  });

  it('企业版：状态只返回 provider + key 名，绝不含值', async () => {
    await setup({ enterprise: true, secrets: { OPENAI_KEY: 'sk-real-value', SLACK_TOKEN: 'xoxb-real' } });
    const res = await request(app).get('/api/external-secrets').set(authed()).expect(200);
    expect(res.body.provider).toBe('测试 provider');
    expect(res.body.enabled).toBe(true);
    expect(res.body.keys.sort()).toEqual(['OPENAI_KEY', 'SLACK_TOKEN']);
    expect(JSON.stringify(res.body)).not.toContain('sk-real-value'); // 铁律 3
    expect(JSON.stringify(res.body)).not.toContain('xoxb-real');
  });

  it('企业版：凭证里的 {{ $secrets.KEY }} 在执行注入时物化为真值', async () => {
    await setup({ enterprise: true, secrets: { OPENAI_KEY: 'sk-materialized-123' } });
    const cred = await request(app)
      .post('/api/credentials')
      .set(authed())
      .send({ name: 'openai', type: 'httpHeaderAuth', data: { name: 'Authorization', value: 'Bearer {{ $secrets.OPENAI_KEY }}' } })
      .expect(201);

    // getDecryptedData 是执行时的凭证注入链路——断言引用已物化为真值。
    const resolved = await boot.services.credentials.getDecryptedData(cred.body.id, projectId);
    expect(resolved['value']).toBe('Bearer sk-materialized-123');
    // 且 API 视图永不含明文（也不含引用本身）
    const list = await request(app).get('/api/credentials').set(authed()).expect(200);
    expect(JSON.stringify(list.body)).not.toContain('sk-materialized-123');
    expect(JSON.stringify(list.body)).not.toContain('$secrets');
  });

  it('引用不存在的 key → 注入时报错（fail-fast，不静默空值）', async () => {
    await setup({ enterprise: true, secrets: {} });
    const cred = await request(app)
      .post('/api/credentials')
      .set(authed())
      .send({ name: 'x', type: 'httpHeaderAuth', data: { name: 'A', value: '{{ $secrets.MISSING }}' } })
      .expect(201);
    await expect(
      boot.services.credentials.getDecryptedData(cred.body.id, projectId),
    ).rejects.toThrow(/External secret not found: MISSING/);
  });

  it('社区版：凭证含 $secrets 引用 → 注入时 403（不把引用当明文泄露）', async () => {
    await setup({ enterprise: false, secrets: { K: 'v' } });
    const cred = await request(app)
      .post('/api/credentials')
      .set(authed())
      .send({ name: 'x', type: 'httpHeaderAuth', data: { name: 'A', value: '{{ $secrets.K }}' } })
      .expect(201);
    await expect(
      boot.services.credentials.getDecryptedData(cred.body.id, projectId),
    ).rejects.toThrow(/Enterprise/);
  });

  it('无 $secrets 引用的普通凭证不受影响', async () => {
    await setup({ enterprise: true, secrets: {} });
    const cred = await request(app)
      .post('/api/credentials')
      .set(authed())
      .send({ name: 'plain', type: 'httpHeaderAuth', data: { name: 'A', value: 'literal-value' } })
      .expect(201);
    const resolved = await boot.services.credentials.getDecryptedData(cred.body.id, projectId);
    expect(resolved['value']).toBe('literal-value');
  });
});
