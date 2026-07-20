import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
}
