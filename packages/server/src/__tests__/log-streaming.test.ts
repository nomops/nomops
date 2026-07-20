import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import type { PostFn } from '../services/log-streaming-service.js';
import { licensedBoot } from './helpers.js';

/**
 * B3 验收：日志流目的地管理 + 执行/审计事件推送 + HMAC 签名 + license 门 + 密钥不出 API。
 * 用进程内接收器（injected PostFn）替代真实网络。
 */

interface Received {
  url: string;
  body: string;
  headers: Record<string, string>;
}

function makeSink() {
  const received: Received[] = [];
  const post: PostFn = async (url, body, headers) => {
    received.push({ url, body, headers });
    return { status: 200 };
  };
  return { received, post };
}

let boot: BootstrapResult;
let app: Express;
let token: string;

async function setup(opts: { enterprise: boolean; post?: PostFn }) {
  boot = await bootstrap({
    dbConfig: { type: 'sqlite' },
    ...(opts.enterprise ? licensedBoot() : { licenseKey: null }),
    ...(opts.post ? { logStreamPost: opts.post } : {}),
  });
  app = createApp(boot.services);
  const reg = await request(app).post('/auth/register').send({ email: 'ls@dev.dev', password: 'password-123' }).expect(201);
  token = reg.body.token;
}
const authed = () => ({ Authorization: `Bearer ${token}` });

afterEach(async () => {
  await boot.shutdown();
});

/** 等待 fire-and-forget 的旁路推送落地。 */
const flush = () => new Promise((r) => setTimeout(r, 60));

describe('日志流（Log Streaming）', () => {
  it('社区版 → 所有目的地端点 403 带 feature 标识', async () => {
    await setup({ enterprise: false });
    const res = await request(app).get('/api/log-streaming/destinations').set(authed()).expect(403);
    expect(res.body.feature).toBe('logStreaming');
    await request(app).post('/api/log-streaming/destinations').set(authed()).send({ name: 'x', url: 'http://x' }).expect(403);
  });

  it('企业版：增删目的地，列表脱敏（永不返回 secret 明文）', async () => {
    await setup({ enterprise: true });
    const created = await request(app)
      .post('/api/log-streaming/destinations')
      .set(authed())
      .send({ name: 'SIEM', url: 'http://sink.local/in', secret: 'super-secret', events: ['audit'] })
      .expect(201);
    expect(created.body.secretConfigured).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain('super-secret'); // 铁律 3

    const list = await request(app).get('/api/log-streaming/destinations').set(authed()).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].secret).toBeUndefined();
    expect(list.body[0].secretConfigured).toBe(true);

    await request(app).delete(`/api/log-streaming/destinations/${created.body.id}`).set(authed()).expect(204);
    expect((await request(app).get('/api/log-streaming/destinations').set(authed())).body).toHaveLength(0);
  });

  it('非法 url → 400', async () => {
    await setup({ enterprise: true });
    await request(app).post('/api/log-streaming/destinations').set(authed()).send({ name: 'x', url: 'ftp://nope' }).expect(400);
  });

  it('测试发送 → 命中接收器且带 HMAC 签名', async () => {
    const sink = makeSink();
    await setup({ enterprise: true, post: sink.post });
    const dest = await request(app)
      .post('/api/log-streaming/destinations')
      .set(authed())
      .send({ name: 'SIEM', url: 'http://sink.local/in', secret: 'k' })
      .expect(201);

    const res = await request(app).post(`/api/log-streaming/destinations/${dest.body.id}/test`).set(authed()).expect(200);
    expect(res.body.ok).toBe(true);
    expect(sink.received).toHaveLength(1);
    expect(sink.received[0]!.headers['x-nomops-signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(sink.received[0]!.body).action).toBe('logStreaming.test');
  });

  it('执行结束事件自动推送到 execution 目的地', async () => {
    const sink = makeSink();
    await setup({ enterprise: true, post: sink.post });
    await request(app)
      .post('/api/log-streaming/destinations')
      .set(authed())
      .send({ name: 'exec-sink', url: 'http://sink.local/exec', events: ['execution'] })
      .expect(201);

    // 建一个最小可跑 workflow 并运行
    const wf = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({
        name: 'ping',
        nodes: [
          { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'b', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { ok: true } } },
        ],
        connections: { Start: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
      })
      .expect(201);
    await request(app).post(`/api/workflows/${wf.body.id}/run`).set(authed()).send({}).expect(200);

    await flush();
    const execEvents = sink.received.filter((r) => r.url.endsWith('/exec'));
    expect(execEvents.length).toBeGreaterThanOrEqual(1);
    const evt = JSON.parse(execEvents[0]!.body);
    expect(evt.type).toBe('execution');
    expect(evt.status).toBe('success');
    expect(evt.workflowId).toBe(wf.body.id);
  });

  it('只订阅 audit 的目的地不会收到 execution 事件', async () => {
    const sink = makeSink();
    await setup({ enterprise: true, post: sink.post });
    await request(app)
      .post('/api/log-streaming/destinations')
      .set(authed())
      .send({ name: 'audit-only', url: 'http://sink.local/audit', events: ['audit'] })
      .expect(201);
    // 上面这次 create 不产生 audit（controllers 未对该路由记审计），构造一次审计事件：改角色需 team project，
    // 简化用一次会写审计的操作——创建凭证不记审计，这里直接断言 execution 不串台即可。
    const wf = await request(app)
      .post('/api/workflows')
      .set(authed())
      .send({
        name: 'p',
        nodes: [{ id: 'a', name: 'S', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
        connections: {},
      })
      .expect(201);
    await request(app).post(`/api/workflows/${wf.body.id}/run`).set(authed()).send({}).expect(200);
    await flush();
    expect(sink.received.filter((r) => JSON.parse(r.body).type === 'execution')).toHaveLength(0);
  });
});
