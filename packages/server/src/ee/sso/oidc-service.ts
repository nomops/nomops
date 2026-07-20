import * as oidc from 'openid-client';
import { OperationalError } from '@nomops/workflow';
import type { Repositories } from '@nomops/db';
import type { Credentials } from '@nomops/core';
import type { AuthService, IAuthResult } from '../../auth/auth-service.js';

/** 实例级 OIDC 配置（settings['sso.oidc']，clientSecret 加密存储——docs/07）。 */
export interface ISsoConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string; // 内存态为明文；落库前必须经 Cipher
}

const SETTINGS_KEY = 'sso.oidc';
const PENDING_TTL_MS = 10 * 60 * 1000;

interface IPendingAuth {
  codeVerifier: string;
  nonce: string;
  createdAt: number;
}

export class OidcService {
  /** state → 待完成的授权（内存态；多实例部署需挪到 Redis，本切片单进程）。 */
  private readonly pending = new Map<string, IPendingAuth>();
  private discovered: oidc.Configuration | null = null;
  private discoveredIssuer: string | null = null;

  constructor(
    private readonly repos: Repositories,
    private readonly credentials: Credentials,
    private readonly auth: AuthService,
    private readonly baseUrl: string,
  ) {}

  /* ── 配置管理 ── */

  async getConfig(): Promise<ISsoConfig | null> {
    const raw = await this.repos.settings.get(SETTINGS_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as ISsoConfig;
    return {
      ...stored,
      clientSecret: stored.clientSecret
        ? String((await this.credentials.decrypt(stored.clientSecret))['secret'] ?? '')
        : '',
    };
  }

  async setConfig(config: ISsoConfig): Promise<void> {
    const encrypted = await this.credentials.encrypt({ secret: config.clientSecret });
    await this.repos.settings.set(SETTINGS_KEY, JSON.stringify({ ...config, clientSecret: encrypted }));
    this.discovered = null; // 配置变更后重新发现
  }

  /** 掩码视图（GET /api/sso/config 用，绝不回明文 secret）。 */
  async getMaskedConfig(): Promise<(Omit<ISsoConfig, 'clientSecret'> & { clientSecret: string }) | null> {
    const config = await this.getConfig();
    if (!config) return null;
    return { ...config, clientSecret: config.clientSecret ? '••••••••' : '' };
  }

  async isEnabled(): Promise<boolean> {
    return (await this.getConfig())?.enabled ?? false;
  }

  /* ── OIDC 流程 ── */

  private async discover(): Promise<oidc.Configuration> {
    const config = await this.getConfig();
    if (!config?.enabled) throw new OperationalError('SSO is not enabled', { status: 403 });
    if (this.discovered && this.discoveredIssuer === config.issuer) return this.discovered;

    const issuerUrl = new URL(config.issuer);
    this.discovered = await oidc.discovery(issuerUrl, config.clientId, config.clientSecret, undefined, {
      // 仅本地/测试 IdP 允许 http；生产 https 严格校验
      execute: issuerUrl.protocol === 'http:' ? [oidc.allowInsecureRequests] : [],
    });
    this.discoveredIssuer = config.issuer;
    return this.discovered;
  }

  /** 生成 IdP 授权跳转 URL（Authorization Code + PKCE + state + nonce）。 */
  async buildLoginUrl(): Promise<string> {
    const configuration = await this.discover();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();

    this.gcPending();
    this.pending.set(state, { codeVerifier, nonce, createdAt: Date.now() });

    const url = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: `${this.baseUrl}/sso/callback`,
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return url.href;
  }

  /** 处理 IdP 回调：换 token、验 ID token、JIT 预配、签发本系统 JWT。 */
  async handleCallback(callbackUrl: URL): Promise<{ result: IAuthResult; provisioned: boolean }> {
    const state = callbackUrl.searchParams.get('state') ?? '';
    const pendingAuth = this.pending.get(state);
    if (!pendingAuth || Date.now() - pendingAuth.createdAt > PENDING_TTL_MS) {
      throw new OperationalError('SSO session not found or expired, please sign in again', { status: 400 });
    }
    this.pending.delete(state);

    const configuration = await this.discover();
    const tokens = await oidc
      .authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: pendingAuth.codeVerifier,
        expectedState: state,
        expectedNonce: pendingAuth.nonce,
        idTokenExpected: true,
      })
      .catch((error: Error) => {
        throw new OperationalError(`SSO token exchange failed: ${error.message}`, { status: 400 });
      });

    const claims = tokens.claims();
    const email = typeof claims?.['email'] === 'string' ? claims['email'] : null;
    if (!email) {
      throw new OperationalError('The IdP did not return an email claim, cannot sign in', { status: 400 });
    }
    return this.auth.loginViaSso({
      email,
      firstName: typeof claims?.['given_name'] === 'string' ? claims['given_name'] : null,
      lastName: typeof claims?.['family_name'] === 'string' ? claims['family_name'] : null,
    });
  }

  private gcPending(): void {
    const now = Date.now();
    for (const [state, item] of this.pending) {
      if (now - item.createdAt > PENDING_TTL_MS) this.pending.delete(state);
    }
  }
}
