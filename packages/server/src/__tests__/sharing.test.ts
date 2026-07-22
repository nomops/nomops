import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser, licensedBoot, setupOwner } from './helpers.js';

/**
 * 工作流/凭证共享（backlog #12,企业功能 sharing）：
 * - owner 项目共享给受享项目 → 受享方列表可见、可读/跑/改;不可删/再共享;
 * - 取消共享立即失效;getOwnerProjectId 在多共享行下仍取 owner（生产触发凭证上下文命门）;
 * - 凭证共享:受享可列表/执行注入,不可改/删;共享清单不出密文;
 * - 社区版:共享端点 403 带 feature。
 */
let boot: BootstrapResult;
let app: Express;
let a: { token: string; userId: string; projectId: string };
let b: { token: string; userId: string; projectId: string };

const as = (t: string) => ({ Authorization: `Bearer ${t}` });

const wfBody = (name: string) => ({
  name,
  nodes: [
    { id: 'x', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: 'y', name: 'Fill', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { ok: 1 } } },
  ],
  connections: { Start: { main: [[{ node: 'Fill', type: 'main', index: 0 }]] } },
});

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot() });
  app = createApp(boot.services);
  a = await setupOwner(app, 'a@share.dev');
  b = await inviteUser(app, a.token, 'b@share.dev');
});

afterAll(async () => {
  await boot.shutdown();
});

describe('工作流共享', () => {
  it('share-targets 列出对方个人项目;共享后受享方可见/可跑/可改,不可删/再共享;取消共享即失效', async () => {
    const wf = await request(app).post('/api/workflows').set(as(a.token)).send(wfBody('shared-flow')).expect(201);

    // 目标清单含 B 的个人项目
    const targets = await request(app).get('/api/share-targets').set(as(a.token)).expect(200);
    const bTarget = (targets.body.targets as Array<{ projectId: string; label: string }>).find(
      (t) => t.projectId === b.projectId,
    );
    expect(bTarget?.label).toContain('b@share.dev');

    // 共享前 B 看不到
    await request(app).get(`/api/workflows/${wf.body.id}`).set(as(b.token)).expect(404);

    // A 共享给 B
    const shared = await request(app)
      .put(`/api/workflows/${wf.body.id}/share`)
      .set(as(a.token))
      .send({ projectIds: [b.projectId] })
      .expect(200);
    const roles = Object.fromEntries(
      (shared.body.shares as Array<{ projectId: string; role: string }>).map((s) => [s.projectId, s.role]),
    );
    expect(roles[a.projectId]).toBe('workflow:owner');
    expect(roles[b.projectId]).toBe('workflow:editor');

    // B:列表可见、可读、可跑、可改
    const list = await request(app).get('/api/workflows').set(as(b.token)).expect(200);
    expect(list.body.map((w: { id: string }) => w.id)).toContain(wf.body.id);
    const run = await request(app).post(`/api/workflows/${wf.body.id}/run`).set(as(b.token)).send({}).expect(200);
    expect(run.body.status).toBe('success');
    await request(app)
      .patch(`/api/workflows/${wf.body.id}`)
      .set(as(b.token))
      .send({ name: 'renamed-by-b' })
      .expect(200);

    // Shared with you 页数据
    const sharedList = await request(app).get('/api/shared/workflows').set(as(b.token)).expect(200);
    expect(sharedList.body.map((w: { id: string }) => w.id)).toContain(wf.body.id);
    // owner 侧的 shared 列表不含自己拥有的
    const sharedForA = await request(app).get('/api/shared/workflows').set(as(a.token)).expect(200);
    expect(sharedForA.body.map((w: { id: string }) => w.id)).not.toContain(wf.body.id);

    // B:不可删、不可再共享、不可读共享面
    await request(app).delete(`/api/workflows/${wf.body.id}`).set(as(b.token)).expect(403);
    await request(app)
      .put(`/api/workflows/${wf.body.id}/share`)
      .set(as(b.token))
      .send({ projectIds: [] })
      .expect(403);
    await request(app).get(`/api/workflows/${wf.body.id}/share`).set(as(b.token)).expect(403);

    // 多共享行下 owner 解析仍指 A（生产触发凭证上下文命门）
    expect(await boot.services.repos.workflows.getOwnerProjectId(wf.body.id as string)).toBe(a.projectId);

    // A 取消共享 → B 立即 404
    await request(app).put(`/api/workflows/${wf.body.id}/share`).set(as(a.token)).send({ projectIds: [] }).expect(200);
    await request(app).get(`/api/workflows/${wf.body.id}`).set(as(b.token)).expect(404);
  });

  it('幽灵目标项目 400;owner 项目自身被忽略不重复插行', async () => {
    const wf = await request(app).post('/api/workflows').set(as(a.token)).send(wfBody('ghost-target')).expect(201);
    await request(app)
      .put(`/api/workflows/${wf.body.id}/share`)
      .set(as(a.token))
      .send({ projectIds: ['00000000-0000-0000-0000-000000000000'] })
      .expect(400);
    const self = await request(app)
      .put(`/api/workflows/${wf.body.id}/share`)
      .set(as(a.token))
      .send({ projectIds: [a.projectId] })
      .expect(200);
    expect(self.body.shares).toHaveLength(1); // 只有 owner 行
  });
});

