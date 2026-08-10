import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Repositories } from '@nomops/db';
import { OperationalError } from '@nomops/workflow';
import type { JsonObject } from '@nomops/workflow';
import type { CredentialService } from './credential-service.js';

/**
 * 凭证级 OAuth2（Authorization Code）流程（「Connect my account」）。
 * 用户在凭证里填 authUrl / accessTokenUrl / clientId / clientSecret / scope，
 * 点 Connect → 跳提供方授权 → 回调换 token → 加密存回凭证 data.oauthTokenData。
 * token 只经内部链路，绝不出 API/进日志（铁律 3）。state 内存态（单进程切片）。
 */
const PENDING_TTL_MS = 10 * 60 * 1000;
const REFRESH_LEASE_MS = 15_000;

export interface IOAuthTokenData {
  access_token: unknown;
  token_type: unknown;
  refresh_token: unknown;
  scope: unknown;
  expires_at: number | null;
}

export class OAuth2Service {
  private readonly refreshes = new Map<string, Promise<void>>();
  private readonly instanceId = randomUUID();

  constructor(
    private readonly credentials: CredentialService,
    private readonly baseUrl: string,
    private readonly repos: Repositories,
  ) {}

  private redirectUri(): string {
    return `${this.baseUrl}/oauth2/callback`;
  }

  /** demo 提供方的 URL 由后端自身 baseUrl 提供；否则用凭证里用户填的 URL。 */
  private authorizeUrlFor(data: JsonObject): string {
    return data['provider'] === 'demo' ? `${this.baseUrl}/oauth2/demo/authorize` : String(data['authUrl'] ?? '');
  }
  private tokenUrlFor(data: JsonObject): string {
    return data['provider'] === 'demo' ? `${this.baseUrl}/oauth2/demo/token` : String(data['accessTokenUrl'] ?? '');
  }

