import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #43：平台零散补差清扫 —— 实例升级史 / MCP registry 缓存 / 文件夹打标 / 每用户偏好。逐项验证。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'plat@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'plat@test.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('平台零散补差（backlog #43）', () => {
  it('实例升级史：启动记录当前版本,可查', async () => {
    const hist = (await request(app).get('/api/instance/version-history').set(authed()).expect(200)).body as Array<{ version: string }>;
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(hist[0]!.version).toBe('0.1.0');
  });

  it('MCP registry 缓存：刷新写入,列表可读', async () => {
    expect((await request(app).get('/api/mcp-registry').set(authed()).expect(200)).body).toHaveLength(0);
    const refreshed = (await request(app).post('/api/mcp-registry/refresh').set(authed()).expect(200)).body;
    expect(refreshed.length).toBeGreaterThanOrEqual(3);
    expect((await request(app).get('/api/mcp-registry').set(authed()).expect(200)).body.length).toBe(refreshed.length);
  });

  it('每用户偏好：PUT /me/settings 落库,/me 回显', async () => {
    await request(app).put('/api/me/settings').set(authed()).send({ sidebarCollapsed: true, theme: 'dark' }).expect(200);
    await request(app).put('/api/me/settings').set(authed()).send({ locale: 'zh-CN' }).expect(200);
    const me = (await request(app).get('/api/me').set(authed()).expect(200)).body;
    expect(me.settings).toEqual({ sidebarCollapsed: true, theme: 'dark', locale: 'zh-CN' });
  });

  it('文件夹打标：设标签,回读', async () => {
    const folder = (await request(app).post('/api/folders').set(authed()).send({ name: 'Ops' }).expect(201)).body;
    const tag = (await request(app).post('/api/tags').set(authed()).send({ name: 'critical' }).expect(201)).body;
    const set = (await request(app).put(`/api/folders/${folder.id}/tags`).set(authed()).send({ tagIds: [tag.id] }).expect(200)).body;
    expect(set.map((t: { name: string }) => t.name)).toEqual(['critical']);
    const got = (await request(app).get(`/api/folders/${folder.id}/tags`).set(authed()).expect(200)).body;
    expect(got).toHaveLength(1);
  });
});