describe('凭证共享', () => {
  it('受享方列表可见,不可改/删;清单不出密文;取消共享即失效', async () => {
    const cred = await request(app)
      .post('/api/credentials')
      .set(as(a.token))
      .send({ name: 'shared-key', type: 'httpHeaderAuth', data: { apiKey: 'top-secret-99' } })
      .expect(201);

    await request(app)
      .put(`/api/credentials/${cred.body.id}/share`)
      .set(as(a.token))
      .send({ projectIds: [b.projectId] })
      .expect(200);

    // B 列表可见（可挂到节点上执行注入）
    const list = await request(app).get('/api/credentials').set(as(b.token)).expect(200);
    expect(list.body.map((c: { id: string }) => c.id)).toContain(cred.body.id);
    expect(JSON.stringify(list.body)).not.toContain('top-secret-99');

    // 受享清单/shared 端点均不出明文与密文
    const sharedCreds = await request(app).get('/api/shared/credentials').set(as(b.token)).expect(200);
    expect(sharedCreds.body.map((c: { id: string }) => c.id)).toContain(cred.body.id);
    expect(JSON.stringify(sharedCreds.body)).not.toMatch(/top-secret-99|v1:/);

    // B 不可改/删
    await request(app)
      .patch(`/api/credentials/${cred.body.id}`)
      .set(as(b.token))
      .send({ name: 'hijack' })
      .expect(403);
    await request(app).delete(`/api/credentials/${cred.body.id}`).set(as(b.token)).expect(403);

    // 取消共享 → B 404
    await request(app).put(`/api/credentials/${cred.body.id}/share`).set(as(a.token)).send({ projectIds: [] }).expect(200);
    await request(app).get(`/api/credentials/${cred.body.id}/share`).set(as(b.token)).expect(404);
  });
});

describe('跨项目转移（backlog #13）', () => {
  it('转到我有 editor 权的团队项目;非成员目标 403;受享方不可转;文件夹归零', async () => {
    // A 建团队项目(自动成为 owner)
    const team = await request(app).post('/api/projects').set(as(a.token)).send({ name: 'Move Target' }).expect(201);
    const teamId = team.body.id as string;

    // A 建文件夹 + 放进去的工作流,共享给 B
    const folder = await request(app).post('/api/folders').set(as(a.token)).send({ name: 'src-folder' }).expect(201);
    const wf = await request(app)
      .post('/api/workflows')
      .set(as(a.token))
      .send({ ...wfBody('transfer-me'), folderId: folder.body.id })
      .expect(201);
    await request(app).put(`/api/workflows/${wf.body.id}/share`).set(as(a.token)).send({ projectIds: [b.projectId] }).expect(200);

    // 受享方 B 不可转移(非 owner 项目)
    await request(app)
      .post(`/api/workflows/${wf.body.id}/transfer`)
      .set(as(b.token))
      .send({ projectId: b.projectId })
      .expect(403);
    // A 转到 B 的个人项目 → A 非其成员 403
    await request(app)
      .post(`/api/workflows/${wf.body.id}/transfer`)
      .set(as(a.token))
      .send({ projectId: b.projectId })
      .expect(403);

    // A 转到团队项目 → 成功;个人项目不再可见,团队上下文可见;文件夹归零;共享行清空
    const moved = await request(app)
      .post(`/api/workflows/${wf.body.id}/transfer`)
      .set(as(a.token))
      .send({ projectId: teamId })
      .expect(200);
    expect(moved.body.folderId).toBeNull();
    await request(app).get(`/api/workflows/${wf.body.id}`).set(as(a.token)).expect(404);
    await request(app).get(`/api/workflows/${wf.body.id}`).set(as(b.token)).expect(404); // 共享行已清
    const inTeam = await request(app)
      .get(`/api/workflows/${wf.body.id}`)
      .set({ ...as(a.token), 'X-Project-Id': teamId })
      .expect(200);
    expect(inTeam.body.name).toBe('transfer-me');
    expect(await boot.services.repos.workflows.getOwnerProjectId(wf.body.id as string)).toBe(teamId);
  });
});

describe('社区版门控', () => {
  it('无 sharing 功能位 → 共享端点 403 带 feature', async () => {
    const cboot = await bootstrap({ dbConfig: { type: 'sqlite' }, licenseKey: null });
    const capp = createApp(cboot.services);
    const owner = await setupOwner(capp, 'c@share.dev');
    const wf = await request(capp).post('/api/workflows').set(as(owner.token)).send(wfBody('community')).expect(201);
    const res = await request(capp)
      .put(`/api/workflows/${wf.body.id}/share`)
      .set(as(owner.token))
      .send({ projectIds: [] })
      .expect(403);
    expect(res.body.feature).toBe('sharing');
    await request(capp).get('/api/share-targets').set(as(owner.token)).expect(403);
    await cboot.shutdown();
  });
});
