import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IBinaryDataStore } from './binary-store.js';
import { FileSystemBinaryStore, InMemoryBinaryStore } from './binary-store.js';
import { S3BinaryStore, s3StoreOptionsFromEnv } from './s3-binary-store.js';

/**
 * 三种存储后端的**共用契约**（B3）。
 *
 * 加一种后端最容易出的事，是它在某个边角上和别的实现不一致——
 * id 校验松了、找不到时抛的不是 404、fileName 丢了。那些差异要到生产才暴露。
 * 所以这里让每种实现跑同一组断言，而不是各写各的测试。
 */

/** 进程内的假 S3：按 Key 存字节，行为对齐真实 S3 的关键语义（不存在即抛）。 */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    factory: async () => ({
      send: async (command: unknown) => {
        const input = (command as { input: Record<string, unknown> }).input;
        const key = String(input['Key']);
        // PutObjectCommand 带 Body，GetObjectCommand 不带
        if (input['Body'] !== undefined) {
          objects.set(key, Buffer.from(input['Body'] as Buffer));
          return {};
        }
        const found = objects.get(key);
        if (!found) throw new Error('NoSuchKey');
        return { Body: { transformToByteArray: async () => new Uint8Array(found) } };
      },
    }),
  };
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nomops-contract-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const backends: Array<[string, () => IBinaryDataStore]> = [
  ['文件系统', () => new FileSystemBinaryStore(dir)],
  ['内存', () => new InMemoryBinaryStore()],
  ['S3（假客户端）', () => new S3BinaryStore({ bucket: 'test-bucket', clientFactory: fakeS3().factory })],
];

describe.each(backends)('存储契约 @ %s', (_name, make) => {
  it('存取往返，字节一模一样', async () => {
    const store = make();
    const payload = Buffer.from('hello nomops binary');

    const ref = await store.put(payload, { mimeType: 'text/plain', fileName: 'a.txt' });
    const back = await store.get(ref.id!);

    expect(Buffer.from(back).equals(payload)).toBe(true);
  });

  it('二进制安全：不是文本也不能被改坏', async () => {
    const store = make();
    const payload = Buffer.from([0x00, 0xff, 0x1b, 0x80, 0x0a, 0x00]);

    const ref = await store.put(payload, { mimeType: 'application/octet-stream' });

    expect(Buffer.from(await store.get(ref.id!)).equals(payload)).toBe(true);
  });

  it('引用轻量且可 JSON 序列化（铁律 4）', async () => {
    const store = make();
    const payload = Buffer.from('x'.repeat(1000));

    const ref = await store.put(payload, { mimeType: 'text/plain', fileName: 'big.txt' });

    expect(ref.id).toBeTruthy();
    expect(ref.data).toBeUndefined(); // 引用形态绝不内嵌字节
    expect(ref.fileSize).toBe(1000);
    expect(ref.fileName).toBe('big.txt');
    expect(() => JSON.stringify(ref)).not.toThrow();
  });

  it('不给 fileName 也能存（并非所有二进制都有文件名）', async () => {
    const store = make();

    const ref = await store.put(Buffer.from('nameless'), { mimeType: 'application/octet-stream' });

    expect(ref.fileName).toBeUndefined();
    expect(Buffer.from(await store.get(ref.id!)).toString()).toBe('nameless');
  });

  it('两次存入互不覆盖（id 必须唯一）', async () => {
    const store = make();

    const a = await store.put(Buffer.from('AAA'), { mimeType: 'text/plain' });
    const b = await store.put(Buffer.from('BBB'), { mimeType: 'text/plain' });

    expect(a.id).not.toBe(b.id);
    expect(Buffer.from(await store.get(a.id!)).toString()).toBe('AAA');
    expect(Buffer.from(await store.get(b.id!)).toString()).toBe('BBB');
  });

  it('★非法 id 一律拒绝，且与「找不到」可区分（防路径穿越 / 键注入）', async () => {
    const store = make();

    for (const bad of ['../../etc/passwd', 'not-a-uuid', '', '*', 'a/b']) {
      // 「格式非法」不是「不存在」——前者是攻击信号,后者是正常的 404
      await expect(store.get(bad), bad).rejects.toThrow(/Invalid binary data id/);
    }
  });

  it('合法但不存在的 id → 报 404 而非泄漏后端细节', async () => {
    const store = make();

    await expect(store.get(randomUUID())).rejects.toMatchObject({
      context: { status: 404 },
    });
  });

  it('空内容也是合法内容', async () => {
    const store = make();

    const ref = await store.put(Buffer.alloc(0), { mimeType: 'application/octet-stream' });

    expect(ref.fileSize).toBe(0);
    expect(Buffer.from(await store.get(ref.id!)).byteLength).toBe(0);
  });
});

/* ────────────── S3 特有 ────────────── */

describe('S3 存储', () => {
  it('对象键带前缀分区，且文件名不进键（键恒为 uuid）', async () => {
    const fake = fakeS3();
    const store = new S3BinaryStore({
      bucket: 'b',
      prefix: 'binary/',
      clientFactory: fake.factory,
    });

    const ref = await store.put(Buffer.from('x'), {
      mimeType: 'text/plain',
      fileName: '../../evil name.txt',
    });

    const keys = [...fake.objects.keys()];
    expect(keys).toEqual([`binary/${ref.id}.bin`]);
    expect(keys[0]).not.toContain('evil');
  });

  it('前缀末尾多余的斜杠不会产生双斜杠键', async () => {
    const fake = fakeS3();
    const store = new S3BinaryStore({ bucket: 'b', prefix: 'a/b///', clientFactory: fake.factory });

    const ref = await store.put(Buffer.from('x'), { mimeType: 'text/plain' });

    expect([...fake.objects.keys()][0]).toBe(`a/b/${ref.id}.bin`);
  });

  it('缺 bucket 直接拒绝构造（早失败，别等到运行时才炸）', () => {
    expect(() => new S3BinaryStore({ bucket: '' })).toThrow();
  });
});

describe('S3 环境变量', () => {
  it('未配 bucket = 不启用', () => {
    expect(s3StoreOptionsFromEnv({})).toBeNull();
  });

  it('读全部配置项', () => {
    expect(
      s3StoreOptionsFromEnv({
        NOMOPS_S3_BUCKET: 'my-bucket',
        NOMOPS_S3_REGION: 'us-east-1',
        NOMOPS_S3_ENDPOINT: 'http://minio:9000',
        NOMOPS_S3_ACCESS_KEY_ID: 'ak',
        NOMOPS_S3_SECRET_ACCESS_KEY: 'sk',
        NOMOPS_S3_FORCE_PATH_STYLE: 'true',
        NOMOPS_S3_PREFIX: 'nomops',
        NOMOPS_S3_PRESIGN_EXPIRY_SECONDS: '600',
      }),
    ).toEqual({
      bucket: 'my-bucket',
      region: 'us-east-1',
      endpoint: 'http://minio:9000',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      forcePathStyle: true,
      prefix: 'nomops',
      presignExpirySeconds: 600,
    });
  });

  it('只给 bucket 时其余留空，走 SDK 默认凭证链（IAM role 比长期密钥安全）', () => {
    expect(s3StoreOptionsFromEnv({ NOMOPS_S3_BUCKET: 'b' })).toEqual({ bucket: 'b' });
  });
});
