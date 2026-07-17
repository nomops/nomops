import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/** 发布/草稿分离：生产触发跑已发布版本；保存只改草稿；手动运行跑草稿；发布才切换生产并重注册触发器。 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'pub@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'pub@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.shutdown();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

const hookFlow = (path: string, v: string) => ({
  nodes: [
    { id: 'a', name: 'Hook', type: 'nomops.webhook', typeVersion: 1, position: [0, 0], parameters: { path, method: 'POST' } },
    { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { v } } },
  ],
  connections: { Hook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
});

async function setOutput(executionId: string): Promise<Record<string, unknown>> {
  const detail = await request(app).get(`/api/executions/${executionId}`).set(authed()).expect(200);
  return detail.body.data.resultData.runData.Set[0].data.main[0][0].json;
}

describe('发布/草稿分离', () => {
  it('激活即发布；草稿编辑不影响生产；手动跑草稿；发布切换生产', async () => {
    // v1 上线
    const created = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({ name: 'pd-flow', ...hookFlow('pd-hook', 'one') })
      .expect(201);
    const id = created.body.id as string;
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);

    // 激活自动发布了当前定义
    let detail = await request(app).get(`/api/workflows/${id}`).set(authed()).expect(200);
    expect(detail.body.publishedVersionId).toBeTruthy();
    expect(detail.body.publishedDirty).toBe(false);

    let hit = await request(app).post('/webhook/pd-hook').send({}).expect(200);
    expect((await setOutput(hit.body.executionId))['v']).toBe('one');

    // 草稿改成 v2：生产不动，手动跑草稿
    await request(app).patch(`/api/workflows/${id}`).set(authed()).send(hookFlow('pd-hook', 'two')).expect(200);
    detail = await request(app).get(`/api/workflows/${id}`).set(authed()).expect(200);
    expect(detail.body.publishedDirty).toBe(true);

    hit = await request(app).post('/webhook/pd-hook').send({}).expect(200);
    expect((await setOutput(hit.body.executionId))['v']).toBe('one'); // 生产仍是 v1

    const manual = await request(app).post(`/api/workflows/${id}/run`).set(authed()).send({}).expect(200);
    expect((await setOutput(manual.body.executionId))['v']).toBe('two'); // 手动 = 草稿 v2

    // 发布 → 生产切到 v2
    const pub = await request(app).post(`/api/workflows/${id}/publish`).set(authed()).expect(200);
    expect(pub.body.publishedDirty).toBe(false);
    expect(pub.body.publishedAt).toBeTruthy();

    hit = await request(app).post('/webhook/pd-hook').send({}).expect(200);
    expect((await setOutput(hit.body.executionId))['v']).toBe('two');

    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: false }).expect(200);
  });

  it('webhook 路径变更：草稿改路径不影响生产路由，发布后才切换（含触发器重注册）', async () => {
    const created = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({ name: 'pd-path', ...hookFlow('pd-old', 'x') })
      .expect(201);
    const id = created.body.id as string;
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);

    // 草稿把路径改成 pd-new：旧路径仍在服务，新路径 404
    await request(app).patch(`/api/workflows/${id}`).set(authed()).send(hookFlow('pd-new', 'x')).expect(200);
    await request(app).post('/webhook/pd-old').send({}).expect(200);
    await request(app).post('/webhook/pd-new').send({}).expect(404);

    // 发布：重注册 → 新路径生效，旧路径下线
    await request(app).post(`/api/workflows/${id}/publish`).set(authed()).expect(200);
    await request(app).post('/webhook/pd-new').send({}).expect(200);
    await request(app).post('/webhook/pd-old').send({}).expect(404);

    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: false }).expect(200);
  });

  it('执行保存策略（workflow settings）：saveManualExecutions=false → 手动执行不留记录', async () => {
    const created = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({
        name: 'save-policy',
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { ok: true } } },
        ],
        connections: { Start: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
        settings: { saveManualExecutions: false },
      })
      .expect(201);
    const id = created.body.id as string;

    const run = await request(app).post(`/api/workflows/${id}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('success');
    // 记录已按策略删除
    await request(app).get(`/api/executions/${run.body.executionId}`).set(authed()).expect(404);

    // 关掉策略 → 记录保留
    await request(app).patch(`/api/workflows/${id}`).set(authed()).send({ settings: {} }).expect(200);
    const run2 = await request(app).post(`/api/workflows/${id}/run`).set(authed()).send({}).expect(200);
    await request(app).get(`/api/executions/${run2.body.executionId}`).set(authed()).expect(200);
  });

  it('收藏 + 归档（B2）：归档下线触发器并从默认列表消失，unarchive 恢复', async () => {
    const created = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({ name: 'b2-flow', ...hookFlow('b2-hook', 'x') })
      .expect(201);
    const id = created.body.id as string;

    // 收藏
    const fav = await request(app).post(`/api/workflows/${id}/favorite`).set(authed()).send({ favorite: true }).expect(200);
    expect(fav.body.favorite).toBe(true);

    // 激活（webhook 上线）→ 归档：触发器下线 + active=false + 默认列表消失
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);
    await request(app).post('/webhook/b2-hook').send({}).expect(200);

    const archived = await request(app).post(`/api/workflows/${id}/archive`).set(authed()).expect(200);
    expect(archived.body.archived).toBe(true);
    expect(archived.body.active).toBe(false);
    await request(app).post('/webhook/b2-hook').send({}).expect(404); // 触发器已下线

    const list = await request(app).get('/api/workflows').set(authed()).expect(200);
    expect(list.body.some((w: { id: string }) => w.id === id)).toBe(false);
    const archivedList = await request(app).get('/api/workflows?archived=true').set(authed()).expect(200);
    expect(archivedList.body.some((w: { id: string }) => w.id === id)).toBe(true);

    // unarchive → 回到默认列表（不自动重新激活）
    await request(app).post(`/api/workflows/${id}/unarchive`).set(authed()).expect(200);
    const list2 = await request(app).get('/api/workflows').set(authed()).expect(200);
    const row = list2.body.find((w: { id: string }) => w.id === id);
    expect(row.archived).toBe(false);
    expect(row.active).toBe(false);
  });
});
