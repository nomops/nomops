import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/** Data tables：项目维度结构化表 — 表/列/行 CRUD + 列投影 + 归属隔离。 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'dt@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'dt@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.dbHandle.close();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

describe('Data tables', () => {
  it('表 CRUD + 唯一名 + 校验', async () => {
    const created = await request(app).post('/api/data-tables').set(authed()).send({ name: 'customers' }).expect(201);
    expect(created.body).toMatchObject({ name: 'customers', rowCount: 0 });
    expect(created.body.columns).toEqual([]);

    // 重名（大小写不敏感）
    await request(app).post('/api/data-tables').set(authed()).send({ name: 'Customers' }).expect(409);
    // 空名
    await request(app).post('/api/data-tables').set(authed()).send({ name: '   ' }).expect(400);

    // 重命名
    await request(app).patch(`/api/data-tables/${created.body.id}`).set(authed()).send({ name: 'clients' }).expect(200);

    const list = await request(app).get('/api/data-tables').set(authed()).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe('clients');

    await request(app).delete(`/api/data-tables/${created.body.id}`).set(authed()).expect(204);
    expect((await request(app).get('/api/data-tables').set(authed()).expect(200)).body).toHaveLength(0);
  });

  it('列 + 行 CRUD，未声明列被丢弃', async () => {
    const table = (await request(app).post('/api/data-tables').set(authed()).send({ name: 'orders' }).expect(201)).body;

    // 加列
    await request(app).post(`/api/data-tables/${table.id}/columns`).set(authed()).send({ name: 'email', type: 'string' }).expect(201);
    const withCol = await request(app).post(`/api/data-tables/${table.id}/columns`).set(authed()).send({ name: 'amount', type: 'number' }).expect(201);
    expect(withCol.body.columns.map((c: { name: string }) => c.name)).toEqual(['email', 'amount']);

    // 重复列名 409
    await request(app).post(`/api/data-tables/${table.id}/columns`).set(authed()).send({ name: 'email', type: 'string' }).expect(409);
    // 保留列名 400
    await request(app).post(`/api/data-tables/${table.id}/columns`).set(authed()).send({ name: 'id', type: 'string' }).expect(400);

    // 插入行：未知列 phantom 被丢弃，只保留声明列
    const row = (
      await request(app)
        .post(`/api/data-tables/${table.id}/rows`)
        .set(authed())
        .send({ data: { email: 'a@b.com', amount: 42, phantom: 'nope' } })
        .expect(201)
    ).body;
    expect(row.data).toEqual({ email: 'a@b.com', amount: 42 });
    expect(row.id).toBeTruthy();

    // 更新行（部分列合并）
    const updated = (
      await request(app).patch(`/api/data-tables/${table.id}/rows/${row.id}`).set(authed()).send({ data: { amount: 99 } }).expect(200)
    ).body;
    expect(updated.data).toEqual({ email: 'a@b.com', amount: 99 });

    const rows = await request(app).get(`/api/data-tables/${table.id}/rows`).set(authed()).expect(200);
    expect(rows.body).toHaveLength(1);

    // 行数反映在表视图
    const got = await request(app).get(`/api/data-tables/${table.id}`).set(authed()).expect(200);
    expect(got.body.rowCount).toBe(1);

    // 删列后行数据经再次投影时丢弃该列
    await request(app).delete(`/api/data-tables/${table.id}/columns/amount`).set(authed()).expect(200);

    // 删行
    await request(app).delete(`/api/data-tables/${table.id}/rows/${row.id}`).set(authed()).expect(204);
    expect((await request(app).get(`/api/data-tables/${table.id}/rows`).set(authed()).expect(200)).body).toHaveLength(0);
  });

  it('未知表 404', async () => {
    await request(app).get('/api/data-tables/does-not-exist').set(authed()).expect(404);
    await request(app).delete('/api/data-tables/does-not-exist').set(authed()).expect(404);
  });

  it('Data table 节点动态加载表/列并在真实引擎中持久化和读取行', async () => {
    const table = (await request(app).post('/api/data-tables').set(authed()).send({
      name: 'node-orders',
      columns: [{ name: 'email', type: 'string' }, { name: 'amount', type: 'number' }],
    }).expect(201)).body;

    const locator = await request(app)
      .post('/api/dynamic-node-parameters/resource-locator-results')
      .set(authed())
      .send({
        nodeType: 'nomops.dataTable', nodeVersion: 1.1, propertyName: 'dataTableId',
        currentNodeParameters: {}, credentials: {}, filter: 'node-order',
      })
      .expect(200);
    expect(locator.body.results).toEqual([{ name: 'node-orders', value: table.id, description: '0 rows' }]);

    const mapper = await request(app)
      .post('/api/dynamic-node-parameters/resource-mapper-fields')
      .set(authed())
      .send({
        nodeType: 'nomops.dataTable', nodeVersion: 1.1, propertyName: 'columns',
        currentNodeParameters: { dataTableId: { mode: 'id', value: table.id } }, credentials: {},
      })
      .expect(200);
    expect(mapper.body.fields.map((field: { id: string }) => field.id)).toEqual(['email', 'amount']);

    const workflow = (await request(app).post('/api/workflows').set(authed()).send({
      name: 'Data table node runtime',
      nodes: [
        { id: 'trigger', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        {
          id: 'insert', name: 'Insert order', type: 'nomops.dataTable', typeVersion: 1.1, position: [220, 0],
          parameters: {
            resource: 'row', operation: 'insert', dataTableId: { mode: 'id', value: table.id },
            columns: { mappingMode: 'defineBelow', value: { email: 'buyer@example.com', amount: 42 }, schema: mapper.body.fields },
            options: {},
          },
        },
        {
          id: 'get', name: 'Read orders', type: 'nomops.dataTable', typeVersion: 1.1, position: [440, 0],
          parameters: {
            resource: 'row', operation: 'get', dataTableId: { mode: 'id', value: table.id },
            filters: { conditions: [{ keyName: 'amount', condition: 'gte', keyValue: 40 }] },
            matchType: 'allConditions', returnAll: true, orderBy: false,
          },
        },
      ],
      connections: {
        Start: { main: [[{ node: 'Insert order', type: 'main', index: 0 }]] },
        'Insert order': { main: [[{ node: 'Read orders', type: 'main', index: 0 }]] },
      },
    }).expect(201)).body;

    const execution = await request(app).post(`/api/workflows/${workflow.id}/run`).set(authed()).send({}).expect(200);
    expect(execution.body.status).toBe('success');
    const rows = await request(app).get(`/api/data-tables/${table.id}/rows`).set(authed()).expect(200);
    expect(rows.body).toHaveLength(1);
    expect(rows.body[0].data).toEqual({ email: 'buyer@example.com', amount: 42 });
    const detail = await request(app).get(`/api/executions/${execution.body.executionId}`).set(authed()).expect(200);
    expect(detail.body.data.resultData.runData['Read orders'][0].data.main[0][0].json).toMatchObject({
      email: 'buyer@example.com', amount: 42,
    });
  });
});
