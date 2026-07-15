import type { JsonObject } from '@nomops/workflow';

/**
 * 凭证连接测试（对标 n8n「Test connection」）。
 * 每个可测类型声明一个校验请求：解密后的凭证 → 打对应服务的一个只读端点。
 * 判定两档：默认看 HTTP 状态（坏 key → 401/403）；bodyCheck 用于状态不反映鉴权
 * 有效性的服务——slack(auth.test 恒 200，看 body.ok)、graphql(恒 200，看 errors)。
 * 铁律 3：密钥只进请求发给目标服务；响应 body 只提取布尔/错误码，绝不整体回 API/落日志。
 */

export interface CredentialTestRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  /** POST 请求体（如 GraphQL query）。 */
  body?: string;
  /** body 级判定（不设 = 只看 HTTP 状态；设了 tester 才读响应 body）。 */
  bodyCheck?: 'slack' | 'graphql';
}

export interface CredentialTestResponse {
  status: number;
  ok: boolean;
  /** 仅 bodyCheck 请求解析（JSON 解析失败 → undefined）。 */
  json?: unknown;
}

/** HTTP seam：真实用 fetch；测试注入假实现。 */
export interface ICredentialTester {
  request(req: CredentialTestRequest): Promise<CredentialTestResponse>;
}

export class FetchCredentialTester implements ICredentialTester {
  async request(req: CredentialTestRequest): Promise<CredentialTestResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
      // 只在需要 body 级判定时才读响应体
      const json = req.bodyCheck ? await res.json().catch(() => undefined) : undefined;
      return { status: res.status, ok: res.ok, json };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 判定响应是否代表凭证有效。返回消息只含服务的错误「码」（如 invalid_auth），
 * 不透传任意响应内容（铁律 3 谨慎面）。
 */
export function judgeTestResponse(
  req: CredentialTestRequest,
  res: CredentialTestResponse,
): { ok: boolean; message: string } {
  if (req.bodyCheck === 'slack') {
    // Slack Web API：恒 200，body { ok: boolean, error?: 'invalid_auth' | ... }
    const body = res.json as { ok?: boolean; error?: string } | undefined;
    if (body?.ok === true) return { ok: true, message: 'Connection successful.' };
    const code = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
    return { ok: false, message: `Connection failed — Slack returned "${code}".` };
  }
  if (req.bodyCheck === 'graphql') {
    // GraphQL：鉴权失败也常回 200，看 errors；有 data 且无 errors 即有效
    if (!res.ok) return { ok: false, message: `Connection failed — the service returned HTTP ${res.status}.` };
    const body = res.json as { data?: unknown; errors?: Array<{ message?: string }> } | undefined;
    if (body && !body.errors && body.data !== undefined && body.data !== null) {
      return { ok: true, message: 'Connection successful.' };
    }
    const first = body?.errors?.[0]?.message;
    return {
      ok: false,
      message: first ? `Connection failed — ${first}` : 'Connection failed — the GraphQL query returned errors.',
    };
  }
  // 默认：HTTP 状态即判定
  return res.ok
    ? { ok: true, message: 'Connection successful.' }
    : { ok: false, message: `Connection failed — the service returned HTTP ${res.status}.` };
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
  // GraphQL：鉴权失败也常回 200 + errors，走 body 级判定
  linearApi: (d) =>
    need(str(d, 'apiKey'), () => ({
      method: 'POST',
      url: 'https://api.linear.app/graphql',
      headers: { authorization: str(d, 'apiKey'), 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ viewer { id } }' }),
      bodyCheck: 'graphql',
    })),
  // Slack Web API：auth.test 恒 200，看 body.ok / body.error
  slackApi: (d) =>
    need(str(d, 'accessToken'), () => ({
      method: 'POST',
      url: 'https://slack.com/api/auth.test',
      headers: { authorization: `Bearer ${str(d, 'accessToken')}` },
      bodyCheck: 'slack',
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
