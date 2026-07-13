import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser } from './helpers.js';

/**
 * 工作流文件夹（对标 n8n）：CRUD + 嵌套 + 工作流归属文件夹/移动/过滤 + 非空拒删 + 防环。
 * in-memory SQLite。
 */

let boot: BootstrapResult;
let app: Express;
let jwt: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'folders@demo.dev', password: 'password-123' }).expect(201);
  jwt = (await request(app).post('/auth/login').send({ email: 'folders@demo.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.dbHandle.close();
});

const auth = () => ({ Authorization: `Bearer ${jwt}` });
const emptyWf = (name: string, folderId?: string | null) => ({ name, nodes: [], connections: {}, ...(folderId !== undefined ? { folderId } : {}) });

describe('文件夹 CRUD + 嵌套', () => {
  let root: string;
  let child: string;

  it('创建根文件夹 + 子文件夹；GET 列出全部', async () => {
    const a = await request(app).post('/api/folders').set(auth()).send({ name: 'Marketing' }).expect(201);
    root = a.body.id;
    expect(a.body.parentFolderId).toBeNull();
    const b = await request(app).post('/api/folders').set(auth()).send({ name: 'Campaigns', parentFolderId: root }).expect(201);
    child = b.body.id;
    expect(b.body.parentFolderId).toBe(root);
    const list = await request(app).get('/api/folders').set(auth()).expect(200);
    expect(list.body.map((f: { id: string }) => f.id).sort()).toEqual([root, child].sort());
  });

  it('未知父文件夹 → 404；缺名 → 400', async () => {
    await request(app).post('/api/folders').set(auth()).send({ name: 'x', parentFolderId: 'nope' }).expect(404);
    await request(app).post('/api/folders').set(auth()).send({}).expect(400);
  });

  it('重命名', async () => {
    const r = await request(app).patch(`/api/folders/${root}`).set(auth()).send({ name: 'Growth' }).expect(200);
    expect(r.body.name).toBe('Growth');
  });

  it('防环：移动到自身/后代 → 400', async () => {
    await request(app).patch(`/api/folders/${root}`).set(auth()).send({ parentFolderId: root }).expect(400); // 自身
    await request(app).patch(`/api/folders/${root}`).set(auth()).send({ parentFolderId: child }).expect(400); // 后代
  });
});

describe('工作流归属文件夹 / 移动 / 过滤', () => {
  let folder: string;
  let wfInFolder: string;

  it('建文件夹 + 在文件夹里建工作流', async () => {
    folder = (await request(app).post('/api/folders').set(auth()).send({ name: 'Ops' }).expect(201)).body.id;
    const wf = await request(app).post('/api/workflows').set(auth()).send(emptyWf('in-ops', folder)).expect(201);
    wfInFolder = wf.body.id;
    expect(wf.body.folderId).toBe(folder);
    // 根工作流
    await request(app).post('/api/workflows').set(auth()).send(emptyWf('at-root')).expect(201);
  });

  it('无效 folderId 建工作流 → 404', async () => {
    await request(app).post('/api/workflows').set(auth()).send(emptyWf('bad', 'nope')).expect(404);
  });

  it('?folderId 过滤：指定文件夹 vs 根', async () => {
    const inFolder = await request(app).get(`/api/workflows?folderId=${folder}`).set(auth()).expect(200);
    expect(inFolder.body.map((w: { name: string }) => w.name)).toEqual(['in-ops']);
    const atRoot = await request(app).get('/api/workflows?folderId=root').set(auth()).expect(200);
    expect(atRoot.body.some((w: { name: string }) => w.name === 'at-root')).toBe(true);
    expect(atRoot.body.some((w: { name: string }) => w.name === 'in-ops')).toBe(false);
  });

  it('移动工作流：到根 → folderId null', async () => {
    const moved = await request(app).patch(`/api/workflows/${wfInFolder}`).set(auth()).send({ folderId: null }).expect(200);
    expect(moved.body.folderId).toBeNull();
    const inFolder = await request(app).get(`/api/workflows?folderId=${folder}`).set(auth()).expect(200);
    expect(inFolder.body).toHaveLength(0);
  });
});

describe('非空拒删 + 归属', () => {
  it('非空文件夹拒删（400），清空后可删（204）', async () => {
    const f = (await request(app).post('/api/folders').set(auth()).send({ name: 'Tmp' }).expect(201)).body.id;
    const wf = (await request(app).post('/api/workflows').set(auth()).send(emptyWf('tmp-wf', f)).expect(201)).body.id;
    await request(app).delete(`/api/folders/${f}`).set(auth()).expect(400); // 非空
    await request(app).patch(`/api/workflows/${wf}`).set(auth()).send({ folderId: null }).expect(200); // 清空
    await request(app).delete(`/api/folders/${f}`).set(auth()).expect(204);
  });

  it('别的用户看不到/删不了我的文件夹（归属隔离）', async () => {
    const mine = (await request(app).post('/api/folders').set(auth()).send({ name: 'Private' }).expect(201)).body.id;
    const otherJwt = (await inviteUser(app, jwt, 'other-f@demo.dev')).token;
    await request(app).delete(`/api/folders/${mine}`).set({ Authorization: `Bearer ${otherJwt}` }).expect(404);
    const otherList = await request(app).get('/api/folders').set({ Authorization: `Bearer ${otherJwt}` }).expect(200);
    expect(otherList.body.find((f: { id: string }) => f.id === mine)).toBeUndefined();
  });
});
