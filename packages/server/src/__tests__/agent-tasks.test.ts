import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/**
 * backlog #44 M4：定时任务 —— agent_task_definition ↔ #38 scheduled_job(kind=agent-task)。
 * 验收：定时触发 agent(注入假 provider,不打真实网络);双实例只触发一次由 #38 租约保证
 * (scheduler.test.ts 已覆盖),此处验 once 任务触发一次后不再重复。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

const fakeHttp = (async () => ({
  content: [{ type: 'text', text: 'scheduled reply' }],
  usage: { input_tokens: 20, output_tokens: 8 },
})) as (o: unknown) => Promise<unknown>;

let agentId = '';

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, httpRequest: fakeHttp });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'task@test.dev', password: 'password-123' }).expect(201);
  token = (await request(app).post('/auth/login').send({ email: 'task@test.dev', password: 'password-123' }).expect(200)).body.token;
  const cred = (await request(app).post('/api/credentials').set(authed()).send({ name: 'Claude', type: 'anthropicApi', data: { apiKey: 'sk-test' } }).expect(201)).body;
  agentId = (await request(app).post('/api/agents').set(authed()).send({
    name: 'Cron Agent',
    config: { system: 'Be brief.', provider: 'anthropic', model: 'claude-sonnet-5', credentialId: cred.id },
  }).expect(201)).body.id;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('定时任务 CRUD（#44 M4）', () => {
  it('建任务 → task 行 + scheduled_job(kind=agent-task,config.taskId 回链,nextRunAt 已算)', async () => {
    const t = (await request(app).post(`/api/agents/${agentId}/tasks`).set(authed()).send({
      name: 'Hourly digest',
      message: 'Summarize the hour.',
      schedule: { mode: 'interval', everySeconds: 3600 },
    }).expect(201)).body;
    expect(t.jobId).toBeTruthy();

    const job = await boot.services.repos.scheduler.findJobById(t.jobId);
    expect(job).toMatchObject({ kind: 'agent-task', active: true });
    expect((job!.config as { taskId?: string }).taskId).toBe(t.id);
    expect(job!.nextRunAt).toBeInstanceOf(Date);

    const list = (await request(app).get(`/api/agents/${agentId}/tasks`).set(authed()).expect(200)).body;
    expect(list.map((x: { id: string }) => x.id)).toContain(t.id);
  });

  it('无效 cron → 400,不落任务行', async () => {
    const before = (await request(app).get(`/api/agents/${agentId}/tasks`).set(authed()).expect(200)).body.length;
    await request(app).post(`/api/agents/${agentId}/tasks`).set(authed()).send({
      name: 'bad', message: 'x', schedule: { mode: 'cron', cron: 'not a cron' },
    }).expect(400);
    const after = (await request(app).get(`/api/agents/${agentId}/tasks`).set(authed()).expect(200)).body.length;
    expect(after).toBe(before);
  });

  it('暂停 → 作业停 + nextRunAt 清空;恢复 → 重新排期', async () => {
    const t = (await request(app).post(`/api/agents/${agentId}/tasks`).set(authed()).send({
      name: 'Pausable', message: 'ping', schedule: { mode: 'interval', everySeconds: 600 },
    }).expect(201)).body;

    const paused = (await request(app).patch(`/api/agents/${agentId}/tasks/${t.id}`).set(authed()).send({ active: false }).expect(200)).body;
    expect(paused.active).toBe(false);
    let job = await boot.services.repos.scheduler.findJobById(t.jobId);
    expect(job!.active).toBe(false);
    expect(job!.nextRunAt).toBeNull();

    await request(app).patch(`/api/agents/${agentId}/tasks/${t.id}`).set(authed()).send({ active: true }).expect(200);
    job = await boot.services.repos.scheduler.findJobById(t.jobId);
    expect(job!.active).toBe(true);
    expect(job!.nextRunAt).toBeInstanceOf(Date);
  });

  it('删任务 → 任务行删除 + 作业停用', async () => {
    const t = (await request(app).post(`/api/agents/${agentId}/tasks`).set(authed()).send({
      name: 'Doomed', message: 'bye', schedule: { mode: 'interval', everySeconds: 600 },
    }).expect(201)).body;
    await request(app).delete(`/api/agents/${agentId}/tasks/${t.id}`).set(authed()).expect(204);

    const list = (await request(app).get(`/api/agents/${agentId}/tasks`).set(authed()).expect(200)).body;
    expect(list.map((x: { id: string }) => x.id)).not.toContain(t.id);
    const job = await boot.services.repos.scheduler.findJobById(t.jobId);
    expect(job!.active).toBe(false);
  });
});

describe('定时触发 agent（#44 M4 全链）', () => {
  it('once 任务到期 → tick 触发 agent 运行,聚在 channel=schedule 专属线程,链到 execution', async () => {
    const t = (await request(app).post(`/api/agents/${agentId}/tasks`).set(authed()).send({
      name: 'Fire now',
      message: 'Do the scheduled thing.',
      schedule: { mode: 'once', fireAt: new Date(Date.now() - 1000).toISOString() }, // 已到期
    }).expect(201)).body;

    // 手动 tick 触发（bootstrap 的后台轮询也可能先触发——租约保证只跑一次,轮询待结果即可）
    await boot.scheduler.tick();
    let task: { threadId: string | null; lastRunAt: string | null } | undefined;
    for (let i = 0; i < 20; i++) {
      [task] = (await request(app).get(`/api/agents/${agentId}/tasks`).set(authed()).expect(200)).body
        .filter((x: { id: string }) => x.id === t.id);
      if (task?.threadId) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(task?.threadId).toBeTruthy();
    expect(task?.lastRunAt).toBeTruthy();

    // 线程侧留痕：channel=schedule,run 链到 execution,回复来自假 provider
    const detail = (await request(app).get(`/api/agents/${agentId}/threads/${task!.threadId}`).set(authed()).expect(200)).body;
    expect(detail.thread.channel).toBe('schedule');
    expect(detail.runs).toHaveLength(1);
    expect(detail.runs[0].executionId).toBeTruthy();
    expect(detail.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(detail.messages[1].content).toEqual({ text: 'scheduled reply' });

    // once：触发后 nextRunAt 清空,再 tick 不重复触发
    const job = await boot.services.repos.scheduler.findJobById(t.jobId);
    expect(job!.nextRunAt).toBeNull();
    await boot.scheduler.tick();
    const detail2 = (await request(app).get(`/api/agents/${agentId}/threads/${task!.threadId}`).set(authed()).expect(200)).body;
    expect(detail2.runs).toHaveLength(1);
  });

  it('已删任务的残留作业触发 → 静默跳过不炸', async () => {
    const t = (await request(app).post(`/api/agents/${agentId}/tasks`).set(authed()).send({
      name: 'Ghost', message: 'boo', schedule: { mode: 'once', fireAt: new Date(Date.now() - 1000).toISOString() },
    }).expect(201)).body;
    // 直接删任务行但把作业留成活跃(模拟不一致)
    await boot.services.repos.agents.deleteTask(t.id);
    const r = await boot.scheduler.tick(); // 不抛错即通过;fire 返回 null
    expect(r.fired).toBeGreaterThanOrEqual(0);
  });
});
