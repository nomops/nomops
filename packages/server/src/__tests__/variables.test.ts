import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/** 变量（$vars）：项目维度 CRUD + 唯一键/校验 + 表达式里 {{ $vars.KEY }} 求值。 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'vars@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'vars@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.dbHandle.close();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

describe('变量', () => {
  it('CRUD + 唯一键 + 校验', async () => {
    const created = await request(app).post('/api/variables').set(authed()).send({ key: 'ENV', value: 'prod' }).expect(201);
    expect(created.body).toMatchObject({ key: 'ENV', value: 'prod' });

    // 唯一键
    await request(app).post('/api/variables').set(authed()).send({ key: 'ENV', value: 'x' }).expect(409);
    // 非法键（含空格/数字开头）
    await request(app).post('/api/variables').set(authed()).send({ key: '1 bad', value: 'x' }).expect(400);

    // 更新
    await request(app).patch(`/api/variables/${created.body.id}`).set(authed()).send({ key: 'ENV', value: 'staging' }).expect(200);

    const list = await request(app).get('/api/variables').set(authed()).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ key: 'ENV', value: 'staging' });

    // 删除
    await request(app).delete(`/api/variables/${created.body.id}`).set(authed()).expect(204);
    expect((await request(app).get('/api/variables').set(authed()).expect(200)).body).toHaveLength(0);
  });

  it('{{ $vars.KEY }} 在工作流执行时求值', async () => {
    await request(app).post('/api/variables').set(authed()).send({ key: 'API_BASE', value: 'https://api.example.com' }).expect(201);

    const wf = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({
        name: 'vars-exec',
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          {
            id: 'b',
            name: 'Set',
            type: 'nomops.set',
            typeVersion: 1,
            position: [200, 0],
            parameters: { fields: { url: '={{ $vars.API_BASE }}/v1' } },
          },
        ],
        connections: { Start: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
      })
      .expect(201);

    const run = await request(app).post(`/api/workflows/${wf.body.id}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('success');

    const exec = await request(app).get(`/api/executions/${run.body.executionId}`).set(authed()).expect(200);
    const out = exec.body.data.resultData.runData.Set[0].data.main[0][0].json;
    expect(out.url).toBe('https://api.example.com/v1');
  });
});
