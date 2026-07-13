import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { OperationalError } from '@nomops/workflow';
import type { Repositories, User } from '@nomops/db';
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

  async register(input: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }): Promise<IAuthResult> {
    const existing = await this.repos.users.findByEmail(input.email);
    if (existing) {
      throw new OperationalError('This email is already registered', { email: input.email });
    }
    const passwordHash = await argon2.hash(input.password);
    // 第一个注册用户 = 实例 owner（自托管惯例，docs/07）
    const role = (await this.repos.users.count()) === 0 ? 'owner' : 'member';
    const user = await this.repos.users.create({
      email: input.email,
      passwordHash,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      role,
    });
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
