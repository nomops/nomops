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
