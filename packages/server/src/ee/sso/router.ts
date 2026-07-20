import { Router, urlencoded, type NextFunction, type Request, type Response } from 'express';
import type { AppServices } from '../../app-services.js';

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

  /* ── SAML 2.0（B2）──
     与 OIDC 并存:两者是独立的 IdP 接入方式,实例可各自启用。 */

  const samlGate = (res: Response): boolean => {
    if (services.license.isFeatureEnabled('saml')) return true;
    res.status(403).json({ error: 'SAML SSO requires a paid license', feature: 'saml' });
    return false;
  };

  router.get(
    '/sso/saml/status',
    h(async (_req, res) => {
      const enabled = services.license.isFeatureEnabled('saml') && (await services.saml.isEnabled());
      res.json({ enabled });
    }),
  );

  /** SP 元数据,交给 IdP 导入。不含任何秘密,但仍随功能位一起门控。 */
  router.get(
    '/sso/saml/metadata',
    h(async (_req, res) => {
      if (!samlGate(res)) return;
      res.type('application/xml').send(await services.saml.metadata());
    }),
  );

  /** SP 发起:跳到 IdP。 */
  router.get(
    '/sso/saml/login',
    h(async (req, res) => {
      if (!samlGate(res)) return;
      const relayState = typeof req.query['redirect'] === 'string' ? req.query['redirect'] : '';
      res.redirect(await services.saml.buildLoginUrl(relayState));
    }),
  );

  /**
   * IdP 回调（HTTP-POST 绑定）。断言以表单字段送来,故此路由单独挂 urlencoded——
   * 全局只装了 express.json()。
   */
  router.post(
    '/sso/saml/callback',
    urlencoded({ extended: false, limit: '1mb' }),
    h(async (req, res) => {
      if (!samlGate(res)) return;
      const { result, provisioned } = await services.saml.handleCallback(
        req.body as Record<string, unknown>,
      );
      services.audit.log({
        userId: result.user.id,
        action: 'auth.sso.login',
        resourceType: 'user',
        resourceId: result.user.id,
        details: { provisioned, protocol: 'saml' },
        ip: req.ip ?? null,
      });
      res.redirect(`/sso/done?token=${encodeURIComponent(result.token)}`);
    }),
  );

  return router;
}
