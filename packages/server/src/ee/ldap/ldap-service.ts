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
  /** 登录页 LDAP 表单标签（对标基线 LDAP Login）。 */
  loginLabel: string;
  /** ldaps/StartTLS 下跳过证书校验（自签内网 IdP）。 */
  allowUnauthorizedCerts: boolean;
  /** 追加的用户过滤器（RFC 4515,如 (objectClass=person)）;登录搜索与同步共用。 */
  userFilter: string;
  /** 目录侧用户唯一 ID 属性（同步对账用）。 */
  ldapIdAttribute: string;
  /** 同步搜索分页大小（0 = 不限）。 */
  pageSize: number;
  /** 同步搜索超时（秒,0 = 不限）。 */
  searchTimeout: number;
  /** 邮箱唯一性强制（同步遇到与本地重复邮箱的目录用户时跳过更新,只做对账展示）。 */
  enforceEmailUniqueness: boolean;
}

/** LDAP 校验结果：验证通过返回用户档案；失败返回 null。 */
export interface ILdapProfile {
  email: string;
  firstName: string | null;
  lastName: string | null;
}

/** 目录用户条目（同步用）。 */
export interface ILdapDirectoryUser extends ILdapProfile {
  ldapId: string | null;
}

/** 认证器抽象：把 ldapts 的网络细节隔离出去，便于单测注入。 */
export interface ILdapAuthenticator {
  authenticate(config: ILdapConfig, login: string, password: string): Promise<ILdapProfile | null>;
  /** 服务账号 bind 连通性测试（Test connection 按钮用）。可选：假实现可不提供。 */
  testBind?(config: ILdapConfig): Promise<void>;
  /** 列目录用户（同步用;userFilter/pageSize/searchTimeout 生效）。可选。 */
  listUsers?(config: ILdapConfig): Promise<ILdapDirectoryUser[]>;
}

const SETTINGS_KEY = 'ldap.config';

/** 真实实现：ldapts。lazy import，避免非 LDAP 部署也加载。 */
export class LdaptsAuthenticator implements ILdapAuthenticator {
  /** Client 选项：allowUnauthorizedCerts → 跳过 TLS 证书校验（自签内网 IdP）。 */
  private clientOptions(config: ILdapConfig): { url: string; tlsOptions?: { rejectUnauthorized: boolean } } {
    return {
      url: config.url,
      ...(config.allowUnauthorizedCerts ? { tlsOptions: { rejectUnauthorized: false } } : {}),
    };
  }

  /** 登录搜索过滤器：追加 userFilter（AND 合并）。 */
  private loginFilter(config: ILdapConfig, login: string): string {
    const base = `(${config.loginAttribute}=${escapeFilter(login)})`;
    const extra = config.userFilter?.trim();
    return extra ? `(&${extra}${base})` : base;
  }

