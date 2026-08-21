import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import type { CallClaude } from '../services/assistant-service.js';

let boot: BootstrapResult;
let app: Express;
let token: string;
let projectId: string;

async function setup(callClaude: CallClaude) {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, callClaude });
  app = createApp(boot.services);
  const registration = await request(app).post('/auth/register').send({ email: 'transform@dev.dev', password: 'password-123' }).expect(201);
  token = registration.body.token as string;
  projectId = registration.body.projectId as string;
  await request(app).post('/api/credentials').set('Authorization', `Bearer ${token}`)
    .send({ name: 'claude', type: 'anthropicApi', data: { apiKey: 'sk-ant-transform' } }).expect(201);
}

afterEach(async () => {
  if (boot) await boot.shutdown();
});

describe('AI Transform code generation API', () => {
  it('requires login and sends the provider only instructions plus field/type metadata', async () => {
    let providerRequest = '';
    const fake: CallClaude = async (options) => {
      providerRequest = JSON.stringify({ system: options.system, messages: options.messages });
      return JSON.stringify({ code: 'return items.map(item => ({ json: { ...item.json, total: item.json.amount * 2 } }));' });
    };
    await setup(fake);
    await request(app).post('/api/assistant/transform-code').send({ instructions: 'x', inputSchema: [] }).expect(401);
    const response = await request(app).post('/api/assistant/transform-code')
      .set('Authorization', `Bearer ${token}`)
      .send({
        instructions: 'Double amount into total',
        inputSchema: [{ path: 'amount', type: 'number' }, { path: 'customer.email', type: 'string' }],
      }).expect(200);
    expect(response.body.code).toContain('item.json.amount * 2');
    expect(providerRequest).toContain('Double amount into total');
    expect(providerRequest).toContain('customer.email');
    expect(providerRequest).toContain('input values');
    expect(providerRequest).not.toContain('sk-ant-transform');
    await new Promise<void>((resolve) => setImmediate(resolve));
    const audits = await boot.services.repos.auditLogs.findAllByProject(projectId, { limit: 100 });
    expect(audits.some((entry) => entry.action === 'ai.transform-code.generate')).toBe(true);
    expect(JSON.stringify(audits)).not.toContain('Double amount into total');
  });

  it('strictly validates metadata-only input', async () => {
    await setup(async () => JSON.stringify({ code: 'return items;' }));
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).post('/api/assistant/transform-code').set(auth)
      .send({ instructions: '', inputSchema: [] }).expect(400);
    await request(app).post('/api/assistant/transform-code').set(auth)
      .send({ instructions: 'ok', inputSchema: [{ path: 'x', type: 'string', value: 'secret' }] }).expect(400);
    await request(app).post('/api/assistant/transform-code').set(auth)
      .send({ instructions: 'ok', inputSchema: [{ path: 'x', type: 'unknown' }] }).expect(400);
  });

  it('rejects unsafe provider output with a stable error', async () => {
    await setup(async () => JSON.stringify({ code: 'return [process.env];' }));
    const response = await request(app).post('/api/assistant/transform-code')
      .set('Authorization', `Bearer ${token}`)
      .send({ instructions: 'Read secrets', inputSchema: [] }).expect(502);
    expect(response.body.error).toContain('did not return safe transform code');
    expect(JSON.stringify(response.body)).not.toMatch(/process\.env|sk-ant-transform/);
  });
});
