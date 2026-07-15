import type { JsonObject } from '@nomops/workflow';

/**
 * 凭证连接测试（对标 n8n「Test connection」）。
 * 每个可测类型声明一个校验请求：解密后的凭证 → 打对应服务的一个只读端点，看 HTTP 状态。
 * 只收录「状态能反映鉴权有效性」的类型（坏 key → 401/403）；排除 slack(200+ok:false)、
 * graphql、oauth 等状态不反映有效性的。铁律 3：密钥只进请求头/URL 发给目标服务，不读 body、不落日志。
 */

export interface CredentialTestRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
}

/** HTTP seam：真实用 fetch；测试注入假实现。只回状态，不读 body。 */
export interface ICredentialTester {
  request(req: CredentialTestRequest): Promise<{ status: number; ok: boolean }>;
}

export class FetchCredentialTester implements ICredentialTester {
  async request(req: CredentialTestRequest): Promise<{ status: number; ok: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(req.url, { method: req.method, headers: req.headers, signal: controller.signal });
      return { status: res.status, ok: res.ok };
    } finally {
      clearTimeout(timer);
    }
  }
}

const str = (d: JsonObject, k: string): string => (typeof d[k] === 'string' ? (d[k] as string) : '');
/** 有 token 才建请求，否则 null（缺字段 → 无法测）。 */
const need = (token: string, build: () => CredentialTestRequest): CredentialTestRequest | null =>
  token ? build() : null;
const bearerGet = (d: JsonObject, key: string, url: string): CredentialTestRequest | null =>
  need(str(d, key), () => ({ method: 'GET', url, headers: { authorization: `Bearer ${str(d, key)}` } }));

type Builder = (data: JsonObject) => CredentialTestRequest | null;

const TESTS: Record<string, Builder> = {
  anthropicApi: (d) =>
    need(str(d, 'apiKey'), () => ({
      method: 'GET',
      url: 'https://api.anthropic.com/v1/models',
      headers: { 'x-api-key': str(d, 'apiKey'), 'anthropic-version': '2023-06-01' },
    })),
  openAiApi: (d) => bearerGet(d, 'apiKey', 'https://api.openai.com/v1/models'),
  githubApi: (d) =>
    need(str(d, 'accessToken'), () => ({
      method: 'GET',
      url: 'https://api.github.com/user',
      headers: {
        authorization: `Bearer ${str(d, 'accessToken')}`,
        'user-agent': 'nomops',
        accept: 'application/vnd.github+json',
      },
    })),
  gitlabApi: (d) =>
    need(str(d, 'accessToken'), () => ({
      method: 'GET',
      url: 'https://gitlab.com/api/v4/user',
      headers: { 'private-token': str(d, 'accessToken') },
    })),
  notionApi: (d) =>
    need(str(d, 'apiKey'), () => ({
      method: 'GET',
      url: 'https://api.notion.com/v1/users/me',
      headers: { authorization: `Bearer ${str(d, 'apiKey')}`, 'notion-version': '2022-06-28' },
    })),
  airtableApi: (d) => bearerGet(d, 'apiKey', 'https://api.airtable.com/v0/meta/whoami'),
  stripeApi: (d) => bearerGet(d, 'secretKey', 'https://api.stripe.com/v1/account'),
  sendGridApi: (d) => bearerGet(d, 'apiKey', 'https://api.sendgrid.com/v3/scopes'),
  hubspotApi: (d) => bearerGet(d, 'apiKey', 'https://api.hubapi.com/account-info/v3/details'),
  todoistApi: (d) => bearerGet(d, 'apiKey', 'https://api.todoist.com/rest/v2/projects'),
  linearApi: (d) =>
    need(str(d, 'apiKey'), () => ({
      method: 'GET',
      url: 'https://api.linear.app/graphql?query=%7Bviewer%7Bid%7D%7D',
      headers: { authorization: str(d, 'apiKey') },
    })),
  discordApi: (d) =>
    need(str(d, 'botToken'), () => ({
      method: 'GET',
      url: 'https://discord.com/api/v10/users/@me',
      headers: { authorization: `Bot ${str(d, 'botToken')}` },
    })),
  telegramApi: (d) =>
    need(str(d, 'accessToken'), () => ({
      method: 'GET',
      url: `https://api.telegram.org/bot${str(d, 'accessToken')}/getMe`,
    })),
};

/** 该类型是否可测。 */
export function isTestable(type: string): boolean {
  return type in TESTS;
}

/** 构建测试请求；类型不可测 → undefined；可测但缺字段 → null。 */
export function buildCredentialTest(type: string, data: JsonObject): CredentialTestRequest | null | undefined {
  const build = TESTS[type];
  return build ? build(data) : undefined;
}

/** 可测类型清单（前端决定是否显示 Test 按钮）。 */
export const TESTABLE_CREDENTIAL_TYPES = Object.keys(TESTS);
