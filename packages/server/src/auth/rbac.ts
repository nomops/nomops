/** 项目角色层级（docs/06 权限矩阵）。 */
export type ProjectRole = 'project:viewer' | 'project:editor' | 'project:owner';

const ROLE_LEVEL: Record<ProjectRole, number> = {
  'project:viewer': 1,
  'project:editor': 2,
  'project:owner': 3,
};

export const PROJECT_ROLES = Object.keys(ROLE_LEVEL) as ProjectRole[];

export function isProjectRole(value: string): value is ProjectRole {
  return value in ROLE_LEVEL;
}

export function roleAtLeast(actual: string, min: ProjectRole): boolean {
  return isProjectRole(actual) && ROLE_LEVEL[actual] >= ROLE_LEVEL[min];
}

/* ── 自定义角色（backlog #29）：命名的权限集,解析为有效内建层级供既有 requireRole 生效 ── */

/** 项目资源权限目录（自定义角色勾选的 scope）。 */
export const PROJECT_SCOPES = [
  'workflow:read',
  'workflow:create',
  'workflow:update',
  'workflow:delete',
  'execution:read',
  'execution:execute',
  'credential:read',
  'credential:create',
  'credential:update',
  'credential:delete',
  'member:manage',
] as const;
export type ProjectScope = (typeof PROJECT_SCOPES)[number];

/** 内建角色 → scope 集合（owner=全含成员管理;editor=读写不含成员管理;viewer=只读）。 */
export const BUILTIN_ROLE_SCOPES: Record<ProjectRole, ProjectScope[]> = {
  'project:owner': [...PROJECT_SCOPES],
  'project:editor': PROJECT_SCOPES.filter((s) => s !== 'member:manage'),
  'project:viewer': PROJECT_SCOPES.filter((s) => s.endsWith(':read')),
};

/**
 * scope 集合 → 有效内建层级（自定义角色靠此接入既有 requireRole 层级）：
 * 有 member:manage → owner;有任一写/执行 → editor;否则 viewer。
 */
export function tierForScopes(scopes: string[]): ProjectRole {
  if (scopes.includes('member:manage')) return 'project:owner';
  if (scopes.some((s) => /:(create|update|delete|execute)$/.test(s))) return 'project:editor';
  return 'project:viewer';
}
