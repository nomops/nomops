import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * 工作流版本历史（对标 n8n）：创建/编辑保存快照、列表、查看、回滚、归属隔离、删除清版本。
 * in-memory SQLite。规则：仅「定义变更」（nodes/connections）触发快照，纯改名/移动不算版本。
 */

let boot: BootstrapResult;
let app: Express;
let jwt: string;

const node = (name: string) => ({
  id: name,
  name,
  type: 'nomops.manualTrigger',
  typeVersion: 1,
  position: [0, 0] as [number, number],
  parameters: {},
});

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'ver@demo.dev', password: 'password-123' }).expect(201);
  jwt = (await request(app).post('/auth/login').send({ email: 'ver@demo.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.dbHandle.close();
});

const auth = () => ({ Authorization: `Bearer ${jwt}` });

describe('版本历史：快照 / 列表 / 查看 / 回滚', () => {
  let wf: string;

  it('创建工作流 → 自动落 v1', async () => {
    const r = await request(app)
      .post('/api/workflows')
      .set(auth())
      .send({ name: 'wf-v1', nodes: [node('Start')], connections: {} })
      .expect(201);
    wf = r.body.id;
    const versions = await request(app).get(`/api/workflows/${wf}/versions`).set(auth()).expect(200);
    expect(versions.body).toHaveLength(1);
    expect(versions.body[0].versionNumber).toBe(1);
    expect(versions.body[0].name).toBe('wf-v1');
    // 列表是元信息，不带大字段
    expect(versions.body[0].nodes).toBeUndefined();
  });

  it('定义变更（nodes）保存 → 落 v2；列表新→旧', async () => {
    await request(app)
      .patch(`/api/workflows/${wf}`)
      .set(auth())
      .send({ name: 'wf-v2', nodes: [node('Start'), node('Second')], connections: {} })
      .expect(200);
    const versions = await request(app).get(`/api/workflows/${wf}/versions`).set(auth()).expect(200);
    expect(versions.body.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
  });

  it('纯改名（无 nodes/connections）不产生新版本', async () => {
    await request(app).patch(`/api/workflows/${wf}`).set(auth()).send({ name: 'renamed-only' }).expect(200);
    const versions = await request(app).get(`/api/workflows/${wf}/versions`).set(auth()).expect(200);
    expect(versions.body).toHaveLength(2); // 仍是 2
  });

  it('查看单个版本 → 全量含 nodes/connections', async () => {
    const list = await request(app).get(`/api/workflows/${wf}/versions`).set(auth()).expect(200);
    const v1Id = list.body.find((v: { versionNumber: number }) => v.versionNumber === 1).id;
    const v1 = await request(app).get(`/api/workflows/${wf}/versions/${v1Id}`).set(auth()).expect(200);
    expect(v1.body.name).toBe('wf-v1');
    expect(v1.body.nodes).toHaveLength(1);
    expect(v1.body.nodes[0].name).toBe('Start');
  });

  it('未知版本 → 404', async () => {
    await request(app).get(`/api/workflows/${wf}/versions/nope`).set(auth()).expect(404);
  });

  it('回滚到 v1 → 工作流恢复 v1 定义，且回滚本身落一条新版本', async () => {
    const list = await request(app).get(`/api/workflows/${wf}/versions`).set(auth()).expect(200);
    const v1Id = list.body.find((v: { versionNumber: number }) => v.versionNumber === 1).id;
    const restored = await request(app)
      .post(`/api/workflows/${wf}/versions/${v1Id}/restore`)
      .set(auth())
      .expect(200);
    expect(restored.body.name).toBe('wf-v1');
    expect(restored.body.nodes).toHaveLength(1);
    // 现在应有 3 个版本（v1、v2、回滚产生的 v3），最新 v3 的定义 == v1
    const after = await request(app).get(`/api/workflows/${wf}/versions`).set(auth()).expect(200);
    expect(after.body.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([3, 2, 1]);
    expect(after.body[0].name).toBe('wf-v1');
  });
});

describe('归属隔离 + 删除清版本', () => {
  let wf: string;

  it('别的用户看不到我的版本历史（404）', async () => {
    wf = (await request(app).post('/api/workflows').set(auth()).send({ name: 'mine', nodes: [], connections: {} }).expect(201)).body.id;
    await request(app).post('/auth/register').send({ email: 'other-ver@demo.dev', password: 'password-123' }).expect(201);
    const otherJwt = (await request(app).post('/auth/login').send({ email: 'other-ver@demo.dev', password: 'password-123' }).expect(200)).body.token;
    await request(app).get(`/api/workflows/${wf}/versions`).set({ Authorization: `Bearer ${otherJwt}` }).expect(404);
  });

  it('删除工作流 → 版本随之清除', async () => {
    await request(app).get(`/api/workflows/${wf}/versions`).set(auth()).expect(200);
    await request(app).delete(`/api/workflows/${wf}`).set(auth()).expect(204);
    // 工作流没了，版本列表走归属检查 → 404
    await request(app).get(`/api/workflows/${wf}/versions`).set(auth()).expect(404);
  });
});
