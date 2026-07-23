import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #35b：执行自定义元数据 —— 工作流写 customData 后执行列表能按键值筛出。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
let wfId = '';
const authed = () => ({ Authorization: `Bearer ${token}` });

/** ChatTrigger 不需要——用 manualTrigger → SetMetadata，metadata 值取表达式。 */
const wfWith = (customerId: string) => ({
  name: `meta-${customerId}`,
  nodes: [
    { id: 't', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    {
      id: 'm',
      name: 'Meta',
      type: 'nomops.setMetadata',
      typeVersion: 1,
      position: [240, 0],
      parameters: { metadata: { customerId, stage: 'checkout' } },
    },
  ],
  connections: { Start: { main: [[{ node: 'Meta', type: 'main', index: 0 }]] } },
});

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'meta@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'meta@test.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

const runWf = async (customerId: string): Promise<string> => {
  const w = (await request(app).post('/api/workflows').set(authed()).send(wfWith(customerId)).expect(201)).body;
  wfId = w.id;
  const run = await request(app).post(`/api/workflows/${w.id}/run`).set(authed()).send({}).expect(200);
  return run.body.executionId;
};

describe('执行自定义元数据（backlog #35b）', () => {
  it('SetMetadata 写的 KV 进执行详情 metadata', async () => {
    const execId = await runWf('alice');
    const detail = (await request(app).get(`/api/executions/${execId}`).set(authed()).expect(200)).body;
    const asObj = Object.fromEntries(detail.metadata.map((m: { key: string; value: string }) => [m.key, m.value]));
    expect(asObj).toEqual({ customerId: 'alice', stage: 'checkout' });
  });

  it('执行列表能按 metadata 键值筛出', async () => {
    const aliceExec = await runWf('alice2');
    const bobExec = await runWf('bob');

    // 按 key+value 精确筛
    const alice = (await request(app).get('/api/executions?metaKey=customerId&metaValue=alice2').set(authed()).expect(200)).body;
    expect(alice.map((e: { id: string }) => e.id)).toContain(aliceExec);
    expect(alice.map((e: { id: string }) => e.id)).not.toContain(bobExec);

    // 只按 key 筛 → 两条都命中（都有 customerId）
    const byKey = (await request(app).get('/api/executions?metaKey=customerId').set(authed()).expect(200)).body;
    const ids = byKey.map((e: { id: string }) => e.id);
    expect(ids).toContain(aliceExec);
    expect(ids).toContain(bobExec);

    // 不存在的值 → 空
    const none = (await request(app).get('/api/executions?metaKey=customerId&metaValue=zzz').set(authed()).expect(200)).body;
    expect(none).toHaveLength(0);
  });

  it('无过滤参数：返回全部（含无 metadata 的执行）', async () => {
    const all = (await request(app).get('/api/executions').set(authed()).expect(200)).body;
    expect(all.length).toBeGreaterThanOrEqual(3);
  });
});
