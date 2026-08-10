/**
 * ★铁律 5：任何取加密密钥的地方都经此接口，不写死。
 * 安装版实现（server 层）：从 settings 表读实例密钥；
 * Cloud 实现（Phase 6+）：从 KMS / 每租户密钥读。core 只认接口。
 */
export interface IEncryptionKeyProvider {
  /** 返回 32 字节密钥（AES-256）。context 供 Cloud 按租户取键。 */
  getKey(context?: { projectId?: string }): Promise<Buffer>;
  /** 可选 keyring 能力：Cipher 检测到后写入带 keyId 的 v2 密文。 */
  getActiveKey?(context?: { projectId?: string }): Promise<{ id: string; key: Buffer }>;
  /** 按密文中的 keyId 读取历史 DEK，供无停机轮换。 */
  getKeyById?(id: string, context?: { projectId?: string }): Promise<Buffer>;
}

/** 测试/开发用：固定内存密钥。 */
export class StaticKeyProvider implements IEncryptionKeyProvider {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error(`加密密钥必须 32 字节（AES-256），实际 ${key.length}`);
    }
  }

  async getKey(): Promise<Buffer> {
    return this.key;
  }
}
