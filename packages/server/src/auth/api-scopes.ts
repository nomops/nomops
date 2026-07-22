/**
 * 公共 API 细粒度作用域（backlog #26）。
 *
 * 形态 `resource:action`。两个便捷宏保留向后兼容：
 * - `all`：全放行（等于持有所有 scope）；
 * - `readonly`：所有 *:read（只读方法放行，写方法拒）。
 *
 * 存储：api_keys.scope 存逗号分隔的 scope 列表，或宏 'all'/'readonly'。
 * 强制：按请求 method + 路径前缀算出「所需 scope」，令牌的 scope 集合须覆盖它。
 */

export const API_RESOURCES = ['workflow', 'execution', 'credential', 'variable', 'user', 'project'] as const;
export type ApiResource = (typeof API_RESOURCES)[number];

export const API_SCOPES: string[] = [
  ...API_RESOURCES.map((r) => `${r}:read`),
  ...API_RESOURCES.map((r) => `${r}:write`),
];

/** 路径前缀 → 资源。未命中的路径视为需要 'all'（保守：非白名单资源默认要全权）。 */
const PATH_RESOURCE: Array<[RegExp, ApiResource]> = [
  [/^\/(api\/v1|api)\/workflows(\/|$)/, 'workflow'],
  [/^\/(api\/v1|api)\/executions(\/|$)/, 'execution'],
  [/^\/(api\/v1|api)\/credentials(\/|$)/, 'credential'],
  [/^\/(api\/v1|api)\/variables(\/|$)/, 'variable'],
  [/^\/(api\/v1|api)\/(instance\/users|me)(\/|$)/, 'user'],
  [/^\/(api\/v1|api)\/projects(\/|$)/, 'project'],
];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 解析存储的 scope 字段为 scope 集合（宏原样保留）。 */
export function parseScopes(stored: string | null | undefined): string[] {
  if (!stored || stored === 'all') return ['all'];
  if (stored === 'readonly') return ['readonly'];
  return stored
    .split(',')
    .map((s) => s.trim())
    .filter((s) => API_SCOPES.includes(s));
}

/** 校验并归一创建时传入的 scope：宏原样;否则过滤为合法 scope 列表(空则回落 all)。 */
export function normalizeScopeInput(input: unknown): string {
  if (input === 'readonly') return 'readonly';
  if (input === 'all' || input == null) return 'all';
  const list = Array.isArray(input) ? input : String(input).split(',');
  const valid = list.map((s) => String(s).trim()).filter((s) => API_SCOPES.includes(s));
  return valid.length ? [...new Set(valid)].join(',') : 'all';
}

/** 请求所需 scope（如 workflow:read）;未识别资源 → null（需 'all'）。 */
export function requiredScope(method: string, path: string): string | null {
  const resource = PATH_RESOURCE.find(([re]) => re.test(path))?.[1];
  if (!resource) return null;
  return `${resource}:${READ_METHODS.has(method.toUpperCase()) ? 'read' : 'write'}`;
}

/** 令牌 scope 集合是否放行本请求。 */
export function scopesAllow(scopes: string[], method: string, path: string): boolean {
  if (scopes.includes('all')) return true;
  const isRead = READ_METHODS.has(method.toUpperCase());
  if (scopes.includes('readonly')) return isRead;
  const required = requiredScope(method, path);
  if (required === null) return false; // 未识别资源:细粒度令牌一律不放行（需 all 宏）
  return scopes.includes(required);
}
