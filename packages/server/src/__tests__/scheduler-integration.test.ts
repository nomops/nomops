import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #38b：Schedule Trigger 迁到 DB 调度器 —— 激活建 job、tick 触发执行、停用停 job。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

const scheduleWf = {
  name: 'sched-wf',
  nodes: [
    { id: 't', name: 'Schedule', type: 'nomops.schedule', typeVersion: 1, position: [0, 0], parameters: { mode: 'interval', intervalSeconds: 60 } },
    { id: 's', name: 'Set', type: 'nomops.set', typeVersion: 1, position: [240, 0], parameters: { fields: { ok: true } } },
  ],
  connections: { Schedule: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
};

beforeAll(async () => {
  // pollMs 拉大避免自动触发,测试手动 tick;instanceId 固定
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, scheduler: { pollMs: 3_600_000, instanceId: 'test' } });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'sched@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'sched@test.dev', password: 'password-123' }).expect(200)).body.token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('Schedule Trigger → DB 调度器（backlog #38b）', () => {
  let wfId = '';

  it('激活工作流 → 建 scheduled_job（active,带 nextRunAt）', async () => {
    wfId = (await request(app).post('/api/workflows').set(authed()).send(scheduleWf).expect(201)).body.id;
    await request(app).post(`/api/workflows/${wfId}/activate`).set(authed()).send({ active: true }).expect(200);

    const job = await boot.services.repos.scheduler.findJobByNode(wfId, 'Schedule');
    expect(job).toBeTruthy();
    expect(job!.active).toBe(true);
    expect(job!.nextRunAt).toBeInstanceOf(Date);
    expect(job!.config).toMatchObject({ mode: 'interval', everySeconds: 60 });
  });

  it('到期 tick → 触发一次执行（mode=trigger）', async () => {
    const job = await boot.services.repos.scheduler.findJobByNode(wfId, 'Schedule');
    // 把 nextRunAt 拨到过去使其到期
    await boot.services.repos.scheduler.updateJob(job!.id, { nextRunAt: new Date(Date.now() - 1000) });

    const before = (await request(app).get('/api/executions').set(authed()).expect(200)).body.length;
    const r = await boot.scheduler.tick();
    expect(r.fired).toBe(1);

    const execs = (await request(app).get('/api/executions').set(authed()).expect(200)).body as Array<{ workflowId: string; mode: string }>;
    expect(execs.length).toBe(before + 1);
    expect(execs.some((e) => e.workflowId === wfId && e.mode === 'trigger')).toBe(true);

    // nextRunAt 已推进到未来
    const after = await boot.services.repos.scheduler.findJobById(job!.id);
    expect(after!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('停用工作流 → job 停用,tick 不再触发', async () => {
    await request(app).post(`/api/workflows/${wfId}/activate`).set(authed()).send({ active: false }).expect(200);
    const job = await boot.services.repos.scheduler.findJobByNode(wfId, 'Schedule');
    expect(job!.active).toBe(false);

    // 即便拨到过期,停用的 job 不进 findDueJobs
    await boot.services.repos.scheduler.updateJob(job!.id, { nextRunAt: new Date(Date.now() - 1000) });
    // 但 updateJob 不改 active;确认 active 仍 false 后 tick 不触发
    const r = await boot.scheduler.tick();
    expect(r.fired).toBe(0);
  });

  it('同一 Schedule 节点的多条 Trigger Rule 各自持久化并可独立到期', async () => {
    const id = (await request(app).post('/api/workflows').set(authed()).send({
      ...scheduleWf,
      name: 'multi-rule-schedule',
      nodes: [
        {
          ...scheduleWf.nodes[0],
          parameters: {
            rule: { interval: [
              { field: 'seconds', secondsInterval: 30 },
              { field: 'minutes', minutesInterval: 2 },
            ] },
          },
        },
        scheduleWf.nodes[1],
      ],
    }).expect(201)).body.id as string;
    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: true }).expect(200);

    const jobs = await boot.services.repos.scheduler.findJobsByNode(id, 'Schedule');
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.config)).toEqual(expect.arrayContaining([
      { mode: 'interval', everySeconds: 30 },
      { mode: 'interval', everySeconds: 120 },
    ]));
    for (const job of jobs) await boot.services.repos.scheduler.updateJob(job.id, { nextRunAt: new Date(Date.now() - 1000) });
    const before = ((await request(app).get('/api/executions').set(authed()).expect(200)).body as Array<{ workflowId: string }>).filter((row) => row.workflowId === id).length;
    expect((await boot.scheduler.tick()).fired).toBe(2);
    const after = ((await request(app).get('/api/executions').set(authed()).expect(200)).body as Array<{ workflowId: string }>).filter((row) => row.workflowId === id).length;
    expect(after - before).toBe(2);

    await request(app).post(`/api/workflows/${id}/activate`).set(authed()).send({ active: false }).expect(200);
    expect((await boot.services.repos.scheduler.findJobsByNode(id, 'Schedule')).every((job) => !job.active)).toBe(true);
  });
});
