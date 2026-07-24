import type { DynamicCredentialResolver, Repositories } from '@nomops/db';
import type { Credentials } from '@nomops/core';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

/**
 * 动态凭证（backlog #46 M1，docs/14）：把一个逻辑凭证在运行时按 **subject**（租户/终端用户）
 * 解析成不同的实际值。解析在 CredentialService.getDecryptedData 这个唯一 choke point 切入
 * （与 $secrets 相邻），引擎/core 零改动。
 * ★铁律 3：解析出的值即用即弃——不落库、不出 API、不进日志；entry.data 存密文。
 */

/** 解析器后端：给定解析器 + subject → 实际凭证值。可插拔（M1 只有 table，M2 加 http）。 */
export interface ICredentialResolver {
  resolve(resolver: DynamicCredentialResolver, subject: string | undefined, ctx: { projectId: string }): Promise<JsonObject>;
}

/** table 后端：值存 dynamic_credential_entries，按 subject 查 → 解密。 */
class TableResolver implements ICredentialResolver {
  constructor(
    private readonly repos: Repositories,
    private readonly credentials: Credentials,
  ) {}

  async resolve(resolver: DynamicCredentialResolver, subject: string | undefined, ctx: { projectId: string }): Promise<JsonObject> {
    // 缺 subject 不静默取错值（docs/14 决策 3）
    if (!subject) throw new OperationalError('Dynamic credential requires a subject to resolve', { status: 400 });
    const entry = await this.repos.dynamicCredentials.findEntry(resolver.id, subject);
    if (!entry) throw new OperationalError(`No dynamic credential value for subject "${subject}"`, { status: 404 });
    return this.credentials.decrypt(entry.data, { projectId: ctx.projectId });
  }
}

/** 解析器视图：config 可能含端点密钥（M2 http），不出 API。 */
export interface ResolverView {
  id: string;
  name: string;
  kind: string;
  createdAt: Date;
}

export class DynamicCredentialService {
  private readonly backends: Record<string, ICredentialResolver>;

  constructor(
    private readonly repos: Repositories,
    private readonly credentials: Credentials,
    /** 额外解析器后端（M2 注入 http；测试可注入假实现）。 */
    extraBackends: Record<string, ICredentialResolver> = {},
  ) {
    this.backends = { table: new TableResolver(repos, credentials), ...extraBackends };
  }

  /** 运行时解析：按 resolverId + subject 取实际值。CredentialService 在凭证 resolvable 时调用。 */
  async resolve(resolverId: string, projectId: string, subject: string | undefined): Promise<JsonObject> {
    const resolver = await this.repos.dynamicCredentials.findResolver(resolverId, projectId);
    if (!resolver) throw new OperationalError('Dynamic credential resolver not found', { status: 404 });
    const backend = this.backends[resolver.kind];
    if (!backend) throw new OperationalError(`Unsupported resolver kind: ${resolver.kind}`, { status: 400 });
    return backend.resolve(resolver, subject, { projectId });
  }

  /* ── 解析器 CRUD ── */
  private static view(r: DynamicCredentialResolver): ResolverView {
    return { id: r.id, name: r.name, kind: r.kind, createdAt: r.createdAt };
  }

  async createResolver(projectId: string, input: { name: string; kind?: string; config?: JsonObject }): Promise<ResolverView> {
    const kind = input.kind ?? 'table';
    if (!this.backends[kind]) throw new OperationalError(`Unsupported resolver kind: ${kind}`, { status: 400 });
    const r = await this.repos.dynamicCredentials.createResolver({ projectId, name: input.name.trim() || 'resolver', kind, config: input.config ?? {} });
    return DynamicCredentialService.view(r);
  }

  async listResolvers(projectId: string): Promise<ResolverView[]> {
    return (await this.repos.dynamicCredentials.listResolvers(projectId)).map(DynamicCredentialService.view);
  }

  async deleteResolver(id: string, projectId: string): Promise<void> {
    const r = await this.repos.dynamicCredentials.findResolver(id, projectId);
    if (!r) throw new OperationalError('Resolver not found', { status: 404 });
    await this.repos.dynamicCredentials.deleteResolver(id);
  }

  /* ── 按 subject 的凭证值（entry） ── */
  /** 存/覆盖某 subject 的值：加密后落库（铁律 3）。 */
  async setEntry(resolverId: string, projectId: string, subject: string, value: JsonObject): Promise<void> {
    const r = await this.repos.dynamicCredentials.findResolver(resolverId, projectId);
    if (!r) throw new OperationalError('Resolver not found', { status: 404 });
    if (!subject.trim()) throw new OperationalError('subject is required', { status: 400 });
    const encrypted = await this.credentials.encrypt(value, { projectId });
    await this.repos.dynamicCredentials.upsertEntry({ resolverId, subject: subject.trim(), data: encrypted });
  }

  /** 列 subject（不含值密文——铁律 3）。 */
  async listSubjects(resolverId: string, projectId: string): Promise<Array<{ id: string; subject: string; updatedAt: Date }>> {
    const r = await this.repos.dynamicCredentials.findResolver(resolverId, projectId);
    if (!r) throw new OperationalError('Resolver not found', { status: 404 });
    return this.repos.dynamicCredentials.listEntrySubjects(resolverId);
  }

  async deleteEntry(resolverId: string, projectId: string, subject: string): Promise<void> {
    const r = await this.repos.dynamicCredentials.findResolver(resolverId, projectId);
    if (!r) throw new OperationalError('Resolver not found', { status: 404 });
    await this.repos.dynamicCredentials.deleteEntry(resolverId, subject);
  }
}
