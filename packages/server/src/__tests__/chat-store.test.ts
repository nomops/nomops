import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser, setupOwner } from './helpers.js';

/**
 * Chat 会话/个人 Agent 持久化（backlog #14）：
 * 用户维度归属、PUT 幂等 upsert、别人的 uuid 不可覆盖（403）、消息数组原样往返。
 */
let boot: BootstrapResult;
let app: Express;
let a: { token: string };
let b: { token: string };
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  a = await setupOwner(app, 'chat-a@test.dev');
  b = await inviteUser(app, a.token, 'chat-b@test.dev');
});

afterAll(async () => {
  await boot.shutdown();
});

describe('Chat 持久化', () => {
  it('会话 upsert/列表/更新/删除,消息原样往返;跨用户不可见/不可覆盖', async () => {
    const id = randomUUID();
    const body = {
      title: 'First chat',
      target: { type: 'model', label: 'claude-sonnet-5', model: 'claude-sonnet-5' },
      wfSessionId: null,
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello!', workflow: null },
      ],
    };
    await request(app).put(`/api/chat/sessions/${id}`).set(as(a.token)).send(body).expect(200);

    const list = await request(app).get('/api/chat/sessions').set(as(a.token)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].messages).toEqual(body.messages);
    expect(list.body[0].target.model).toBe('claude-sonnet-5');

    // 幂等更新(追加消息)
    await request(app)
      .put(`/api/chat/sessions/${id}`)
      .set(as(a.token))
      .send({ ...body, title: 'Renamed', messages: [...body.messages, { role: 'user', content: 'more' }] })
      .expect(200);
    const after = await request(app).get('/api/chat/sessions').set(as(a.token)).expect(200);
    expect(after.body).toHaveLength(1);
    expect(after.body[0].title).toBe('Renamed');
    expect(after.body[0].messages).toHaveLength(3);

    // B 看不到,也不能用同 id 覆盖
    const forB = await request(app).get('/api/chat/sessions').set(as(b.token)).expect(200);
    expect(forB.body).toHaveLength(0);
    await request(app).put(`/api/chat/sessions/${id}`).set(as(b.token)).send(body).expect(403);
    // A 的行未被 B 的尝试污染
    const intact = await request(app).get('/api/chat/sessions').set(as(a.token)).expect(200);
    expect(intact.body[0].title).toBe('Renamed');

    await request(app).delete(`/api/chat/sessions/${id}`).set(as(a.token)).expect(204);
    expect((await request(app).get('/api/chat/sessions').set(as(a.token)).expect(200)).body).toHaveLength(0);
  });

  it('Agent upsert/删除;非法 id 400', async () => {
    const id = randomUUID();
    await request(app)
      .put(`/api/chat/agents/${id}`)
      .set(as(a.token))
      .send({ name: 'Support bot', system: 'Be nice.' })
      .expect(200);
    const list = await request(app).get('/api/chat/agents').set(as(a.token)).expect(200);
    expect(list.body[0].name).toBe('Support bot');
    await request(app).put('/api/chat/agents/short-id').set(as(a.token)).send({ name: 'x', system: 'y' }).expect(400);
    await request(app).delete(`/api/chat/agents/${id}`).set(as(a.token)).expect(204);
    expect((await request(app).get('/api/chat/agents').set(as(a.token)).expect(200)).body).toHaveLength(0);
  });
});
