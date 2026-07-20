import { OperationalError } from '@nomops/workflow';
import type { Repositories } from '@nomops/db';
import type { Credentials } from '@nomops/core';
import type { AuthService, IAuthResult } from '../../auth/auth-service.js';
import type { LicenseService } from '../license/license-service.js';

/**
 * LDAP 登录（docs/10 B5，企业功能 `ldap`）。
 *
 * 流程：服务账号 bind → 按 loginAttribute 搜索用户拿到 userDn 与 email →
 * 用 userDn + 用户密码再 bind 一次（校验密码）→ 按 email 做 JIT 预配（复用 SSO 的
 * `auth.loginViaSso`）→ 签发本系统 JWT。
 *
 * ★铁律 3 延伸：服务账号 bindPassword 落库前经 Cipher 加密；getMaskedConfig 绝不回明文。
 *   用户密码只在 bind 校验瞬间使用，不落库/不出 API/不进日志。
 *
 * authenticator 可注入：默认 ldapts 真实实现；测试注入假实现做协议无关的逻辑验证。
 */

export interface ILdapConfig {
  enabled: boolean;
  url: string; // ldap://host:389 或 ldaps://host:636
  bindDn: string; // 服务账号 DN
  bindPassword: string; // 内存态明文；落库前必须经 Cipher
  userSearchBase: string; // ou=people,dc=example,dc=com
  loginAttribute: string; // uid / sAMAccountName
  emailAttribute: string; // mail
  firstNameAttribute: string; // givenName
  lastNameAttribute: string; // sn
}

/** LDAP 校验结果：验证通过返回用户档案；失败返回 null。 */
export interface ILdapProfile {
  email: string;
  firstName: string | null;
  lastName: string | null;
}

/** 认证器抽象：把 ldapts 的网络细节隔离出去，便于单测注入。 */
export interface ILdapAuthenticator {
  authenticate(config: ILdapConfig, login: string, password: string): Promise<ILdapProfile | null>;
}

const SETTINGS_KEY = 'ldap.config';

/** 真实实现：ldapts。lazy import，避免非 LDAP 部署也加载。 */
export class LdaptsAuthenticator implements ILdapAuthenticator {
  async authenticate(config: ILdapConfig, login: string, password: string): Promise<ILdapProfile | null> {
    const { Client } = await import('ldapts');
    const client = new Client({ url: config.url });
    try {
      await client.bind(config.bindDn, config.bindPassword);
      const filter = `(${config.loginAttribute}=${escapeFilter(login)})`;
      const { searchEntries } = await client.search(config.userSearchBase, {
        scope: 'sub',
        filter,
        attributes: [config.emailAttribute, config.firstNameAttribute, config.lastNameAttribute],
      });
      const entry = searchEntries[0];
      if (!entry) return null;

      // 用户 DN + 密码再 bind 一次校验密码
      const userClient = new Client({ url: config.url });
      try {
        await userClient.bind(String(entry.dn), password);
      } catch {
        return null; // 密码错误
      } finally {
        await userClient.unbind().catch(() => undefined);
      }

      const attr = (name: string): string | null => {
        const v = entry[name];
        if (Array.isArray(v)) return v[0] != null ? String(v[0]) : null;
        return v != null ? String(v) : null;
      };
      const email = attr(config.emailAttribute);
      if (!email) return null;
      return { email, firstName: attr(config.firstNameAttribute), lastName: attr(config.lastNameAttribute) };
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}

/** RFC 4515 过滤器特殊字符转义（防 LDAP 注入）。 */
function escapeFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

export class LdapService {
  constructor(
    private readonly repos: Repositories,
    private readonly credentials: Credentials,
    private readonly auth: AuthService,
    private readonly license: LicenseService,
    private readonly authenticator: ILdapAuthenticator = new LdaptsAuthenticator(),
  ) {}

  private featureEnabled(): boolean {
    return this.license.isFeatureEnabled('ldap');
  }

  async getConfig(): Promise<ILdapConfig | null> {
    const raw = await this.repos.settings.get(SETTINGS_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as ILdapConfig;
    return {
      ...stored,
      bindPassword: stored.bindPassword
        ? String((await this.credentials.decrypt(stored.bindPassword))['secret'] ?? '')
        : '',
    };
  }

  /** 掩码视图（GET /api/ldap/config 用，绝不回明文 bindPassword）。 */
  async getMaskedConfig(): Promise<(Omit<ILdapConfig, 'bindPassword'> & { bindPassword: string }) | null> {
    const config = await this.getConfig();
    if (!config) return null;
    return { ...config, bindPassword: config.bindPassword ? '••••••••' : '' };
  }

  /** 保存配置。bindPassword 留空表示不修改（保留原密文）。 */
  async setConfig(input: Partial<ILdapConfig> & { enabled: boolean }): Promise<void> {
    const current = await this.getConfig();
    const merged: ILdapConfig = {
      enabled: input.enabled,
      url: input.url ?? current?.url ?? '',
      bindDn: input.bindDn ?? current?.bindDn ?? '',
      bindPassword: input.bindPassword && input.bindPassword.length > 0 ? input.bindPassword : current?.bindPassword ?? '',
      userSearchBase: input.userSearchBase ?? current?.userSearchBase ?? '',
      loginAttribute: input.loginAttribute ?? current?.loginAttribute ?? 'uid',
      emailAttribute: input.emailAttribute ?? current?.emailAttribute ?? 'mail',
      firstNameAttribute: input.firstNameAttribute ?? current?.firstNameAttribute ?? 'givenName',
      lastNameAttribute: input.lastNameAttribute ?? current?.lastNameAttribute ?? 'sn',
    };
    const encrypted = await this.credentials.encrypt({ secret: merged.bindPassword });
    await this.repos.settings.set(SETTINGS_KEY, JSON.stringify({ ...merged, bindPassword: encrypted }));
  }

  async isEnabled(): Promise<boolean> {
    if (!this.featureEnabled()) return false;
    return (await this.getConfig())?.enabled ?? false;
  }

  /** LDAP 登录：校验凭据 → JIT 预配 → 签发 JWT。 */
  async login(loginName: string, password: string): Promise<{ result: IAuthResult; provisioned: boolean }> {
    if (!this.featureEnabled()) {
      throw new OperationalError('LDAP login requires an Enterprise license', { feature: 'ldap', status: 403 });
    }
    const config = await this.getConfig();
    if (!config?.enabled) {
      throw new OperationalError('LDAP login is not enabled', { status: 403 });
    }
    if (!loginName || !password) {
      throw new OperationalError('Username and password are required', { status: 400 });
    }
    const profile = await this.authenticator.authenticate(config, loginName, password).catch((error: Error) => {
      throw new OperationalError(`LDAP connection failed: ${error.message}`, { status: 502 });
    });
    if (!profile) {
      throw new OperationalError('Invalid username or password', { status: 401 });
    }
    return this.auth.loginViaSso({
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
    });
  }
}
