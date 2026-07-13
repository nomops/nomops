import { randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AppServices } from '../app-services.js';

const h =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** 弹窗回调页：向 opener 发消息并自关。message 传给前端做连接完成判定。 */
function popupHtml(message: string, note: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>OAuth2</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;background:#171717;color:#e5e5e5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style>
</head><body><p>${note}</p><script>
try { if (window.opener) window.opener.postMessage(${JSON.stringify(message)}, '*'); } catch (e) {}
setTimeout(function(){ window.close(); }, 400);
</script></body></html>`;
}

/**
 * OAuth2 公开路由（凭证「Connect my account」流程）：
 * - /oauth2/callback：提供方回调，换 token 存回凭证，通知弹窗 opener。
 * - /oauth2/demo/*：自带 demo 提供方，无需注册外部应用即可端到端体验/验证 OAuth2。
 */
export function createOAuth2Router(services: AppServices): Router {
  const router = Router();

  router.get(
    '/oauth2/callback',
    h(async (req, res) => {
      const callbackUrl = new URL(req.originalUrl, 'http://localhost');
      try {
        await services.oauth2.handleCallback(callbackUrl);
        res.type('html').send(popupHtml('nomops-oauth2:done', 'Account connected — you can close this window.'));
      } catch (error) {
        const message = (error as Error).message;
        res.type('html').send(popupHtml(`nomops-oauth2:error:${message}`, `Connection failed: ${message}`));
      }
    }),
  );

  /* ── 内置 demo 提供方（仅发放假 token，供无外部应用时体验/验证 OAuth2） ── */
  router.get(
    '/oauth2/demo/authorize',
    h(async (req, res) => {
      const redirectUri = String(req.query['redirect_uri'] ?? '');
      const state = String(req.query['state'] ?? '');
      if (!redirectUri) {
        res.status(400).send('missing redirect_uri');
        return;
      }
      // demo 提供方直接批准（真实提供方会先要求登录/授权）
      const target = new URL(redirectUri);
      target.searchParams.set('code', `demo-${randomBytes(8).toString('hex')}`);
      if (state) target.searchParams.set('state', state);
      res.redirect(target.href);
    }),
  );

  router.post(
    '/oauth2/demo/token',
    h(async (_req, res) => {
      res.json({
        access_token: `demo-access-${randomBytes(12).toString('hex')}`,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: `demo-refresh-${randomBytes(12).toString('hex')}`,
        scope: 'demo',
      });
    }),
  );

  return router;
}
