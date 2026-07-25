import type { AuditLog, DynamicCredentialResolver, Repositories } from '@nomops/db';
import type { Credentials } from '@nomops/core';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

/** 审计 resourceType（#46 M3）：所有动态凭证变更以此 + resolverId 归档,管理台按此过滤。 */
export const AUDIT_RESOURCE = 'dynamic-credential';

/**
 * 动态凭证（backlog #46 M1，docs/14）：把一个逻辑凭证在运行时按 **subject**（租户/终端用户）
 * 解析成不同的实际值。解析在 CredentialService.getDecryptedData 这个唯一 choke point 切入
 * （与 $secrets 相邻），引擎/core 零改动。
 * ★铁律 3：解析出的值即用即弃——不落库、不出 API、不进日志；entry.data 存密文。
 */

/** 解析上下文：projectId 决定密钥/归属；userId 供 user_entry 回退（#46 M2）。 */
export interface ResolveContext {
  projectId: string;
  userId?: string;
}

/** 解析器后端：给定解析器 + subject → 实际凭证值。可插拔（table / http）。 */
export interface ICredentialResolver {
  resolve(resolver: DynamicCredentialResolver, subject: string | undefined, ctx: ResolveContext): Promise<JsonObject>;
}

/**
 * table 后端：先按 subject 查 dynamic_credential_entries；无 subject 值时回退按 userId 查
 * user_entries（#46 M2）→ 解密。都没有则 fail-fast（不静默取错值,docs/14 决策 3）。
 */
class TableResolver implements ICredentialResolver {
  constructor(
    private readonly repos: Repositories,
    private readonly credentials: Credentials,
  ) {}

  async resolve(resolver: DynamicCredentialResolver, subject: string | undefined, ctx: ResolveContext): Promise<JsonObject> {
    if (subject) {
      const entry = await this.repos.dynamicCredentials.findEntry(resolver.id, subject);
      if (entry) return this.credentials.decrypt(entry.data, { projectId: ctx.projectId });
    }
    // 回退：按平台 userId 取 user_entry（#46 M2）
    if (ctx.userId) {
      const ue = await this.repos.dynamicCredentials.findUserEntry(resolver.id, ctx.userId);
      if (ue) return this.credentials.decrypt(ue.data, { projectId: ctx.projectId });
    }
    if (!subject && !ctx.userId) throw new OperationalError('Dynamic credential requires a subject or user to resolve', { status: 400 });
    throw new OperationalError(`No dynamic credential value for subject "${subject ?? '(user)'}"`, { status: 404 });
  }
}

/**
 * http 后端（#46 M2，embed/白标）：运行时 POST subject 到宿主端点 → 返回实际凭证值。
 * config.url 必填;config.token → Bearer。fetch 可注入（测试不打网络）。★铁律 3：值不落库/日志。
 */
class HttpResolver implements ICredentialResolver {
  constructor(private readonly fetchImpl: typeof fetch) {}

