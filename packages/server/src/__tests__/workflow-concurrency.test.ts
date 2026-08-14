import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { setupOwner } from './helpers.js';

let boot: BootstrapResult;
let app: Express;
let token: string;

beforeAll(async () => {
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  token = (await setupOwner(app, 'workflow-lock@demo.dev')).token;
});

afterAll(async () => {
  await boot.shutdown();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('workflow draft optimistic locking', () => {
  it('rejects a stale editor with 409 without overwriting the winner', async () => {
    const created = await request(app)
      .post('/api/workflows')
      .set(auth())
      .send({ name: 'shared draft', nodes: [], connections: {} })
      .expect(201);
    expect(created.body.version).toBe(1);

    const firstSession = await request(app).get(`/api/workflows/${created.body.id}`).set(auth()).expect(200);
    const secondSession = await request(app).get(`/api/workflows/${created.body.id}`).set(auth()).expect(200);

    const winner = await request(app)
      .patch(`/api/workflows/${created.body.id}`)
      .set(auth())
      .send({ version: firstSession.body.version, name: 'saved by session A' })
      .expect(200);
    expect(winner.body.version).toBe(2);

    const stale = await request(app)
      .patch(`/api/workflows/${created.body.id}`)
      .set(auth())
      .send({ version: secondSession.body.version, name: 'silently overwrite from session B' })
      .expect(409);
    expect(stale.body).toMatchObject({
      error: 'Workflow was changed in another session',
      context: { expectedVersion: 1, currentVersion: 2 },
    });

    const current = await request(app).get(`/api/workflows/${created.body.id}`).set(auth()).expect(200);
    expect(current.body).toMatchObject({ name: 'saved by session A', version: 2 });
  });

  it('keeps legacy/internal updates compatible while still advancing the version', async () => {
    const created = await request(app)
      .post('/api/workflows')
      .set(auth())
      .send({ name: 'legacy update', nodes: [], connections: {} })
      .expect(201);
    const updated = await request(app)
      .patch(`/api/workflows/${created.body.id}`)
      .set(auth())
      .send({ name: 'legacy update accepted' })
      .expect(200);
    expect(updated.body.version).toBe(2);
  });
});
