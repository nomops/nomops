import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AppServices } from '../app-services.js';

const h =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** SSO 公开路由：status / login / callback（docs/07）。 */
export function createSsoRouter(services: AppServices): Router {
  const router = Router();

  router.get(
    '/sso/status',
    h(async (_req, res) => {
      const enabled = services.license.isFeatureEnabled('sso') && (await services.sso.isEnabled());
      res.json({ enabled });
    }),
  );

  router.get(
    '/sso/login',
    h(async (_req, res) => {
      if (!services.license.isFeatureEnabled('sso')) {
        res.status(403).json({ error: 'SSO requires an Enterprise license', feature: 'sso' });
        return;
      }
      res.redirect(await services.sso.buildLoginUrl());
    }),
  );

  router.get(
    '/sso/callback',
    h(async (req, res) => {
      if (!services.license.isFeatureEnabled('sso')) {
        res.status(403).json({ error: 'SSO requires an Enterprise license', feature: 'sso' });
        return;
      }
      const callbackUrl = new URL(req.originalUrl, 'http://localhost');
      const { result, provisioned } = await services.sso.handleCallback(callbackUrl);
      services.audit.log({
        userId: result.user.id,
        action: 'auth.sso.login',
        resourceType: 'user',
        resourceId: result.user.id,
        details: { provisioned },
        ip: req.ip ?? null,
      });
      // 302 到前端着陆页带 token（docs/07 流程）
      res.redirect(`/sso/done?token=${encodeURIComponent(result.token)}`);
    }),
  );

  return router;
}
