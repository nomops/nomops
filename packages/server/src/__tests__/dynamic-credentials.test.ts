import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { licensedBoot, setupOwner } from './helpers.js';

/**
 * backlog #46 M1：动态凭证 —— 一个逻辑凭证运行时按 subject 解析成不同值。
 * 验收：标一凭证 resolvable 挂 table 解析器 → 加两 subject 的 entry → getDecryptedData 按
 * subject 返不同值；非 resolvable 不变；解析值不出 API。license 门 dynamicCredentials。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
let projectId: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot() });
  app = createApp(boot.services);
  const owner = await setupOwner(app, 'dyn@cred.dev');
  token = owner.token;
  projectId = owner.projectId;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('动态凭证（#46 M1）', () => {
  let credId = '';
  let resolverId = '';

  it('建凭证 + 建 table 解析器（config 不出 API）', async () => {
    credId = (await request(app).post('/api/credentials').set(authed()).send({
      name: 'Tenant Slack', type: 'slackApi', data: { accessToken: 'placeholder' },
    }).expect(201)).body.id;

    const r = (await request(app).post('/api/dynamic-credentials/resolvers').set(authed()).send({ name: 'per-tenant slack', kind: 'table' }).expect(201)).body;
    resolverId = r.id;
    expect(r.kind).toBe('table');
    expect(r.config).toBeUndefined(); // config 不出 API
  });

  it('标凭证 resolvable + 挂解析器', async () => {
    await request(app).post(`/api/credentials/${credId}/resolver`).set(authed()).send({ resolverId }).expect(204);
  });

  it('加两个 subject 的 entry（值只进不出）', async () => {
    await request(app).put(`/api/dynamic-credentials/resolvers/${resolverId}/entry`).set(authed()).send({ subject: 'tenant-A', data: { accessToken: 'xoxb-AAA' } }).expect(204);
    await request(app).put(`/api/dynamic-credentials/resolvers/${resolverId}/entry`).set(authed()).send({ subject: 'tenant-B', data: { accessToken: 'xoxb-BBB' } }).expect(204);

    const subjects = (await request(app).get(`/api/dynamic-credentials/resolvers/${resolverId}/subjects`).set(authed()).expect(200)).body as Array<{ subject: string; data?: unknown }>;
    expect(subjects.map((s) => s.subject).sort()).toEqual(['tenant-A', 'tenant-B']);
    // 铁律 3：值密文不出 API
    expect(JSON.stringify(subjects)).not.toContain('xoxb');
    expect(subjects.every((s) => s.data === undefined)).toBe(true);
  });

  it('★核心：getDecryptedData 按 subject 返不同实际值', async () => {
    const a = await boot.services.credentials.getDecryptedData(credId, projectId, 'tenant-A');
    const b = await boot.services.credentials.getDecryptedData(credId, projectId, 'tenant-B');
    expect(a['accessToken']).toBe('xoxb-AAA');
    expect(b['accessToken']).toBe('xoxb-BBB');
  });

  it('缺 subject → fail-fast（不静默取错值）', async () => {
    await expect(boot.services.credentials.getDecryptedData(credId, projectId)).rejects.toThrow(/subject/i);
  });

  it('未知 subject → 404（无该 subject 的值）', async () => {
    await expect(boot.services.credentials.getDecryptedData(credId, projectId, 'tenant-Z')).rejects.toThrow(/No dynamic credential value/i);
  });

  it('upsert：同 subject 覆盖', async () => {
    await request(app).put(`/api/dynamic-credentials/resolvers/${resolverId}/entry`).set(authed()).send({ subject: 'tenant-A', data: { accessToken: 'xoxb-AAA2' } }).expect(204);
    const a = await boot.services.credentials.getDecryptedData(credId, projectId, 'tenant-A');
    expect(a['accessToken']).toBe('xoxb-AAA2');
    // subject 数不增（覆盖非新增）
    const subjects = (await request(app).get(`/api/dynamic-credentials/resolvers/${resolverId}/subjects`).set(authed()).expect(200)).body;
    expect(subjects).toHaveLength(2);
  });

  it('删 subject → 再解析 404', async () => {
    await request(app).delete(`/api/dynamic-credentials/resolvers/${resolverId}/entry?subject=tenant-B`).set(authed()).expect(204);
    await expect(boot.services.credentials.getDecryptedData(credId, projectId, 'tenant-B')).rejects.toThrow();
  });

  it('解除 resolvable → 回退固定密文老行为（subject 被忽略）', async () => {
    await request(app).delete(`/api/credentials/${credId}/resolver`).set(authed()).expect(204);
    const d = await boot.services.credentials.getDecryptedData(credId, projectId, 'tenant-A');
    expect(d['accessToken']).toBe('placeholder'); // 回到凭证自身固定值
  });

  it('非 resolvable 凭证不受影响（普通凭证正常解密）', async () => {
    const plain = (await request(app).post('/api/credentials').set(authed()).send({ name: 'Plain', type: 'httpHeaderAuth', data: { name: 'X-Key', value: 'static-123' } }).expect(201)).body.id;
    const d = await boot.services.credentials.getDecryptedData(plain, projectId);
    expect(d['value']).toBe('static-123');
  });
});

describe('license 门（#46 M1）', () => {
  it('无 dynamicCredentials license → 403', async () => {
    const unlicensed = await bootstrap({ dbConfig: { type: 'sqlite' } });
    const app2 = createApp(unlicensed.services);
    const owner = await setupOwner(app2, 'nolic@cred.dev');
    await request(app2).post('/api/dynamic-credentials/resolvers').set({ Authorization: `Bearer ${owner.token}` }).send({ name: 'x' }).expect(403);
    await unlicensed.shutdown();
  });
});
