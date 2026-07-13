import type { JsonObject } from '@nomops/workflow';
import type { Cipher } from './encryption/cipher.js';

/**
 * 凭证对象加解密（core 层只管密码学，不碰 DB/API）。
 * ★铁律 3：解密后的数据绝不落库/出 API/进日志——调用方（server 层）负责遵守。
 */
export class Credentials {
  constructor(private readonly cipher: Cipher) {}

  async encrypt(data: JsonObject, context?: { projectId?: string }): Promise<string> {
    return this.cipher.encrypt(JSON.stringify(data), context);
  }

  async decrypt(encrypted: string, context?: { projectId?: string }): Promise<JsonObject> {
    return JSON.parse(await this.cipher.decrypt(encrypted, context)) as JsonObject;
  }
}
