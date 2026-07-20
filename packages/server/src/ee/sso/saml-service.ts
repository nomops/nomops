import { SAML, ValidateInResponseTo, generateServiceProviderMetadata } from '@node-saml/node-saml';
import { OperationalError } from '@nomops/workflow';
import type { Repositories } from '@nomops/db';
import type { Credentials } from '@nomops/core';
import type { AuthService, IAuthResult } from '../../auth/auth-service.js';

/**
 * SAML 2.0 单点登录（B2）。
 *
 * ★XML 签名校验交给 @node-saml/node-saml，不自己实现。签名包装（XSW）、
 * 实体扩展、规范化差异这一类攻击面极其微妙，自己写几乎必然留洞。
 * 本文件只负责：配置存取、SP 元数据、把库的校验结果映射成本系统的登录。
 *
 * 与 OIDC 并存：两者是独立的 IdP 接入方式，实例可各自启用。
 */

/** 实例级 SAML 配置（settings['sso.saml']；SP 私钥加密存储——铁律 3）。 */
export interface ISamlConfig {
  enabled: boolean;
  /** IdP 的 EntityID（Issuer），断言的 Issuer 必须与之相等。 */
  idpEntityId: string;
  /** IdP 的 SSO 端点（HTTP-Redirect 绑定）。 */
  idpSsoUrl: string;
  /** IdP 签名证书（PEM，可多份以支持轮换）。 */
  idpCertificates: string[];
  /** 属性名映射；缺省走常见的 SAML 属性 URN。 */
  attributeMapping?: { email?: string; firstName?: string; lastName?: string };
  /** SP 私钥（PEM）——签 AuthnRequest 用；内存态明文，落库前必经 Cipher。 */
  spPrivateKey?: string;
  /** SP 证书（PEM），随元数据发布给 IdP。 */
  spCertificate?: string;
}

const SETTINGS_KEY = 'sso.saml';

/** 断言中取邮箱/姓名的缺省属性名。IdP 千奇百怪，配置可覆盖。 */
const DEFAULT_ATTRS = {
  email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  firstName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  lastName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
} as const;

/** 已发出的 AuthnRequest：用于 InResponseTo 校验（防重放/防注入未请求的断言）。 */
const REQUEST_TTL_MS = 10 * 60 * 1000;

export class SamlService {
  /**
   * requestId → 发出时刻。node-saml 需要一个 InResponseTo 缓存来拒绝
   * 「没请求过」和「已用过」的断言。
   * ★内存态：多实例部署下需挪到 Redis，否则用户可能落到没有该记录的实例上。
   * 与 OidcService 的 pending 是同一个已知边界。
   */
  private readonly issuedRequests = new Map<string, { value: string; at: number }>();

  constructor(
    private readonly repos: Repositories,
    private readonly credentials: Credentials,
    private readonly auth: AuthService,
    private readonly baseUrl: string,
  ) {}

  /* ── 配置 ── */

  private get callbackUrl(): string {
    return `${this.baseUrl}/sso/saml/callback`;
  }

  /** SP 的 EntityID：用自己的回调地址，符合常见 IdP 的期待。 */
  private get spEntityId(): string {
    return `${this.baseUrl}/sso/saml/metadata`;
  }

