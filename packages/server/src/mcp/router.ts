import express, { Router, type Request, type Response } from 'express';
import type { AppServices } from '../app-services.js';

/**
 * 实例级 MCP 端点（POST /mcp-server/http）：MCP Streamable HTTP 最小子集。
 * - 单条 JSON-RPC 2.0 请求/响应（application/json；不做 SSE 流）。
 * - Bearer access token 鉴权（Settings → Instance-level MCP 签发）。
 * - 未启用 → 404（与不存在无差别）。
 */
export function createMcpRouter(services: AppServices): Router {
  const router = Router();

  const baseUrl = (req: Request): string =>
    process.env['NOMOPS_BASE_URL'] ??
    `${(req.headers['x-forwarded-proto'] as string) || req.protocol}://${req.headers.host ?? 'localhost'}`;

  const oauthErr = (res: Response, next: (e: Error) => void, error: unknown): void => {
    const e = error as { context?: { status?: number }; message?: string };
    const status = e?.context?.status ?? 500;
    if (status >= 500) return next(error as Error);
    res.status(status).json({ error: e.message ?? 'oauth error' });
  };

  /* ── OAuth 2.0 授权服务器元数据发现（RFC 8414；MCP 客户端用，#25） ── */
  const metadata = (req: Request, res: Response): void => {
    res.json(services.mcp.oauthMetadata(baseUrl(req)));
  };
  router.get('/.well-known/oauth-authorization-server', metadata);
  router.get('/mcp-server/.well-known/oauth-authorization-server', metadata);

  /** 授权端点：校验 → 302 回 redirect_uri 带 code。 */
  router.get('/mcp-server/oauth/authorize', (req: Request, res: Response, next) => {
    void (async () => {
      const q = req.query as Record<string, string>;
      const { redirectTo } = await services.mcp.authorize({
        clientId: q['client_id'] ?? '',
        redirectUri: q['redirect_uri'] ?? '',
        codeChallenge: q['code_challenge'] ?? '',
        codeChallengeMethod: q['code_challenge_method'] ?? '',
        ...(q['state'] ? { state: q['state'] } : {}),
      });
      res.redirect(redirectTo);
    })().catch((e) => oauthErr(res, next, e));
  });

  /** 令牌端点：authorization_code + PKCE → access_token（兼容 form-urlencoded 与 JSON）。 */
  router.post('/mcp-server/oauth/token', express.urlencoded({ extended: true }), (req: Request, res: Response, next) => {
    void (async () => {
      const b = { ...(req.body as Record<string, string>), ...(req.query as Record<string, string>) };
      if (b['grant_type'] !== 'authorization_code') {
        res.status(400).json({ error: 'unsupported_grant_type' });
        return;
      }
      const tokens = await services.mcp.exchangeToken({
        code: b['code'] ?? '',
        codeVerifier: b['code_verifier'] ?? '',
        redirectUri: b['redirect_uri'] ?? '',
      });
      res.json(tokens);
    })().catch((e) => oauthErr(res, next, e));
  });

  router.post('/mcp-server/http', (req: Request, res: Response) => {
    void (async () => {
      if (!(await services.mcp.isEnabled())) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      if (!(await services.mcp.verifyBearer(req.headers.authorization))) {
        res.status(401).json({ error: 'Invalid or missing access token' });
        return;
      }
      const body = req.body as unknown;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Expected a single JSON-RPC object' } });
        return;
      }
      const result = await services.mcp.handleRpc(body as Parameters<typeof services.mcp.handleRpc>[0]);
      if (result === null) {
        res.status(202).end(); // notification：无响应体
        return;
      }
      res.json(result);
    })().catch((error: Error) => {
      res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: error.message } });
    });
  });

  return router;
}
