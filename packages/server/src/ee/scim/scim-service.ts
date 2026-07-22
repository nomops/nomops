import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Project, ProjectMember, Repositories, User } from '@nomops/db';
import { OperationalError } from '@nomops/workflow';

const TOKEN_HASH_KEY = 'scim.tokenHash';

/** SCIM Group 成员默认角色（team 项目里可读写工作流/凭证）。 */
const GROUP_MEMBER_ROLE = 'project:editor';

/** SCIM Group 资源（RFC 7643）：映射到 nomops team 项目,成员 = project_relations。 */
export interface IScimGroup {
  schemas: string[];
  id: string;
  displayName: string;
  members: Array<{ value: string; display?: string }>;
  meta: { resourceType: 'Group'; created?: string };
}

export function toScimGroup(project: Project, members: ProjectMember[]): IScimGroup {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
    id: project.id,
    displayName: project.name,
    members: members.map((m) => ({ value: m.userId, display: m.email })),
    meta: {
      resourceType: 'Group',
      created: project.createdAt instanceof Date ? project.createdAt.toISOString() : undefined,
    },
  };
}

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

  /* ── Groups 资源（→ team 项目，成员 = project_relations；docs/07 延后项落地） ── */

  private async groupWithMembers(project: Project): Promise<{ project: Project; members: ProjectMember[] }> {
    return { project, members: await this.repos.projects.findMembers(project.id) };
  }

  async listGroups(filter?: string): Promise<Array<{ project: Project; members: ProjectMember[] }>> {
    if (filter) {
      const match = /^displayName\s+eq\s+"(.+)"$/i.exec(filter.trim());
      if (!match) throw new OperationalError(`Unsupported filter: ${filter}`, { status: 400 });
      const project = await this.repos.projects.findByNameAndType(match[1]!, 'team');
      return project ? [await this.groupWithMembers(project)] : [];
    }
    const projects = await this.repos.projects.findAllByType('team');
    return Promise.all(projects.map((p) => this.groupWithMembers(p)));
  }

  async getGroup(id: string): Promise<{ project: Project; members: ProjectMember[] }> {
    const project = await this.repos.projects.findById(id);
    if (!project || project.type !== 'team') throw new OperationalError('Group not found', { status: 404 });
    return this.groupWithMembers(project);
  }

  async createGroup(input: { displayName: string; members?: string[] }): Promise<{ project: Project; members: ProjectMember[] }> {
    const name = input.displayName?.trim();
    if (!name) throw new OperationalError('displayName is required', { status: 400 });
    if (await this.repos.projects.findByNameAndType(name, 'team')) {
      throw new OperationalError('Group already exists', { status: 409 });
    }
    const project = await this.repos.projects.create({ name, type: 'team' });
    for (const userId of new Set(input.members ?? [])) {
      if (await this.repos.users.findById(userId)) {
        await this.repos.projects.addMember(project.id, userId, GROUP_MEMBER_ROLE);
      }
    }
    return this.groupWithMembers(project);
  }

  /** PUT：全量替换 displayName + 成员集（对齐 IdP 的整体推送）。 */
  async replaceGroup(id: string, input: { displayName?: string; members?: string[] }): Promise<{ project: Project; members: ProjectMember[] }> {
    const { project } = await this.getGroup(id);
    if (input.displayName && input.displayName.trim() && input.displayName.trim() !== project.name) {
      await this.repos.projects.rename(id, input.displayName.trim());
    }
    if (input.members) await this.setMembers(id, input.members);
    return this.getGroup(id);
  }

  /** 覆盖式设置成员（存在的 userId 才加；非本组成员移除）。 */
  private async setMembers(id: string, memberIds: string[]): Promise<void> {
    const target = new Set(memberIds);
    const current = await this.repos.projects.findMembers(id);
    for (const m of current) {
      if (!target.has(m.userId)) await this.repos.projects.removeMember(id, m.userId);
    }
    const existing = new Set(current.map((m) => m.userId));
    for (const userId of target) {
      if (!existing.has(userId) && (await this.repos.users.findById(userId))) {
        await this.repos.projects.addMember(id, userId, GROUP_MEMBER_ROLE);
      }
    }
  }

  /** PATCH：add/remove members、replace displayName/members（RFC 7644 §3.5.2 子集）。 */
  async patchGroup(
    id: string,
    ops: Array<{ op: string; path?: string; value?: unknown }>,
  ): Promise<{ project: Project; members: ProjectMember[] }> {
    await this.getGroup(id);
    for (const op of ops) {
      const kind = op.op.toLowerCase();
      const path = op.path?.toLowerCase();
      const memberIds = extractMemberIds(op.value);
      if (path === 'members' || (!path && Array.isArray(op.value))) {
        if (kind === 'add') for (const uid of memberIds) await this.addMemberSafe(id, uid);
        else if (kind === 'remove') for (const uid of memberIds) await this.repos.projects.removeMember(id, uid);
        else if (kind === 'replace') await this.setMembers(id, memberIds);
        else throw new OperationalError(`Unsupported group op: ${op.op}`, { status: 400 });
      } else if (kind === 'remove' && path?.startsWith('members[value eq ')) {
        const m = /members\[value eq "(.+)"\]/i.exec(op.path ?? '');
        if (m) await this.repos.projects.removeMember(id, m[1]!);
      } else if (kind === 'replace' && (path === 'displayname' || !path)) {
        const dn = typeof op.value === 'string' ? op.value : (op.value as { displayName?: string })?.displayName;
        if (dn) await this.repos.projects.rename(id, dn);
      } else {
        throw new OperationalError(`Unsupported group patch: ${op.op} ${op.path ?? ''}`, { status: 400 });
      }
    }
    return this.getGroup(id);
  }

  private async addMemberSafe(projectId: string, userId: string): Promise<void> {
    if ((await this.repos.projects.findMemberRole(projectId, userId)) !== null) return; // 已是成员
    if (await this.repos.users.findById(userId)) {
      await this.repos.projects.addMember(projectId, userId, GROUP_MEMBER_ROLE);
    }
  }

  /** DELETE：删 team 项目 + 成员关系。项目仍持有工作流/凭证（FK 阻止）→ 409。 */
  async deleteGroup(id: string): Promise<void> {
    await this.getGroup(id);
    try {
      await this.repos.projects.deleteWithRelations(id);
    } catch {
      throw new OperationalError('Group has resources; move or delete them first', { status: 409 });
    }
  }
}

/** SCIM members value 归一为 userId 数组（[{value}] 或 [id] 或 {value}）。 */
function extractMemberIds(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : typeof (v as { value?: unknown })?.value === 'string' ? String((v as { value: string }).value) : null))
      .filter((v): v is string => v !== null);
  }
  return [];
}
