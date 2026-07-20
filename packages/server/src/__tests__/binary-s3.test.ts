import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { setupOwner } from './helpers.js';

/**
 * S3 二进制存储在**真实执行路径**上的端到端验证（B3）。
 *
 * store 自身的语义由 core 的契约测试守（三种后端同一组断言）。这里要证明的是
 * 另一件事：bootstrap 选对了后端，且节点写进去的字节能经下载接口原样取回来。
 * 少了这一环，就可能出现「store 实现得很好但根本没接上」。
 */
const objects = new Map<string, Buffer>();

let boot: BootstrapResult;
let app: Express;
let token: string;

/** 进程内假 S3。测试不打真网，也不要求本地起 MinIO。 */
const fakeClient = async () => ({
  send: async (command: unknown) => {
    const input = (command as { input: Record<string, unknown> }).input;
    const key = String(input['Key']);
    if (input['Body'] !== undefined) {
      objects.set(key, Buffer.from(input['Body'] as Buffer));
      return {};
    }
    const found = objects.get(key);
    if (!found) throw new Error('NoSuchKey');
    return { Body: { transformToByteArray: async () => new Uint8Array(found) } };
  },
});

beforeAll(async () => {
  boot = await bootstrap({
    dbConfig: { type: 'sqlite' },
    s3: { bucket: 'nomops-test', prefix: 'binary', clientFactory: fakeClient },
  });
  app = createApp(boot.services);
  token = (await setupOwner(app, 'owner@s3.dev')).token;
});

afterAll(async () => {
  await boot.shutdown();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

/** 造一条持有该二进制引用的执行记录（聚焦存储后端与下载链路，不走节点管道）。 */
async function seedExecutionWith(ref: unknown): Promise<string> {
  const me = await request(app).get('/api/me').set(authed()).expect(200);
  const wf = await boot.services.workflows.create(
    {
      name: 's3-flow',
      nodes: [
        { id: 'a', name: 'S', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
      ],
      connections: {},
    },
    me.body.projectId as string,
  );
  const execution = await boot.services.repos.executions.create(
    { workflowId: wf.id, status: 'success', mode: 'manual', startedAt: new Date() },
    {
      workflowData: { name: wf.name, nodes: wf.nodes, connections: wf.connections },
      data: {
        resultData: {
          runData: {
            S: [{ startTime: 0, executionTime: 1, source: [], data: { main: [[{ json: {}, binary: { file: ref } }]] } }],
          },
        },
      },
    },
  );
  return execution.id;
}

describe('S3 后端接线', () => {
  it('★bootstrap 配了 S3 就用 S3，字节落进桶而非文件系统', async () => {
    const store = boot.services.executions.getBinaryStore()!;
    expect(store.constructor.name).toBe('S3BinaryStore');

    const ref = await store.put(Buffer.from('s3 payload bytes'), {
      mimeType: 'text/plain',
      fileName: 'out.txt',
    });

    const keys = [...objects.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^binary\/[0-9a-f-]{36}\.bin$/);
    expect(objects.get(keys[0]!)!.toString()).toBe('s3 payload bytes');
    expect(ref.id).toBeTruthy();
  });

  it('下载接口从 S3 取回字节，元数据正确', async () => {
    const store = boot.services.executions.getBinaryStore()!;
    const ref = await store.put(Buffer.from('PDF-BYTES'), {
      mimeType: 'application/pdf',
      fileName: 'report.pdf',
    });
    const executionId = await seedExecutionWith(ref);

    const download = await request(app)
      .get(`/api/executions/${executionId}/binary/${ref.id}`)
      .set(authed())
      .expect(200);

    expect(download.body.toString()).toBe('PDF-BYTES');
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['content-disposition']).toContain('report.pdf');
  });

  it('store 里有、但不属于该执行的 id → 404（归属校验仍然生效）', async () => {
    const store = boot.services.executions.getBinaryStore()!;
    const ref = await store.put(Buffer.from('MINE'), { mimeType: 'text/plain' });
    const orphan = await store.put(Buffer.from('SECRET'), { mimeType: 'text/plain' });
    const executionId = await seedExecutionWith(ref);

    await request(app)
      .get(`/api/executions/${executionId}/binary/${orphan.id}`)
      .set(authed())
      .expect(404);
  });
});

describe('未配 S3 时', () => {
  it('回落文件系统，行为与 B3 之前一致', async () => {
    const fs = await bootstrap({ dbConfig: { type: 'sqlite' }, s3: null });
    try {
      expect(fs.services.executions.getBinaryStore()?.constructor.name).toBe('FileSystemBinaryStore');
    } finally {
      await fs.shutdown();
    }
  });
});