  async resolve(resolver: DynamicCredentialResolver, subject: string | undefined, ctx: ResolveContext): Promise<JsonObject> {
    const cfg = resolver.config as JsonObject;
    const url = String(cfg['url'] ?? '');
    if (!/^https?:\/\//.test(url)) throw new OperationalError('http resolver missing a valid url', { status: 400 });
    if (!subject) throw new OperationalError('Dynamic credential requires a subject to resolve', { status: 400 });
    const token = String(cfg['token'] ?? '');
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ subject, projectId: ctx.projectId }),
    });
    if (!res.ok) throw new OperationalError(`Credential resolver endpoint → HTTP ${res.status}`, { status: 502 });
    const value = (await res.json()) as JsonObject;
    if (!value || typeof value !== 'object') throw new OperationalError('Resolver endpoint returned no credential value', { status: 502 });
    return value;
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
    /** #46 M2：http 后端的 fetch（缺省真实 fetch；测试注入假实现）+ 额外后端覆盖。 */
    opts: { fetchImpl?: typeof fetch; extraBackends?: Record<string, ICredentialResolver> } = {},
  ) {
    this.backends = {
      table: new TableResolver(repos, credentials),
      http: new HttpResolver(opts.fetchImpl ?? fetch),
      ...(opts.extraBackends ?? {}),
    };
  }

  /** 运行时解析：按 resolverId + subject(+userId 回退) 取实际值。凭证 resolvable 时 CredentialService 调用。 */
  async resolve(resolverId: string, projectId: string, subject: string | undefined, userId?: string): Promise<JsonObject> {
    const resolver = await this.repos.dynamicCredentials.findResolver(resolverId, projectId);
    if (!resolver) throw new OperationalError('Dynamic credential resolver not found', { status: 404 });
    const backend = this.backends[resolver.kind];
    if (!backend) throw new OperationalError(`Unsupported resolver kind: ${resolver.kind}`, { status: 400 });
    return backend.resolve(resolver, subject, { projectId, userId });
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

  /* ── 按平台 user 的凭证值（user_entry，#46 M2） ── */
  async setUserEntry(resolverId: string, projectId: string, userId: string, value: JsonObject): Promise<void> {
    const r = await this.repos.dynamicCredentials.findResolver(resolverId, projectId);
    if (!r) throw new OperationalError('Resolver not found', { status: 404 });
    if (!userId.trim()) throw new OperationalError('userId is required', { status: 400 });
    const encrypted = await this.credentials.encrypt(value, { projectId });
    await this.repos.dynamicCredentials.upsertUserEntry({ resolverId, userId: userId.trim(), data: encrypted });
  }

  /** 列 userId（不含值密文——铁律 3）。 */
  async listUserEntries(resolverId: string, projectId: string): Promise<Array<{ id: string; userId: string; updatedAt: Date }>> {
    const r = await this.repos.dynamicCredentials.findResolver(resolverId, projectId);
    if (!r) throw new OperationalError('Resolver not found', { status: 404 });
    return this.repos.dynamicCredentials.listUserEntryUsers(resolverId);
  }

  async deleteUserEntry(resolverId: string, projectId: string, userId: string): Promise<void> {
    const r = await this.repos.dynamicCredentials.findResolver(resolverId, projectId);
    if (!r) throw new OperationalError('Resolver not found', { status: 404 });
    await this.repos.dynamicCredentials.deleteUserEntry(resolverId, userId);
  }

  /* ── 管理台完善（#46 M3）：批量导入 + 审计读 ── */
  /** 批量导入 subject 值：{ subject: {字段…} }。每条加密 upsert。返回导入条数。 */
  async importEntries(resolverId: string, projectId: string, entries: Record<string, JsonObject>): Promise<{ imported: number; subjects: string[] }> {
    const r = await this.repos.dynamicCredentials.findResolver(resolverId, projectId);
    if (!r) throw new OperationalError('Resolver not found', { status: 404 });
    const subjects = Object.keys(entries).map((s) => s.trim()).filter(Boolean);
    if (!subjects.length) throw new OperationalError('No entries to import', { status: 400 });
    for (const subject of subjects) {
      const value = entries[subject];
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new OperationalError(`Value for subject "${subject}" must be an object`, { status: 400 });
      }
      const encrypted = await this.credentials.encrypt(value, { projectId });
      await this.repos.dynamicCredentials.upsertEntry({ resolverId, subject, data: encrypted });
    }
    return { imported: subjects.length, subjects };
  }

  /** 某解析器的审计流（谁/何时改了哪个 subject——绝无值，铁律 3）。 */
  async listAudit(resolverId: string, projectId: string): Promise<AuditLog[]> {
    const r = await this.repos.dynamicCredentials.findResolver(resolverId, projectId);
    if (!r) throw new OperationalError('Resolver not found', { status: 404 });
    return this.repos.auditLogs.findByResource(projectId, AUDIT_RESOURCE, resolverId);
  }
}
