import type { NextFunction, Request, Response } from 'express';
import type { z, ZodTypeAny } from 'zod';
import { OperationalError } from '@nomops/workflow';
import type { JsonObject } from '@nomops/workflow';
import type { AppServices } from '../app-services.js';

/**
 * 路由层共用的无状态辅助（C1 下半场抽出）。
 *
 * 放在 http/ 而不是 controllers/：它们是 HTTP 层的无状态工具，社区路由与企业
 * 路由都要用。留在 controllers/ 下会让 ee 看起来在反向依赖社区的路由注册层，
 * 而那条边界必须干净——依赖方向只能指向基础设施，绝不指向 controllers。
 */

/** Zod 校验失败 → 400（含字段级错误）。 */
export function parseBody<S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw new OperationalError('Request body validation failed', {
      status: 400,
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

/** async handler 包装：错误统一走 error middleware。 */
export const h =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export const auth = (req: Request) => req.auth!; // 路由挂在 authMiddleware 之后，一定存在

/** Express 5 的 params 值类型为 string | string[]（通配符），这里统一取 string。 */
export const param = (req: Request, name: string): string => String(req.params[name]);

/** 实例管理员检查（users.role ∈ owner/admin）。社区与企业路由共用。 */
export async function assertInstanceAdmin(services: AppServices, req: Request): Promise<void> {
  const user = await services.repos.users.findById(auth(req).userId);
  if (!user || !['owner', 'admin'].includes(user.role)) {
    throw new OperationalError('Requires instance administrator (owner/admin) permission', {
      status: 403,
    });
  }
}

/** 成员管理等按 URL 参数指定项目操作：校验请求者是该项目 owner。社区与企业路由共用。 */
export async function assertOwnerOf(
  services: AppServices,
  req: Request,
  projectId: string,
): Promise<void> {
  const role = await services.repos.projects.findMemberRole(projectId, auth(req).userId);
  if (role !== 'project:owner') {
    throw new OperationalError('Requires project:owner permission for this project', {
      status: 403,
      projectId,
    });
  }
}

/** 审计留痕（docs/06）：fire-and-forget，details 只放元数据（铁律 3）。 */
export function recordAudit(
  services: AppServices,
  req: Request,
  action: string,
  resource?: { type: string; id: string },
  details?: JsonObject,
  /** 项目域动作（成员管理等）按 URL 参数指定项目留痕，而非请求者上下文项目。 */
  projectId?: string,
): void {
  services.audit.log({
    userId: req.auth?.userId ?? null,
    projectId: projectId ?? req.auth?.projectId ?? null,
    action,
    resourceType: resource?.type ?? null,
    resourceId: resource?.id ?? null,
    details: details ?? null,
    ip: req.ip ?? null,
  });
}