  async authenticate(config: ILdapConfig, login: string, password: string): Promise<ILdapProfile | null> {
    const { Client } = await import('ldapts');
    const client = new Client(this.clientOptions(config));
    try {
      await client.bind(config.bindDn, config.bindPassword);
      const { searchEntries } = await client.search(config.userSearchBase, {
        scope: 'sub',
        filter: this.loginFilter(config, login),
        attributes: [config.emailAttribute, config.firstNameAttribute, config.lastNameAttribute],
      });
      const entry = searchEntries[0];
      if (!entry) return null;

      // 用户 DN + 密码再 bind 一次校验密码
      const userClient = new Client(this.clientOptions(config));
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

  /** 只做服务账号 bind——不搜索不改动，验证地址/DN/密码三件事是否对。 */
  async testBind(config: ILdapConfig): Promise<void> {
    const { Client } = await import('ldapts');
    const client = new Client(this.clientOptions(config));
    try {
      await client.bind(config.bindDn, config.bindPassword);
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  /** 列目录用户（同步）：userFilter 为过滤器（缺省全量）,pageSize/searchTimeout 生效。 */
  async listUsers(config: ILdapConfig): Promise<ILdapDirectoryUser[]> {
    const { Client } = await import('ldapts');
    const client = new Client(this.clientOptions(config));
    try {
      await client.bind(config.bindDn, config.bindPassword);
      const { searchEntries } = await client.search(config.userSearchBase, {
        scope: 'sub',
        filter: config.userFilter?.trim() || `(${config.emailAttribute}=*)`,
        attributes: [config.ldapIdAttribute, config.emailAttribute, config.firstNameAttribute, config.lastNameAttribute],
        ...(config.pageSize > 0 ? { sizeLimit: config.pageSize } : {}),
        ...(config.searchTimeout > 0 ? { timeLimit: config.searchTimeout } : {}),
      });
      const attr = (entry: (typeof searchEntries)[number], name: string): string | null => {
        const v = entry[name];
        if (Array.isArray(v)) return v[0] != null ? String(v[0]) : null;
        return v != null ? String(v) : null;
      };
      return searchEntries
        .map((entry) => ({
          ldapId: attr(entry, config.ldapIdAttribute),
          email: attr(entry, config.emailAttribute) ?? '',
          firstName: attr(entry, config.firstNameAttribute),
          lastName: attr(entry, config.lastNameAttribute),
        }))
        .filter((u) => u.email.length > 0);
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
      loginLabel: input.loginLabel ?? current?.loginLabel ?? 'LDAP Login',
      allowUnauthorizedCerts: input.allowUnauthorizedCerts ?? current?.allowUnauthorizedCerts ?? false,
      userFilter: input.userFilter ?? current?.userFilter ?? '',
      ldapIdAttribute: input.ldapIdAttribute ?? current?.ldapIdAttribute ?? 'uid',
      pageSize: input.pageSize ?? current?.pageSize ?? 0,
      searchTimeout: input.searchTimeout ?? current?.searchTimeout ?? 60,
      enforceEmailUniqueness: input.enforceEmailUniqueness ?? current?.enforceEmailUniqueness ?? true,
    };
    const encrypted = await this.credentials.encrypt({ secret: merged.bindPassword });
    await this.repos.settings.set(SETTINGS_KEY, JSON.stringify({ ...merged, bindPassword: encrypted }));
  }

  async isEnabled(): Promise<boolean> {
    if (!this.featureEnabled()) return false;
    return (await this.getConfig())?.enabled ?? false;
  }

  /**
   * 连通性测试（Test connection 按钮）：用**已保存**的配置做一次服务账号 bind。
   * 与基线同语义——测的是存量配置，所以 UI 在有未保存改动时禁用该按钮。
   */
  async testConnection(): Promise<void> {
    const config = await this.getConfig();
    if (!config?.url) throw new OperationalError('LDAP is not configured', { status: 400 });
    if (!this.authenticator.testBind) {
      throw new OperationalError('LDAP connection test is not supported by this authenticator', { status: 501 });
    }
    try {
      await this.authenticator.testBind(config);
    } catch (error) {
      throw new OperationalError(`LDAP connection failed: ${(error as Error).message}`, { status: 400 });
    }
  }

  /**
   * 同步预览（Test synchronization）：列目录用户,与本地按 email 对账,**不写库**。
   * create = 本地不存在;update = 姓名有差异;unchanged = 一致。
   */
  async previewSync(): Promise<
    Array<{ ldapId: string | null; email: string; firstName: string | null; lastName: string | null; action: 'create' | 'update' | 'unchanged' }>
  > {
    const config = await this.getConfig();
    if (!config?.url) throw new OperationalError('LDAP is not configured', { status: 400 });
    if (!this.authenticator.listUsers) {
      throw new OperationalError('LDAP synchronization is not supported by this authenticator', { status: 501 });
    }
    const remote = await this.authenticator.listUsers(config).catch((error: Error) => {
      throw new OperationalError(`LDAP search failed: ${error.message}`, { status: 502 });
    });
    const rows: Array<{ ldapId: string | null; email: string; firstName: string | null; lastName: string | null; action: 'create' | 'update' | 'unchanged' }> = [];
    for (const u of remote) {
      const local = await this.repos.users.findByEmail(u.email);
      const action = !local
        ? 'create'
        : (local.firstName ?? null) !== (u.firstName ?? null) || (local.lastName ?? null) !== (u.lastName ?? null)
          ? 'update'
          : 'unchanged';
      rows.push({ ...u, action });
    }
    return rows;
  }

  /** 执行同步：create → JIT 预配（随机口令+个人项目）;update → 覆写姓名。 */
  async runSync(): Promise<{ created: number; updated: number; unchanged: number }> {
    const rows = await this.previewSync();
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const row of rows) {
      if (row.action === 'create') {
        await this.auth.provisionSsoUser({ email: row.email, firstName: row.firstName, lastName: row.lastName });
        created++;
      } else if (row.action === 'update') {
        const local = await this.repos.users.findByEmail(row.email);
        if (local) await this.repos.users.update(local.id, { firstName: row.firstName, lastName: row.lastName });
        updated++;
      } else {
        unchanged++;
      }
    }
    return { created, updated, unchanged };
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
