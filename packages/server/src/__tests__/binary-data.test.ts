import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

/** 二进制下载端点：归属校验 + 引用必须出现在执行数据里；元数据（mimeType/fileName）回填响应头。 */
let boot: BootstrapResult;
let app: Express;
let token: string;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nomops-bin-srv-'));
  process.env['NOMOPS_BINARY_DATA_DIR'] = dir;
  boot = await bootstrap({ type: 'sqlite' });
  app = createApp(boot.services);
  await request(app).post('/auth/register').send({ email: 'bin@test.dev', password: 'password-123' }).expect(201);
  const login = await request(app).post('/auth/login').send({ email: 'bin@test.dev', password: 'password-123' }).expect(200);
  token = login.body.token as string;
});

afterAll(async () => {
  delete process.env['NOMOPS_BINARY_DATA_DIR'];
  await boot.shutdown();
  await rm(dir, { recursive: true, force: true });
});

const authed = () => ({ Authorization: `Bearer ${token}` });

describe('二进制数据', () => {
  it('执行数据里的引用可下载；伪造 id 拿不到', async () => {
    const store = boot.services.executions.getBinaryStore()!;
    const ref = await store.put(Buffer.from('PDF-BYTES'), { mimeType: 'application/pdf', fileName: 'report.pdf' });
    // 另一份存在于 store、但不属于任何执行的字节（用来验证包含校验）
    const orphan = await store.put(Buffer.from('SECRET'), { mimeType: 'text/plain' });

    // 直接铺一条含该引用的执行（跳过节点管道，聚焦端点行为）
    const me = await request(app).get('/api/me').set(authed()).expect(200);
    const projectId = me.body.projectId as string;
    const wf = await boot.services.workflows.create(
      { name: 'bin-flow', nodes: [{ id: 'a', name: 'S', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }], connections: {} },
      projectId,
    );
    const execution = await boot.services.repos.executions.create(
      { workflowId: wf.id, status: 'success', mode: 'manual', startedAt: new Date() },
      {
        workflowData: { name: wf.name, nodes: wf.nodes, connections: wf.connections },
        data: { resultData: { runData: { S: [{ startTime: 0, executionTime: 1, source: [], data: { main: [[{ json: {}, binary: { file: ref } }]] } }] } } },
      },
    );

    const ok = await request(app).get(`/api/executions/${execution.id}/binary/${ref.id}`).set(authed()).expect(200);
    expect(ok.headers['content-type']).toContain('application/pdf');
    expect(ok.headers['content-disposition']).toContain('report.pdf');
    expect(ok.body.toString()).toBe('PDF-BYTES');

    // store 里存在但不属于该执行的 id → 404（包含校验挡住任意拉取）
    await request(app).get(`/api/executions/${execution.id}/binary/${orphan.id}`).set(authed()).expect(404);
  });
});
