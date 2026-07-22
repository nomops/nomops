import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IBinaryData } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

export interface IBinaryMeta {
  mimeType: string;
  fileName?: string;
}

/**
 * 二进制存储抽象：执行状态里只留引用（id+元数据），字节流落在 store。
 * 文件系统实现给自托管；Cloud 换 S3 实现，业务零改动（同凭证 KeyProvider 思路）。
 */
export interface IBinaryDataStore {
  put(buffer: Buffer, meta: IBinaryMeta): Promise<IBinaryData>;
  get(id: string): Promise<Buffer>;
  /** 删除单个引用（执行记录删除时级联;不存在视为已删,不报错）。可选:老实现无此能力。 */
  delete?(id: string): Promise<void>;
  /** 列全部 blob id（孤儿清理扫描用）。可选:S3 大桶不宜全 list,返回 null 表示不支持。 */
  list?(): Promise<string[] | null>;
}

/** 从执行数据 JSON 里收集所有 binary 引用 id（深扫 pruner/级联删除用）。 */
export function collectBinaryIds(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectBinaryIds(v, acc);
  } else if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // IBinaryData 形状:有 string id + mimeType（区别于普通业务对象里恰好叫 id 的字段）
    if (typeof obj['id'] === 'string' && typeof obj['mimeType'] === 'string' && ID_PATTERN.test(obj['id'] as string)) {
      acc.add(obj['id'] as string);
    }
    for (const v of Object.values(obj)) collectBinaryIds(v, acc);
  }
  return acc;
}

/**
 * id 必须是 uuid。各实现共用同一把尺子——校验松紧不一致的后端，
 * 会让「路径穿越 / 键注入」在某一种部署形态下悄悄可行。
 */
const ID_PATTERN = /^[0-9a-f-]{36}$/i;

export function assertValidBinaryId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new OperationalError('Invalid binary data id', { id });
  }
}

/** 文件系统实现：<rootDir>/<uuid>.bin。id 即文件名主干（uuid，杜绝路径穿越）。 */
export class FileSystemBinaryStore implements IBinaryDataStore {
  constructor(private readonly rootDir: string) {}

  async put(buffer: Buffer, meta: IBinaryMeta): Promise<IBinaryData> {
    await mkdir(this.rootDir, { recursive: true });
    const id = randomUUID();
    await writeFile(join(this.rootDir, `${id}.bin`), buffer);
    return {
      id,
      mimeType: meta.mimeType,
      ...(meta.fileName ? { fileName: meta.fileName } : {}),
      fileSize: buffer.byteLength,
    };
  }

  async get(id: string): Promise<Buffer> {
    assertValidBinaryId(id);
    try {
      return await readFile(join(this.rootDir, `${id}.bin`));
    } catch {
      throw new OperationalError('Binary data not found', { id, status: 404 });
    }
  }

  async delete(id: string): Promise<void> {
    assertValidBinaryId(id);
    await rm(join(this.rootDir, `${id}.bin`), { force: true }); // 不存在不报错
  }

  async list(): Promise<string[]> {
    try {
      const files = await readdir(this.rootDir);
      return files.filter((f) => f.endsWith('.bin')).map((f) => f.slice(0, -4));
    } catch {
      return []; // 目录尚未创建 = 没有任何 blob
    }
  }
}

/** 内存实现（测试用）。 */
export class InMemoryBinaryStore implements IBinaryDataStore {
  private readonly blobs = new Map<string, Buffer>();

  async put(buffer: Buffer, meta: IBinaryMeta): Promise<IBinaryData> {
    const id = randomUUID();
    this.blobs.set(id, buffer);
    return { id, mimeType: meta.mimeType, ...(meta.fileName ? { fileName: meta.fileName } : {}), fileSize: buffer.byteLength };
  }

  async get(id: string): Promise<Buffer> {
    assertValidBinaryId(id); // 与其他后端同一把尺子:格式非法 ≠ 不存在
    const blob = this.blobs.get(id);
    if (!blob) throw new OperationalError('Binary data not found', { id, status: 404 });
    return blob;
  }

  async delete(id: string): Promise<void> {
    assertValidBinaryId(id);
    this.blobs.delete(id);
  }

  async list(): Promise<string[]> {
    return [...this.blobs.keys()];
  }
}