  /** token endpoint 的 client 认证；旧凭证无字段时保持 body，显式 header 才走 HTTP Basic。 */
  private applyClientAuthentication(
    data: JsonObject,
    body: URLSearchParams,
  ): Record<string, string> {
    const clientId = String(data['clientId'] ?? '');
    const clientSecret = String(data['clientSecret'] ?? '');
    if (data['authentication'] === 'header') {
      return {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      };
    }
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    return { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  }

  /** 生成提供方授权跳转 URL（state 关联到待连接的 credential）。 */
  async buildAuthUrl(credentialId: string, projectId: string): Promise<string> {
    const data = await this.credentials.rawData(credentialId, projectId);
    const authUrl = this.authorizeUrlFor(data);
    const clientId = String(data['clientId'] ?? '');
    const scope = String(data['scope'] ?? '');
    if (!authUrl || !clientId) {
      throw new OperationalError('OAuth2 credential is missing an Authorization URL or Client ID', { status: 400 });
    }

    const state = randomBytes(16).toString('hex');
    await this.repos.oauthRuntime.createPendingState(
      this.stateHash(state), credentialId, projectId, new Date(Date.now() + PENDING_TTL_MS),
    );

    const url = new URL(authUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', this.redirectUri());
    if (scope) url.searchParams.set('scope', scope);
    url.searchParams.set('state', state);
    return url.href;
  }

  /** 处理提供方回调：用 code 换 token，加密存回凭证。 */
  async handleCallback(callbackUrl: URL): Promise<void> {
    const state = callbackUrl.searchParams.get('state') ?? '';
    const code = callbackUrl.searchParams.get('code') ?? '';
    const pending = state
      ? await this.repos.oauthRuntime.consumePendingState(this.stateHash(state))
      : null;
    if (!pending) {
      throw new OperationalError('OAuth2 session not found or expired, please try connecting again', { status: 400 });
    }
    if (!code) {
      const err = callbackUrl.searchParams.get('error') ?? 'no authorization code';
      throw new OperationalError(`OAuth2 authorization failed: ${err}`, { status: 400 });
    }

    const data = await this.credentials.rawData(pending.credentialId, pending.projectId);
    const tokenUrl = this.tokenUrlFor(data);
    if (!tokenUrl) throw new OperationalError('OAuth2 credential is missing an Access Token URL', { status: 400 });

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri(),
    });
    const headers = this.applyClientAuthentication(data, body);

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body,
    }).catch((error: Error) => {
      throw new OperationalError(`OAuth2 token exchange request failed: ${error.message}`, { status: 400 });
    });
    if (!res.ok) {
      throw new OperationalError(`OAuth2 token exchange failed: HTTP ${res.status}`, { status: 400 });
    }
    const tokens = (await res.json().catch(() => ({}))) as JsonObject;
    if (!tokens['access_token']) {
      throw new OperationalError('OAuth2 token exchange returned no access_token', { status: 400 });
    }

    const oauthTokenData: IOAuthTokenData = {
      access_token: tokens['access_token'],
      token_type: tokens['token_type'] ?? 'Bearer',
      refresh_token: tokens['refresh_token'] ?? null,
      scope: tokens['scope'] ?? data['scope'] ?? null,
      expires_at:
        typeof tokens['expires_in'] === 'number' ? Date.now() + (tokens['expires_in'] as number) * 1000 : null,
    };
    await this.credentials.updateData(pending.credentialId, pending.projectId, {
      oauthTokenData: oauthTokenData as unknown as JsonObject,
    });
  }

  /**
   * 临期自动续期（backlog #16）：token 已过期/60s 内到期且有 refresh_token → 刷新并存回。
   * 无 refresh_token / 无 expires_at（旧凭证）→ 原样不动;刷新失败抛错（比拿着死 token
   * 去打目标 API 得到含糊的 401 更可诊断）。支持 refresh token 轮换（响应带新 refresh_token 即换）。
   */
  async refreshIfNeeded(credentialId: string, projectId: string): Promise<void> {
    const key = `${projectId}:${credentialId}`;
    const existing = this.refreshes.get(key);
    if (existing) return existing;
    const refresh = this.refreshWithLease(credentialId, projectId).finally(() => this.refreshes.delete(key));
    this.refreshes.set(key, refresh);
    return refresh;
  }

  private async refreshWithLease(credentialId: string, projectId: string): Promise<void> {
    const data = await this.credentials.rawData(credentialId, projectId);
    const tok = data['oauthTokenData'] as JsonObject | undefined;
    const refreshToken = tok?.['refresh_token'];
    const expiresAt = tok?.['expires_at'];
    if (!tok || !refreshToken || typeof expiresAt !== 'number') return;
    if (Date.now() < expiresAt - 60_000) return;

    const acquired = await this.repos.oauthRuntime.tryAcquireRefreshLock(
      credentialId, this.instanceId, new Date(Date.now() + REFRESH_LEASE_MS),
    );
    if (!acquired) {
      const until = Date.now() + REFRESH_LEASE_MS + 250;
      while (Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const current = await this.credentials.rawData(credentialId, projectId);
        const currentToken = current['oauthTokenData'] as JsonObject | undefined;
        if (typeof currentToken?.['expires_at'] !== 'number' || Date.now() < currentToken['expires_at'] - 60_000) return;
        if (await this.repos.oauthRuntime.tryAcquireRefreshLock(
          credentialId, this.instanceId, new Date(Date.now() + REFRESH_LEASE_MS),
        )) return this.performRefresh(credentialId, projectId, current, currentToken);
      }
      throw new OperationalError('OAuth2 token refresh lock timed out', { status: 503 });
    }
    return this.performRefresh(credentialId, projectId, data, tok);
  }

  private async performRefresh(
    credentialId: string,
    projectId: string,
    data: JsonObject,
    tok: JsonObject,
  ): Promise<void> {
    const refreshToken = tok['refresh_token'];
    try {
      const tokenUrl = this.tokenUrlFor(data);
      if (!tokenUrl) return;
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: String(refreshToken),
      });
      const headers = this.applyClientAuthentication(data, body);
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers,
        body,
      }).catch((error: Error) => {
        throw new OperationalError(`OAuth2 token refresh request failed: ${error.message}`, { status: 400 });
      });
      if (!res.ok) {
        throw new OperationalError(`OAuth2 token refresh failed: HTTP ${res.status}`, { status: 400 });
      }
      const tokens = (await res.json().catch(() => ({}))) as JsonObject;
      if (!tokens['access_token']) {
        throw new OperationalError('OAuth2 token refresh returned no access_token', { status: 400 });
      }
      const next: IOAuthTokenData = {
        access_token: tokens['access_token'],
        token_type: tokens['token_type'] ?? tok['token_type'] ?? 'Bearer',
        refresh_token: tokens['refresh_token'] ?? refreshToken, // 轮换:响应带新的就换
        scope: tokens['scope'] ?? tok['scope'] ?? null,
        expires_at:
          typeof tokens['expires_in'] === 'number' ? Date.now() + (tokens['expires_in'] as number) * 1000 : null,
      };
      await this.credentials.updateData(credentialId, projectId, {
        oauthTokenData: next as unknown as JsonObject,
      });
    } finally {
      await this.repos.oauthRuntime.releaseRefreshLock(credentialId, this.instanceId);
    }
  }

  private stateHash(state: string): string {
    return createHash('sha256').update(state).digest('hex');
  }
}
