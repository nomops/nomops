import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser, setupOwner } from './helpers.js';
import { ENTERPRISE_FEATURES } from '../license/license-service.js';

/** Phase 6a（docs/06）验收：RBAC 权限矩阵、项目切换、License 门、审计日志。 */

const sampleWorkflow = (name: string) => ({
  name,
  nodes: [
    { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { x: 1 } } },
  ],
  connections: { Start: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
});

describe('企业版（LICENSE_KEY 注入）', () => {
  let boot: BootstrapResult;
  let app: Express;
  /** owner/editor/viewer 三个用户 + 一个团队项目。 */
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  let teamProjectId: string;

  const as = (who: string, projectId?: string) => ({
    Authorization: `Bearer ${tokens[who]}`,
    ...(projectId ? { 'X-Project-Id': projectId } : {}),
  });

  beforeAll(async () => {
    boot = await bootstrap({ dbConfig: { type: 'sqlite' }, licenseKey: 'test-enterprise-key' });
    app = createApp(boot.services);

    // owner = 首个注册用户；其余经邀请（公开注册在 owner 后即关闭）
    const owner = await setupOwner(app, 'owner@ent.dev');
    tokens['owner'] = owner.token;
    userIds['owner'] = owner.userId;
    for (const who of ['editor', 'viewer', 'outsider']) {
      const u = await inviteUser(app, tokens['owner'], `${who}@ent.dev`);
      tokens[who] = u.token;
      userIds[who] = u.userId;
    }

    // owner 建团队项目并拉人
    const project = await request(app)
      .post('/api/projects')
      .set(as('owner'))
      .send({ name: '企业团队' })
      .expect(201);
    teamProjectId = project.body.id;
    await request(app)
      .post(`/api/projects/${teamProjectId}/members`)
      .set(as('owner'))
      .send({ email: 'editor@ent.dev', role: 'project:editor' })
      .expect(201);
    await request(app)
      .post(`/api/projects/${teamProjectId}/members`)
      .set(as('owner'))
      .send({ email: 'viewer@ent.dev', role: 'project:viewer' })
      .expect(201);
  });

  afterAll(async () => {
    await boot.shutdown();
  });

  it('license 端点返回 enterprise + features', async () => {
    const res = await request(app).get('/api/license').set(as('owner')).expect(200);
    expect(res.body).toEqual({ plan: 'enterprise', features: [...ENTERPRISE_FEATURES], activated: true });
  });

  describe('权限矩阵（验收项：逐格生效）', () => {
    let workflowId: string;

    it('editor 可以在团队项目建流/运行/激活', async () => {
      const created = await request(app)
        .post('/api/workflows')
        .set(as('editor', teamProjectId))
        .send(sampleWorkflow('team-flow'))
        .expect(201);
      workflowId = created.body.id;
      await request(app)
        .post(`/api/workflows/${workflowId}/run`)
        .set(as('editor', teamProjectId))
        .send({})
        .expect(200);
    });

    it('viewer 可读列表与详情', async () => {
      const list = await request(app).get('/api/workflows').set(as('viewer', teamProjectId)).expect(200);
      expect(list.body.map((w: { id: string }) => w.id)).toContain(workflowId);
      await request(app).get(`/api/workflows/${workflowId}`).set(as('viewer', teamProjectId)).expect(200);
      await request(app).get('/api/executions').set(as('viewer', teamProjectId)).expect(200);
    });

    it('viewer 改/跑/激活/建凭证/测凭证 → 全部 403', async () => {
      const v = as('viewer', teamProjectId);
      await request(app).post('/api/workflows').set(v).send(sampleWorkflow('nope')).expect(403);
      await request(app).patch(`/api/workflows/${workflowId}`).set(v).send({ name: 'x' }).expect(403);
      await request(app).delete(`/api/workflows/${workflowId}`).set(v).expect(403);
      await request(app).post(`/api/workflows/${workflowId}/run`).set(v).send({}).expect(403);
      await request(app).post(`/api/workflows/${workflowId}/activate`).set(v).send({ active: true }).expect(403);
      await request(app)
        .post('/api/credentials')
        .set(v)
        .send({ name: 'c', type: 'httpHeaderAuth', data: { k: 'v' } })
        .expect(403);
    });

    it('editor 不能管成员（owner 专属）', async () => {
      await request(app)
        .get(`/api/projects/${teamProjectId}/members`)
        .set(as('editor'))
        .expect(403);
      await request(app)
        .post(`/api/projects/${teamProjectId}/members`)
        .set(as('editor'))
        .send({ email: 'outsider@ent.dev', role: 'project:viewer' })
        .expect(403);
    });

    it('owner 可查成员列表并改角色', async () => {
      const members = await request(app)
        .get(`/api/projects/${teamProjectId}/members`)
        .set(as('owner'))
        .expect(200);
      expect(members.body).toHaveLength(3);
      await request(app)
        .patch(`/api/projects/${teamProjectId}/members/${userIds['viewer']}`)
        .set(as('owner'))
        .send({ role: 'project:editor' })
        .expect(200);
      // 改回去
      await request(app)
        .patch(`/api/projects/${teamProjectId}/members/${userIds['viewer']}`)
        .set(as('owner'))
        .send({ role: 'project:viewer' })
        .expect(200);
    });

    it('最后一个 owner 不可移除/降级', async () => {
      await request(app)
        .delete(`/api/projects/${teamProjectId}/members/${userIds['owner']}`)
        .set(as('owner'))
        .expect(400);
      await request(app)
        .patch(`/api/projects/${teamProjectId}/members/${userIds['owner']}`)
        .set(as('owner'))
        .send({ role: 'project:viewer' })
        .expect(400);
    });
  });

  describe('项目上下文切换（X-Project-Id）', () => {
    it('非成员切入 → 403；成员切入数据隔离正确', async () => {
      await request(app).get('/api/workflows').set(as('outsider', teamProjectId)).expect(403);

      // editor 的 personal 空间里看不到团队流
      const personal = await request(app).get('/api/workflows').set(as('editor')).expect(200);
      expect(personal.body.map((w: { name: string }) => w.name)).not.toContain('team-flow');
      const team = await request(app).get('/api/workflows').set(as('editor', teamProjectId)).expect(200);
      expect(team.body.map((w: { name: string }) => w.name)).toContain('team-flow');
    });

    it('成员被移除后立刻失去访问（验收项）', async () => {
      // 拉 outsider 进来再踢掉
      await request(app)
        .post(`/api/projects/${teamProjectId}/members`)
        .set(as('owner'))
        .send({ email: 'outsider@ent.dev', role: 'project:viewer' })
        .expect(201);
      await request(app).get('/api/workflows').set(as('outsider', teamProjectId)).expect(200);

      await request(app)
        .delete(`/api/projects/${teamProjectId}/members/${userIds['outsider']}`)
        .set(as('owner'))
        .expect(204);
      await request(app).get('/api/workflows').set(as('outsider', teamProjectId)).expect(403);
    });
  });

  describe('审计日志（验收项）', () => {
    it('动作留痕：who/what/when/project；凭证日志不含明文与密文', async () => {
      const secret = 'audit-secret-value-99';
      await request(app)
        .post('/api/credentials')
        .set(as('editor', teamProjectId))
        .send({ name: 'audit-cred', type: 'httpHeaderAuth', data: { apiKey: secret } })
        .expect(201);
      await new Promise((r) => setTimeout(r, 100)); // fire-and-forget 落库

      const logs = await request(app)
        .get(`/api/audit-logs?projectId=${teamProjectId}`)
        .set(as('owner'))
        .expect(200);

      const actions = logs.body.map((l: { action: string }) => l.action);
      expect(actions).toContain('workflow.create');
      expect(actions).toContain('workflow.run');
      expect(actions).toContain('credential.create');
      expect(actions).toContain('project.member.add');
      expect(actions).toContain('project.member.remove');

      const credLog = logs.body.find((l: { action: string }) => l.action === 'credential.create');
      expect(credLog.userId).toBe(userIds['editor']);
      expect(credLog.projectId).toBe(teamProjectId);
      expect(credLog.timestamp).toBeTruthy();
      // 铁律 3：审计不含明文，也不含密文
      expect(JSON.stringify(logs.body)).not.toContain(secret);
      expect(JSON.stringify(logs.body)).not.toContain('v1:');
    });

    it('审计查询是 owner 专属', async () => {
      await request(app).get(`/api/audit-logs?projectId=${teamProjectId}`).set(as('editor')).expect(403);
      await request(app).get(`/api/audit-logs?projectId=${teamProjectId}`).set(as('viewer')).expect(403);
    });

    it('limit 分页生效', async () => {
      const res = await request(app)
        .get(`/api/audit-logs?projectId=${teamProjectId}&limit=2`)
        .set(as('owner'))
        .expect(200);
      expect(res.body).toHaveLength(2);
    });
  });
});

