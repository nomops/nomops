import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #32b：多模态 chat 附件入口 —— base64 附件经 chat 端点 → 存 binaryStore →
 * seed 进 item.binary → ChatTrigger 原样透传给下游（AiAgent 会读 image/* 附件）。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

const chatWorkflow = {
  name: 'chat-mm',
  nodes: [
    { id: 't', name: 'Chat', type: 'nomops.chatTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: 'n', name: 'Pass', type: 'nomops.noOp', typeVersion: 1, position: [220, 0], parameters: {} },
  ],
  connections: { Chat: { main: [[{ node: 'Pass', type: 'main', index: 0 }]] } },
};

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'mm@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'mm@test.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.dbHandle.close();
});

describe('多模态 chat 附件（backlog #32）', () => {
  it('图片附件 → 进执行 seed 的 item.binary，随 ChatTrigger 透传', async () => {
    const wf = (await request(app).post('/api/workflows').set(authed()).send(chatWorkflow).expect(201)).body;
    const b64 = Buffer.from('PNGBYTES').toString('base64');

    const res = await request(app)
      .post(`/api/workflows/${wf.id}/chat`)
      .set(authed())
      .send({ message: 'describe this', attachments: [{ fileName: 'cat.png', mimeType: 'image/png', data: b64 }] })
      .expect(200);
    expect(res.body.status).toBe('success');

    // 执行数据里 ChatTrigger 输出应带 binary（有 store 时为引用形态：id + mimeType）
    const detail = (await request(app).get(`/api/executions/${res.body.executionId}`).set(authed()).expect(200)).body;
    const triggerOut = detail.data.resultData.runData['Chat'][0].data.main[0][0];
    expect(triggerOut.json.chatInput).toBe('describe this');
    expect(triggerOut.binary.file0.mimeType).toBe('image/png');
    expect(triggerOut.binary.file0.fileName).toBe('cat.png');
  });

  it('仅附件（空 message）也放行', async () => {
    const wf = (await request(app).post('/api/workflows').set(authed()).send(chatWorkflow).expect(201)).body;
    const b64 = Buffer.from('x').toString('base64');
    await request(app)
      .post(`/api/workflows/${wf.id}/chat`)
      .set(authed())
      .send({ attachments: [{ mimeType: 'image/jpeg', data: b64 }] })
      .expect(200);
  });

  it('空 message 且无附件 → 400', async () => {
    const wf = (await request(app).post('/api/workflows').set(authed()).send(chatWorkflow).expect(201)).body;
    await request(app).post(`/api/workflows/${wf.id}/chat`).set(authed()).send({ message: '   ' }).expect(400);
  });
});
