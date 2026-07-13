import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Repositories, User } from '@nomops/db';
import { OperationalError } from '@nomops/workflow';

const TOKEN_HASH_KEY = 'scim.tokenHash';

/** SCIM User 资源（RFC 7643 子集）。 */
export interface IScimUser {
  schemas: string[];
  id: string;
  userName: string;
  name: { givenName?: string; familyName?: string };
  emails: Array<{ value: string; primary: boolean }>;
  active: boolean;
  meta: { resourceType: 'User'; created?: string };
}

export function toScimUser(user: User): IScimUser {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: user.id,
    userName: user.email,
    name: {
      ...(user.firstName ? { givenName: user.firstName } : {}),
      ...(user.lastName ? { familyName: user.lastName } : {}),
    },
    emails: [{ value: user.email, primary: true }],
    active: !user.disabled,
    meta: {
      resourceType: 'User',
      created: user.createdAt instanceof Date ? user.createdAt.toISOString() : undefined,
    },
  };
}

export class ScimService {
  constructor(private readonly repos: Repositories) {}

  /** 生成 SCIM Bearer token：明文只返回一次，库存 SHA-256（docs/07）。 */
  async generateToken(): Promise<string> {
    const token = `nomops_scim_${randomBytes(24).toString('hex')}`;
    await this.repos.settings.set(TOKEN_HASH_KEY, createHash('sha256').update(token).digest('hex'));
    return token;
  }

  async verifyToken(token: string): Promise<boolean> {
    const stored = await this.repos.settings.get(TOKEN_HASH_KEY);
    if (!stored) return false;
    return createHash('sha256').update(token).digest('hex') === stored;
  }

  /* ── Users 资源 ── */

  async listUsers(filter?: string): Promise<User[]> {
    // 只支持 IdP 查重所需的 userName eq "x"（RFC 7644 §3.4.2.2 子集）
    if (filter) {
      const match = /^userName\s+eq\s+"(.+)"$/i.exec(filter.trim());
      if (!match) throw new OperationalError(`Unsupported filter: ${filter}`, { status: 400 });
      const user = await this.repos.users.findByEmail(match[1]!);
      return user ? [user] : [];
    }
    return this.repos.users.findAll();
  }

  async getUser(id: string): Promise<User> {
    const user = await this.repos.users.findById(id);
    if (!user) throw new OperationalError('User not found', { status: 404 });
    return user;
  }

  async createUser(input: {
    userName: string;
    givenName?: string;
    familyName?: string;
    active?: boolean;
  }): Promise<User> {
    if (await this.repos.users.findByEmail(input.userName)) {
      throw new OperationalError('User already exists', { status: 409 });
    }
    const user = await this.repos.users.create({
      email: input.userName,
      // SCIM 预配用户走 SSO 登录，密码置随机不可用值（docs/07）
      passwordHash: await argon2.hash(randomBytes(32).toString('hex')),
      firstName: input.givenName ?? null,
      lastName: input.familyName ?? null,
    });
    if (input.active === false) {
      return this.repos.users.update(user.id, { disabled: true });
    }
    return user;
  }

  async updateUser(
    id: string,
    patch: { givenName?: string; familyName?: string; active?: boolean },
  ): Promise<User> {
    await this.getUser(id); // 404 检查
    return this.repos.users.update(id, {
      ...(patch.givenName !== undefined ? { firstName: patch.givenName } : {}),
      ...(patch.familyName !== undefined ? { lastName: patch.familyName } : {}),
      ...(patch.active !== undefined ? { disabled: !patch.active } : {}),
    });
  }

  /** DELETE = 软删（active=false），不物理删（docs/07）。 */
  async deactivateUser(id: string): Promise<void> {
    await this.getUser(id);
    await this.repos.users.update(id, { disabled: true });
  }
}
