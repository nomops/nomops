import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #35a：执行标注 —— 打分👍👎 / 笔记 / 标签往返。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
let execId = '';
const authed = () => ({ Authorization: `Bearer ${token}` });

const wf = {
  name: 'annot-wf',
  nodes: [{ id: 't', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
  connections: {},
};

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'annot@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'annot@test.dev', password: 'password-123' }).expect(200)).body.token;
  const w = (await request(app).post('/api/workflows').set(authed()).send(wf).expect(201)).body;
  const run = await request(app).post(`/api/workflows/${w.id}/run`).set(authed()).send({}).expect(200);
  execId = run.body.executionId;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('执行标注（backlog #35a）', () => {
  it('默认无标注：vote null、note 空、无标签', async () => {
    const res = await request(app).get(`/api/executions/${execId}/annotation`).set(authed()).expect(200);
    expect(res.body).toEqual({ vote: null, note: '', tags: [] });
  });

  it('打分 + 笔记 + 标签往返；标签名首次即创建', async () => {
    const put = await request(app)
      .put(`/api/executions/${execId}/annotation`)
      .set(authed())
      .send({ vote: 'up', note: 'looks good', tags: ['reviewed', 'prod'] })
      .expect(200);
    expect(put.body.vote).toBe('up');
    expect(put.body.note).toBe('looks good');
    expect(put.body.tags.map((t: { name: string }) => t.name).sort()).toEqual(['prod', 'reviewed']);

    // 再 GET 一致
    const get = await request(app).get(`/api/executions/${execId}/annotation`).set(authed()).expect(200);
    expect(get.body.vote).toBe('up');
    expect(get.body.tags).toHaveLength(2);

    // 标签进了全局标签库
    const tags = (await request(app).get('/api/annotation-tags').set(authed()).expect(200)).body;
    expect(tags.map((t: { name: string }) => t.name).sort()).toEqual(['prod', 'reviewed']);
  });

  it('部分更新：改 vote 不清空 note/tags', async () => {
    await request(app).put(`/api/executions/${execId}/annotation`).set(authed()).send({ vote: 'down' }).expect(200);
    const get = (await request(app).get(`/api/executions/${execId}/annotation`).set(authed()).expect(200)).body;
    expect(get.vote).toBe('down');
    expect(get.note).toBe('looks good'); // 保留
    expect(get.tags).toHaveLength(2); // 保留
  });

  it('替换标签：传新集合全量覆盖；复用同名标签不重复建', async () => {
    await request(app).put(`/api/executions/${execId}/annotation`).set(authed()).send({ tags: ['prod'] }).expect(200);
    const get = (await request(app).get(`/api/executions/${execId}/annotation`).set(authed()).expect(200)).body;
    expect(get.tags.map((t: { name: string }) => t.name)).toEqual(['prod']);
    // 标签库仍是 2 个（reviewed 未删除，只是不再映射）
    const tags = (await request(app).get('/api/annotation-tags').set(authed()).expect(200)).body;
    expect(tags).toHaveLength(2);
  });

  it('别的项目的执行 id → 404（归属校验）', async () => {
    await request(app).get('/api/executions/nonexistent-id/annotation').set(authed()).expect(404);
  });
});
