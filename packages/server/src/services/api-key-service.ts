import { createHash, randomBytes } from 'node:crypto';
import type { ApiKey, Repositories } from '@nomops/db';

/**
 * 公共 REST API 令牌。
 * 令牌明文只在创建时返回一次，库里只存 sha256 哈希（铁律 3：口令类不可逆落库）。
 * 归属为**用户级**：令牌代表创建它的用户身份调 /api/*。
 */

const TOKEN_PREFIX = 'nmp_';

export type ApiKeyScope = 'all' | 'readonly';

export interface ApiKeyPublic {
  id: string;
  label: string;
  prefix: string;
  scope: ApiKeyScope;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

function toPublic(k: ApiKey): ApiKeyPublic {
  return {
    id: k.id,
    label: k.label,
    prefix: k.prefix,
    scope: (k.scope as ApiKeyScope) ?? 'all',
    expiresAt: k.expiresAt ?? null,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
  };
}

/** token → 存储哈希（sha256，令牌熵足够，无需加盐）。 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class ApiKeyService {
  constructor(private readonly repos: Repositories) {}

  /** 创建：生成明文令牌（仅此一次返回）+ 存哈希。prefix 供列表识别；可选过期天数与作用域。 */
  async create(
    userId: string,
    label: string,
    opts: { expiresInDays?: number | null; scope?: ApiKeyScope } = {},
  ): Promise<{ token: string; apiKey: ApiKeyPublic }> {
    const token = TOKEN_PREFIX + randomBytes(24).toString('base64url');
    const prefix = token.slice(0, 12); // nmp_ + 前 8 字符
    const expiresAt =
      opts.expiresInDays != null ? new Date(Date.now() + opts.expiresInDays * 24 * 60 * 60 * 1000) : null;
    const row = await this.repos.apiKeys.create({
      userId,
      label,
      tokenHash: hashToken(token),
      prefix,
      expiresAt,
      scope: opts.scope ?? 'all',
    });
    return { token, apiKey: toPublic(row) };
  }

  async list(userId: string): Promise<ApiKeyPublic[]> {
    return (await this.repos.apiKeys.findAllByUser(userId)).map(toPublic);
  }

  /** 吊销：带用户归属校验，成功删除返回 true。 */
  async revoke(id: string, userId: string): Promise<boolean> {
    return this.repos.apiKeys.deleteOwned(id, userId);
  }

  /** 鉴权：明文令牌 → { userId, scope }；过期视同无效；记录 lastUsed（fire-and-forget）。 */
  async authenticate(token: string): Promise<{ userId: string; keyId: string; scope: ApiKeyScope } | null> {
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    const row = await this.repos.apiKeys.findByTokenHash(hashToken(token));
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null; // 过期 → 401
    void this.repos.apiKeys.touchLastUsed(row.id).catch(() => undefined);
    return { userId: row.userId, keyId: row.id, scope: (row.scope as ApiKeyScope) ?? 'all' };
  }
}
