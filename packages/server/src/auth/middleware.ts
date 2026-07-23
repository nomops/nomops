import type { NextFunction, Request, Response } from 'express';
import type { Repositories } from '@nomops/db';
import type { AuthService } from './auth-service.js';
import type { ApiKeyService } from '../services/api-key-service.js';
import { isProjectRole, roleAtLeast, tierForScopes, type ProjectRole } from './rbac.js';
import { requiredScope, scopesAllow } from './api-scopes.js';

/** 公共 API 令牌头。 */
export const API_KEY_HEADER = 'x-nomops-api-key';

/** 解析后的请求身份，挂在 req.auth。 */
export interface IRequestAuth {
  userId: string;
  projectId: string;
  /** 有效内建层级（自定义角色解析为其一，供 requireRole 层级判定）。 */
  role: ProjectRole;
  /** 原始角色名（内建时同 role;自定义角色时为其名字，供审计/展示）。 */
  roleName: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: IRequestAuth;
  }
}

/** 把已解析的身份挂到 req.auth；目标项目非成员 → 403。JWT 与 API key 两路共用。 */
function attachAuth(
  repos: Repositories,
  req: Request,
  res: Response,
  next: NextFunction,
  userId: string,
  defaultProjectId: string,
): void {
  const headerProject = req.headers['x-project-id'];
  const projectId = typeof headerProject === 'string' && headerProject ? headerProject : defaultProjectId;
  void repos.projects
    .findMemberRole(projectId, userId)
    .then(async (role) => {
      if (!role) {
        res.status(403).json({ error: 'You are not a member of this project', projectId });
        return;
      }
      // 自定义角色（#29）：非内建 → 查其 scopes 解析为有效层级;未知角色 → 最小权限 viewer
      let effective: ProjectRole = 'project:viewer';
      if (isProjectRole(role)) {
        effective = role;
      } else {
        const scopes = await repos.customRoles.scopesForName(role).catch(() => null);
        if (scopes) effective = tierForScopes(scopes);
      }
      req.auth = { userId, projectId, role: effective, roleName: role };
      void repos.users.touchLastActive(userId).catch(() => undefined); // D146:活跃打点,失败不阻塞
      next();
    })
    .catch(next);
}

/**
 * 身份鉴权（两路）：
 * - `X-Nomops-Api-Key` 头 → 公共 API 令牌，解析出用户 + 其默认（个人）项目
 * - `Authorization: Bearer <JWT>` → 会话令牌
 * `X-Project-Id` 头可切换项目上下文（docs/06）。目标项目非成员 → 403。
 * 角色不进 JWT——避免改权后旧 token 越权。
 */
export function createAuthMiddleware(authService: AuthService, repos: Repositories, apiKeys: ApiKeyService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // ── 公共 API 令牌 ──
    const apiKeyHeader = req.headers[API_KEY_HEADER];
    if (typeof apiKeyHeader === 'string' && apiKeyHeader) {
      void apiKeys
        .authenticate(apiKeyHeader)
        .then(async (result) => {
          if (!result) {
            res.status(401).json({ error: 'Invalid API key' });
            return;
          }
          // 细粒度作用域强制（#26）：按 method + 路径算所需 scope,令牌须覆盖
          const path = req.originalUrl.split('?')[0] ?? req.path;
          if (!scopesAllow(result.scopes, req.method, path)) {
            res.status(403).json({
              error: 'API key scope does not permit this request',
              required: requiredScope(req.method, path) ?? 'all',
              scopes: result.scopes,
            });
            return;
          }
          // 默认项目上下文 = 用户的个人项目（无 X-Project-Id 时）
          const projects = await repos.projects.findAllByUser(result.userId);
          const personal = projects.find((p) => p.type === 'personal') ?? projects[0];
          if (!personal) {
            res.status(403).json({ error: 'No accessible project for this API key' });
            return;
          }
          attachAuth(repos, req, res, next, result.userId, personal.id);
        })
        .catch(next);
      return;
    }

    // ── 会话 JWT ──
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Authorization Bearer token' });
      return;
    }
    let payload;
    try {
      payload = authService.verify(header.slice('Bearer '.length));
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    attachAuth(repos, req, res, next, payload.sub, payload.projectId);
  };
}

/** 路由级角色门：低于 minRole → 403。挂在 authMiddleware 之后。 */
export function requireRole(minRole: ProjectRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth || !roleAtLeast(req.auth.role, minRole)) {
      res.status(403).json({ error: `Requires ${minRole} role or higher`, role: req.auth?.role });
      return;
    }
    next();
  };
}
