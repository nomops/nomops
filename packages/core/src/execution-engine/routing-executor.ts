import type {
  IExecuteContext,
  IHttpRequestDeclaration,
  IHttpRequestOptions,
  INodeExecutionData,
  INodeTypeDescription,
  JsonObject,
} from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

/**
 * 声明式 routing 执行器：节点不写 execute()，只在 description 里声明
 * 「operation → HTTP 请求怎么拼」，本执行器按声明逐 item 发请求。
 * 加集成节点因此退化为纯数据录入（url/body/凭证注入全是声明）。
 *
 * 求值规则：url/qs/body/headers 的字符串值支持 `={{ }}` 表达式，
 * 由 ctx.getNodeParameter 之外的独立通道解析——这里直接复用 execute 上下文
 * 的参数求值语义：声明值先替换 {{$parameter.x}} 之类由调用方（引擎上下文）处理。
 */

/** description 是否是声明式节点（任一 operation 选项带 routing）。 */
export function hasRoutingDeclarations(description: INodeTypeDescription): boolean {
  return description.properties.some((p) =>
    (p.options ?? []).some((o) => o.routing !== undefined),
  );
}

/** 找到当前选中 operation 的 routing 声明（按 property 顺序第一个命中）。 */
function findRouting(
  description: INodeTypeDescription,
  getParam: (name: string) => unknown,
): IHttpRequestDeclaration {
  for (const prop of description.properties) {
    const options = prop.options ?? [];
    if (!options.some((o) => o.routing)) continue;
    const selected = getParam(prop.name) ?? prop.default;
    const match = options.find((o) => o.value === selected);
    if (match?.routing) return match.routing;
    throw new OperationalError(
      `声明式节点：操作 "${String(selected)}" 没有对应的 routing 声明`,
      { parameter: prop.name },
    );
  }
  throw new OperationalError('声明式节点：description 里没有任何 routing 声明');
}

/** 解析凭证注入模板：'Bearer {{apiKey}}' + 凭证 data → 实际值。 */
function renderCredentialTemplate(template: string, credential: JsonObject): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, field: string) =>
    String(credential[field] ?? ''),
  );
}

/**
 * 以 execute 上下文跑声明式节点：逐 item 求值声明 → 拼请求 → 发送 → 输出响应。
 * 表达式求值借道 getNodeParameter 的机制：把声明值临时挂为「虚拟参数」不可行，
 * 因此引擎在构造上下文时提供 resolveValue（与参数求值同一作用域）。
 */
export async function executeRoutingNode(
  ctx: IExecuteContext & { resolveValue(value: unknown, itemIndex: number): unknown },
  description: INodeTypeDescription,
): Promise<INodeExecutionData[][]> {
  const items = ctx.getInputData();
  const out: INodeExecutionData[] = [];
  const injection = description.credentialInjection;
  // 凭证整个执行取一次（同一节点同一凭证）；明文只在本函数作用域存在
  const credential = injection ? await ctx.getCredentials(injection.credentialName) : null;

  for (let i = 0; i < Math.max(items.length, 1); i++) {
    const routing = findRouting(description, (name) => ctx.getNodeParameter(name, i));
    const resolve = (v: unknown) => ctx.resolveValue(v, i);

    const rawUrl = String(resolve(routing.url));
    const base = description.requestDefaults?.baseUrl ?? '';
    const url = /^https?:\/\//.test(rawUrl) ? rawUrl : `${base.replace(/\/$/, '')}${rawUrl}`;

    const headers: Record<string, string> = {
      ...(description.requestDefaults?.headers ?? {}),
    };
    for (const [k, v] of Object.entries(routing.headers ?? {})) headers[k] = String(resolve(v));

    const qs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(routing.qs ?? {})) {
      const resolved = resolve(v);
      if (resolved !== undefined && resolved !== null && resolved !== '') qs[k] = resolved;
    }

    let body: JsonObject | undefined;
    if (routing.body) {
      body = {};
      for (const [k, v] of Object.entries(routing.body)) {
        const resolved = resolve(v);
        if (resolved !== undefined) body[k] = resolved;
      }
    }

    if (injection && credential) {
      const value = renderCredentialTemplate(injection.template, credential);
      if (injection.in === 'header') headers[injection.key] = value;
      else qs[injection.key] = value;
    }

    const options: IHttpRequestOptions = {
      url,
      method: routing.method ?? 'GET',
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(Object.keys(qs).length > 0 ? { qs } : {}),
      ...(body ? { body } : {}),
    };

    const response = await ctx.helpers.httpRequest(options);
    out.push({
      json:
        response !== null && typeof response === 'object' && !Array.isArray(response)
          ? (response as JsonObject)
          : { data: response },
      pairedItem: { item: i },
    });
  }

  return [out];
}
