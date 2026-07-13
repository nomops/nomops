import type { NextFunction, Request, Response } from 'express';
import type { Repositories } from '@nomops/db';
import type { AuthService } from './auth-service.js';
import { roleAtLeast, type ProjectRole } from './rbac.js';

/** 解析后的请求身份，挂在 req.auth。 */
export interface IRequestAuth {
  userId: string;
  projectId: string;
  /** 用户在当前项目上下文中的角色（每请求查表，改权立即生效——docs/06）。 */
  role: ProjectRole;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: IRequestAuth;
  }
}

/**
 * Bearer JWT → 身份；`X-Project-Id` 头可切换项目上下文（docs/06）。
 * 目标项目非成员 → 403。角色不进 JWT——避免改权后旧 token 越权。
 */
export function createAuthMiddleware(authService: AuthService, repos: Repositories) {
  return (req: Request, res: Response, next: NextFunction): void => {
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

    const headerProject = req.headers['x-project-id'];
    const projectId = typeof headerProject === 'string' && headerProject ? headerProject : payload.projectId;

    void repos.projects
      .findMemberRole(projectId, payload.sub)
      .then((role) => {
        if (!role) {
          res.status(403).json({ error: 'You are not a member of this project', projectId });
          return;
        }
        req.auth = { userId: payload.sub, projectId, role: role as ProjectRole };
        next();
      })
      .catch(next);
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
