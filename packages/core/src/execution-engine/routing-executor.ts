import type {
  ICredentialAuthentication,
  IExecuteContext,
  IHttpPaginationDeclaration,
  IHttpRequestDeclaration,
  IHttpRequestOptions,
  INodeExecutionData,
  INodeTypeDescription,
  JsonObject,
} from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

type RoutingContext = IExecuteContext & {
  resolveValue(value: unknown, itemIndex: number, overrides?: { json?: JsonObject }): unknown;
};

/** description 是否是声明式节点（任一 operation 选项带 routing）。 */
export function hasRoutingDeclarations(description: INodeTypeDescription): boolean {
  return description.properties.some((property) =>
    (property.options ?? []).some((option) => option.routing !== undefined),
  );
}

function findRouting(
  description: INodeTypeDescription,
  getParam: (name: string) => unknown,
): IHttpRequestDeclaration {
  for (const property of description.properties) {
    const options = property.options ?? [];
    if (!options.some((option) => option.routing)) continue;
    const selected = getParam(property.name) ?? property.default;
    const match = options.find((option) => option.value === selected);
    if (match?.routing) return match.routing;
    throw new OperationalError(`声明式节点：操作 "${String(selected)}" 没有对应的 routing 声明`, {
      parameter: property.name,
    });
  }
  throw new OperationalError('声明式节点：description 里没有任何 routing 声明');
}

function renderCredentialTemplate(template: string, credential: JsonObject): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, field: string) =>
    String(credential[field] ?? ''),
  );
}

function getPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  let current = value;
  for (const segment of path.split('.').filter(Boolean)) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : { data: value };
}

function setBucket(
  options: IHttpRequestOptions,
  target: 'headers' | 'qs' | 'body',
  key: string,
  value: unknown,
): void {
  if (target === 'headers') (options.headers ??= {})[key] = String(value);
  else if (target === 'qs') (options.qs ??= {})[key] = value;
  else {
    const body = asObject(options.body ?? {});
    body[key] = value;
    options.body = body;
  }
}

function removeBucket(
  options: IHttpRequestOptions,
  target: 'headers' | 'qs' | 'body',
  key: string,
): void {
  if (target === 'headers') delete options.headers?.[key];
  else if (target === 'qs') delete options.qs?.[key];
  else if (options.body !== null && typeof options.body === 'object' && !Array.isArray(options.body)) {
    delete (options.body as JsonObject)[key];
  }
}

function legacyAuthentication(description: INodeTypeDescription): ICredentialAuthentication | undefined {
  const injection = description.credentialInjection;
  return injection
    ? {
        credentialName: injection.credentialName,
        injections: [{ in: injection.in, key: injection.key, template: injection.template }],
      }
    : undefined;
}

function placePagination(
  options: IHttpRequestOptions,
  pagination: IHttpPaginationDeclaration,
  token: string | number,
): void {
  const target = pagination.request.in === 'query'
    ? 'qs'
    : pagination.request.in === 'header'
      ? 'headers'
      : 'body';
  setBucket(options, target, pagination.request.name, token);
}

function cloneRequest(options: IHttpRequestOptions): IHttpRequestOptions {
  return {
    ...options,
    ...(options.headers ? { headers: { ...options.headers } } : {}),
    ...(options.qs ? { qs: { ...options.qs } } : {}),
    ...(options.body !== null && typeof options.body === 'object' && !Array.isArray(options.body)
      ? { body: { ...(options.body as JsonObject) } }
      : {}),
  };
}

async function applyAuthentication(
  options: IHttpRequestOptions,
  authentication: ICredentialAuthentication | undefined,
  credential: JsonObject | null,
  customAuthenticate?: (
    credentials: JsonObject,
    request: IHttpRequestOptions,
  ) => IHttpRequestOptions | Promise<IHttpRequestOptions>,
): Promise<IHttpRequestOptions> {
  if (!authentication || !credential) return options;
  if (authentication.type === 'custom') {
    if (!customAuthenticate) {
      throw new OperationalError(`凭证 ${authentication.credentialName} 声明 custom 认证但节点未实现 authenticate`);
    }
    return customAuthenticate(credential, options);
  }

  for (const injection of authentication.injections ?? []) {
    const rendered = renderCredentialTemplate(injection.template, credential);
    if (injection.in === 'header') (options.headers ??= {})[injection.key] = rendered;
    else if (injection.in === 'query') (options.qs ??= {})[injection.key] = rendered;
    else if (injection.in === 'body') setBucket(options, 'body', injection.key, rendered);
    else if (injection.in === 'basic') {
      (options.headers ??= {})[injection.key || 'authorization'] = `Basic ${Buffer.from(rendered).toString('base64')}`;
    } else {
      options.url = options.url.split(`{${injection.key}}`).join(rendered);
    }
  }
  return options;
}

function credentialSecrets(credential: JsonObject | null): string[] {
  if (!credential) return [];
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string' && value.length >= 4) found.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(credential);
  return found.sort((a, b) => b.length - a.length);
}

function redact(value: string, secrets: string[]): string {
  return secrets.reduce((text, secret) => text.split(secret).join('***'), value);
}

async function postProcess(
  ctx: RoutingContext,
  routing: IHttpRequestDeclaration,
  itemIndex: number,
  response: unknown,
): Promise<unknown> {
  let current = response;
  for (const transform of routing.postReceive ?? []) {
    if (transform.type === 'extract') {
      current = getPath(current, transform.path);
      continue;
    }
    const values = Array.isArray(current) ? current : [current];
    current = values.map((value) => {
      const json = asObject(value);
      const mapped: JsonObject = {};
      for (const [key, declaration] of Object.entries(transform.fields)) {
        mapped[key] = ctx.resolveValue(declaration, itemIndex, { json });
      }
      return mapped;
    });
  }
  return current;
}

