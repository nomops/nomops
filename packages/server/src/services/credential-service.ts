import type { Repositories } from '@nomops/db';
import type { Credentials } from '@nomops/core';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { SecretsService } from './secrets-service.js';

/** API 返回形态：永不含 data（密文也不给，明文更不给——铁律 3）。 */
export interface ICredentialView {
  id: string;
  name: string;
  type: string;
  createdAt: Date;
}

export class CredentialService {
  constructor(
    private readonly repos: Repositories,
    private readonly credentials: Credentials,
    /** 外部密钥解析（docs/10 B4）。注入后 `{{ $secrets.KEY }}` 引用在注入瞬间物化。 */
    private readonly secrets?: SecretsService,
  ) {}

  async create(input: { name: string; type: string; data: JsonObject }, projectId: string): Promise<ICredentialView> {
    const encrypted = await this.credentials.encrypt(input.data, { projectId });
    const row = await this.repos.credentials.create(
      { name: input.name, type: input.type, data: encrypted },
      projectId,
    );
    return this.toView(row);
  }

  async list(projectId: string): Promise<ICredentialView[]> {
    return (await this.repos.credentials.findAllByProject(projectId)).map((r) => this.toView(r));
  }

  /** 仅供执行时注入节点使用，绝不经 API 返回（铁律 3）。 */
  async getDecryptedData(id: string, projectId: string): Promise<JsonObject> {
    const row = await this.repos.credentials.findById(id, projectId);
    if (!row) throw new OperationalError('Credential not found', { credentialId: id, status: 404 });
    const data = await this.credentials.decrypt(row.data, { projectId });
    // 外部密钥：把 {{ $secrets.KEY }} 引用物化为真值（仅此注入链路，绝不出 API/落库）
    return this.secrets ? this.secrets.resolve(data) : data;
  }

  /** 原始解密数据（不做 $secrets 解析——OAuth token 存回时用，避免把引用物化落库）。仅内部链路，绝不出 API。 */
  async rawData(id: string, projectId: string): Promise<JsonObject> {
    const row = await this.repos.credentials.findById(id, projectId);
    if (!row) throw new OperationalError('Credential not found', { credentialId: id, status: 404 });
    return this.credentials.decrypt(row.data, { projectId });
  }

  /** 合并补丁到凭证 data 并重新加密存回（OAuth 回调存 token 用）。 */
  async updateData(id: string, projectId: string, patch: JsonObject): Promise<void> {
    const current = await this.rawData(id, projectId);
    const encrypted = await this.credentials.encrypt({ ...current, ...patch }, { projectId });
    await this.repos.credentials.update(id, { data: encrypted });
  }

  /** OAuth 连接状态（只回布尔，绝不回 token——铁律 3）。 */
  async oauthStatus(id: string, projectId: string): Promise<{ connected: boolean }> {
    const data = await this.rawData(id, projectId);
    const token = (data['oauthTokenData'] as JsonObject | undefined)?.['access_token'];
    return { connected: Boolean(token) };
  }

  /** 测试连接（MVP：能解密即 ok；真实连接测试随具体凭证类型在后续补）。 */
  async test(id: string, projectId: string): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.getDecryptedData(id, projectId);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  }

  async delete(id: string, projectId: string): Promise<void> {
    const row = await this.repos.credentials.findById(id, projectId);
    if (!row) throw new OperationalError('Credential not found', { credentialId: id, status: 404 });
    await this.repos.credentials.delete(id);
  }

  private toView(row: { id: string; name: string; type: string; createdAt: Date }): ICredentialView {
    return { id: row.id, name: row.name, type: row.type, createdAt: row.createdAt };
  }
}
