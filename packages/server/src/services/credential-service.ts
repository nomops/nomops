import type { Repositories } from '@nomops/db';
import type { Credentials } from '@nomops/core';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { SecretsService } from './secrets-service.js';
import {
  buildCredentialTest,
  judgeTestResponse,
  FetchCredentialTester,
  type ICredentialTester,
} from './credential-test.js';

/** API 返回形态：永不含 data（密文也不给，明文更不给——铁律 3）。 */
export interface ICredentialView {
  id: string;
  name: string;
  type: string;
  createdAt: Date;
  updatedAt: Date;
}

export class CredentialService {
  constructor(
    private readonly repos: Repositories,
    private readonly credentials: Credentials,
    /** 外部密钥解析（docs/10 B4）。注入后 `{{ $secrets.KEY }}` 引用在注入瞬间物化。 */
    private readonly secrets?: SecretsService,
    /** 连接测试的 HTTP 客户端（缺省真实 fetch；测试注入假实现，不打真网）。 */
    private readonly tester: ICredentialTester = new FetchCredentialTester(),
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

  /**
   * 用户编辑凭证（对标 n8n 凭证卡片 Open）：改名 + 覆写填写的字段。
   * data 只合并非空字段到现有解密数据再整体重加密——旧值绝不回显，编辑表单留空即保持不变。
   */
  async update(
    id: string,
    projectId: string,
    patch: { name?: string; data?: JsonObject },
  ): Promise<ICredentialView> {
    const row = await this.repos.credentials.findById(id, projectId);
    if (!row) throw new OperationalError('Credential not found', { credentialId: id, status: 404 });
    const update: { name?: string; data?: string } = {};
    if (patch.name !== undefined && patch.name !== row.name) update.name = patch.name;
    const filled = Object.fromEntries(
      Object.entries(patch.data ?? {}).filter(([, v]) => v !== '' && v !== undefined && v !== null),
    );
    if (Object.keys(filled).length > 0) {
      const current = await this.credentials.decrypt(row.data, { projectId });
      update.data = await this.credentials.encrypt({ ...current, ...filled }, { projectId });
    }
    await this.repos.credentials.update(id, update);
    const fresh = await this.repos.credentials.findById(id, projectId);
    return this.toView(fresh!);
  }

  /** OAuth 连接状态（只回布尔，绝不回 token——铁律 3）。 */
  async oauthStatus(id: string, projectId: string): Promise<{ connected: boolean }> {
    const data = await this.rawData(id, projectId);
    const token = (data['oauthTokenData'] as JsonObject | undefined)?.['access_token'];
    return { connected: Boolean(token) };
  }

  /**
   * 测试连接：解密凭证 → 按类型打对应服务的只读端点看 HTTP 状态。
   * 可测类型不存在 → tested:false（凭证已存但无连接测试）；缺字段 → tested:false。
   * 密钥只进请求发给目标服务，绝不回 API/落日志（铁律 3）。
   */
  async test(id: string, projectId: string): Promise<{ ok: boolean; tested: boolean; message?: string }> {
    const row = await this.repos.credentials.findById(id, projectId); // 归属检查
    if (!row) throw new OperationalError('Credential not found', { credentialId: id, status: 404 });
    const data = await this.credentials.decrypt(row.data, { projectId });
    const req = buildCredentialTest(row.type, this.secrets ? this.secrets.resolve(data) : data);
    if (req === undefined) {
      return { ok: true, tested: false, message: 'No connection test available for this credential type.' };
    }
    if (req === null) {
      return { ok: false, tested: false, message: 'Missing fields required to test this credential.' };
    }
    try {
      const res = await this.tester.request(req);
      return { tested: true, ...judgeTestResponse(req, res) };
    } catch (error) {
      return { ok: false, tested: true, message: `Could not reach the service: ${(error as Error).message}` };
    }
  }

  async delete(id: string, projectId: string): Promise<void> {
    const row = await this.repos.credentials.findById(id, projectId);
    if (!row) throw new OperationalError('Credential not found', { credentialId: id, status: 404 });
    await this.repos.credentials.delete(id);
  }

  private toView(row: { id: string; name: string; type: string; createdAt: Date; updatedAt: Date }): ICredentialView {
    return { id: row.id, name: row.name, type: row.type, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }
}