/**
 * 声明式 routing 执行器：分页、请求/响应变换、二进制与凭证认证都由纯数据描述驱动。
 * custom authenticate 是唯一运行期函数扩展点，留在节点类上，不进入 API/工作流 JSON。
 */
export async function executeRoutingNode(
  ctx: RoutingContext,
  description: INodeTypeDescription,
  customAuthenticate?: (
    credentials: JsonObject,
    request: IHttpRequestOptions,
  ) => IHttpRequestOptions | Promise<IHttpRequestOptions>,
): Promise<INodeExecutionData[][]> {
  const items = ctx.getInputData();
  const output: INodeExecutionData[] = [];
  const authentication = description.credentialAuthentication ?? legacyAuthentication(description);
  const credential = authentication ? await ctx.getCredentials(authentication.credentialName) : null;
  const secrets = credentialSecrets(credential);

  for (let itemIndex = 0; itemIndex < Math.max(items.length, 1); itemIndex++) {
    const routing = findRouting(description, (name) => ctx.getNodeParameter(name, itemIndex));
    const resolve = (value: unknown) => ctx.resolveValue(value, itemIndex);
    const rawUrl = String(resolve(routing.url));
    const baseUrl = description.requestDefaults?.baseUrl ?? '';
    const url = /^https?:\/\//.test(rawUrl) ? rawUrl : `${baseUrl.replace(/\/$/, '')}${rawUrl}`;
    const request: IHttpRequestOptions = {
      url,
      method: routing.method ?? 'GET',
      headers: { ...(description.requestDefaults?.headers ?? {}) },
      qs: {},
      ...(routing.response?.format && routing.response.format !== 'auto'
        ? { responseFormat: routing.response.format }
        : {}),
    };
    for (const [key, value] of Object.entries(routing.headers ?? {})) {
      request.headers![key] = String(resolve(value));
    }
    for (const [key, value] of Object.entries(routing.qs ?? {})) {
      const resolved = resolve(value);
      if (resolved !== undefined && resolved !== null && resolved !== '') request.qs![key] = resolved;
    }
    if (routing.body) request.body = resolve(routing.body);
    for (const transform of routing.preSend ?? []) {
      if (transform.type === 'remove') removeBucket(request, transform.target, transform.key);
      else setBucket(request, transform.target, transform.key, resolve(transform.value));
    }

    if (routing.response?.format === 'binary' && routing.pagination) {
      throw new OperationalError('声明式 routing 的 binary 响应不支持分页');
    }

    const pages: unknown[] = [];
    const pagination = routing.pagination;
    const maxPages = Math.min(Math.max(pagination?.maxPages ?? 100, 1), 1000);
    let token: string | number = pagination?.start ?? (pagination?.mode === 'offset' ? 0 : '');
    const seenCursors = new Set<string>();

    for (let page = 0; page < (pagination ? maxPages : 1); page++) {
      let pageRequest = cloneRequest(request);
      if (pagination && (pagination.mode === 'offset' || token !== '')) {
        placePagination(pageRequest, pagination, token);
      }
      pageRequest = await applyAuthentication(pageRequest, authentication, credential, customAuthenticate);

      let response: unknown;
      try {
        response = await ctx.helpers.httpRequest(pageRequest);
      } catch (error) {
        const message = redact(String((error as Error).message), secrets);
        throw new OperationalError(message, { url: redact(pageRequest.url, secrets) });
      }

      if (routing.response?.format === 'binary') {
        if (!(response instanceof Uint8Array)) {
          throw new OperationalError('声明式 binary 响应必须由 HTTP helper 返回 Uint8Array');
        }
        const binary = await ctx.helpers.bufferToBinary(response, {
          mimeType: routing.response.mimeType ?? 'application/octet-stream',
          ...(routing.response.fileName ? { fileName: String(resolve(routing.response.fileName)) } : {}),
        });
        output.push({
          json: {},
          binary: { [routing.response.binaryPropertyName ?? 'data']: binary },
          pairedItem: { item: itemIndex },
        });
        break;
      }

      const pageResults = getPath(response, pagination?.response.resultsPath);
      if (pagination && Array.isArray(pageResults)) pages.push(...pageResults);
      else pages.push(pageResults);
      if (!pagination) break;

      if (pagination.mode === 'cursor') {
        const next = getPath(response, pagination.response.nextCursorPath);
        if (next === undefined || next === null || next === '') break;
        const cursor = String(next);
        if (seenCursors.has(cursor)) throw new OperationalError('声明式分页返回了重复 cursor');
        if (page === maxPages - 1) {
          throw new OperationalError(`声明式分页超过最大页数 ${maxPages}`);
        }
        seenCursors.add(cursor);
        token = cursor;
      } else {
        const hasMore = pagination.response.hasMorePath
          ? Boolean(getPath(response, pagination.response.hasMorePath))
          : Array.isArray(pageResults) && pageResults.length > 0;
        if (!hasMore) break;
        if (page === maxPages - 1) {
          throw new OperationalError(`声明式分页超过最大页数 ${maxPages}`);
        }
        token = Number(token) + (pagination.increment ?? 1);
      }
    }

    if (routing.response?.format === 'binary') continue;
    const combined = pagination ? pages : pages[0];
    const processed = await postProcess(ctx, routing, itemIndex, combined);
    const split = Boolean(pagination || routing.postReceive?.length);
    const values = split && Array.isArray(processed) ? processed : [processed];
    for (const value of values) {
      output.push({ json: asObject(value), pairedItem: { item: itemIndex } });
    }
  }

  return [output];
}
