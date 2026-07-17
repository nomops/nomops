import { Router, type Request, type Response } from 'express';
import type { AppServices } from '../app-services.js';

/**
 * 实例级 MCP 端点（POST /mcp-server/http）：MCP Streamable HTTP 最小子集。
 * - 单条 JSON-RPC 2.0 请求/响应（application/json；不做 SSE 流）。
 * - Bearer access token 鉴权（Settings → Instance-level MCP 签发）。
 * - 未启用 → 404（与不存在无差别）。
 */
export function createMcpRouter(services: AppServices): Router {
  const router = Router();

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
