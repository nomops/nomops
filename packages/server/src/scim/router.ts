import { Router, type NextFunction, type Request, type Response } from 'express';
import { OperationalError } from '@nomops/workflow';
import type { AppServices } from '../app-services.js';
import { toScimUser } from './scim-service.js';

/** SCIM 错误响应（RFC 7644 §3.12）。 */
function scimError(res: Response, status: number, detail: string): void {
  res.status(status).json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: String(status),
    detail,
  });
}

const h =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

interface IScimPatchOp {
  op: string;
  path?: string;
  value?: unknown;
}

/** 解析 PATCH Operations 子集：replace active / name.givenName / name.familyName（含 pathless）。 */
function parsePatch(operations: IScimPatchOp[]): { givenName?: string; familyName?: string; active?: boolean } {
  const patch: { givenName?: string; familyName?: string; active?: boolean } = {};
  for (const operation of operations) {
    if (operation.op.toLowerCase() !== 'replace') {
      throw new OperationalError(`Unsupported SCIM op: ${operation.op}`, { status: 400 });
    }
    const path = operation.path?.toLowerCase();
    if (!path) {
      // pathless：value 是对象 {active, name:{...}}
      const value = (operation.value ?? {}) as Record<string, unknown>;
      if (typeof value['active'] === 'boolean') patch.active = value['active'];
      const name = value['name'] as Record<string, unknown> | undefined;
      if (typeof name?.['givenName'] === 'string') patch.givenName = name['givenName'];
      if (typeof name?.['familyName'] === 'string') patch.familyName = name['familyName'];
    } else if (path === 'active') {
      patch.active = operation.value === true || operation.value === 'true' || operation.value === 'True';
    } else if (path === 'name.givenname') {
      patch.givenName = String(operation.value ?? '');
    } else if (path === 'name.familyname') {
      patch.familyName = String(operation.value ?? '');
    } else {
      throw new OperationalError(`Unsupported SCIM path: ${operation.path}`, { status: 400 });
    }
  }
  return patch;
}

/** SCIM 2.0 Users 路由（/scim/v2）。专用 Bearer token 鉴权 + scim 功能门。 */
export function createScimRouter(services: AppServices): Router {
  const router = Router();

  // 功能门 + token 鉴权
  router.use((req: Request, res: Response, next: NextFunction): void => {
    if (!services.license.isFeatureEnabled('scim')) {
      scimError(res, 403, 'SCIM requires an Enterprise license');
      return;
    }
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      scimError(res, 401, 'Missing SCIM Bearer token');
      return;
    }
    void services.scim
      .verifyToken(header.slice('Bearer '.length))
      .then((ok) => {
        if (!ok) scimError(res, 401, 'Invalid SCIM token');
        else next();
      })
      .catch(next);
  });

  router.get(
    '/Users',
    h(async (req, res) => {
      const filter = typeof req.query['filter'] === 'string' ? req.query['filter'] : undefined;
      const users = await services.scim.listUsers(filter);
      res.json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        totalResults: users.length,
        startIndex: 1,
        itemsPerPage: users.length,
        Resources: users.map(toScimUser),
      });
    }),
  );

  router.get(
    '/Users/:id',
    h(async (req, res) => {
      res.json(toScimUser(await services.scim.getUser(String(req.params['id']))));
    }),
  );

  router.post(
    '/Users',
    h(async (req, res) => {
      const body = req.body as {
        userName?: string;
        name?: { givenName?: string; familyName?: string };
        active?: boolean;
      };
      if (!body.userName) throw new OperationalError('userName is required', { status: 400 });
      const user = await services.scim.createUser({
        userName: body.userName,
        givenName: body.name?.givenName,
        familyName: body.name?.familyName,
        active: body.active,
      });
      services.audit.log({
        action: 'scim.user.create',
        resourceType: 'user',
        resourceId: user.id,
        details: { userName: user.email },
      });
      res.status(201).json(toScimUser(user));
    }),
  );

  router.put(
    '/Users/:id',
    h(async (req, res) => {
      const body = req.body as {
        name?: { givenName?: string; familyName?: string };
        active?: boolean;
      };
      const user = await services.scim.updateUser(String(req.params['id']), {
        givenName: body.name?.givenName ?? '',
        familyName: body.name?.familyName ?? '',
        active: body.active ?? true,
      });
      services.audit.log({
        action: 'scim.user.update',
        resourceType: 'user',
        resourceId: user.id,
        details: { active: !user.disabled },
      });
      res.json(toScimUser(user));
    }),
  );

  router.patch(
    '/Users/:id',
    h(async (req, res) => {
      const body = req.body as { Operations?: IScimPatchOp[] };
      const patch = parsePatch(body.Operations ?? []);
      const user = await services.scim.updateUser(String(req.params['id']), patch);
      services.audit.log({
        action: patch.active === false ? 'scim.user.deactivate' : 'scim.user.update',
        resourceType: 'user',
        resourceId: user.id,
        details: { active: !user.disabled },
      });
      res.json(toScimUser(user));
    }),
  );

  router.delete(
    '/Users/:id',
    h(async (req, res) => {
      await services.scim.deactivateUser(String(req.params['id']));
      services.audit.log({
        action: 'scim.user.deactivate',
        resourceType: 'user',
        resourceId: String(req.params['id']),
      });
      res.status(204).end();
    }),
  );

  // OperationalError → SCIM 错误格式
  router.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof OperationalError) {
      const status = typeof error.context['status'] === 'number' ? error.context['status'] : 400;
      scimError(res, status, error.message);
      return;
    }
    next(error);
  });

  return router;
}
