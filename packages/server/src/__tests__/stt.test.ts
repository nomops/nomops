import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #32c：语音转写（STT）—— 配置(admin) + 转写(editor)。
 * 注入假 fetch：断言打到配置的 endpoint、带 Bearer + multipart，返回 { text }。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const calls: Array<{ url: string; auth: string | null; hasForm: boolean }> = [];

const fakeFetch = (async (url: unknown, init?: unknown) => {
  const opts = (init ?? {}) as { headers?: Record<string, string>; body?: unknown };
  calls.push({
    url: String(url),
    auth: opts.headers?.['Authorization'] ?? null,
    hasForm: typeof FormData !== 'undefined' && opts.body instanceof FormData,
  });
  return { ok: true, status: 200, json: async () => ({ text: 'hello world' }) } as Response;
}) as unknown as typeof fetch;

const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, sttFetch: fakeFetch });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'stt@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'stt@test.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.dbHandle.close();
});

describe('语音转写 STT（backlog #32）', () => {
  it('默认配置：未启用、apiKey 未配、绝不回显 apiKey', async () => {
    const res = await request(app).get('/api/stt-config').set(authed()).expect(200);
    expect(res.body).toMatchObject({ enabled: false, apiKeyConfigured: false, model: 'whisper-1' });
    expect(res.body.apiKey).toBeUndefined();
  });

  it('未启用时转写 → 400', async () => {
    await request(app)
      .post('/api/chat/transcribe')
      .set(authed())
      .send({ audio: Buffer.from('x').toString('base64'), mimeType: 'audio/webm' })
      .expect(400);
  });

  it('配置 apiKey → apiKeyConfigured 但不回显；省略 apiKey 保留旧值', async () => {
    const set = await request(app)
      .put('/api/stt-config')
      .set(authed())
      .send({ enabled: true, apiKey: 'sk-secret', model: 'whisper-1' })
      .expect(200);
    expect(set.body).toMatchObject({ enabled: true, apiKeyConfigured: true });
    expect(set.body.apiKey).toBeUndefined();

    // 再次 PUT 不带 apiKey：仍保留（apiKeyConfigured 不变）
    const again = await request(app).put('/api/stt-config').set(authed()).send({ enabled: true }).expect(200);
    expect(again.body.apiKeyConfigured).toBe(true);
  });

  it('转写：打到配置 endpoint、带 Bearer + multipart，返回文本', async () => {
    calls.length = 0;
    const res = await request(app)
      .post('/api/chat/transcribe')
      .set(authed())
      .send({ audio: Buffer.from('AUDIODATA').toString('base64'), mimeType: 'audio/webm', fileName: 'clip.webm' })
      .expect(200);
    expect(res.body.text).toBe('hello world');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(calls[0]!.auth).toBe('Bearer sk-secret');
    expect(calls[0]!.hasForm).toBe(true);
  });
});
