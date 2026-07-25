import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { licensedBoot, setupOwner } from './helpers.js';

/**
 * backlog #46 M2：运行时按 subject 贯通 + user_entry + HTTP 解析器。
 * 验收：同一 workflow 同一凭证引用,run as subject X → 注入 X 的值；user 域 entry 生效；
 * http 解析器按 subject 取值。注入假 httpRequest(捕获注入的凭证) + 假 resolver fetch,不打真网。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
let projectId: string;
let userId: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

// 捕获声明式节点发出的请求（Telegram getMe 的 URL 含注入的 accessToken）
const httpCalls: Array<{ url: string }> = [];
const captureHttp = (async (opts: unknown) => {
  const o = opts as { url?: string; baseUrl?: string };
  httpCalls.push({ url: `${o.baseUrl ?? ''}${o.url ?? ''}` });
  return { ok: true };
}) as (o: unknown) => Promise<unknown>;

// 假动态凭证 http 解析器端点：按 subject 回不同 token
const resolverFetch = (async (_url: unknown, init?: { body?: string }) => {
  const body = JSON.parse(init?.body ?? '{}') as { subject?: string };
  return new Response(JSON.stringify({ accessToken: `http-${body.subject}` }), { status: 200 });
}) as typeof fetch;

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot(), httpRequest: captureHttp, dynamicCredentialFetch: resolverFetch });
  app = createApp(boot.services);
  const owner = await setupOwner(app, 'dynm2@cred.dev');
  token = owner.token;
  projectId = owner.projectId;
  userId = owner.userId;
});

afterAll(async () => {
  await boot.shutdown();
});

/** 建一个挂了 table 解析器的 resolvable telegramApi 凭证,返回 {credId, resolverId}。 */
async function makeResolvableTelegram(name: string) {
  const credId = (await request(app).post('/api/credentials').set(authed()).send({ name, type: 'telegramApi', data: { accessToken: 'placeholder' } }).expect(201)).body.id;
  const resolverId = (await request(app).post('/api/dynamic-credentials/resolvers').set(authed()).send({ name: `${name}-resolver`, kind: 'table' }).expect(201)).body.id;
  await request(app).post(`/api/credentials/${credId}/resolver`).set(authed()).send({ resolverId }).expect(204);
  return { credId, resolverId };
}

describe('user_entry 回退 + http 解析器（#46 M2，service 级）', () => {
  it('无 subject entry → 回退按 userId 取 user_entry', async () => {
    const { credId, resolverId } = await makeResolvableTelegram('UserFallback');
    await request(app).put(`/api/dynamic-credentials/resolvers/${resolverId}/user-entry`).set(authed()).send({ userId, data: { accessToken: 'per-user-tok' } }).expect(204);
    // 传了 subject 但无该 subject 的 entry → 回退 userId 的 user_entry
    const d = await boot.services.credentials.getDecryptedData(credId, projectId, 'no-such-subject', userId);
    expect(d['accessToken']).toBe('per-user-tok');
  });

  it('subject entry 优先于 user_entry', async () => {
    const { credId, resolverId } = await makeResolvableTelegram('SubjectWins');
    await request(app).put(`/api/dynamic-credentials/resolvers/${resolverId}/user-entry`).set(authed()).send({ userId, data: { accessToken: 'per-user' } }).expect(204);
    await request(app).put(`/api/dynamic-credentials/resolvers/${resolverId}/entry`).set(authed()).send({ subject: 'tenant-1', data: { accessToken: 'per-subject' } }).expect(204);
    const d = await boot.services.credentials.getDecryptedData(credId, projectId, 'tenant-1', userId);
    expect(d['accessToken']).toBe('per-subject');
  });

  it('user_entry 列表不泄露值（铁律 3）', async () => {
    const { resolverId } = await makeResolvableTelegram('UserList');
    await request(app).put(`/api/dynamic-credentials/resolvers/${resolverId}/user-entry`).set(authed()).send({ userId, data: { accessToken: 'secret-uv' } }).expect(204);
    const users = (await request(app).get(`/api/dynamic-credentials/resolvers/${resolverId}/users`).set(authed()).expect(200)).body;
    expect(users).toHaveLength(1);
    expect(JSON.stringify(users)).not.toContain('secret-uv');
  });

  it('http 解析器：按 subject 打端点取值', async () => {
    const credId = (await request(app).post('/api/credentials').set(authed()).send({ name: 'HttpRes', type: 'telegramApi', data: { accessToken: 'x' } }).expect(201)).body.id;
    const resolverId = (await request(app).post('/api/dynamic-credentials/resolvers').set(authed()).send({ name: 'http-res', kind: 'http', config: { url: 'https://host.example/resolve' } }).expect(201)).body.id;
    await request(app).post(`/api/credentials/${credId}/resolver`).set(authed()).send({ resolverId }).expect(204);
    const a = await boot.services.credentials.getDecryptedData(credId, projectId, 'acme', userId);
    const b = await boot.services.credentials.getDecryptedData(credId, projectId, 'globex', userId);
    expect(a['accessToken']).toBe('http-acme');
    expect(b['accessToken']).toBe('http-globex');
  });
});

