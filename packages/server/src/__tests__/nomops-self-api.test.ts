import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { IHttpRequestOptions } from '@nomops/workflow';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

let boot: BootstrapResult | undefined;

afterEach(async () => {
  await boot?.shutdown();
  boot = undefined;
});

async function setup(transport: (options: IHttpRequestOptions) => Promise<unknown>) {
  boot = await bootstrap({
    dbConfig: { type: 'sqlite' },
    scheduler: { pollMs: 3_600_000 },
    nomopsApiHttpRequest: transport,
  });
  const app = createApp(boot.services);
  const registration = await request(app).post('/auth/register')
    .send({ email: 'self-api@test.dev', password: 'password-123' }).expect(201);
  const token = registration.body.token as string;
  const projectId = registration.body.projectId as string;
  const credential = await request(app).post('/api/credentials')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Scoped self API', type: 'nomopsApi', data: { apiKey: 'nmp_test-secret-never-output' } })
    .expect(201);
  return { app, token, projectId, credentialId: credential.body.id as string };
}

async function runWorkflow(
  app: Express,
  token: string,
  credentialId: string,
  parameters: Record<string, unknown>,
) {
  const workflow = await request(app).post('/api/workflows')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Self API flow',
      nodes: [
        { id: 'start', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        {
          id: 'self', name: 'Nomops', type: 'nomops.nomops', typeVersion: 1, position: [220, 0],
          parameters,
          credentials: { nomopsApi: { id: credentialId, name: 'Scoped self API' } },
        },
      ],
      connections: { Start: { main: [[{ node: 'Nomops', type: 'main', index: 0 }]] } },
    }).expect(201);
  const summary = await request(app).post(`/api/workflows/${workflow.body.id}/run`)
    .set('Authorization', `Bearer ${token}`).send({}).expect(200);
  const detail = await request(app).get(`/api/executions/${summary.body.executionId}`)
    .set('Authorization', `Bearer ${token}`).expect(200);
  return { summary: summary.body, detail: detail.body };
}

describe('Nomops self API execution boundary', () => {
  it('fixes the target, API version and current project while keeping the key out of output', async () => {
    const transport = vi.fn(async () => [{ id: 'wf-a', name: 'Allowed' }]);
    const { app, token, projectId, credentialId } = await setup(transport);
    const result = await runWorkflow(app, token, credentialId, {
      resource: 'workflow', operation: 'list', returnAll: true,
    });
    expect(result.summary.status).toBe('success');
    expect(transport).toHaveBeenCalledOnce();
    const options = transport.mock.calls[0]![0];
    expect(options.url).toBe('http://localhost:5678/api/v1/workflows');
    expect(options.method).toBe('GET');
    expect(options.urlTrust).toBe('trusted');
    expect(options.headers).toMatchObject({
      'x-nomops-api-key': 'nmp_test-secret-never-output',
      'x-project-id': projectId,
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const serialized = JSON.stringify(result.detail);
    expect(serialized).toContain('Allowed');
    expect(serialized).not.toContain('nmp_test-secret-never-output');
  });

  it('rejects a crafted non-whitelisted resource without making a request or leaking the key', async () => {
    const transport = vi.fn(async () => ({}));
    const { app, token, credentialId } = await setup(transport);
    const result = await runWorkflow(app, token, credentialId, {
      resource: 'credential', operation: 'list', returnAll: true,
    });
    expect(result.summary.status).toBe('error');
    expect(transport).not.toHaveBeenCalled();
    expect(JSON.stringify(result.detail)).toContain('operation is not allowed');
    expect(JSON.stringify(result.detail)).not.toContain('nmp_test-secret-never-output');
  });
});
