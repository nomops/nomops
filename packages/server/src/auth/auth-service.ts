import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { OperationalError } from '@nomops/workflow';
import type { Invitation, Repositories, User } from '@nomops/db';
import type { MfaService } from '../services/mfa-service.js';

export interface IAuthTokenPayload {
  sub: string; // userId
  projectId: string; // 当前 project（安装版 = 注册时建的 personal project）
}

export interface IAuthResult {
  token: string;
  user: { id: string; email: string; firstName: string | null; lastName: string | null };
  projectId: string;
}

const TOKEN_TTL = '7d';
const RESET_TTL_MS = 60 * 60 * 1000; // 密码重置 token 有效期 1 小时

/** token 的存储哈希（存哈希不存明文，铁律 3 延伸）。 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 邀请接受链接（前端 /signup?invite= 着陆页）。无 SMTP 时由 admin 复制转交。 */
function inviteLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/signup?invite=${encodeURIComponent(token)}`;
}

/** 登录需要第二因素时的中间态（凭据已验证，等待 TOTP/备份码）。 */
export interface IMfaRequired {
  mfaRequired: true;
}

export class AuthService {
  constructor(
    private readonly repos: Repositories,
    private readonly jwtSecret: string,
    private readonly mfa: MfaService,
  ) {}

  /** 实例是否待初始化（无任何用户）→ 前端首启引导 owner setup（对标 n8n 自托管）。 */
  async needsSetup(): Promise<boolean> {
    return (await this.repos.users.count()) === 0;
  }

  /**
   * 自托管 owner 初始化：`register` 只用于创建实例的第一个用户（owner）。
   * 一旦已有用户，公开注册即关闭（对标 n8n：此后只能由 admin 邀请，见 invite/acceptInvite）。
   */
  async register(input: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }): Promise<IAuthResult> {
    if ((await this.repos.users.count()) > 0) {
      throw new OperationalError('Open sign-up is disabled. Ask an instance admin for an invitation.', {
        status: 403,
      });
    }
    const passwordHash = await argon2.hash(input.password);
    // 首个用户 = 实例 owner（上面的守卫已保证此刻无任何用户）
    const user = await this.repos.users.create({
      email: input.email,
      passwordHash,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      role: 'owner',
    });
    const projectId = await this.ensurePersonalProject(user);
    return this.issueToken(user, projectId);
  }

  /**
   * 邀请用户（对标 n8n：owner/admin 发起 → 生成邀请链接）。此刻不建 users 行，
   * 仅落一条 invitation（存 token 哈希）；接受时才建用户。返回明文 token + 链接供投递/复制。
   * 邮箱已是用户 → 409；已有未接受邀请 → 换发新 token。
   */
  async invite(input: {
    email: string;
    role?: string;
    invitedBy: string | null;
    baseUrl: string;
  }): Promise<{ invitation: Invitation; token: string; link: string }> {
    const email = input.email.trim();
    if (!email) throw new OperationalError('Email is required', { status: 400 });
    if (await this.repos.users.findByEmail(email)) {
      throw new OperationalError('A user with this email already exists', { status: 409, email });
    }
    const existing = await this.repos.invitations.findByEmail(email);
    if (existing) await this.repos.invitations.delete(existing.id); // 重新邀请：换新 token
    const role = input.role === 'admin' ? 'admin' : 'member';
    const token = randomBytes(32).toString('base64url');
    const invitation = await this.repos.invitations.create({
      email,
      tokenHash: hashToken(token),
      role,
      invitedBy: input.invitedBy,
    });
    return { invitation, token, link: inviteLink(input.baseUrl, token) };
  }

  /** 校验邀请 token（接受页预填邮箱用）。无效/已用 → null。 */
  async lookupInvite(token: string): Promise<{ email: string; role: string } | null> {
    const inv = await this.repos.invitations.findByTokenHash(hashToken(token));
    return inv ? { email: inv.email, role: inv.role } : null;
  }

  /** 接受邀请：设口令 + 姓名 → 建用户 + personal project → 消费邀请 → 直接建会话。 */
  async acceptInvite(
    token: string,
    input: { firstName?: string; lastName?: string; password: string },
  ): Promise<IAuthResult> {
    if (input.password.length < 8) {
      throw new OperationalError('Password must be at least 8 characters', { status: 400 });
    }
    const inv = await this.repos.invitations.findByTokenHash(hashToken(token));
    if (!inv) throw new OperationalError('Invitation is invalid or has already been used', { status: 400 });
    if (await this.repos.users.findByEmail(inv.email)) {
      await this.repos.invitations.delete(inv.id); // 竞态兜底：邮箱已被占用
      throw new OperationalError('A user with this email already exists', { status: 409 });
    }
    const user = await this.repos.users.create({
      email: inv.email,
      passwordHash: await argon2.hash(input.password),
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      role: inv.role,
    });
    await this.repos.invitations.delete(inv.id);
    const projectId = await this.ensurePersonalProject(user);
    return this.issueToken(user, projectId);
  }

  async login(email: string, password: string, mfaCode?: string): Promise<IAuthResult | IMfaRequired> {
    const user = await this.repos.users.findByEmail(email);
    // 统一报错文案，不暴露「邮箱是否存在」；hash 非法（SSO 预配用户）同样落到这里
    let verified = false;
    if (user) {
      verified = await argon2.verify(user.passwordHash, password).catch(() => false);
    }
    if (!user || !verified) {
      throw new OperationalError('Invalid email or password');
    }
    if (user.disabled) {
      throw new OperationalError('This account has been disabled', { status: 401 });
    }
    // 两步验证：口令通过后要求第二因素（缺码 → 中间态；错码 → 401）
    if (user.mfaEnabled) {
      if (!mfaCode) return { mfaRequired: true };
      if (!(await this.mfa.verifyCode(user, mfaCode))) {
        throw new OperationalError('Invalid two-factor code', { status: 401 });
      }
    }
    const projectId = await this.ensurePersonalProject(user);
    return this.issueToken(user, projectId);
  }

  /**
   * 发起密码重置：邮箱存在 → 生成一次性 token（存哈希 + 1h 过期），返回明文 token 供投递。
   * 邮箱不存在 → 返回 null；调用方无论如何回统一成功，避免邮箱枚举。
   */
  async requestReset(email: string, now: number): Promise<{ token: string; email: string } | null> {
    const user = await this.repos.users.findByEmail(email);
    if (!user || user.disabled) return null;
    const token = randomBytes(32).toString('base64url');
    await this.repos.passwordResets.create(hashToken(token), user.id, new Date(now + RESET_TTL_MS));
    return { token, email: user.email };
  }

  /** 用重置 token 设新口令：校验 token 哈希 + 未过期 → argon2 换 hash + 作废 token（一次性）。 */
  async resetPassword(token: string, newPassword: string, now: number): Promise<void> {
    if (newPassword.length < 8) throw new OperationalError('Password must be at least 8 characters', { status: 400 });
    const tokenHash = hashToken(token);
    const ticket = await this.repos.passwordResets.find(tokenHash);
    if (!ticket || ticket.expiresAt.getTime() < now) {
      throw new OperationalError('Reset link is invalid or has expired', { status: 400 });
    }
    await this.repos.users.setPassword(ticket.userId, await argon2.hash(newPassword));
    await this.repos.passwordResets.delete(tokenHash);
  }

  /**
   * SSO 登录/JIT 预配（docs/07）：按 email 找用户，不存在则自动建
   * （passwordHash 置随机值——密码登录不可用，仅 SSO 进入）。disabled → 403。
   */
  async loginViaSso(profile: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  }): Promise<{ result: IAuthResult; provisioned: boolean }> {
    let user = await this.repos.users.findByEmail(profile.email);
    let provisioned = false;
    if (!user) {
      user = await this.repos.users.create({
        email: profile.email,
        passwordHash: await argon2.hash(randomBytes(32).toString('hex')),
        firstName: profile.firstName ?? null,
        lastName: profile.lastName ?? null,
        role: (await this.repos.users.count()) === 0 ? 'owner' : 'member',
      });
      provisioned = true;
    }
    if (user.disabled) {
      throw new OperationalError('This account has been disabled', { status: 403 });
    }
    const projectId = await this.ensurePersonalProject(user);
    return { result: this.issueToken(user, projectId), provisioned };
  }

  /**
   * Cloud 首启预置 owner（docs/11 Phase 2）：控制平面开实例时注入 NOMOPS_OWNER_EMAIL，
   * 实例首启（无任何用户）建该 owner，绑定门户账户身份。密码置随机——实例登录经门户，
   * 与 SSO JIT 用户同理。已有用户则幂等跳过。
   */
  async ensureOwner(email: string): Promise<void> {
    if ((await this.repos.users.count()) > 0) return;
    const user = await this.repos.users.create({
      email,
      passwordHash: await argon2.hash(randomBytes(32).toString('hex')),
      firstName: null,
      lastName: null,
      role: 'owner',
    });
    await this.ensurePersonalProject(user);
  }

  /**
   * 门户免密登录（docs/11 Phase 2.5）：控制平面验明账户身份后，为该 email 直接签发实例会话。
   * 不校验密码——信任已由 handoff 令牌（共享密钥验签）建立。用户不存在/停用 → null/403。
   */
  async sessionForEmail(email: string): Promise<IAuthResult | null> {
    const user = await this.repos.users.findByEmail(email);
    if (!user) return null;
    if (user.disabled) throw new OperationalError('This account has been disabled', { status: 403 });
    const projectId = await this.ensurePersonalProject(user);
    return this.issueToken(user, projectId);
  }

  verify(token: string): IAuthTokenPayload {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as jwt.JwtPayload;
      if (typeof payload.sub !== 'string' || typeof payload['projectId'] !== 'string') {
        throw new Error('Token payload is missing fields');
      }
      return { sub: payload.sub, projectId: payload['projectId'] };
    } catch {
      throw new OperationalError('Invalid or expired token');
    }
  }

  private issueToken(user: User, projectId: string): IAuthResult {
    const token = jwt.sign({ sub: user.id, projectId }, this.jwtSecret, { expiresIn: TOKEN_TTL });
    return {
      token,
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      projectId,
    };
  }

  /** 用户的 personal project；没有则建（注册与 SSO JIT 共用）。 */
  private async ensurePersonalProject(user: User): Promise<string> {
    const projects = await this.repos.projects.findAllByUser(user.id);
    const first = projects[0];
    if (first) return first.id;
    const project = await this.repos.projects.create({
      name: 'Personal',
      type: 'personal',
    });
    await this.repos.projects.addMember(project.id, user.id, 'project:owner');
    return project.id;
  }
}
