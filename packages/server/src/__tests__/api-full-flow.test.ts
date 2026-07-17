import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser, setupOwner } from './helpers.js';

/**
 * Phase 3 验收：curl 级全流程「注册→登录→建工作流→手动运行→查执行历史」。
 * in-memory SQLite，每个测试套件独立实例。
 */

let boot: BootstrapResult;
let app: Express;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' }); // 内存库
  app = createApp(boot.services);
});

afterAll(async () => {
  await boot.dbHandle.close();
});

// 首个用户 = owner（公开注册仅此一次）；其余经 owner 邀请（自托管）。
let ownerToken: string | undefined;
async function registerAndLogin(email: string): Promise<string> {
  if (!ownerToken) {
    ownerToken = (await setupOwner(app, email)).token;
    return ownerToken;
  }
  return (await inviteUser(app, ownerToken, email)).token;
}

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

const sampleWorkflow = {
  name: '测试流',
  nodes: [
    {
      id: 'a',
      name: 'Start',
      type: 'nomops.manualTrigger',
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    },
    {
      id: 'b',
      name: 'Set',
      type: 'nomops.set',
      typeVersion: 1,
      position: [200, 0],
      parameters: { fields: { greeting: 'hello' } },
    },
  ],
  connections: {
    Start: { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
  },
};

describe('鉴权', () => {
  it('未登录访问受保护端点 → 401', async () => {
    await request(app).get('/api/workflows').expect(401);
    await request(app).get('/api/workflows').set('Authorization', 'Bearer nonsense').expect(401);
  });

  it('owner 建成后公开注册关闭 → 403；密码错误 → 400 且不暴露邮箱是否存在', async () => {
    await registerAndLogin('dup@test.dev'); // 首个用户 = owner
    // 已有 owner，公开注册关闭（改用邀请）
    await request(app)
      .post('/auth/register')
      .send({ email: 'another@test.dev', password: 'password-123' })
      .expect(403);
    const bad = await request(app)
      .post('/auth/login')
      .send({ email: 'dup@test.dev', password: 'wrong-password' })
      .expect(400);
    expect(bad.body.error).toBe('Invalid email or password');
  });
});

describe('全流程：登录→建工作流→运行→查执行历史（验收项）', () => {
  it('走通并且数据正确', async () => {
    const token = await registerAndLogin('flow@test.dev');

    // 建工作流
    const created = await request(app)
      .post('/api/workflows')
      .set(authed(token))
      .send(sampleWorkflow)
      .expect(201);
    const workflowId = created.body.id as string;
    expect(workflowId).toBeTruthy();

    // 列表可见
    const list = await request(app).get('/api/workflows').set(authed(token)).expect(200);
    expect(list.body.map((w: { id: string }) => w.id)).toContain(workflowId);

    // 手动运行
    const run = await request(app)
      .post(`/api/workflows/${workflowId}/run`)
      .set(authed(token))
      .send({})
      .expect(200);
    expect(run.body.status).toBe('success');
    expect(run.body.lastNodeExecuted).toBe('Set');

    // 执行历史
    const executions = await request(app).get('/api/executions').set(authed(token)).expect(200);
    expect(executions.body).toHaveLength(1);
    expect(executions.body[0].status).toBe('success');
    expect(executions.body[0].mode).toBe('manual');

    // 执行详情含 RunExecutionData，Set 节点输出正确
    const detail = await request(app)
      .get(`/api/executions/${run.body.executionId}`)
      .set(authed(token))
      .expect(200);
    const setOutput = detail.body.data.resultData.runData['Set'][0].data.main[0];
    expect(setOutput[0].json).toEqual({ greeting: 'hello' });
  });

  it('结构非法的工作流被拒（未知节点类型 / 连接引用不存在的节点）', async () => {
    const token = await registerAndLogin('invalid@test.dev');

    await request(app)
      .post('/api/workflows')
      .set(authed(token))
      .send({
        ...sampleWorkflow,
        nodes: [{ ...sampleWorkflow.nodes[0], type: 'nomops.notExist' }],
        connections: {},
      })
      .expect(400);

    await request(app)
      .post('/api/workflows')
      .set(authed(token))
      .send({
        ...sampleWorkflow,
        connections: { Start: { main: [[{ node: 'Ghost', type: 'main', index: 0 }]] } },
      })
      .expect(400);
  });

  it('Zod 挡掉形状错误的请求体', async () => {
    const token = await registerAndLogin('zod@test.dev');
    const res = await request(app)
      .post('/api/workflows')
      .set(authed(token))
      .send({ name: '', nodes: 'not-an-array' })
      .expect(400);
    expect(res.body.error).toBe('Request body validation failed');
  });
});

describe('归属边界（铁律 2）', () => {
  it('跨用户访问不到对方的 workflow / execution', async () => {
    const tokenA = await registerAndLogin('alice@test.dev');
    const tokenB = await registerAndLogin('bob@test.dev');

    const created = await request(app)
      .post('/api/workflows')
      .set(authed(tokenA))
      .send(sampleWorkflow)
      .expect(201);
    const workflowId = created.body.id as string;
    const run = await request(app)
      .post(`/api/workflows/${workflowId}/run`)
      .set(authed(tokenA))
      .send({})
      .expect(200);

    // B 看不到、跑不了、查不了
    await request(app).get(`/api/workflows/${workflowId}`).set(authed(tokenB)).expect(404);
    await request(app)
      .post(`/api/workflows/${workflowId}/run`)
      .set(authed(tokenB))
      .send({})
      .expect(404);
    await request(app)
      .get(`/api/executions/${run.body.executionId}`)
      .set(authed(tokenB))
      .expect(404);
    const listB = await request(app).get('/api/workflows').set(authed(tokenB)).expect(200);
    expect(listB.body).toHaveLength(0);
  });
});

describe('凭证系统（铁律 3：明文不落库、不出 API）', () => {
  it('创建→列表→test→执行注入全链路，明文只进节点上下文', async () => {
    const token = await registerAndLogin('cred@test.dev');
    const secret = 'super-secret-api-key-42';

    const created = await request(app)
      .post('/api/credentials')
      .set(authed(token))
      .send({ name: 'my-api', type: 'httpHeaderAuth', data: { apiKey: secret } })
      .expect(201);

    // API 响应不含 data 字段，更不含明文
    expect(created.body.data).toBeUndefined();
    expect(JSON.stringify(created.body)).not.toContain(secret);

    // DB 落的是密文
    const rows = await boot.services.repos.credentials.findAllByProject(
      (await request(app).post('/auth/login').send({ email: 'cred@test.dev', password: 'password-123' })).body
        .projectId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).not.toContain(secret);
    expect(rows[0]!.data.startsWith('v1:')).toBe(true);

    // 列表同样无明文
    const list = await request(app).get('/api/credentials').set(authed(token)).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(secret);

    // test 接口
    const test = await request(app)
      .post(`/api/credentials/${created.body.id}/test`)
      .set(authed(token))
      .expect(200);
    expect(test.body.ok).toBe(true);
  });
});

describe('node-types', () => {
  it('返回全部内置节点 descriptions', async () => {
    const token = await registerAndLogin('nodes@test.dev');
    const res = await request(app).get('/api/node-types').set(authed(token)).expect(200);
    const names = res.body.map((d: { name: string }) => d.name).sort();
    expect(names).toEqual([
      'aiAgent',
      'anthropicChatModel',
      'chatTrigger',
      'code',
      'executeWorkflow',
      'github',
      'hackerNews',
      'httpRequest',
      'httpTool',
      'if',
      'manualTrigger',
      'merge',
      'noOp',
      'notion',
      'pollingTrigger',
      'schedule',
      'sendGrid',
      'set',
      'slack',
      'stickyNote',
      'stripe',
      'wait',
      'webhook',
      'windowMemory',
    ]);
  });
});
