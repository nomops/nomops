import { randomBytes } from 'node:crypto';
import { OperationalError } from '@nomops/workflow';
import type { JsonObject } from '@nomops/workflow';
import type { CredentialService } from './credential-service.js';

/**
 * 凭证级 OAuth2（Authorization Code）流程（对标 n8n 的「Connect my account」）。
 * 用户在凭证里填 authUrl / accessTokenUrl / clientId / clientSecret / scope，
 * 点 Connect → 跳提供方授权 → 回调换 token → 加密存回凭证 data.oauthTokenData。
 * token 只经内部链路，绝不出 API/进日志（铁律 3）。state 内存态（单进程切片）。
 */
interface IPending {
  credentialId: string;
  projectId: string;
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

export interface IOAuthTokenData {
  access_token: unknown;
  token_type: unknown;
  refresh_token: unknown;
  scope: unknown;
  expires_at: number | null;
}

export class OAuth2Service {
  private readonly pending = new Map<string, IPending>();

  constructor(
    private readonly credentials: CredentialService,
    private readonly baseUrl: string,
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
    this.gcPending();
    this.pending.set(state, { credentialId, projectId, createdAt: Date.now() });

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
    const pending = this.pending.get(state);
    if (!pending || Date.now() - pending.createdAt > PENDING_TTL_MS) {
      throw new OperationalError('OAuth2 session not found or expired, please try connecting again', { status: 400 });
    }
    this.pending.delete(state);
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
      client_id: String(data['clientId'] ?? ''),
      client_secret: String(data['clientSecret'] ?? ''),
    });

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
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

  private gcPending(): void {
    const now = Date.now();
    for (const [state, item] of this.pending) {
      if (now - item.createdAt > PENDING_TTL_MS) this.pending.delete(state);
    }
  }
}
