import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser, setupOwner, licensedBoot } from './helpers.js';

/**
 * backlog #34：每用户收藏 —— 同一团队项目里两个用户各自星标互不可见。
 */
let boot: BootstrapResult;
let app: Express;
const tok: Record<string, string> = {};
let projectId: string;
let wfA = '';
let wfB = '';

const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}`, 'X-Project-Id': projectId });
const sample = (name: string) => ({
  name,
  nodes: [{ id: 't', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
  connections: {},
});

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot() });
  app = createApp(boot.services);
  const owner = await setupOwner(app, 'owner@fav.dev');
  tok['owner'] = owner.token;
  const mate = await inviteUser(app, owner.token, 'mate@fav.dev');
  tok['mate'] = mate.token;

  const proj = await request(app).post('/api/projects').set({ Authorization: `Bearer ${owner.token}` }).send({ name: 'Fav Team' }).expect(201);
  projectId = proj.body.id;
  await request(app)
    .post(`/api/projects/${projectId}/members`)
    .set({ Authorization: `Bearer ${owner.token}` })
    .send({ email: 'mate@fav.dev', role: 'project:editor' })
    .expect(201);

  wfA = (await request(app).post('/api/workflows').set(as('owner')).send(sample('Alpha')).expect(201)).body.id;
  wfB = (await request(app).post('/api/workflows').set(as('owner')).send(sample('Beta')).expect(201)).body.id;
});

afterAll(async () => {
  await boot.shutdown();
});

const favIds = async (who: string): Promise<string[]> => {
  const rows = (await request(app).get('/api/workflows').set(as(who)).expect(200)).body as Array<{ id: string; favorite?: boolean }>;
  return rows.filter((r) => r.favorite).map((r) => r.id);
};

describe('每用户收藏（backlog #34）', () => {
  it('两用户各收藏不同工作流，列表里各见各的', async () => {
    await request(app).post(`/api/workflows/${wfA}/favorite`).set(as('owner')).send({ favorite: true }).expect(200);
    await request(app).post(`/api/workflows/${wfB}/favorite`).set(as('mate')).send({ favorite: true }).expect(200);

    expect(await favIds('owner')).toEqual([wfA]);
    expect(await favIds('mate')).toEqual([wfB]);
  });

  it('同一工作流：一方收藏不影响另一方', async () => {
    await request(app).post(`/api/workflows/${wfA}/favorite`).set(as('mate')).send({ favorite: true }).expect(200);
    // mate 现在收藏 A 和 B；owner 仍只有 A
    expect((await favIds('mate')).sort()).toEqual([wfA, wfB].sort());
    expect(await favIds('owner')).toEqual([wfA]);
  });

  it('取消收藏只影响本人', async () => {
    await request(app).post(`/api/workflows/${wfA}/favorite`).set(as('owner')).send({ favorite: false }).expect(200);
    expect(await favIds('owner')).toEqual([]);
    // mate 的 A 收藏不受影响
    expect((await favIds('mate')).sort()).toEqual([wfA, wfB].sort());
  });

  it('favorite 端点回显本用户的新状态', async () => {
    const res = await request(app).post(`/api/workflows/${wfB}/favorite`).set(as('owner')).send({ favorite: true }).expect(200);
    expect(res.body).toMatchObject({ id: wfB, favorite: true });
  });
});