describe('运行时按 subject 贯通引擎（#46 M2）', () => {
  let credId = '';
  let workflowId = '';

  it('挂 resolvable 凭证 + 两 subject 值,建用它的工作流', async () => {
    const made = await makeResolvableTelegram('RunSubject');
    credId = made.credId;
    await request(app).put(`/api/dynamic-credentials/resolvers/${made.resolverId}/entry`).set(authed()).send({ subject: 'acme', data: { accessToken: 'TOK-ACME' } }).expect(204);
    await request(app).put(`/api/dynamic-credentials/resolvers/${made.resolverId}/entry`).set(authed()).send({ subject: 'globex', data: { accessToken: 'TOK-GLOBEX' } }).expect(204);
    // 也给触发者 userId 存一个 user_entry（无 subject 时回退用）
    await request(app).put(`/api/dynamic-credentials/resolvers/${made.resolverId}/user-entry`).set(authed()).send({ userId, data: { accessToken: 'TOK-USER' } }).expect(204);

    workflowId = (await request(app).post('/api/workflows').set(authed()).send({
      name: 'Ping telegram',
      nodes: [
        { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'b', name: 'TG', type: 'nomops.telegram', typeVersion: 1, position: [220, 0], parameters: { operation: 'getMe' }, credentials: { telegramApi: { id: credId, name: 'RunSubject' } } },
      ],
      connections: { Start: { main: [[{ node: 'TG', type: 'main', index: 0 }]] } },
    }).expect(201)).body.id;
  });

  it('run as subject=acme → 注入 acme 的 token', async () => {
    httpCalls.length = 0;
    const r = (await request(app).post(`/api/workflows/${workflowId}/run`).set(authed()).send({ subject: 'acme' }).expect(200)).body;
    expect(r.status).toBe('success');
    expect(httpCalls.some((c) => c.url.includes('/botTOK-ACME/'))).toBe(true);
    expect(httpCalls.some((c) => c.url.includes('TOK-GLOBEX'))).toBe(false);
  });

  it('run as subject=globex → 注入 globex 的 token（同一 workflow 同一凭证,值随 subject 变）', async () => {
    httpCalls.length = 0;
    await request(app).post(`/api/workflows/${workflowId}/run`).set(authed()).send({ subject: 'globex' }).expect(200);
    expect(httpCalls.some((c) => c.url.includes('/botTOK-GLOBEX/'))).toBe(true);
  });

  it('run 无 subject → 回退触发者 userId 的 user_entry', async () => {
    httpCalls.length = 0;
    await request(app).post(`/api/workflows/${workflowId}/run`).set(authed()).send({}).expect(200);
    expect(httpCalls.some((c) => c.url.includes('/botTOK-USER/'))).toBe(true);
  });
});
