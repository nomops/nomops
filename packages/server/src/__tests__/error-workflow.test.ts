import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * 错误处理流（settings.errorWorkflow）：
 * 执行失败 → 以 mode='error' 触发指定错误流并携带失败上下文；错误流自身失败不级联。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'errwf@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'errwf@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  await boot.shutdown();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

/** 错误处理流：Start → Set（打标记）。 */
const handlerFlow = (name: string, failInside = false) => ({
  name,
  nodes: [
    { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    failInside
      ? { id: 'b', name: 'Boom', type: 'nomops.code', typeVersion: 1, position: [200, 0], parameters: { code: 'throw new Error("handler boom")' } }
      : { id: 'b', name: 'Notify', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { handled: true } } },
  ],
  connections: { Start: { main: [[{ node: failInside ? 'Boom' : 'Notify', type: 'main', index: 0 }]] } },
});

/** 必炸主流：Start → Code(throw)。 */
const failingFlow = (name: string, errorWorkflowId: string) => ({
  name,
  nodes: [
    { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: 'b', name: 'Fail', type: 'nomops.code', typeVersion: 1, position: [200, 0], parameters: { code: 'throw new Error("main boom")' } },
  ],
  connections: { Start: { main: [[{ node: 'Fail', type: 'main', index: 0 }]] } },
  settings: { errorWorkflow: errorWorkflowId },
});

async function executionsOf(workflowId: string) {
  const list = (await request(app).get('/api/executions').set(authed()).expect(200)).body as Array<{
    id: string;
    workflowId: string;
    mode: string;
    status: string;
  }>;
  return list.filter((e) => e.workflowId === workflowId);
}

describe('错误处理流', () => {
  it('主流失败 → 错误流以 mode=error 运行并收到失败上下文', async () => {
    const handler = await request(app).post('/api/workflows').set(authed()).send(handlerFlow('err-handler')).expect(201);
    const main = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send(failingFlow('err-main', handler.body.id as string))
      .expect(201);

    const run = await request(app).post(`/api/workflows/${main.body.id}/run`).set(authed()).send({}).expect(200);
    expect(run.body.status).toBe('error');

    await new Promise((r) => setTimeout(r, 200)); // fire-and-forget 派发落库

    const handlerRuns = await executionsOf(handler.body.id as string);
    expect(handlerRuns).toHaveLength(1);
    expect(handlerRuns[0]!.mode).toBe('error');
    expect(handlerRuns[0]!.status).toBe('success');

    // 错误上下文进入错误流：Start 的种子输出带 workflow/execution/error
    const detail = await request(app).get(`/api/executions/${handlerRuns[0]!.id}`).set(authed()).expect(200);
    const seed = detail.body.data.resultData.runData['Start'][0].data.main[0][0].json as {
      workflow: { id: string };
      error: { message: string; node: string };
    };
    expect(seed.workflow.id).toBe(main.body.id);
    expect(seed.error.message).toContain('main boom');
    expect(seed.error.node).toBe('Fail');
    const notifyOut = detail.body.data.resultData.runData['Notify'][0].data.main[0][0].json as Record<string, unknown>;
    expect(notifyOut['handled']).toBe(true);
  });

  it('错误流自身失败不级联（哪怕它把自己设为 errorWorkflow）', async () => {
    // 建一个会失败的错误流，并把它的 errorWorkflow 指向自己
    const selfRef = await request(app).post('/api/workflows').set(authed()).send(handlerFlow('err-self', true)).expect(201);
    await request(app)
      .patch(`/api/workflows/${selfRef.body.id}`)
      .set(authed())
      .send({ settings: { errorWorkflow: selfRef.body.id } })
      .expect(200);

    const main = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({ ...failingFlow('err-main-2', selfRef.body.id as string), name: 'err-main-2' })
      .expect(201);

    await request(app).post(`/api/workflows/${main.body.id}/run`).set(authed()).send({}).expect(200);

    // 轮询等错误流运行落定（全量套件并发下固定等待不稳）
    let selfRuns = await executionsOf(selfRef.body.id as string);
    for (let i = 0; i < 40 && (selfRuns.length === 0 || selfRuns.some((e) => e.status === 'running' || e.status === 'new')); i++) {
      await new Promise((r) => setTimeout(r, 100));
      selfRuns = await executionsOf(selfRef.body.id as string);
    }
    await new Promise((r) => setTimeout(r, 200)); // 若有级联，给它冒头的时间

    selfRuns = await executionsOf(selfRef.body.id as string);
    expect(selfRuns).toHaveLength(1);
    expect(selfRuns[0]!.mode).toBe('error');
    expect(selfRuns[0]!.status).toBe('error');
  });
});
