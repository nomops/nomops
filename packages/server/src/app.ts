import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { OperationalError } from '@nomops/workflow';
import type { AppServices } from './app-services.js';
import { createAuthMiddleware } from './auth/middleware.js';
import {
  createApiRouter,
  createAuthRouter,
  createInternalRouter,
  createWebhookRouter,
} from './controllers/index.js';
import { createSsoRouter } from './sso/router.js';
import { createOAuth2Router } from './oauth2/router.js';
import { createScimRouter } from './scim/router.js';
import { createBillingRouter } from './billing/router.js';

/**
 * 构造 Express 应用但不监听端口——单测直接对 app 发请求。
 * 路由结构：/healthz、/auth/*、/webhook/*（公开）、/api/*（JWT 保护）、
 * 静态前端（生产，NOMOPS_STATIC_DIR 存在时托管 + SPA 回退）。
 */
export function createApp(services?: AppServices): Express {
  const app = express();
  // billing webhook 要 raw body（服务商原文验签），必须挂在全局 json 解析之前
  if (services) app.use(createBillingRouter(services));
  app.use(express.json({ limit: '10mb' }));

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  if (services) {
    app.use('/auth', createAuthRouter(services));
    app.use(createWebhookRouter(services));
    app.use(createSsoRouter(services)); // /sso/*（公开，内部自查 license）
    app.use(createOAuth2Router(services)); // /oauth2/*（公开：凭证 OAuth 回调 + demo 提供方）
    app.use('/scim/v2', createScimRouter(services)); // SCIM 专用 token 鉴权
    app.use(createInternalRouter(services)); // /internal/*（控制平面指标，共享密钥鉴权；自托管无密钥即 404）
    app.use('/api', createAuthMiddleware(services.auth, services.repos), createApiRouter(services));

    // 生产：托管前端产物（Docker 镜像里指向 frontend/dist）
    const staticDir = process.env['NOMOPS_STATIC_DIR'];
    if (staticDir && existsSync(staticDir)) {
      app.use(express.static(staticDir));
      // SPA 回退：非 API 路径全部回 index.html（GET 且非保留前缀）
      app.get('*path', (req: Request, res: Response, next: NextFunction) => {
        if (/^\/(api|auth|webhook|ws|healthz)(\/|$)/.test(req.path)) return next();
        res.sendFile(join(staticDir, 'index.html'));
      });
    }
  }

  // 统一错误处理：OperationalError → 4xx（context.status 或 400）；其余 → 500
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof OperationalError) {
      const status = typeof error.context['status'] === 'number' ? error.context['status'] : 400;
      const { status: _s, ...context } = error.context;
      res.status(status).json({ error: error.message, ...(Object.keys(context).length ? { context } : {}) });
      return;
    }
    console.error('[nomops] 未预期错误:', error);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
