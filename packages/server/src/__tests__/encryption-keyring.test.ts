import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { setupOwner } from './helpers.js';

describe('外部主密钥 + DEK 信封轮换', () => {
  let boot: BootstrapResult;
  let app: Express;
  let token: string;
  let projectId: string;
  const bearer = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    boot = await bootstrap({ dbConfig: { type: 'sqlite' }, encryptionMasterKey: randomBytes(32) });
    app = createApp(boot.services);
    ({ token, projectId } = await setupOwner(app, 'keyring@test.dev'));
  });

  afterAll(async () => {
    await boot.shutdown();
  });

  it('DB 不再保存明文 encryptionKey，只保存被包裹的 keyring', async () => {
    expect(await boot.services.repos.settings.get('encryptionKey')).toBeNull();
    const stored = await boot.services.repos.settings.get('encryptionKeyring.v1');
    expect(stored).toContain('wrapped');
    expect(stored).not.toMatch(/"key"\s*:/);
    const status = await request(app).get('/api/security/encryption-key').set(bearer()).expect(200);
    expect(status.body.mode).toBe('external-envelope');
  });

  it('轮换后新密文使用新 keyId，旧密文仍可解密', async () => {
    const first = await request(app)
      .post('/api/credentials')
      .set(bearer())
      .send({ name: 'before', type: 'httpHeaderAuth', data: { name: 'X-Key', value: 'before-secret' } })
      .expect(201);
    const firstRow = await boot.services.repos.credentials.findById(first.body.id as string, projectId);
    const firstKeyId = String(firstRow!.data).split(':')[1];
    expect(firstRow!.data).toMatch(/^v2:/);

    const rotated = await request(app).post('/api/security/encryption-key/rotate').set(bearer()).expect(200);
    expect(rotated.body.activeKeyId).not.toBe(firstKeyId);
    expect(rotated.body.retainedKeys).toBe(2);

    const second = await request(app)
      .post('/api/credentials')
      .set(bearer())
      .send({ name: 'after', type: 'httpHeaderAuth', data: { name: 'X-Key', value: 'after-secret' } })
      .expect(201);
    const secondRow = await boot.services.repos.credentials.findById(second.body.id as string, projectId);
    expect(String(secondRow!.data).split(':')[1]).toBe(rotated.body.activeKeyId);

    await expect(boot.services.credentials.rawData(first.body.id as string, projectId)).resolves.toMatchObject({
      value: 'before-secret',
    });
    await expect(boot.services.credentials.rawData(second.body.id as string, projectId)).resolves.toMatchObject({
      value: 'after-secret',
    });
  });
});
