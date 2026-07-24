import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #44 M1：Agent 定义 + 版本 —— 建/发布/回滚/列表；旧 chat_agents 迁入不丢。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'ag@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'ag@test.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('Agent 定义 + 版本（backlog #44 M1）', () => {
  let agentId = '';

  it('建 agent → 列表可见', async () => {
    const created = await request(app).post('/api/agents').set(authed()).send({ name: 'Support', config: { system: 'You are helpful.' } }).expect(201);
    agentId = created.body.id;
    expect(created.body).toMatchObject({ name: 'Support', active: false });
    const list = (await request(app).get('/api/agents').set(authed()).expect(200)).body;
    expect(list.some((a: { id: string }) => a.id === agentId)).toBe(true);
  });

  it('发布 → v1；改配置再发布 → v2', async () => {
    const p1 = await request(app).post(`/api/agents/${agentId}/publish`).set(authed()).expect(200);
    expect(p1.body.versionNumber).toBe(1);
    await request(app).patch(`/api/agents/${agentId}`).set(authed()).send({ config: { system: 'You are concise.' } }).expect(200);
    const p2 = await request(app).post(`/api/agents/${agentId}/publish`).set(authed()).expect(200);
    expect(p2.body.versionNumber).toBe(2);

    const versions = (await request(app).get(`/api/agents/${agentId}/versions`).set(authed()).expect(200)).body;
    expect(versions).toHaveLength(2);
    expect(versions[0].versionNumber).toBe(2); // 最新在前
  });

  it('回滚到 v1 → 当前配置恢复,史线新增一版', async () => {
    const versions = (await request(app).get(`/api/agents/${agentId}/versions`).set(authed()).expect(200)).body;
    const v1 = versions.find((v: { versionNumber: number }) => v.versionNumber === 1);
    await request(app).post(`/api/agents/${agentId}/versions/${v1.id}/restore`).set(authed()).expect(200);

    const cur = (await request(app).get(`/api/agents/${agentId}`).set(authed()).expect(200)).body;
    expect(cur.config).toEqual({ system: 'You are helpful.' }); // 回到 v1 定义
    const after = (await request(app).get(`/api/agents/${agentId}/versions`).set(authed()).expect(200)).body;
    expect(after).toHaveLength(3); // 回滚也产生一版（史线线性）
  });

  it('别项目/不存在 id → 404', async () => {
    await request(app).get('/api/agents/nope').set(authed()).expect(404);
  });

  it('删除 → 列表不再有', async () => {
    await request(app).delete(`/api/agents/${agentId}`).set(authed()).expect(204);
    const list = (await request(app).get('/api/agents').set(authed()).expect(200)).body;
    expect(list.some((a: { id: string }) => a.id === agentId)).toBe(false);
  });
});

describe('chat_agents 迁移（backlog #44 M1）', () => {
  it('旧个人 chat agent 一次性迁进 agents 平台,不丢', async () => {
    const file = '/tmp/nomops-agent-backfill.db';
    rmSync(file, { force: true });
    // 第一次启动：注册用户 + 建个人 chat agent + 重置迁移标志
    let b = await bootstrap({ dbConfig: { type: 'sqlite', filename: file } });
    let a = createApp(b.services);
    const reg = await request(a).post('/auth/register').send({ email: 'mig@test.dev', password: 'password-123' }).expect(201);
    const tok = reg.body.token;
    await request(a).put('/api/chat/agents/11111111-1111-4111-8111-111111111111').set({ Authorization: `Bearer ${tok}` }).send({ name: 'Legacy Bot', system: 'old system prompt' }).expect(200);
    await b.services.repos.settings.set('agents.backfilled', ''); // 空串 → 重触发迁移
    await b.shutdown();

    // 第二次启动同一文件：迁移应把 chat agent 搬进 agents
    b = await bootstrap({ dbConfig: { type: 'sqlite', filename: file } });
    a = createApp(b.services);
    const login = await request(a).post('/auth/login').send({ email: 'mig@test.dev', password: 'password-123' }).expect(200);
    const agents = (await request(a).get('/api/agents').set({ Authorization: `Bearer ${login.body.token}` }).expect(200)).body;
    const migrated = agents.find((x: { name: string }) => x.name === 'Legacy Bot');
    expect(migrated).toBeTruthy();
    expect(migrated.config).toEqual({ system: 'old system prompt' });
    await b.shutdown();
    rmSync(file, { force: true });
  });
});