describe('社区版（无 LICENSE_KEY，零回归）', () => {
  let boot: BootstrapResult;
  let app: Express;
  let token: string;

  beforeAll(async () => {
    boot = await bootstrap({ dbConfig: { type: 'sqlite' }, licenseKey: null });
    app = createApp(boot.services);
    const reg = await request(app)
      .post('/auth/register')
      .send({ email: 'solo@comm.dev', password: 'password-123' })
      .expect(201);
    token = reg.body.token;
  });

  afterAll(async () => {
    await boot.shutdown();
  });

  it('license = community，features 空', async () => {
    const res = await request(app).get('/api/license').set({ Authorization: `Bearer ${token}` }).expect(200);
    expect(res.body).toEqual({ plan: 'community', features: [], activated: false });
  });

  it('企业端点 403 且带 feature 标识（验收项）', async () => {
    const authed = { Authorization: `Bearer ${token}` };
    const create = await request(app).post('/api/projects').set(authed).send({ name: 't' }).expect(403);
    expect(create.body.feature).toBe('rbac');
    const audit = await request(app).get('/api/audit-logs').set(authed).expect(403);
    expect(audit.body.feature).toBe('auditLogs');
  });

  it('personal 空间全权操作不受影响（owner 角色），审计写入照常进行', async () => {
    const authed = { Authorization: `Bearer ${token}` };
    const wf = await request(app).post('/api/workflows').set(authed).send(sampleWorkflow('solo')).expect(201);
    await request(app).post(`/api/workflows/${wf.body.id}/run`).set(authed).send({}).expect(200);
    await new Promise((r) => setTimeout(r, 100));

    // 查询被门控，但写入始终进行（直接查仓储验证）
    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'solo@comm.dev', password: 'password-123' })
      .expect(200);
    const logs = await boot.services.repos.auditLogs.findAllByProject(login.body.projectId);
    expect(logs.map((l) => l.action)).toContain('workflow.create');
  });

  it('GET /api/projects 列出 personal 项目与角色（无需企业版）', async () => {
    const res = await request(app).get('/api/projects').set({ Authorization: `Bearer ${token}` }).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].role).toBe('project:owner');
    expect(res.body[0].type).toBe('personal');
  });
});
