import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser, setupOwner, licensedBoot } from './helpers.js';

/**
 * backlog #29 自定义角色：实例 admin 定义角色（scopes 子集），指派给项目成员，
 * 成员的有效层级由 scopes 解析（tierForScopes）后进 requireRole 门。
 */

const sampleWorkflow = (name: string) => ({
  name,
  nodes: [
    { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
  ],
  connections: {},
});

describe('自定义角色（backlog #29）', () => {
  let boot: BootstrapResult;
  let app: Express;
  const tokens: Record<string, string> = {};
  let teamProjectId: string;

  const as = (who: string, projectId?: string) => ({
    Authorization: `Bearer ${tokens[who]}`,
    ...(projectId ? { 'X-Project-Id': projectId } : {}),
  });

  beforeAll(async () => {
    boot = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot() });
    app = createApp(boot.services);

    const owner = await setupOwner(app, 'owner@roles.dev');
    tokens['owner'] = owner.token;
    for (const who of ['reader', 'writer', 'member']) {
      const u = await inviteUser(app, tokens['owner'], `${who}@roles.dev`);
      tokens[who] = u.token;
    }

    const project = await request(app)
      .post('/api/projects')
      .set(as('owner'))
      .send({ name: '角色测试团队' })
      .expect(201);
    teamProjectId = project.body.id;
  });

  afterAll(async () => {
    await boot.shutdown();
  });

  it('列举 scope 目录 + 空角色表（仅实例 admin）', async () => {
    const res = await request(app).get('/api/custom-roles').set(as('owner')).expect(200);
    expect(Array.isArray(res.body.scopes)).toBe(true);
    expect(res.body.scopes).toContain('workflow:read');
    expect(res.body.scopes).toContain('member:manage');
    expect(res.body.roles).toEqual([]);
  });

  it('非实例 admin 不能读/建自定义角色', async () => {
    await request(app).get('/api/custom-roles').set(as('reader')).expect(403);
    await request(app)
      .post('/api/custom-roles')
      .set(as('reader'))
      .send({ name: 'sneaky', scopes: ['workflow:read'] })
      .expect(403);
  });

  it('创建只读自定义角色 → 解析为 viewer 层级', async () => {
    const res = await request(app)
      .post('/api/custom-roles')
      .set(as('owner'))
      .send({ name: 'read-only', description: '只能看', scopes: ['workflow:read', 'execution:read'] })
      .expect(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('read-only');
    expect(res.body.scopes).toEqual(['workflow:read', 'execution:read']);
  });

  it('拒绝无 scope / 与内建角色重名 / 重复名', async () => {
    await request(app)
      .post('/api/custom-roles')
      .set(as('owner'))
      .send({ name: 'empty', scopes: [] })
      .expect(400);
    await request(app)
      .post('/api/custom-roles')
      .set(as('owner'))
      .send({ name: 'owner', scopes: ['workflow:read'] })
      .expect(400);
    await request(app)
      .post('/api/custom-roles')
      .set(as('owner'))
      .send({ name: 'read-only', scopes: ['workflow:read'] })
      .expect(409);
  });

  it('指派只读角色的成员：可读工作流，不可创建', async () => {
    await request(app)
      .post(`/api/projects/${teamProjectId}/members`)
      .set(as('owner'))
      .send({ email: 'reader@roles.dev', role: 'read-only' })
      .expect(201);

    // viewer 有效层级：GET 放行
    await request(app).get('/api/workflows').set(as('reader', teamProjectId)).expect(200);
    // 低于 editor：POST 被 requireRole 拦
    await request(app)
      .post('/api/workflows')
      .set(as('reader', teamProjectId))
      .send(sampleWorkflow('reader-wf'))
      .expect(403);
  });

  it('带写 scope 的自定义角色 → editor 层级，可创建工作流', async () => {
    await request(app)
      .post('/api/custom-roles')
      .set(as('owner'))
      .send({ name: 'author', scopes: ['workflow:read', 'workflow:create'] })
      .expect(201);
    await request(app)
      .post(`/api/projects/${teamProjectId}/members`)
      .set(as('owner'))
      .send({ email: 'writer@roles.dev', role: 'author' })
      .expect(201);

    await request(app)
      .post('/api/workflows')
      .set(as('writer', teamProjectId))
      .send(sampleWorkflow('writer-wf'))
      .expect(201);
  });

  it('指派未知角色 → 400', async () => {
    await request(app)
      .post(`/api/projects/${teamProjectId}/members`)
      .set(as('owner'))
      .send({ email: 'member@roles.dev', role: 'does-not-exist' })
      .expect(400);
  });

  it('删除自定义角色', async () => {
    const list = await request(app).get('/api/custom-roles').set(as('owner')).expect(200);
    const role = (list.body.roles as Array<{ id: string; name: string }>).find((r) => r.name === 'read-only');
    expect(role).toBeTruthy();
    await request(app).delete(`/api/custom-roles/${role!.id}`).set(as('owner')).expect(204);
    const after = await request(app).get('/api/custom-roles').set(as('owner')).expect(200);
    expect((after.body.roles as Array<{ name: string }>).some((r) => r.name === 'read-only')).toBe(false);
  });
});
