import type { JsonObject } from '@nomops/workflow';

/**
 * 凭证连接测试。
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
  bodyCheck?: 'slack' | 'graphql' | 'auth-only';
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
  if (req.bodyCheck === 'auth-only') {
    // 只判鉴权：401/403 = 坏 key；其余（含 400 参数错）说明 key 已通过鉴权。
    // 用于没有零成本探测端点的服务（豆包/GLM）：发一个故意无效的最小请求。
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `Connection failed — the service returned HTTP ${res.status} (invalid key).` };
    }
    return { ok: true, message: 'Connection successful.' };
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

/** Basic-auth 头：base64(user:pass)。 */
const basic = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

/**
 * 归一化域名字段为 https origin：容忍用户贴全 URL / 裸主机名，剥协议与尾斜杠，
 * 校验只含主机合法字符（防把奇怪输入拼进请求 URL）。非法 → ''（按缺字段处理）。
 */
function httpsOrigin(input: string): string {
  const host = input.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  // 标准 hostname：点分标签，每段字母数字开头结尾（拒绝连点/空格/@ 等）；可带端口
  const label = '[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?';
  return new RegExp(`^${label}(\\.${label})*(:\\d+)?$`).test(host) ? `https://${host}` : '';
}

/**
 * 归一化子域字段：容忍贴了完整域名（acme.zendesk.com）或 URL 的情况，
 * 取第一段并校验字符。非法 → ''。
 */
function subdomainOf(input: string, suffix: string): string {
  let s = input.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (s.toLowerCase().endsWith(`.${suffix}`)) s = s.slice(0, -(suffix.length + 1));
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(s) ? s : '';
}
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
  /* Chat providers（Settings → Chat）：DeepSeek/Kimi/千问有标准 models 列表端点 */
  deepseekApi: (d) => bearerGet(d, 'apiKey', 'https://api.deepseek.com/models'),
  kimiApi: (d) => bearerGet(d, 'apiKey', 'https://api.moonshot.cn/v1/models'),
  qwenApi: (d) => bearerGet(d, 'apiKey', 'https://dashscope.aliyuncs.com/compatible-mode/v1/models'),
  /* 豆包/GLM 无零成本列表端点：发故意无效的最小请求，只判鉴权（401/403 = 坏 key） */
  doubaoApi: (d) =>
    need(str(d, 'apiKey'), () => ({
      method: 'POST',
      url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      headers: { authorization: `Bearer ${str(d, 'apiKey')}`, 'content-type': 'application/json' },
      body: '{}',
      bodyCheck: 'auth-only',
    })),
  glmApi: (d) =>
    need(str(d, 'apiKey'), () => ({
      method: 'POST',
      url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      headers: { authorization: `Bearer ${str(d, 'apiKey')}`, 'content-type': 'application/json' },
      body: '{}',
      bodyCheck: 'auth-only',
    })),
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
  /* ── Basic-auth 拼接型：多字段组合成 Basic 头 + 域名归一化 ── */
  jiraApi: (d) => {
    const origin = httpsOrigin(str(d, 'domain'));
    const email = str(d, 'email');
    const token = str(d, 'apiToken');
    if (!origin || !email || !token) return null;
    return {
      method: 'GET',
      url: `${origin}/rest/api/2/myself`,
      headers: { authorization: basic(email, token), accept: 'application/json' },
    };
  },
  zendeskApi: (d) => {
    const sub = subdomainOf(str(d, 'subdomain'), 'zendesk.com');
    const email = str(d, 'email');
    const token = str(d, 'apiToken');
    if (!sub || !email || !token) return null;
    // Zendesk 约定：user = {email}/token
    return {
      method: 'GET',
      url: `https://${sub}.zendesk.com/api/v2/users/me.json`,
      headers: { authorization: basic(`${email}/token`, token) },
    };
  },
  freshdeskApi: (d) => {
    const sub = subdomainOf(str(d, 'domain'), 'freshdesk.com');
    const key = str(d, 'apiKey');
    if (!sub || !key) return null;
    // Freshdesk 约定：user = apiKey，pass 任意（惯用 X）
    return {
      method: 'GET',
      url: `https://${sub}.freshdesk.com/api/v2/agents/me`,
      headers: { authorization: basic(key, 'X') },
    };
  },
  twilioApi: (d) => {
    const sid = str(d, 'accountSid').trim();
    const token = str(d, 'authToken');
    if (!/^AC[a-zA-Z0-9]+$/.test(sid) || !token) return null; // SID 也进 URL，先校验字符
    return {
      method: 'GET',
      url: `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
      headers: { authorization: basic(sid, token) },
    };
  },
  mailchimpApi: (d) => {
    const key = str(d, 'apiKey').trim();
    // dc 在 key 后缀（xxxx-us21）；无法提取 → 按缺字段处理
    const dc = /-([a-z]{2,4}\d+)$/.exec(key)?.[1];
    if (!key || !dc) return null;
    return {
      method: 'GET',
      url: `https://${dc}.api.mailchimp.com/3.0/`,
      headers: { authorization: basic('anystring', key) },
    };
  },
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
