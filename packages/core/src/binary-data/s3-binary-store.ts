import { randomUUID } from 'node:crypto';
import type { IBinaryData } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { assertValidBinaryId } from './binary-store.js';
import type { IBinaryDataStore, IBinaryMeta } from './binary-store.js';

/**
 * S3 兼容对象存储（B3）。覆盖 AWS S3、MinIO、Cloudflare R2、Wasabi 等
 * 任何讲 S3 协议的后端——所以不单独做 MinIO 实现。
 *
 * ★AWS SDK 全部动态 import：它体积很大，而绝大多数自托管实例用文件系统存储。
 * 不配 S3 就永远不加载，与 BullMQ 的处理一致（docs/01 队列模式同款思路）。
 */

export interface IS3StoreOptions {
  bucket: string;
  region?: string;
  /** 自建 S3 兼容服务的入口（MinIO/R2）；AWS 留空。 */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** MinIO 等通常需要开路径风格寻址。 */
  forcePathStyle?: boolean;
  /** 对象键前缀，便于与桶内其他数据分区。 */
  prefix?: string;
  /** 预签名下载链接有效期（秒）。 */
  presignExpirySeconds?: number;
  /**
   * 测试接缝：注入一个假的 S3 客户端，让本 store 能跑与文件系统实现
   * **同一套契约测试**。不注入即走真实 SDK。
   */
  clientFactory?: () => Promise<{ send(command: unknown): Promise<unknown> }>;
}

const DEFAULT_PRESIGN_EXPIRY = 300;

export class S3BinaryStore implements IBinaryDataStore {
  /** 惰性建立的客户端；首次真正读写时才拉起 SDK。 */
  private client: unknown = null;

  constructor(private readonly options: IS3StoreOptions) {
    if (!options.bucket) {
      throw new OperationalError('S3 binary store requires a bucket name');
    }
  }

  private key(id: string): string {
    const prefix = this.options.prefix ? `${this.options.prefix.replace(/\/+$/, '')}/` : '';
    return `${prefix}${id}.bin`;
  }

  private async s3() {
    if (this.client) return this.client as import('@aws-sdk/client-s3').S3Client;
    if (this.options.clientFactory) {
      this.client = await this.options.clientFactory();
      return this.client as import('@aws-sdk/client-s3').S3Client;
    }
    const { S3Client } = await import('@aws-sdk/client-s3');
    const { bucket: _bucket, region, endpoint, accessKeyId, secretAccessKey, forcePathStyle } = this.options;
    this.client = new S3Client({
      ...(region ? { region } : {}),
      ...(endpoint ? { endpoint } : {}),
      ...(forcePathStyle ? { forcePathStyle } : {}),
      // 不传凭证时走 SDK 的默认链（环境变量 / IAM role / ~/.aws）——
      // 生产上用 IAM role 比在配置里塞长期密钥安全得多
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });
    return this.client as import('@aws-sdk/client-s3').S3Client;
  }

  async put(buffer: Buffer, meta: IBinaryMeta): Promise<IBinaryData> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.s3();
    const id = randomUUID();

    await client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: this.key(id),
        Body: buffer,
        ContentType: meta.mimeType,
        // 文件名进元数据而非对象键：键保持 uuid，文件名可以是任意用户输入
        ...(meta.fileName ? { Metadata: { filename: encodeURIComponent(meta.fileName) } } : {}),
      }),
    );

    return {
      id,
      mimeType: meta.mimeType,
      ...(meta.fileName ? { fileName: meta.fileName } : {}),
      fileSize: buffer.byteLength,
    };
  }

  async get(id: string): Promise<Buffer> {
    assertValidBinaryId(id);
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.s3();

    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: this.key(id) }),
      );
      const body = result.Body;
      if (!body) throw new Error('empty body');
      // SDK 的 Body 是流；transformToByteArray 由 @smithy/util-stream 提供
      const bytes = await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      // 桶里没有 / 无权限 / 网络问题都归为「取不到」，不把 S3 的内部错误透给用户
      throw new OperationalError('Binary data not found', {
        id,
        status: 404,
        cause: (error as Error).message,
      });
    }
  }

  /**
   * 预签名下载链接：让浏览器直接从 S3 拉，大文件不必穿过本进程。
   * 返回 null 表示本 store 不支持（调用方回落到流式下载）。
   */
  async presignedUrl(id: string): Promise<string | null> {
    assertValidBinaryId(id);
    const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner'),
    ]);
    const client = await this.s3();
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: this.key(id) }),
      { expiresIn: this.options.presignExpirySeconds ?? DEFAULT_PRESIGN_EXPIRY },
    );
  }
}

/** 从环境变量构造；未配 bucket 即返回 null（表示不启用 S3）。 */
export function s3StoreOptionsFromEnv(env: NodeJS.ProcessEnv): IS3StoreOptions | null {
  const bucket = env['NOMOPS_S3_BUCKET'];
  if (!bucket) return null;
  const expiry = Number(env['NOMOPS_S3_PRESIGN_EXPIRY_SECONDS']);
  return {
    bucket,
    ...(env['NOMOPS_S3_REGION'] ? { region: env['NOMOPS_S3_REGION'] } : {}),
    ...(env['NOMOPS_S3_ENDPOINT'] ? { endpoint: env['NOMOPS_S3_ENDPOINT'] } : {}),
    ...(env['NOMOPS_S3_ACCESS_KEY_ID'] ? { accessKeyId: env['NOMOPS_S3_ACCESS_KEY_ID'] } : {}),
    ...(env['NOMOPS_S3_SECRET_ACCESS_KEY']
      ? { secretAccessKey: env['NOMOPS_S3_SECRET_ACCESS_KEY'] }
      : {}),
    ...(env['NOMOPS_S3_FORCE_PATH_STYLE'] === 'true' ? { forcePathStyle: true } : {}),
    ...(env['NOMOPS_S3_PREFIX'] ? { prefix: env['NOMOPS_S3_PREFIX'] } : {}),
    ...(Number.isFinite(expiry) && expiry > 0 ? { presignExpirySeconds: expiry } : {}),
  };
}