  async getConfig(): Promise<ISamlConfig | null> {
    const raw = await this.repos.settings.get(SETTINGS_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as ISamlConfig;
    return {
      ...stored,
      spPrivateKey: stored.spPrivateKey
        ? String((await this.credentials.decrypt(stored.spPrivateKey))['key'] ?? '')
        : undefined,
    };
  }

  async setConfig(config: ISamlConfig): Promise<void> {
    const spPrivateKey = config.spPrivateKey
      ? await this.credentials.encrypt({ key: config.spPrivateKey })
      : undefined;
    await this.repos.settings.set(SETTINGS_KEY, JSON.stringify({ ...config, spPrivateKey }));
  }

  /** 掩码视图（配置接口用，绝不回明文私钥）。 */
  async getMaskedConfig(): Promise<(Omit<ISamlConfig, 'spPrivateKey'> & { spPrivateKey: string }) | null> {
    const config = await this.getConfig();
    if (!config) return null;
    return { ...config, spPrivateKey: config.spPrivateKey ? '••••••••' : '' };
  }

  async isEnabled(): Promise<boolean> {
    return (await this.getConfig())?.enabled ?? false;
  }

  /* ── SAML 流程 ── */

  private async client(): Promise<SAML> {
    const config = await this.getConfig();
    if (!config?.enabled) throw new OperationalError('SAML SSO is not enabled', { status: 403 });
    if (config.idpCertificates.length === 0) {
      throw new OperationalError('SAML is misconfigured: no IdP signing certificate', { status: 500 });
    }

    return new SAML({
      entryPoint: config.idpSsoUrl,
      issuer: this.spEntityId,
      callbackUrl: this.callbackUrl,
      idpCert: config.idpCertificates,
      /**
       * ★断言必须签名——它承载身份与全部条件（Audience / NotOnOrAfter /
       * InResponseTo），只签外层 Response 而不签 Assertion 正是签名包装攻击的入口。
       *
       * 外层 Response 的签名**不强制**：多数 IdP（如 Okta 默认）只签断言，
       * 强制要求会让接入直接失败。安全性由断言签名保证，外层没有额外身份信息。
       */
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      // ★Audience 必须等于我们的 EntityID，否则别处签发的断言可被重放到这里
      audience: this.spEntityId,
      validateInResponseTo: ValidateInResponseTo.always,
      // 时钟偏移容忍：IdP 与本机时钟不会完全一致，但不能开太大
      acceptedClockSkewMs: 5000,
      ...(config.spPrivateKey ? { privateKey: config.spPrivateKey } : {}),
      ...(config.spCertificate ? { publicCert: config.spCertificate } : {}),
      // node-saml 需要一个 InResponseTo 缓存实现
      cacheProvider: this.cacheProvider(),
    });
  }

  /**
   * node-saml 的 InResponseTo 缓存契约。用它拒绝两类断言：
   * 我们从未请求过的（IdP 发起的注入），以及已经用过的（重放）。
   */
  private cacheProvider() {
    const store = this.issuedRequests;
    const gc = () => {
      const now = Date.now();
      for (const [id, entry] of store) if (now - entry.at > REQUEST_TTL_MS) store.delete(id);
    };
    return {
      saveAsync: async (key: string, value: string) => {
        gc();
        const at = Date.now();
        store.set(key, { value, at });
        return { createdAt: at, value };
      },
      /**
       * ★必须返回**存进去的值**（node-saml 用 `new Date(result)` 判它是否过期）。
       * 返回 key 会让它拿到 Invalid Date，于是每一次校验都判为「未请求过」——
       * 表现是所有断言（包括合法的）被拒，看起来像很安全，实则整条路径不通。
       */
      getAsync: async (key: string) => {
        gc();
        return store.get(key)?.value ?? null;
      },
      removeAsync: async (key: string) => {
        // 取用即失效——同一个断言不能用第二次
        return store.delete(key) ? key : null;
      },
    };
  }

  /** SP 元数据 XML，交给 IdP 导入。 */
  async metadata(): Promise<string> {
    const config = await this.getConfig();
    return generateServiceProviderMetadata({
      issuer: this.spEntityId,
      callbackUrl: this.callbackUrl,
      ...(config?.spCertificate ? { publicCert: config.spCertificate } : {}),
      wantAssertionsSigned: true,
    });
  }

  /** SP 发起：生成跳转到 IdP 的 URL。 */
  async buildLoginUrl(relayState = ''): Promise<string> {
    const saml = await this.client();
    return saml.getAuthorizeUrlAsync(relayState, undefined, {});
  }

  /**
   * 处理 IdP 回调（HTTP-POST 绑定的 SAMLResponse）。
   *
   * 全部校验由 node-saml 完成：XML 签名、Issuer、Audience、
   * NotBefore/NotOnOrAfter、InResponseTo。任何一项不过都抛。
   */
  async handleCallback(body: Record<string, unknown>): Promise<{
    result: IAuthResult;
    provisioned: boolean;
  }> {
    const saml = await this.client();
    const config = await this.getConfig();

    let profile;
    try {
      const validated = await saml.validatePostResponseAsync(
        body as unknown as Parameters<SAML['validatePostResponseAsync']>[0],
      );
      profile = validated.profile;
    } catch (error) {
      // 不把库的内部细节透给调用方，但保留原因供排错
      throw new OperationalError(`SAML assertion rejected: ${(error as Error).message}`, {
        status: 400,
      });
    }
    if (!profile) {
      throw new OperationalError('SAML assertion contained no profile', { status: 400 });
    }

    const attrs = { ...DEFAULT_ATTRS, ...(config?.attributeMapping ?? {}) };
    const pick = (key: string): string | null => {
      const value = (profile as unknown as Record<string, unknown>)[key];
      if (typeof value === 'string' && value !== '') return value;
      const fromAttributes = (profile.attributes as Record<string, unknown> | undefined)?.[key];
      if (typeof fromAttributes === 'string' && fromAttributes !== '') return fromAttributes;
      if (Array.isArray(fromAttributes) && typeof fromAttributes[0] === 'string') {
        return fromAttributes[0];
      }
      return null;
    };

    // 邮箱优先取映射的属性，退回 nameID（多数 IdP 把邮箱放在这里）
    const email =
      pick(attrs.email) ??
      (typeof profile.nameID === 'string' && profile.nameID.includes('@') ? profile.nameID : null);
    if (!email) {
      throw new OperationalError(
        'The IdP did not return an email attribute, cannot sign in',
        { status: 400 },
      );
    }

    return this.auth.loginViaSso({
      email,
      firstName: pick(attrs.firstName),
      lastName: pick(attrs.lastName),
    });
  }
}
