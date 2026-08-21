import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import type { ZodTypeAny, z } from 'zod';
import type {
  INode,
  INodeExecutionData,
  IRunExecutionData,
  IWebhookContext,
  IWebhookRequest,
  IWebhookResponseData,
  JsonObject,
} from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { AppServices } from '../app-services.js';
import {
  assertInstanceAdmin as assertInstanceAdminOf,
  assertOwnerOf as assertOwnerOfProject,
  auth,
  h,
  param,
  parseBody,
  recordAudit,
} from '../http/route-helpers.js';
import { registerEeRoutes } from '../ee/routes.js';
import { requireProjectScope, requireRole } from '../auth/middleware.js';
import { API_SCOPES } from '../auth/api-scopes.js';
import { verifyHandoff } from '../auth/handoff.js';
import { requireFeature } from '../ee/license/license-service.js';
import { isProjectRole, tierForScopes, PROJECT_SCOPES } from '../auth/rbac.js';
import { CHAT_PROVIDERS } from '../services/assistant-service.js';
import { AUDIT_RESOURCE } from '../ee/services/dynamic-credential-service.js';
import { getTemplate, getTemplateSummary, templateSummaries } from '../services/template-registry.js';
import { parseMultipartForm } from '../http/multipart.js';
import {
  acceptInviteSchema,
  activateBodySchema,
  addMemberSchema,
  createProjectSchema,
  inviteSchema,
  credentialBodySchema,
  credentialPatchSchema,
  dynamicNodeParametersSchema,
  aiTransformCodeSchema,
  dataTableBodySchema,
  dataTableColumnSchema,
  dataTableRenameSchema,
  dataTableRowSchema,
  folderBodySchema,
  folderPatchSchema,
  loginSchema,
  patchMemberSchema,
  chatAgentUpsertSchema,
  chatSessionUpsertSchema,
  quotaBodySchema,
  registerSchema,
  runBodySchema,
  testRunBodySchema,
  chatBodySchema,
  sttConfigSchema,
  transcribeBodySchema,
  executionAnnotationSchema,
  roleMappingSchema,
  agentBodySchema,
  agentPatchSchema,
  updateMeSchema,
  changePasswordSchema,
  ssoConfigSchema,
  tagBodySchema,
  variableBodySchema,
  workflowTagsSchema,
  workflowBodySchema,
  workflowPatchSchema,
  communityNodeInstallSchema,
  sourceControlConnectSchema,
  sourceControlPushSchema,
  licenseActivateSchema,
} from '../schemas.js';

/**
 * 免密登录落地页（docs/11 Phase 2.5）：成功则把会话令牌写进 localStorage（与前端 client.ts 同 key）
 * 再跳画布；失败则提示并回登录页。会话令牌只出现在 HTML body，不进 URL/历史。
 */
function handoffHtml(opts: { token?: string; email?: string; error?: string }): string {
  const safe = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  if (opts.error) {
    return `<!doctype html><meta charset="utf-8"><title>Sign in</title>
<body style="font-family:system-ui;background:#141118;color:#e4e4ea;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0">
<p>${safe(opts.error)}</p><a href="/login" style="color:#ff6d5a">Go to sign in</a></body>`;
  }
  const payload = JSON.stringify({ token: opts.token ?? '', email: opts.email ?? '' });
  return `<!doctype html><meta charset="utf-8"><title>Signing in…</title>
<body style="font-family:system-ui;background:#141118;color:#9a9aa6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<p>Signing in…</p>
<script>
  var d=${payload};
  try{ localStorage.setItem('nomops.token',d.token); if(d.email) localStorage.setItem('nomops.email',d.email); }catch(e){}
  location.replace('/');
</script></body>`;
}

/**
 * 内部指标路由（docs/11 Phase C：运营台真实用量）。
 * 仅供控制平面调用：用实例启动时注入的共享密钥 NOMOPS_INTERNAL_TOKEN 鉴权（非用户会话）。
 * 未注入该密钥（自托管形态）→ 端点整体 404（视同不存在）。
 * 只返回聚合计数（period/used/limit/plan），绝不回任何凭证或密钥（铁律 3）。
 */
export function createInternalRouter(services: AppServices): Router {
  const router = Router();
  const assertInternal = (req: Request): void => {
    const token = process.env['NOMOPS_INTERNAL_TOKEN'];
    if (!token) throw new OperationalError('Not found', { status: 404 });
    const provided = Buffer.from(req.header('x-internal-token') ?? '');
    const expected = Buffer.from(token);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new OperationalError('Unauthorized', { status: 401 });
    }
  };
  router.get(
    '/internal/usage',
    h(async (req, res) => {
      assertInternal(req);
      // owner 项目聚合本月用量。limit/plan 默认取自下发 env，有项目用量则以其为准（二者本应一致）。
      const period = services.quota.currentPeriod();
      const planQuota = process.env['NOMOPS_PLAN_QUOTA'];
      let used = 0;
      let limit: number | null = planQuota && planQuota !== 'unlimited' ? Number(planQuota) : null;
      let plan = process.env['NOMOPS_PLAN'] ?? 'free';
      const ownerEmail = process.env['NOMOPS_OWNER_EMAIL'];
      if (ownerEmail) {
        const owner = await services.repos.users.findByEmail(ownerEmail);
        if (owner) {
          const projects = await services.repos.projects.findAllByUser(owner.id);
          const usages = await Promise.all(projects.map((p) => services.quota.usage(p.id)));
          used = usages.reduce((sum, u) => sum + u.used, 0);
          if (usages[0]) {
            limit = usages[0].limit;
            plan = usages[0].plan;
          }
        }
      }
      res.json({ period, used, limit, plan });
    }),
  );
  router.post(
    '/internal/license/revocations',
    h(async (req, res) => {
      assertInternal(req);
      const ids = (req.body as { ids?: unknown } | undefined)?.ids;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id.length > 200)) {
        throw new OperationalError('ids must be an array of license certificate ids', { status: 400 });
      }
      const unique = [...new Set(ids as string[])];
      await services.repos.settings.set('license.revokedIds', JSON.stringify(unique), true);
      services.license.setRevokedIds(unique);
      res.json({ revoked: unique.length, license: services.license.info() });
    }),
  );
  return router;
}

export function createAuthRouter(services: AppServices): Router {
  const router = Router();

  // 实例初始化状态：无任何用户 → 前端首启引导 owner setup。公开。
  router.get(
    '/state',
    h(async (_req, res) => {
      res.json({ needsSetup: await services.auth.needsSetup() });
    }),
  );

  // 首访引导：无任何用户 → 前端登录页自动切「Set up owner account」（对标基线 /setup）
  router.get(
    '/needs-setup',
    h(async (_req, res) => {
      res.json({ needsSetup: (await services.repos.users.count()) === 0 });
    }),
  );

  router.post(
    '/register',
    h(async (req, res) => {
      const body = parseBody(registerSchema, req);
      const result = await services.auth.register(body);
      services.audit.log({
        userId: result.user.id,
        action: 'auth.register',
        resourceType: 'user',
        resourceId: result.user.id,
        ip: req.ip ?? null,
      });
      res.status(201).json(result);
    }),
  );

  router.post(
    '/login',
    h(async (req, res) => {
      const body = parseBody(loginSchema, req);
      const ip = req.ip ?? 'unknown';
      await services.authRateLimit.assertAllowed(body.email, ip);
      let result;
      try {
        result = await services.auth.login(body.email, body.password, body.mfaCode);
      } catch (error) {
        await services.authRateLimit.recordFailure(body.email, ip);
        throw error;
      }
      // 口令通过但需第二因素：回中间态，客户端补 mfaCode 再提交
      if ('mfaRequired' in result) {
        res.json({ mfaRequired: true });
        return;
      }
      await services.authRateLimit.clear(body.email, ip);
      services.audit.log({
        userId: result.user.id,
        action: 'auth.login',
        resourceType: 'user',
        resourceId: result.user.id,
        ip: req.ip ?? null,
      });
      res.json(result);
    }),
  );

  // 登出（#37）：拉黑当前 JWT,到期前立即失效。幂等——无/无效 token 也回 200。
  router.post(
    '/logout',
    h(async (req, res) => {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
      if (token) {
        try {
          services.auth.verify(token); // 只拉黑验签通过的真 token
          await services.auth.logout(token);
        } catch {
          // 无效/过期 token 无需拉黑
        }
      }
      res.json({ ok: true });
    }),
  );

  // 忘记密码：生成一次性重置 token。无邮件基础设施 → 链接打服务端日志（生产接 SMTP）。
  // 恒回 { ok:true }，不暴露邮箱是否存在（避免枚举）。
  router.post(
    '/forgot',
    h(async (req, res) => {
      const email = String((req.body as { email?: string })?.email ?? '').trim();
      const result = await services.auth.requestReset(email, Date.now());
      if (result) {
        const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
        const base = process.env['NOMOPS_BASE_URL'] ?? `${proto}://${req.headers.host ?? 'localhost'}`;
        const link = `${base.replace(/\/$/, '')}/login?reset=${encodeURIComponent(result.token)}`;
        // SMTP 已启用时不把一次性 token 写进日志，避免重置凭据泄露到日志聚合系统。
        if (services.mailer.enabled) console.log(`[nomops] 密码重置邮件已排队（${result.email}）`);
        else console.log(`[nomops] 密码重置链接（${result.email}）: ${link}`);
        // SMTP 已配置则真发邮件（backlog #18）;失败只记日志——响应恒 ok,不给枚举面
        void services.mailer
          .send(
            result.email,
            'Reset your nomops password',
            `You requested a password reset for your nomops account.\n\nReset link: ${link}\n\nIf you did not request this, you can safely ignore this email.`,
          )
          .then(() => {
            if (services.mailer.enabled) console.log(`[nomops] 密码重置邮件发送成功（${result.email}）`);
          })
          .catch((e: Error) => console.error('[nomops] 重置邮件发送失败:', e.message));
      }
      res.json({ ok: true });
    }),
  );

  // 用重置 token 设新口令
  router.post(
    '/reset',
    h(async (req, res) => {
      const body = (req.body ?? {}) as { token?: string; password?: string };
      await services.auth.resetPassword(String(body.token ?? ''), String(body.password ?? ''), Date.now());
      res.json({ ok: true });
    }),
  );

  // 邀请接受页预填：校验 token → 返回邮箱。公开。无效/已用 → 404。
  router.get(
    '/invite/:token',
    h(async (req, res) => {
      const info = await services.auth.lookupInvite(param(req, 'token'));
      if (!info) throw new OperationalError('Invitation is invalid or has already been used', { status: 404 });
      res.json(info);
    }),
  );

  // 接受邀请：设姓名 + 口令 → 建用户并直接登录。公开（凭 token 授权）。
  router.post(
    '/invite/:token/accept',
    h(async (req, res) => {
      const body = parseBody(acceptInviteSchema, req);
      const result = await services.auth.acceptInvite(param(req, 'token'), body);
      services.audit.log({
        userId: result.user.id,
        action: 'auth.invite.accept',
        resourceType: 'user',
        resourceId: result.user.id,
        ip: req.ip ?? null,
      });
      res.status(201).json(result);
    }),
  );

  // 门户免密登录落地（docs/11 Phase 2.5）：控制平面签的 handoff 令牌 → 实例会话。公开（自带验签）。
  router.get(
    '/handoff',
    h(async (req, res) => {
      const secret = process.env['NOMOPS_HANDOFF_SECRET'];
      const token = typeof req.query['token'] === 'string' ? req.query['token'] : '';
      const fail = (msg: string): void => {
        res.status(401).type('html').send(handoffHtml({ error: msg }));
      };
      if (!secret) return fail('This instance has not enabled passwordless login');
      const claims = verifyHandoff(secret, token, Date.now());
      if (!claims) return fail('Login token is invalid or has expired');
      // slug 绑定校验（令牌是给本实例签的）
      const mySlug = process.env['NOMOPS_TENANT_SLUG'];
      if (mySlug && claims.slug !== mySlug) return fail('Login token does not match this instance');
      const session = await services.auth.sessionForEmail(claims.email);
      if (!session) return fail('This account does not exist on this instance');
      // 令牌落 localStorage 后跳画布（handoff 令牌只在 URL，会话令牌只在 body）
      res.type('html').send(handoffHtml({ token: session.token, email: session.user.email }));
    }),
  );

  // LDAP 是否可用（登录页据此显示「LDAP 登录」入口）。公开。
  router.get(
    '/ldap/status',
    h(async (_req, res) => {
      res.json({ enabled: await services.ldap.isEnabled() });
    }),
  );

  // LDAP 登录（docs/10 B5）：公开端点，内部自查 license + enabled。
  router.post(
    '/ldap/login',
    h(async (req, res) => {
      const body = (req.body ?? {}) as { username?: string; password?: string };
      const { result } = await services.ldap.login(body.username ?? '', body.password ?? '');
      services.audit.log({
        userId: result.user.id,
        action: 'auth.ldap.login',
        resourceType: 'user',
        resourceId: result.user.id,
        ip: req.ip ?? null,
      });
      res.json(result);
    }),
  );

  return router;
}

export function createApiRouter(services: AppServices): Router {
  const router = Router();
  const editor = requireRole('project:editor');
  const workflowCreate = requireProjectScope('workflow:create');
  const workflowUpdate = requireProjectScope('workflow:update');
  const workflowDelete = requireProjectScope('workflow:delete');
  const workflowExecute = requireProjectScope('execution:execute');
  const credentialCreate = requireProjectScope('credential:create');
  const credentialUpdate = requireProjectScope('credential:update');
  const credentialDelete = requireProjectScope('credential:delete');
  const rbacFeature = requireFeature(services.license, 'rbac');
  const auditFeature = requireFeature(services.license, 'auditLogs');

  // 自定义角色按资源逐 scope 守门。内建角色沿用既有矩阵；未知路径继续由具体路由
  // 的 exact-scope/requireRole/assertOwner 守卫处理，绝不把 tier 当成隐式授权。
  router.use((req, res, next) => {
    if (!req.auth || isProjectRole(req.auth.roleName)) return next();
    const path = req.path;
    let required: (typeof PROJECT_SCOPES)[number] | null = null;
    if (path === '/workflows' && req.method === 'POST') required = 'workflow:create';
    else if (path.startsWith('/workflows')) {
      if (req.method === 'GET') required = 'workflow:read';
      else if (req.method === 'DELETE') required = 'workflow:delete';
      else if (/\/(?:run|chat|test-runs)$/.test(path) || /\/webhook-test\//.test(path)) required = 'execution:execute';
      else required = 'workflow:update';
    } else if (path.startsWith('/executions')) {
      if (req.method === 'GET') required = 'execution:read';
      else if (/\/(?:retry|stop|resume)$/.test(path)) required = 'execution:execute';
    } else if (path === '/credentials' && req.method === 'POST') required = 'credential:create';
    else if (path.startsWith('/credentials')) {
      if (req.method === 'GET') required = 'credential:read';
      else if (req.method === 'DELETE') required = 'credential:delete';
      else required = 'credential:update';
    }
    if (required && !req.auth.scopes.includes(required)) {
      res.status(403).json({ error: `Requires ${required} scope`, role: req.auth.roleName });
      return;
    }
    next();
  });

  /** 受保护(生产)实例：源码同步开了 Protected 时，工作流只读——拦编辑操作（对标基线）。 */
  const assertEditable = async (): Promise<void> => {
    if (await services.git.isProtected()) {
      throw new OperationalError(
        'This instance is protected (production environment). Workflow editing is disabled — pull changes from Git instead.',
        { status: 403 },
      );
    }
  };

  /** 绑定 services 的项目 owner 检查（实现在 route-helpers，与企业路由共用）。 */
  const assertOwnerOf = (req: Request, projectId: string) =>
    assertOwnerOfProject(services, req, projectId);

  /* ── workflows ── */
  router.get(
    '/workflows',
    h(async (req, res) => {
      // ?folderId 缺省 → 全部；'root'/'' → 项目根；其它 → 指定文件夹。?archived=true 只看归档。
      const fq = req.query['folderId'];
      const folderId = fq === undefined ? undefined : fq === 'root' || fq === '' ? null : String(fq);
      const archived = req.query['archived'] === 'true';
      res.json(await services.workflows.list(auth(req).projectId, folderId, archived, auth(req).userId));
    }),
  );

  /* 项目依赖图（卡片依赖胶囊；静态段路由须在 /workflows/:id 之前注册） */
  router.get(
    '/workflows/dependencies',
    h(async (req, res) => {
      res.json(await services.workflows.dependencies(auth(req).projectId));
    }),
  );

  /* ── 收藏 / 归档（对标基线卡片菜单 Favorite / Archive；Delete 仅对 archived 开放） ── */
  router.post(
    '/workflows/:id/favorite',
    workflowUpdate,
    h(async (req, res) => {
      const row = await services.workflows.getById(param(req, 'id'), auth(req).projectId);
      const favorite = Boolean((req.body as { favorite?: boolean })?.favorite);
      // #34：每用户收藏——写 user_favorites 而非全局列；返回带本用户 favorite 的行
      const userId = auth(req).userId;
      if (favorite) await services.repos.favorites.add(userId, 'workflow', row.id);
      else await services.repos.favorites.remove(userId, 'workflow', row.id);
      res.json({ ...row, favorite });
    }),
  );

  router.post(
    '/workflows/:id/archive',
    workflowUpdate,
    h(async (req, res) => {
      const row = await services.workflows.getById(param(req, 'id'), auth(req).projectId);
      // 归档即下线：触发器注销 + active=false（基线语义）
      if (row.active) {
        await services.activeWorkflows.remove(row.id);
        await services.repos.workflows.setActive(row.id, false);
      }
      const updated = await services.repos.workflows.setFlags(row.id, { archived: true });
      recordAudit(services, req, 'workflow.archive', { type: 'workflow', id: row.id });
      res.json(updated);
    }),
  );

  router.post(
    '/workflows/:id/unarchive',
    workflowUpdate,
    h(async (req, res) => {
      const row = await services.workflows.getById(param(req, 'id'), auth(req).projectId);
      const updated = await services.repos.workflows.setFlags(row.id, { archived: false });
      recordAudit(services, req, 'workflow.unarchive', { type: 'workflow', id: row.id });
      res.json(updated);
    }),
  );

  router.post(
    '/workflows',
    workflowCreate,
    h(async (req, res) => {
      await assertEditable();
      const body = parseBody(workflowBodySchema, req);
      const created = await services.workflows.create(body, auth(req).projectId, auth(req).userId);
      recordAudit(services, req, 'workflow.create', { type: 'workflow', id: created.id }, { name: created.name });
      res.status(201).json(created);
    }),
  );

  router.get(
    '/workflows/:id',
    h(async (req, res) => {
      const row = await services.workflows.getById(param(req, 'id'), auth(req).projectId);
      // publishedDirty：草稿是否领先已发布版本（前端画布 Publish 按钮状态）
      res.json({ ...row, publishedDirty: await services.workflows.publishedDirty(row) });
    }),
  );

  /* ── 发布（生产触发跑已发布版本；保存只改草稿） ── */
  router.post(
    '/workflows/:id/publish',
    workflowUpdate,
    h(async (req, res) => {
      await assertEditable();
      const row = await services.workflows.publish(param(req, 'id'), auth(req).projectId, auth(req).userId);
      // 激活中的工作流重发布 → 重注册触发器（webhook 路径/轮询间隔可能变了）
      await services.publicationOutbox.publish(row);
      if (row.publishedVersionId) {
        await services.repos.publishPipeline.recordPublish(row.id, row.publishedVersionId, 'publish', auth(req).userId); // #40
      }
      recordAudit(services, req, 'workflow.publish', { type: 'workflow', id: row.id });
      res.json({ id: row.id, publishedVersionId: row.publishedVersionId, publishedAt: row.publishedAt, publishedDirty: false });
    }),
  );

  router.patch(
    '/workflows/:id',
    workflowUpdate,
    h(async (req, res) => {
      await assertEditable();
      const body = parseBody(workflowPatchSchema, req);
      const { version, ...patch } = body;
      const updated = await services.workflows.update(
        param(req, 'id'),
        patch,
        auth(req).projectId,
        auth(req).userId,
        version,
      );
      recordAudit(services, req, 'workflow.update', { type: 'workflow', id: updated.id }, { name: updated.name });
      res.json(updated);
    }),
  );

  router.delete(
    '/workflows/:id',
    workflowDelete,
    h(async (req, res) => {
      await assertEditable();
      await services.workflows.delete(param(req, 'id'), auth(req).projectId);
      recordAudit(services, req, 'workflow.delete', { type: 'workflow', id: param(req, 'id') });
      res.status(204).end();
    }),
  );

  /* ── 工作流版本历史（编辑保存快照、可查看/回滚） ── */
  router.get(
    '/workflows/:id/versions',
    h(async (req, res) => {
      res.json(await services.workflows.listVersions(param(req, 'id'), auth(req).projectId));
    }),
  );

  router.get(
    '/workflows/:id/versions/:versionId',
    h(async (req, res) => {
      res.json(
        await services.workflows.getVersion(
          param(req, 'id'),
          param(req, 'versionId'),
          auth(req).projectId,
        ),
      );
    }),
  );

  router.post(
    '/workflows/:id/versions/:versionId/restore',
    workflowUpdate,
    h(async (req, res) => {
      const restored = await services.workflows.restoreVersion(
        param(req, 'id'),
        param(req, 'versionId'),
        auth(req).projectId,
        auth(req).userId,
      );
      await services.repos.publishPipeline.recordPublish(restored.id, param(req, 'versionId'), 'rollback', auth(req).userId); // #40
      recordAudit(
        services,
        req,
        'workflow.restore',
        { type: 'workflow', id: restored.id },
        { versionId: param(req, 'versionId') },
      );
      res.json(restored);
    }),
  );

  /* ── 发布史 + 逐触发器激活状态（backlog #40） ── */
  router.get(
    '/workflows/:id/publish-history',
    h(async (req, res) => {
      await services.workflows.getById(param(req, 'id'), auth(req).projectId); // 归属校验
      res.json(await services.repos.publishPipeline.listPublishHistory(param(req, 'id')));
    }),
  );
  router.get(
    '/workflows/:id/trigger-status',
    h(async (req, res) => {
      await services.workflows.getById(param(req, 'id'), auth(req).projectId); // 归属校验
      res.json(await services.repos.publishPipeline.listTriggerStatus(param(req, 'id')));
    }),
  );

  /* ── 文件夹（项目内组织工作流，支持嵌套） ── */
  router.get(
    '/folders',
    h(async (req, res) => {
      // 项目全部文件夹（前端建树/面包屑/按 parentFolderId 过滤）
      res.json(await services.repos.folders.findAllByProject(auth(req).projectId));
    }),
  );

  router.post(
    '/folders',
    editor,
    h(async (req, res) => {
      const body = parseBody(folderBodySchema, req);
      const projectId = auth(req).projectId;
      if (body.parentFolderId && !(await services.repos.folders.findById(body.parentFolderId, projectId))) {
        throw new OperationalError('Parent folder not found', { status: 404 });
      }
      const folder = await services.repos.folders.create({
        projectId,
        name: body.name,
        parentFolderId: body.parentFolderId ?? null,
      });
      recordAudit(services, req, 'folder.create', { type: 'folder', id: folder.id }, { name: folder.name });
      res.status(201).json(folder);
    }),
  );

  router.patch(
    '/folders/:id',
    editor,
    h(async (req, res) => {
      const body = parseBody(folderPatchSchema, req);
      const projectId = auth(req).projectId;
      const folder = await services.repos.folders.findById(param(req, 'id'), projectId);
      if (!folder) throw new OperationalError('Folder not found', { status: 404 });
      // 移动：新父必须在本项目，且不能是自身/后代（防环）
      if (body.parentFolderId !== undefined && body.parentFolderId !== null) {
        const target = await services.repos.folders.findById(body.parentFolderId, projectId);
        if (!target) throw new OperationalError('Target folder not found', { status: 404 });
        const all = await services.repos.folders.findAllByProject(projectId);
        const byId = new Map(all.map((f) => [f.id, f]));
        for (let cur: (typeof all)[number] | undefined = target; cur; cur = cur.parentFolderId ? byId.get(cur.parentFolderId) : undefined) {
          if (cur.id === folder.id) throw new OperationalError('Cannot move a folder into itself or its descendant', { status: 400 });
        }
      }
      await services.repos.folders.update(param(req, 'id'), {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.parentFolderId !== undefined ? { parentFolderId: body.parentFolderId } : {}),
      });
      res.json(await services.repos.folders.findById(param(req, 'id'), projectId));
    }),
  );

  router.delete(
    '/folders/:id',
    editor,
    h(async (req, res) => {
      const projectId = auth(req).projectId;
      if (!(await services.repos.folders.findById(param(req, 'id'), projectId))) {
        throw new OperationalError('Folder not found', { status: 404 });
      }
      if (await services.repos.folders.hasContents(param(req, 'id'))) {
        throw new OperationalError('Folder is not empty', { status: 400 });
      }
      await services.repos.folders.delete(param(req, 'id'));
      recordAudit(services, req, 'folder.delete', { type: 'folder', id: param(req, 'id') });
      res.status(204).end();
    }),
  );

  /* 画布/API 聊天（Chat Trigger 起点，对标基线 Chat 面板） */
  router.post(
    '/workflows/:id/chat',
    workflowExecute,
    h(async (req, res) => {
      const body = parseBody(chatBodySchema, req);
      res.json(
        await services.executions.chat(
          param(req, 'id'),
          auth(req).projectId,
          body.message,
          body.sessionId,
          body.attachments,
        ),
      );
    }),
  );

  /* ── 语音转写 STT（backlog #32）：配置(admin) + 转写(editor) ── */
  router.get(
    '/stt-config',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json(await services.stt.getPublicConfig());
    }),
  );
  router.put(
    '/stt-config',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const body = parseBody(sttConfigSchema, req);
      recordAudit(services, req, 'stt.config.update', { type: 'setting', id: 'stt.config' });
      res.json(await services.stt.setConfig(body));
    }),
  );
  router.post(
    '/chat/transcribe',
    editor,
    h(async (req, res) => {
      const body = parseBody(transcribeBodySchema, req);
      res.json(await services.stt.transcribe(body.audio, body.mimeType, body.fileName));
    }),
  );

  router.post(
    '/workflows/:id/run',
    workflowExecute,
    h(async (req, res) => {
      const body = parseBody(runBodySchema, req);
      // #46 M2：动态凭证运行上下文 = 本次 subject + 触发者 userId(user_entry 回退)
      const { subject, ...runOpts } = body;
      const summary = await services.executions.runManually(param(req, 'id'), auth(req).projectId, {
        ...runOpts,
        runContext: { ...(subject ? { subject } : {}), userId: auth(req).userId },
      });
      recordAudit(services, req, 'workflow.run', { type: 'workflow', id: param(req, 'id') }, { mode: 'manual', executionId: summary.executionId });
      res.json(summary);
    }),
  );

  /* Webhook 编辑期单次监听：注册草稿节点，不触碰生产 webhook_entities。 */
  router.post(
    '/workflows/:id/webhook-test/:nodeName',
    workflowExecute,
    h(async (req, res) => {
      const workflowId = param(req, 'id');
      const projectId = auth(req).projectId;
      const row = await services.workflows.getById(workflowId, projectId);
      const nodeName = param(req, 'nodeName');
      const node = (row.nodes as INode[]).find((candidate) => candidate.name === nodeName);
      if (!node || node.type !== 'nomops.webhook') {
        throw new OperationalError('Webhook node not found in workflow draft', { status: 404, node: nodeName });
      }
      const path = String(node.parameters['path'] ?? '').trim();
      const method = String(node.parameters['method'] ?? 'GET').toUpperCase();
      if (!path) throw new OperationalError('Webhook path is required', { status: 400, node: nodeName });
      const listener = services.webhookTests.register({ workflowId, projectId, nodeName, method, path });
      const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http').split(',')[0]!.trim();
      const origin = `${proto}://${req.headers.host ?? 'localhost'}`;
      res.json({
        listening: true,
        method,
        testUrl: `${origin}/webhook-test/${path}`,
        expiresAt: listener.expiresAt.toISOString(),
      });
    }),
  );
  router.delete(
    '/workflows/:id/webhook-test/:nodeName',
    workflowExecute,
    h(async (req, res) => {
      await services.workflows.getById(param(req, 'id'), auth(req).projectId);
      services.webhookTests.stop(param(req, 'id'), param(req, 'nodeName'), auth(req).projectId);
      res.status(204).end();
    }),
  );

  /* ── 评测/测试（backlog #31）：Evaluation Trigger + data table 逐行跑 ── */
  router.post(
    '/workflows/:id/test-runs',
    workflowExecute,
    h(async (req, res) => {
      const body = parseBody(testRunBodySchema, req);
      const run = await services.evaluations.createTestRun(param(req, 'id'), auth(req).projectId, body);
      recordAudit(services, req, 'evaluation.run', { type: 'workflow', id: param(req, 'id') }, { testRunId: run.id, cases: run.totalCases });
      res.status(201).json(run);
    }),
  );
  router.get(
    '/workflows/:id/test-runs',
    h(async (req, res) => {
      res.json(await services.evaluations.listTestRuns(param(req, 'id'), auth(req).projectId));
    }),
  );
  router.get(
    '/test-runs/:id',
    h(async (req, res) => {
      res.json(await services.evaluations.getTestRun(param(req, 'id'), auth(req).projectId));
    }),
  );
  router.delete(
    '/test-runs/:id',
    editor,
    h(async (req, res) => {
      await services.evaluations.deleteTestRun(param(req, 'id'), auth(req).projectId);
      res.status(204).end();
    }),
  );

  /* ── activate / deactivate ── */
  router.post(
    '/workflows/:id/activate',
    workflowUpdate,
    h(async (req, res) => {
      const body = parseBody(activateBodySchema, req);
      let row = await services.workflows.getById(param(req, 'id'), auth(req).projectId);
      if (body.active) {
        // 从未发布 → 激活即发布当前定义（对标基线：激活总是让「此刻的定义」上生产）
        if (!row.publishedVersionId) {
          row = await services.workflows.publish(row.id, auth(req).projectId, auth(req).userId);
          // 首次发布属于本次 activate，而不是“已激活工作流更新”。在 active=true 前
          // 投递并完成 outbox，避免稍后的 outbox 重放再产生一次 update 生命周期事件。
          await services.publicationOutbox.publish(row);
        }
        await services.activeWorkflows.add(row, 'activate'); // 失败抛 OperationalError → 400（activationError）
        await services.repos.workflows.setActive(row.id, true);
      } else {
        await services.activeWorkflows.remove(row.id);
        await services.repos.workflows.setActive(row.id, false);
        await services.repos.publishPipeline.clearTriggerStatus(row.id); // #40：下线即清逐触发器状态
      }
      recordAudit(services, req, body.active ? 'workflow.activate' : 'workflow.deactivate', {
        type: 'workflow',
        id: row.id,
      });
      res.json({ id: row.id, active: body.active });
    }),
  );

  /* 跨项目转移（backlog #13）:owner 项目专属,须是目标项目 editor+;凭证不随迁 */
  router.post(
    '/workflows/:id/transfer',
    editor,
    h(async (req, res) => {
      const body = (req.body ?? {}) as { projectId?: string };
      if (typeof body.projectId !== 'string' || !body.projectId) {
        throw new OperationalError('projectId is required', { status: 400 });
      }
      const moved = await services.workflows.transfer(param(req, 'id'), auth(req).projectId, body.projectId, auth(req).userId);
      recordAudit(services, req, 'workflow.transfer', { type: 'workflow', id: param(req, 'id') }, { to: body.projectId });
      res.json(moved);
    }),
  );

  /* 共享操作路由（GET/PUT :id/share、share-targets）在 ee/routes.ts（边界铁律:付费实现进 ee/） */

  /** Shared with you：共享**给**当前项目的资源（受享侧;凭证只出元数据,密文/明文都不出）。 */
  router.get(
    '/shared/workflows',
    h(async (req, res) => {
      res.json(await services.repos.workflows.findSharedWithProject(auth(req).projectId));
    }),
  );
  router.get(
    '/shared/credentials',
    h(async (req, res) => {
      const rows = await services.repos.credentials.findSharedWithProject(auth(req).projectId);
      res.json(rows.map((r) => ({ id: r.id, name: r.name, type: r.type, createdAt: r.createdAt, updatedAt: r.updatedAt })));
    }),
  );

  /* ── executions ── */
  router.get(
    '/executions',
    h(async (req, res) => {
      // #35：按自定义元数据键(值可选)过滤
      const metaKey = typeof req.query['metaKey'] === 'string' ? req.query['metaKey'] : undefined;
      const metaValue = typeof req.query['metaValue'] === 'string' ? req.query['metaValue'] : undefined;
      res.json(
        await services.executions.list(auth(req).projectId, metaKey ? { metaKey, ...(metaValue ? { metaValue } : {}) } : undefined),
      );
    }),
  );

  router.get(
    '/executions/:id',
    h(async (req, res) => {
      res.json(await services.executions.getById(param(req, 'id'), auth(req).projectId));
    }),
  );

  /* ── 执行标注（backlog #35）：vote👍👎 / note / tags ── */
  // 已定义的标注标签清单（标注输入框自动补全用）
  router.get(
    '/annotation-tags',
    h(async (_req, res) => {
      res.json(await services.repos.annotations.listTags());
    }),
  );
  router.get(
    '/executions/:id/annotation',
    h(async (req, res) => {
      await services.executions.getById(param(req, 'id'), auth(req).projectId); // 归属校验
      res.json(await services.repos.annotations.get(param(req, 'id')));
    }),
  );
  router.put(
    '/executions/:id/annotation',
    editor,
    h(async (req, res) => {
      await services.executions.getById(param(req, 'id'), auth(req).projectId); // 归属校验
      const id = param(req, 'id');
      const body = parseBody(executionAnnotationSchema, req);
      if (body.vote !== undefined || body.note !== undefined) {
        await services.repos.annotations.setAnnotation(id, {
          ...(body.vote !== undefined ? { vote: body.vote } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
        });
      }
      if (body.tags !== undefined) {
        // 标签名 → id（不存在则建），再全量替换映射
        const tagIds = [];
        for (const name of body.tags) tagIds.push((await services.repos.annotations.findOrCreateTag(name.trim())).id);
        await services.repos.annotations.setTags(id, tagIds);
      }
      res.json(await services.repos.annotations.get(id));
    }),
  );

  // 下载执行产物二进制：归属校验（铁律 2）+ 引用必须真实出现在该执行数据里（防任意 id 拉文件）
  router.get(
    '/executions/:id/binary/:binaryId',
    h(async (req, res) => {
      const { data } = await services.executions.getById(param(req, 'id'), auth(req).projectId);
      const binaryId = param(req, 'binaryId');
      const serialized = JSON.stringify(data ?? {});
      if (!serialized.includes(`"${binaryId}"`)) {
        throw new OperationalError('Binary data not found in this execution', { status: 404 });
      }
      const store = services.executions.getBinaryStore();
      if (!store) throw new OperationalError('Binary storage is not configured', { status: 404 });
      const buffer = await store.get(binaryId);
      // 从执行数据里找该引用的元数据（mimeType/fileName）
      const match = serialized.match(new RegExp(`\\{[^{}]*"id":"${binaryId}"[^{}]*\\}`));
      let mimeType = 'application/octet-stream';
      let fileName: string | undefined;
      if (match) {
        try {
          const meta = JSON.parse(match[0]) as { mimeType?: string; fileName?: string };
          if (meta.mimeType) mimeType = meta.mimeType;
          fileName = meta.fileName;
        } catch {
          /* 元数据解析失败用默认 */
        }
      }
      res.setHeader('content-type', mimeType);
      if (fileName) res.setHeader('content-disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
      res.end(buffer);
    }),
  );

  /* 删除执行记录（B5 对标基线 executions 表：行菜单 Delete + 多选批量） */
  router.delete(
    '/executions/:id',
    editor,
    h(async (req, res) => {
      await services.executions.delete(param(req, 'id'), auth(req).projectId);
      recordAudit(services, req, 'execution.delete', { type: 'execution', id: param(req, 'id') });
      res.status(204).end();
    }),
  );

  /* 批量删除（多选浮条）：归属外的 id 静默跳过,回报实删数 */
  router.post(
    '/executions/delete',
    editor,
    h(async (req, res) => {
      const body = (req.body ?? {}) as { ids?: string[] };
      if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.some((x) => typeof x !== 'string')) {
        throw new OperationalError('ids must be a non-empty array of strings', { status: 400 });
      }
      if (body.ids.length > 500) {
        throw new OperationalError('At most 500 executions per batch delete', { status: 400 });
      }
      const result = await services.executions.deleteMany(body.ids, auth(req).projectId);
      recordAudit(services, req, 'execution.bulk-delete', undefined, { requested: body.ids.length, ...result });
      res.json(result);
    }),
  );

  /* 重试（B5）：useOriginal=true 用执行时的定义快照，否则用当前保存的草稿 */
  router.post(
    '/executions/:id/retry',
    workflowExecute,
    h(async (req, res) => {
      const useOriginal = Boolean((req.body as { useOriginal?: boolean })?.useOriginal);
      const summary = await services.executions.retry(param(req, 'id'), auth(req).projectId, useOriginal);
      recordAudit(services, req, 'execution.retry', { type: 'execution', id: param(req, 'id') });
      res.json(summary);
    }),
  );

  // 停止执行（running/waiting/排队 → canceled；已结束 409）
  router.post(
    '/executions/:id/stop',
    workflowExecute,
    h(async (req, res) => {
      const summary = await services.executions.stop(param(req, 'id'), auth(req).projectId);
      recordAudit(services, req, 'execution.stop', { type: 'execution', id: param(req, 'id') });
      res.json(summary);
    }),
  );

  // 唤醒 waiting 执行（Wait 节点的外部信号模式；到点唤醒由 wait-tracker 负责）
  router.post(
    '/executions/:id/resume',
    workflowExecute,
    h(async (req, res) => {
      const summary = await services.executions.resume(param(req, 'id'), auth(req).projectId);
      recordAudit(services, req, 'execution.resume', { type: 'execution', id: param(req, 'id') });
      res.json(summary);
    }),
  );

  /* ── credentials ── */
  router.get(
    '/credentials',
    h(async (req, res) => {
      res.json(await services.credentials.list(auth(req).projectId));
    }),
  );

  router.post(
    '/credentials',
    credentialCreate,
    h(async (req, res) => {
      const body = parseBody(credentialBodySchema, req);
      const created = await services.credentials.create(body, auth(req).projectId);
      // details 只放名称与类型——绝不放 data（铁律 3）
      recordAudit(services, req, 'credential.create', { type: 'credential', id: created.id }, { name: created.name, credentialType: created.type });
      res.status(201).json(created);
    }),
  );

  router.post(
    '/credentials/:id/test',
    credentialUpdate, // test 会触发解密，需凭证写权限
    h(async (req, res) => {
      res.json(await services.credentials.test(param(req, 'id'), auth(req).projectId));
    }),
  );

  /* NDV 动态参数：以当前项目内凭证代查，响应只含资源 name/value/description。 */
  router.post(
    '/dynamic-node-parameters/options',
    editor,
    h(async (req, res) => {
      const body = parseBody(dynamicNodeParametersSchema, req);
      res.json(
        await services.dynamicNodeParameters.loadOptions(
          body as Parameters<typeof services.dynamicNodeParameters.loadOptions>[0],
          auth(req).projectId,
          auth(req).userId,
        ),
      );
    }),
  );

  router.post(
    '/dynamic-node-parameters/resource-locator-results',
    editor,
    h(async (req, res) => {
      const body = parseBody(dynamicNodeParametersSchema, req);
      res.json(
        await services.dynamicNodeParameters.locateResources(
          body as Parameters<typeof services.dynamicNodeParameters.locateResources>[0],
          auth(req).projectId,
          auth(req).userId,
        ),
      );
    }),
  );

  router.post(
    '/dynamic-node-parameters/resource-mapper-fields',
    editor,
    h(async (req, res) => {
      const body = parseBody(dynamicNodeParametersSchema, req);
      res.json(
        await services.dynamicNodeParameters.mapResourceFields(
          body as Parameters<typeof services.dynamicNodeParameters.mapResourceFields>[0],
          auth(req).projectId,
          auth(req).userId,
        ),
      );
    }),
  );

  /* 编辑凭证（对标基线卡片 Open）：改名 + 覆写填写的字段（留空 = 保持不变） */
  router.patch(
    '/credentials/:id',
    credentialUpdate,
    h(async (req, res) => {
      const body = parseBody(credentialPatchSchema, req);
      const view = await services.credentials.update(param(req, 'id'), auth(req).projectId, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.data !== undefined ? { data: body.data as JsonObject } : {}),
      });
      recordAudit(services, req, 'credential.update', { type: 'credential', id: view.id });
      res.json(view);
    }),
  );

  // #40b：删凭证前查引用方（前端在确认框里展示"被 N 个工作流使用"）
  router.get(
    '/credentials/:id/usage',
    h(async (req, res) => {
      const ids = await services.repos.publishPipeline.workflowsUsingCredential(param(req, 'id'));
      const workflows = [];
      for (const id of ids) {
        const wf = await services.repos.workflows.findByIdUnscoped(id).catch(() => null);
        if (wf) workflows.push({ id: wf.id, name: wf.name });
      }
      res.json({ workflows });
    }),
  );

  router.delete(
    '/credentials/:id',
    credentialDelete,
    h(async (req, res) => {
      await services.credentials.delete(param(req, 'id'), auth(req).projectId);
      recordAudit(services, req, 'credential.delete', { type: 'credential', id: param(req, 'id') });
      res.status(204).end();
    }),
  );

  // OAuth 连接状态（只回布尔，绝不回 token——铁律 3）
  router.get(
    '/credentials/:id/oauth-status',
    h(async (req, res) => {
      res.json(await services.credentials.oauthStatus(param(req, 'id'), auth(req).projectId));
    }),
  );

  /* ── 动态凭证（backlog #46 M1，license：dynamicCredentials）：resolvable 凭证按 subject 解析 ── */
  const dynFeature = requireFeature(services.license, 'dynamicCredentials');
  // 标记/解除某凭证的动态解析（挂/摘解析器）
  router.post(
    '/credentials/:id/resolver',
    editor,
    dynFeature,
    h(async (req, res) => {
      await services.credentials.assertOwnerProject(param(req, 'id'), auth(req).projectId); // 只有 owner 可改
      const { resolverId } = req.body as { resolverId?: string };
      if (!resolverId) throw new OperationalError('resolverId is required', { status: 400 });
      // 解析器必须属于本项目
      const r = await services.repos.dynamicCredentials.findResolver(resolverId, auth(req).projectId);
      if (!r) throw new OperationalError('Resolver not found', { status: 404 });
      await services.repos.credentials.setResolver(param(req, 'id'), resolverId);
      recordAudit(services, req, 'credential.resolver-set', { type: 'credential', id: param(req, 'id') });
      res.status(204).end();
    }),
  );
  router.delete(
    '/credentials/:id/resolver',
    editor,
    dynFeature,
    h(async (req, res) => {
      await services.credentials.assertOwnerProject(param(req, 'id'), auth(req).projectId);
      await services.repos.credentials.setResolver(param(req, 'id'), null);
      res.status(204).end();
    }),
  );
  // 解析器 CRUD
  router.get(
    '/dynamic-credentials/resolvers',
    dynFeature,
    h(async (req, res) => {
      res.json(await services.dynamicCredentials.listResolvers(auth(req).projectId));
    }),
  );
  router.post(
    '/dynamic-credentials/resolvers',
    editor,
    dynFeature,
    h(async (req, res) => {
      const { name, kind, config } = req.body as { name?: string; kind?: string; config?: Record<string, unknown> };
      if (!name?.trim()) throw new OperationalError('name is required', { status: 400 });
      const created = await services.dynamicCredentials.createResolver(auth(req).projectId, { name, kind, config: (config ?? {}) as JsonObject });
      recordAudit(services, req, 'dyncred.resolver-create', { type: AUDIT_RESOURCE, id: created.id }, { name: created.name, kind: created.kind });
      res.status(201).json(created);
    }),
  );
  router.delete(
    '/dynamic-credentials/resolvers/:id',
    editor,
    dynFeature,
    h(async (req, res) => {
      await services.dynamicCredentials.deleteResolver(param(req, 'id'), auth(req).projectId);
      recordAudit(services, req, 'dyncred.resolver-delete', { type: AUDIT_RESOURCE, id: param(req, 'id') });
      res.status(204).end();
    }),
  );
  // 按 subject 的凭证值（entry）：值只进不出（铁律 3）
  router.get(
    '/dynamic-credentials/resolvers/:id/subjects',
    dynFeature,
    h(async (req, res) => {
      res.json(await services.dynamicCredentials.listSubjects(param(req, 'id'), auth(req).projectId));
    }),
  );
  router.put(
    '/dynamic-credentials/resolvers/:id/entry',
    editor,
    dynFeature,
    h(async (req, res) => {
      const { subject, data } = req.body as { subject?: string; data?: Record<string, unknown> };
      if (!subject?.trim() || !data || typeof data !== 'object') throw new OperationalError('subject and data are required', { status: 400 });
      await services.dynamicCredentials.setEntry(param(req, 'id'), auth(req).projectId, subject, data as JsonObject);
      // 审计只记元数据(谁/何时/哪个 subject)——绝无值（铁律 3）
      recordAudit(services, req, 'dyncred.entry-set', { type: AUDIT_RESOURCE, id: param(req, 'id') }, { subject: subject.trim() });
      res.status(204).end();
    }),
  );
  router.delete(
    '/dynamic-credentials/resolvers/:id/entry',
    editor,
    dynFeature,
    h(async (req, res) => {
      const subject = typeof req.query['subject'] === 'string' ? req.query['subject'] : '';
      if (!subject) throw new OperationalError('subject query param is required', { status: 400 });
      await services.dynamicCredentials.deleteEntry(param(req, 'id'), auth(req).projectId, subject);
      recordAudit(services, req, 'dyncred.entry-delete', { type: AUDIT_RESOURCE, id: param(req, 'id') }, { subject });
      res.status(204).end();
    }),
  );
  // 批量导入 subject 值 + 审计流（#46 M3）
  router.post(
    '/dynamic-credentials/resolvers/:id/import',
    editor,
    dynFeature,
    h(async (req, res) => {
      const { entries } = req.body as { entries?: Record<string, Record<string, unknown>> };
      if (!entries || typeof entries !== 'object') throw new OperationalError('entries object is required', { status: 400 });
      const result = await services.dynamicCredentials.importEntries(param(req, 'id'), auth(req).projectId, entries as Record<string, JsonObject>);
      recordAudit(services, req, 'dyncred.entry-import', { type: AUDIT_RESOURCE, id: param(req, 'id') }, { count: result.imported, subjects: result.subjects });
      res.status(201).json(result);
    }),
  );
  router.get(
    '/dynamic-credentials/resolvers/:id/audit',
    dynFeature,
    h(async (req, res) => {
      res.json(await services.dynamicCredentials.listAudit(param(req, 'id'), auth(req).projectId));
    }),
  );
  // 按平台 user 的凭证值（user_entry，#46 M2）：subject 无值时回退。值只进不出（铁律 3）
  router.get(
    '/dynamic-credentials/resolvers/:id/users',
    dynFeature,
    h(async (req, res) => {
      res.json(await services.dynamicCredentials.listUserEntries(param(req, 'id'), auth(req).projectId));
    }),
  );
  router.put(
    '/dynamic-credentials/resolvers/:id/user-entry',
    editor,
    dynFeature,
    h(async (req, res) => {
      const { userId, data } = req.body as { userId?: string; data?: Record<string, unknown> };
      if (!userId?.trim() || !data || typeof data !== 'object') throw new OperationalError('userId and data are required', { status: 400 });
      await services.dynamicCredentials.setUserEntry(param(req, 'id'), auth(req).projectId, userId, data as JsonObject);
      recordAudit(services, req, 'dyncred.user-entry-set', { type: AUDIT_RESOURCE, id: param(req, 'id') }, { userId: userId.trim() });
      res.status(204).end();
    }),
  );
  router.delete(
    '/dynamic-credentials/resolvers/:id/user-entry',
    editor,
    dynFeature,
    h(async (req, res) => {
      const userId = typeof req.query['userId'] === 'string' ? req.query['userId'] : '';
      if (!userId) throw new OperationalError('userId query param is required', { status: 400 });
      await services.dynamicCredentials.deleteUserEntry(param(req, 'id'), auth(req).projectId, userId);
      recordAudit(services, req, 'dyncred.user-entry-delete', { type: AUDIT_RESOURCE, id: param(req, 'id') }, { userId });
      res.status(204).end();
    }),
  );

  /* ── 实例信任密钥链（backlog #47，instance admin + license）：联邦信任管理台 ── */
  const trustFeature = requireFeature(services.license, 'instanceTrust');
  router.get(
    '/instance-trust',
    trustFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json(await services.instanceTrust.status());
    }),
  );
  router.post(
    '/instance-trust/rotate',
    trustFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const k = await services.instanceTrust.rotateDeploymentKey();
      recordAudit(services, req, 'instance-trust.rotate', { type: 'instance-trust', id: k.kid });
      res.json({ activeKid: k.kid });
    }),
  );
  router.post(
    '/instance-trust/trusted-keys',
    trustFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const { jwk, kid, issuer, publicKeyDer } = req.body as { jwk?: never; kid?: string; issuer?: string; publicKeyDer?: string };
      const view = await services.instanceTrust.addTrustedKey({ jwk, kid, issuer, publicKeyDer });
      recordAudit(services, req, 'instance-trust.trust-key-add', { type: 'instance-trust', id: view.kid });
      res.status(201).json(view);
    }),
  );
  router.delete(
    '/instance-trust/trusted-keys/:kid',
    trustFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      await services.instanceTrust.removeTrustedKey(param(req, 'kid'));
      res.status(204).end();
    }),
  );
  router.post(
    '/instance-trust/sources',
    trustFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const body = req.body as { type?: string; name?: string; config?: Record<string, unknown>; jwksUrl?: string };
      // 兼容旧 {name, jwksUrl} 形态 → jwks 源
      const config = (body.config ?? (body.jwksUrl ? { url: body.jwksUrl } : {})) as JsonObject;
      const src = await services.instanceTrust.addSource({ type: body.type, name: body.name ?? '', config });
      recordAudit(services, req, 'instance-trust.source-add', { type: 'instance-trust', id: src.id }, { sourceType: src.type });
      res.status(201).json({ id: src.id, name: src.name, type: src.type, status: src.status });
    }),
  );
  router.post(
    '/instance-trust/sources/:id/refresh',
    trustFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json(await services.instanceTrust.refreshSource(param(req, 'id')));
    }),
  );
  router.delete(
    '/instance-trust/sources/:id',
    trustFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      await services.instanceTrust.removeSource(param(req, 'id'));
      res.status(204).end();
    }),
  );
  // 签发本实例令牌（供本实例向对端呈递交换；admin）
  router.post(
    '/instance-trust/sign',
    trustFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const { sub, aud, ttlSec } = req.body as { sub?: string; aud?: string; ttlSec?: number };
      if (!sub?.trim()) throw new OperationalError('sub is required', { status: 400 });
      res.json({ token: await services.instanceTrust.signToken({ sub, aud, ttlSec }) });
    }),
  );

  // 发起凭证 OAuth2 授权：返回提供方跳转 URL（前端开弹窗）
  router.get(
    '/oauth2/auth',
    editor,
    h(async (req, res) => {
      const id = String(req.query['id'] ?? '');
      const authUrl = await services.oauth2.buildAuthUrl(id, auth(req).projectId);
      res.json({ authUrl });
    }),
  );

  /* ── tags（工作流标签，项目维度） ── */
  router.get(
    '/tags',
    h(async (req, res) => {
      res.json(await services.repos.tags.findAllByProject(auth(req).projectId));
    }),
  );
  router.post(
    '/tags',
    editor,
    h(async (req, res) => {
      const { name } = parseBody(tagBodySchema, req);
      const existing = await services.repos.tags.findAllByProject(auth(req).projectId);
      if (existing.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
        throw new OperationalError(`A tag named "${name}" already exists`, { status: 409 });
      }
      res.status(201).json(await services.repos.tags.create(auth(req).projectId, name));
    }),
  );
  router.delete(
    '/tags/:id',
    editor,
    h(async (req, res) => {
      const tag = await services.repos.tags.findById(param(req, 'id'), auth(req).projectId);
      if (!tag) throw new OperationalError('Tag not found', { status: 404 });
      await services.repos.tags.delete(tag.id);
      res.status(204).end();
    }),
  );
  // 覆盖式设置某工作流的标签（tagIds 必须都属于本项目）
  router.put(
    '/workflows/:id/tags',
    editor,
    h(async (req, res) => {
      const { tagIds } = parseBody(workflowTagsSchema, req);
      await services.workflows.getById(param(req, 'id'), auth(req).projectId); // 归属
      for (const tagId of tagIds) {
        if (!(await services.repos.tags.findById(tagId, auth(req).projectId))) {
          throw new OperationalError('Tag not found', { tagId, status: 404 });
        }
      }
      await services.repos.tags.setWorkflowTags(param(req, 'id'), tagIds);
      res.json({ ok: true });
    }),
  );
  // 一批工作流的标签 + 运行统计（Overview 列表页一次取全）
  router.get(
    '/workflows-meta',
    h(async (req, res) => {
      const rows = await services.workflows.list(auth(req).projectId);
      const ids = rows.map((w) => w.id);
      const [tagMap, statsMap] = await Promise.all([
        services.repos.tags.tagsForWorkflows(ids),
        services.repos.tags.statisticsFor(ids),
      ]);
      res.json(
        ids.map((id) => ({
          workflowId: id,
          tags: (tagMap.get(id) ?? []).map((t) => ({ id: t.id, name: t.name })),
          statistics: statsMap.get(id) ?? null,
        })),
      );
    }),
  );

  /* ── variables（项目维度键值对，$vars.KEY） ── */
  router.get(
    '/variables',
    h(async (req, res) => {
      res.json(await services.variables.list(auth(req).projectId));
    }),
  );
  router.post(
    '/variables',
    editor,
    h(async (req, res) => {
      const created = await services.variables.create(parseBody(variableBodySchema, req), auth(req).projectId);
      recordAudit(services, req, 'variable.create', { type: 'variable', id: created.id }, { key: created.key });
      res.status(201).json(created);
    }),
  );
  router.patch(
    '/variables/:id',
    editor,
    h(async (req, res) => {
      res.json(await services.variables.update(param(req, 'id'), parseBody(variableBodySchema, req), auth(req).projectId));
    }),
  );
  router.delete(
    '/variables/:id',
    editor,
    h(async (req, res) => {
      await services.variables.delete(param(req, 'id'), auth(req).projectId);
      recordAudit(services, req, 'variable.delete', { type: 'variable', id: param(req, 'id') });
      res.status(204).end();
    }),
  );

  /* ── data tables（项目维度结构化表，跨工作流持久化） ── */
  router.get(
    '/data-tables',
    h(async (req, res) => {
      res.json(await services.dataTables.list(auth(req).projectId));
    }),
  );
  router.post(
    '/data-tables',
    editor,
    h(async (req, res) => {
      const created = await services.dataTables.create(parseBody(dataTableBodySchema, req), auth(req).projectId);
      recordAudit(services, req, 'dataTable.create', { type: 'dataTable', id: created.id }, { name: created.name });
      res.status(201).json(created);
    }),
  );
  router.get(
    '/data-tables/:id',
    h(async (req, res) => {
      res.json(await services.dataTables.get(param(req, 'id'), auth(req).projectId));
    }),
  );
  router.patch(
    '/data-tables/:id',
    editor,
    h(async (req, res) => {
      const { name } = parseBody(dataTableRenameSchema, req);
      res.json(await services.dataTables.rename(param(req, 'id'), name, auth(req).projectId));
    }),
  );
  router.delete(
    '/data-tables/:id',
    editor,
    h(async (req, res) => {
      await services.dataTables.delete(param(req, 'id'), auth(req).projectId);
      recordAudit(services, req, 'dataTable.delete', { type: 'dataTable', id: param(req, 'id') });
      res.status(204).end();
    }),
  );
  router.post(
    '/data-tables/:id/columns',
    editor,
    h(async (req, res) => {
      const column = parseBody(dataTableColumnSchema, req);
      res.status(201).json(await services.dataTables.addColumn(param(req, 'id'), column, auth(req).projectId));
    }),
  );
  router.delete(
    '/data-tables/:id/columns/:name',
    editor,
    h(async (req, res) => {
      res.json(
        await services.dataTables.deleteColumn(param(req, 'id'), param(req, 'name'), auth(req).projectId),
      );
    }),
  );
  router.get(
    '/data-tables/:id/rows',
    h(async (req, res) => {
      res.json(await services.dataTables.listRows(param(req, 'id'), auth(req).projectId));
    }),
  );
  router.post(
    '/data-tables/:id/rows',
    editor,
    h(async (req, res) => {
      const { data } = parseBody(dataTableRowSchema, req);
      res
        .status(201)
        .json(await services.dataTables.insertRow(param(req, 'id'), data as JsonObject, auth(req).projectId));
    }),
  );
  router.patch(
    '/data-tables/:id/rows/:rowId',
    editor,
    h(async (req, res) => {
      const { data } = parseBody(dataTableRowSchema, req);
      res.json(
        await services.dataTables.updateRow(
          param(req, 'id'),
          param(req, 'rowId'),
          data as JsonObject,
          auth(req).projectId,
        ),
      );
    }),
  );
  router.delete(
    '/data-tables/:id/rows/:rowId',
    editor,
    h(async (req, res) => {
      await services.dataTables.deleteRow(param(req, 'id'), param(req, 'rowId'), auth(req).projectId);
      res.status(204).end();
    }),
  );

  /* ── projects / members（docs/06） ── */
  router.get(
    '/projects',
    h(async (req, res) => {
      res.json(await services.repos.projects.findAllByUserWithRole(auth(req).userId));
    }),
  );

  /* ── Agents 平台（backlog #44 M1）：项目级 agent 定义 + 版本 + 发布/回滚 ── */
  const getAgentOr404 = async (req: Request) => {
    const agent = await services.repos.agents.findById(param(req, 'id'), auth(req).projectId);
    if (!agent) throw new OperationalError('Agent not found', { status: 404 });
    return agent;
  };
  router.get(
    '/agents',
    h(async (req, res) => {
      res.json(await services.repos.agents.findAllByProject(auth(req).projectId));
    }),
  );
  router.post(
    '/agents',
    editor,
    h(async (req, res) => {
      const body = parseBody(agentBodySchema, req);
      const agent = await services.repos.agents.create({
        projectId: auth(req).projectId,
        name: body.name,
        description: body.description,
        config: body.config as JsonObject,
      });
      recordAudit(services, req, 'agent.create', { type: 'agent', id: agent.id });
      res.status(201).json(agent);
    }),
  );
  router.get(
    '/agents/:id',
    h(async (req, res) => {
      res.json(await getAgentOr404(req));
    }),
  );
  router.patch(
    '/agents/:id',
    editor,
    h(async (req, res) => {
      await getAgentOr404(req); // 归属校验
      const body = parseBody(agentPatchSchema, req);
      res.json(await services.repos.agents.update(param(req, 'id'), body as Partial<{ name: string; description: string; config: JsonObject }>));
    }),
  );
  router.delete(
    '/agents/:id',
    editor,
    h(async (req, res) => {
      await getAgentOr404(req);
      await services.repos.agents.delete(param(req, 'id'));
      recordAudit(services, req, 'agent.delete', { type: 'agent', id: param(req, 'id') });
      res.status(204).end();
    }),
  );
  router.post(
    '/agents/:id/publish',
    editor,
    h(async (req, res) => {
      const agent = await getAgentOr404(req);
      const version = await services.repos.agents.publish(agent, auth(req).userId);
      recordAudit(services, req, 'agent.publish', { type: 'agent', id: agent.id }, { versionNumber: version.versionNumber });
      res.json({ id: agent.id, publishedVersionId: version.id, versionNumber: version.versionNumber });
    }),
  );
  router.get(
    '/agents/:id/versions',
    h(async (req, res) => {
      await getAgentOr404(req);
      res.json(await services.repos.agents.listVersions(param(req, 'id')));
    }),
  );
  router.post(
    '/agents/:id/versions/:versionId/restore',
    editor,
    h(async (req, res) => {
      await getAgentOr404(req);
      const version = await services.repos.agents.findVersion(param(req, 'id'), param(req, 'versionId'));
      if (!version) throw new OperationalError('Agent version not found', { status: 404 });
      // 回滚 = 用该版本定义覆写当前 + 再发布一版（史线保持线性，同 workflow restore）
      const updated = await services.repos.agents.update(param(req, 'id'), { name: version.name, config: version.config });
      const newVersion = await services.repos.agents.publish(updated, auth(req).userId);
      recordAudit(services, req, 'agent.restore', { type: 'agent', id: updated.id }, { restoredFrom: version.versionNumber });
      res.json({ id: updated.id, publishedVersionId: newVersion.id, versionNumber: newVersion.versionNumber });
    }),
  );

  /* ── Agent 线程化执行 + 成本核算（backlog #44 M2） ── */
  router.post(
    '/agents/:id/chat',
    editor,
    h(async (req, res) => {
      const body = (req.body ?? {}) as { message?: unknown; threadId?: unknown };
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message) throw new OperationalError('message is required', { status: 400 });
      const threadId = typeof body.threadId === 'string' ? body.threadId : undefined;
      res.json(await services.agentRuns.chat(param(req, 'id'), auth(req).projectId, message, threadId, auth(req).userId));
    }),
  );
  router.get(
    '/agents/:id/threads',
    h(async (req, res) => {
      await getAgentOr404(req);
      res.json(await services.repos.agents.listThreads(param(req, 'id')));
    }),
  );
  router.get(
    '/agents/:id/threads/:threadId',
    h(async (req, res) => {
      await getAgentOr404(req);
      const thread = await services.repos.agents.findThread(param(req, 'threadId'), param(req, 'id'));
      if (!thread) throw new OperationalError('Thread not found', { status: 404 });
      res.json({
        thread,
        runs: await services.repos.agents.listRuns(thread.id),
        messages: await services.repos.agents.listMessages(thread.id),
      });
    }),
  );
  // 分层记忆 + 证据链（backlog #44 M3）：每条记忆可追溯到来源运行。
  router.get(
    '/agents/:id/memory',
    h(async (req, res) => {
      await getAgentOr404(req);
      res.json(await services.repos.agents.listMemoriesWithObservations(param(req, 'id')));
    }),
  );
  // 定时任务（backlog #44 M4）：任务定义 ↔ #38 调度作业,双实例只触发一次靠租约。
  router.get(
    '/agents/:id/tasks',
    h(async (req, res) => {
      await getAgentOr404(req);
      res.json(await services.repos.agents.listTasks(param(req, 'id')));
    }),
  );
  router.post(
    '/agents/:id/tasks',
    h(async (req, res) => {
      await getAgentOr404(req);
      const { name, message, schedule, timezone } = req.body as {
        name?: string; message?: string; schedule?: Record<string, unknown>; timezone?: string;
      };
      if (!name?.trim() || !message?.trim() || !schedule) {
        throw new OperationalError('name, message and schedule are required', { status: 400 });
      }
      res.status(201).json(await services.agentRuns.createTask(param(req, 'id'), auth(req).projectId, { name, message, schedule, timezone }));
    }),
  );
  router.patch(
    '/agents/:id/tasks/:taskId',
    h(async (req, res) => {
      await getAgentOr404(req);
      res.json(await services.agentRuns.updateTaskDef(param(req, 'id'), param(req, 'taskId'), req.body as Record<string, never>));
    }),
  );
  router.delete(
    '/agents/:id/tasks/:taskId',
    h(async (req, res) => {
      await getAgentOr404(req);
      await services.agentRuns.deleteTaskDef(param(req, 'id'), param(req, 'taskId'));
      res.status(204).end();
    }),
  );
  // 文件（backlog #44 M5）：binaryId 复用 #32 binaryStore,上传走 base64（15mb json 上限内）。
  router.get(
    '/agents/:id/files',
    h(async (req, res) => {
      await getAgentOr404(req);
      const files = await services.repos.agents.listFiles(param(req, 'id'));
      res.json(files.map(({ binaryId: _b, ...rest }) => rest)); // binaryId 是内部存储引用,不出 API
    }),
  );
  router.post(
    '/agents/:id/files',
    h(async (req, res) => {
      await getAgentOr404(req);
      const { fileName, mimeType, data } = req.body as { fileName?: string; mimeType?: string; data?: string };
      if (!fileName?.trim() || !data) throw new OperationalError('fileName and data (base64) are required', { status: 400 });
      const store = services.executions.getBinaryStore();
      if (!store) throw new OperationalError('Binary storage is not configured', { status: 404 });
      const buffer = Buffer.from(data, 'base64');
      const ref = await store.put(buffer, { mimeType: mimeType ?? 'application/octet-stream', fileName });
      const file = await services.repos.agents.addFile({
        agentId: param(req, 'id'),
        binaryId: ref.id!,
        fileName,
        mimeType: mimeType ?? 'application/octet-stream',
        size: buffer.length,
      });
      const { binaryId: _b, ...rest } = file;
      res.status(201).json(rest);
    }),
  );
  router.get(
    '/agents/:id/files/:fileId/download',
    h(async (req, res) => {
      await getAgentOr404(req);
      const file = await services.repos.agents.findFile(param(req, 'fileId'), param(req, 'id'));
      if (!file) throw new OperationalError('File not found', { status: 404 });
      const store = services.executions.getBinaryStore();
      if (!store) throw new OperationalError('Binary storage is not configured', { status: 404 });
      res.setHeader('content-type', file.mimeType);
      res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`);
      res.send(await store.get(file.binaryId));
    }),
  );
  router.delete(
    '/agents/:id/files/:fileId',
    h(async (req, res) => {
      await getAgentOr404(req);
      const file = await services.repos.agents.findFile(param(req, 'fileId'), param(req, 'id'));
      if (!file) throw new OperationalError('File not found', { status: 404 });
      const store = services.executions.getBinaryStore();
      await store?.delete?.(file.binaryId).catch(() => undefined); // 存储清理尽力而为
      await services.repos.agents.deleteFile(file.id);
      res.status(204).end();
    }),
  );
  // 外部渠道（backlog #44 M5）：Telegram bot webhook → agent 线程 → 回复回渠道。
  router.get(
    '/agents/:id/channels',
    h(async (req, res) => {
      await getAgentOr404(req);
      res.json(await services.agentChannels.list(param(req, 'id')));
    }),
  );
  router.post(
    '/agents/:id/channels',
    h(async (req, res) => {
      await getAgentOr404(req);
      const { type, credentialId } = req.body as { type?: string; credentialId?: string };
      if (!type || !credentialId) throw new OperationalError('type and credentialId are required', { status: 400 });
      res.status(201).json(await services.agentChannels.create(param(req, 'id'), auth(req).projectId, { type, credentialId }));
    }),
  );
  router.patch(
    '/agents/:id/channels/:channelId',
    h(async (req, res) => {
      await getAgentOr404(req);
      const { active } = req.body as { active?: boolean };
      res.json(await services.agentChannels.setActive(param(req, 'id'), param(req, 'channelId'), active !== false));
    }),
  );
  router.delete(
    '/agents/:id/channels/:channelId',
    h(async (req, res) => {
      await getAgentOr404(req);
      await services.agentChannels.remove(param(req, 'id'), param(req, 'channelId'));
      res.status(204).end();
    }),
  );

  /* ── SSO 角色映射规则（backlog #42，实例 admin）：SSO 声明/LDAP group → 项目角色 ── */
  router.get(
    '/role-mappings',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json(await services.repos.roleMappings.list());
    }),
  );
  router.post(
    '/role-mappings',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const body = parseBody(roleMappingSchema, req);
      const { projectIds, ...rule } = body;
      recordAudit(services, req, 'role-mapping.create', { type: 'setting', id: 'role-mapping' });
      res.status(201).json(await services.repos.roleMappings.create(rule, projectIds));
    }),
  );
  router.delete(
    '/role-mappings/:id',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      await services.repos.roleMappings.delete(param(req, 'id'));
      recordAudit(services, req, 'role-mapping.delete', { type: 'setting', id: param(req, 'id') });
      res.status(204).end();
    }),
  );

  /* ── 自定义角色（backlog #29，企业功能 rbac + 实例 admin） ── */
  router.get(
    '/custom-roles',
    rbacFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json({ scopes: PROJECT_SCOPES, roles: await services.repos.customRoles.list() });
    }),
  );
  router.post(
    '/custom-roles',
    rbacFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const body = (req.body ?? {}) as { name?: string; description?: string; scopes?: string[] };
      const name = String(body.name ?? '').trim();
      if (!name || !/^[a-zA-Z0-9 _-]{1,50}$/.test(name)) {
        throw new OperationalError('name must be 1-50 chars (letters, digits, space, _-)', { status: 400 });
      }
      if (isProjectRole(`project:${name}`) || ['owner', 'editor', 'viewer'].includes(name.toLowerCase())) {
        throw new OperationalError('name collides with a built-in role', { status: 400 });
      }
      const scopes = (Array.isArray(body.scopes) ? body.scopes : []).filter((s) => (PROJECT_SCOPES as readonly string[]).includes(s));
      if (!scopes.length) throw new OperationalError('at least one scope is required', { status: 400 });
      if (await services.repos.customRoles.list().then((rs) => rs.some((r) => r.name === name))) {
        throw new OperationalError('A role with this name already exists', { status: 409 });
      }
      const role = await services.repos.customRoles.create({ name, description: body.description ?? '', scopes });
      recordAudit(services, req, 'customRole.create', { type: 'customRole', id: role.id }, { name, scopes });
      res.status(201).json(role);
    }),
  );
  router.patch(
    '/custom-roles/:id',
    rbacFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const body = (req.body ?? {}) as { description?: string; scopes?: string[] };
      const scopes = body.scopes
        ? body.scopes.filter((s) => (PROJECT_SCOPES as readonly string[]).includes(s))
        : undefined;
      if (scopes && !scopes.length) throw new OperationalError('at least one scope is required', { status: 400 });
      const role = await services.repos.customRoles.update(param(req, 'id'), {
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(scopes ? { scopes } : {}),
      });
      if (!role) throw new OperationalError('Custom role not found', { status: 404 });
      recordAudit(services, req, 'customRole.update', { type: 'customRole', id: role.id });
      res.json(role);
    }),
  );
  router.delete(
    '/custom-roles/:id',
    rbacFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const role = await services.repos.customRoles.findById(param(req, 'id'));
      if (!role) throw new OperationalError('Custom role not found', { status: 404 });
      await services.repos.customRoles.delete(role.id);
      recordAudit(services, req, 'customRole.delete', { type: 'customRole', id: role.id }, { name: role.name });
      res.status(204).end();
    }),
  );

  router.post(
    '/projects',
    rbacFeature,
    h(async (req, res) => {
      const body = parseBody(createProjectSchema, req);
      // 团队项目配额：只数 team，personal project 是每人注册自带的，不占额度
      services.license.assertQuota('teamProjects', await services.repos.projects.countByType('team'));
      const project = await services.repos.projects.create({ name: body.name, type: 'team' });
      await services.repos.projects.addMember(project.id, auth(req).userId, 'project:owner');
      recordAudit(services, req, 'project.create', { type: 'project', id: project.id }, { name: project.name }, project.id);
      res.status(201).json(project);
    }),
  );

  router.get(
    '/projects/:id/members',
    rbacFeature,
    h(async (req, res) => {
      await assertOwnerOf(req, param(req, 'id'));
      res.json(await services.repos.projects.findMembers(param(req, 'id')));
    }),
  );

  router.post(
    '/projects/:id/members',
    rbacFeature,
    h(async (req, res) => {
      const projectId = param(req, 'id');
      await assertOwnerOf(req, projectId);
      const body = parseBody(addMemberSchema, req);
      await assertAssignableRole(body.role);
      const user = await services.repos.users.findByEmail(body.email);
      if (!user) throw new OperationalError('User not found', { status: 404, email: body.email });
      if (await services.repos.projects.findMemberRole(projectId, user.id)) {
        throw new OperationalError('This user is already a project member', { status: 400 });
      }
      await services.repos.projects.addMember(projectId, user.id, body.role);
      recordAudit(services, req, 'project.member.add', { type: 'project', id: projectId }, { memberId: user.id, role: body.role }, projectId);
      res.status(201).json({ userId: user.id, email: user.email, role: body.role });
    }),
  );

  /** 角色可指派性：内建角色或已存在的自定义角色（#29）。 */
  async function assertAssignableRole(role: string): Promise<void> {
    if (isProjectRole(role)) return;
    const custom = await services.repos.customRoles.list();
    if (!custom.some((r) => r.name === role)) {
      throw new OperationalError('Unknown role', { status: 400, role });
    }
  }

  /** 最后一个 owner 不可降级/移除（否则项目无人可管）。 */
  async function assertNotLastOwner(projectId: string, targetUserId: string): Promise<void> {
    const members = await services.repos.projects.findMembers(projectId);
    const owners = members.filter((m) => m.role === 'project:owner');
    if (owners.length === 1 && owners[0]!.userId === targetUserId) {
      throw new OperationalError('Cannot remove or demote the last owner of the project', { status: 400 });
    }
  }

  router.patch(
    '/projects/:id/members/:userId',
    rbacFeature,
    h(async (req, res) => {
      const projectId = param(req, 'id');
      await assertOwnerOf(req, projectId);
      const body = parseBody(patchMemberSchema, req);
      const targetId = param(req, 'userId');
      await assertAssignableRole(body.role);
      // 降级到非 owner 有效层级时,保护最后一个 owner
      const newTier = isProjectRole(body.role)
        ? body.role
        : tierForScopes((await services.repos.customRoles.scopesForName(body.role)) ?? []);
      if (newTier !== 'project:owner') await assertNotLastOwner(projectId, targetId);
      await services.repos.projects.updateMemberRole(projectId, targetId, body.role);
      recordAudit(services, req, 'project.member.update', { type: 'project', id: projectId }, { memberId: targetId, role: body.role }, projectId);
      res.json({ userId: targetId, role: body.role });
    }),
  );

  router.delete(
    '/projects/:id/members/:userId',
    rbacFeature,
    h(async (req, res) => {
      const projectId = param(req, 'id');
      await assertOwnerOf(req, projectId);
      const targetId = param(req, 'userId');
      await assertNotLastOwner(projectId, targetId);
      await services.repos.projects.removeMember(projectId, targetId);
      recordAudit(services, req, 'project.member.remove', { type: 'project', id: projectId }, { memberId: targetId }, projectId);
      res.status(204).end();
    }),
  );

  /* ── quota / usage（docs/08） ── */
  router.get(
    '/projects/:id/usage',
    h(async (req, res) => {
      await assertOwnerOf(req, param(req, 'id'));
      res.json(await services.quota.usage(param(req, 'id')));
    }),
  );

  router.put(
    '/projects/:id/quota',
    requireFeature(services.license, 'quotas'),
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const body = parseBody(quotaBodySchema, req);
      const projectId = param(req, 'id');
      const project = await services.repos.projects.findById(projectId);
      if (!project) throw new OperationalError('Project not found', { status: 404 });
      await services.repos.quotas.upsertQuota(
        projectId,
        body.plan,
        body.plan === 'custom' ? (body.monthlyExecutions ?? null) : null,
      );
      recordAudit(services, req, 'quota.update', { type: 'project', id: projectId }, { plan: body.plan, monthlyExecutions: body.monthlyExecutions ?? null }, projectId);
      res.json(await services.quota.usage(projectId));
    }),
  );

  /* ── billing checkout（支付宝，docs/08） ── */
  router.post(
    '/billing/checkout',
    requireRole('project:owner'),
    h(async (req, res) => {
      const body = (req.body ?? {}) as { plan?: string; months?: number };
      const result = await services.billing.createCheckout(
        auth(req).projectId,
        body.plan ?? 'pro',
        body.months ?? 1,
      );
      recordAudit(services, req, 'billing.checkout.create', { type: 'project', id: auth(req).projectId }, { plan: body.plan ?? 'pro', months: body.months ?? 1 });
      res.status(201).json(result);
    }),
  );

  /** 绑定 services 的实例管理员检查（实现在 route-helpers，与企业路由共用）。 */
  const assertInstanceAdmin = (req: Request) => assertInstanceAdminOf(services, req);

  // ★企业路由集中注册（C1）：实现在 ee/routes.ts，社区侧只留这一个入口
  registerEeRoutes(router, services);

  /* ── insights（#39：读 insights_raw 而非 executions——清理执行历史后数字不变；
     ?scope=all 跨项目聚合，实例 admin 可读） ── */
  router.get(
    '/insights',
    h(async (req, res) => {
      const parse = (v: unknown): Date | null => {
        if (typeof v !== 'string' || !v) return null;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
      };
      const now = new Date();
      const from = parse(req.query['from']);
      const to = parse(req.query['to']);
      const range = from && to && from.getTime() <= to.getTime() ? { from, to } : { from: new Date(now.getTime() - 6 * 86_400_000), to: now };

      const crossProject = req.query['scope'] === 'all';
      if (crossProject) await assertInstanceAdmin(req);
      // #39b：summary 合并 by_period(旧,已卷积) + raw(近期,未卷积)
      res.json(await services.insights.summary(range.from, range.to, crossProject ? undefined : auth(req).projectId));
    }),
  );

  /* Chat provider 注册表 + 各家已存配置（Chat 页与 Settings 数据源；不含任何密钥） */
  const providerConfig = async (
    id: string,
  ): Promise<{
    enabled: boolean;
    credentialId: string | null;
    contextWindow: number;
    /** 基线 Configure 弹窗的 Limit models:空数组 = 不限(All models)。 */
    allowedModels: string[];
    lastEditedAt: string | null;
  }> => {
    const raw = await services.repos.settings.get(`chat.provider.${id}`);
    const parsed = raw
      ? (JSON.parse(raw) as {
          enabled?: boolean;
          credentialId?: string | null;
          contextWindow?: number;
          allowedModels?: string[];
          lastEditedAt?: string;
        })
      : {};
    return {
      enabled: parsed.enabled !== false,
      credentialId: parsed.credentialId ?? null,
      contextWindow: parsed.contextWindow ?? 20,
      allowedModels: Array.isArray(parsed.allowedModels) ? parsed.allowedModels : [],
      lastEditedAt: parsed.lastEditedAt ?? null,
    };
  };

  router.get(
    '/assistant/providers',
    h(async (_req, res) => {
      res.json(
        await Promise.all(
          CHAT_PROVIDERS.map(async (p) => ({
            id: p.id,
            label: p.label,
            credentialType: p.credentialType,
            models: p.models,
            ...(await providerConfig(p.id)),
          })),
        ),
      );
    }),
  );

  /* Configure provider（Settings → Chat 弹窗；对标基线：Enable / Default credential / Context window） */
  router.patch(
    '/assistant/providers/:id',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const id = param(req, 'id');
      const provider = CHAT_PROVIDERS.find((p) => p.id === id);
      if (!provider) throw new OperationalError('Unknown provider', { status: 404 });
      const body = (req.body ?? {}) as {
        enabled?: boolean;
        credentialId?: string | null;
        contextWindow?: number;
        allowedModels?: string[];
      };
      const current = await providerConfig(id);
      // 凭证归属 + 类型校验（防把别家凭证配给它）
      let credentialId = body.credentialId !== undefined ? body.credentialId : current.credentialId;
      if (credentialId) {
        const cred = await services.repos.credentials.findById(credentialId, auth(req).projectId);
        if (!cred || cred.type !== provider.credentialType) {
          throw new OperationalError(`Credential must be of type ${provider.credentialType}`, { status: 400 });
        }
      }
      const next = {
        enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
        credentialId: credentialId ?? null,
        contextWindow:
          typeof body.contextWindow === 'number' && body.contextWindow >= 1 && body.contextWindow <= 100
            ? Math.round(body.contextWindow)
            : current.contextWindow,
        // Limit models:只收本家注册表内的模型名,空数组 = All models
        allowedModels: Array.isArray(body.allowedModels)
          ? body.allowedModels.filter((m) => provider.models.includes(m))
          : current.allowedModels,
        lastEditedAt: new Date().toISOString(),
      };
      await services.repos.settings.set(`chat.provider.${id}`, JSON.stringify(next));
      recordAudit(services, req, 'chat.provider-update', { type: 'chat-provider', id });
      res.json({ id, label: provider.label, credentialType: provider.credentialType, models: provider.models, ...next });
    }),
  );

  /* ── AI 助手（docs/10 B2；Settings → Chat 可整体关停） ── */
  router.post(
    '/assistant/chat',
    h(async (req, res) => {
      if ((await services.repos.settings.get('chat.enabled')) === 'false') {
        throw new OperationalError('Chat is disabled on this instance', { status: 403 });
      }
      const body = (req.body ?? {}) as {
        messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
        credentialId?: string;
        /** Personal agents（Chat 页）：自定义 system prompt。 */
        system?: string;
        /** Chat 页 Select model：会话级模型（Anthropic 系）。 */
        model?: string;
      };
      if (!Array.isArray(body.messages)) {
        throw new OperationalError('messages is required', { status: 400 });
      }
      const system = typeof body.system === 'string' ? body.system.slice(0, 4000) : undefined;
      const model =
        typeof body.model === 'string' && /^[a-zA-Z0-9][\w.-]{1,63}$/.test(body.model) ? body.model : undefined;
      const result = await services.assistant.chat(auth(req).projectId, body.messages, body.credentialId, system, model);
      res.json(result);
    }),
  );

  router.post(
    '/assistant/transform-code',
    h(async (req, res) => {
      if ((await services.repos.settings.get('chat.enabled')) === 'false') {
        throw new OperationalError('Chat is disabled on this instance', { status: 403 });
      }
      const body = parseBody(aiTransformCodeSchema, req);
      const result = await services.assistant.generateTransformCode(
        auth(req).projectId,
        body.instructions,
        body.inputSchema,
        body.credentialId,
        body.model,
      );
      recordAudit(
        services,
        req,
        'ai.transform-code.generate',
        { type: 'node-type', id: 'nomops.aiTransform' },
        { fieldCount: body.inputSchema.length },
      );
      res.json(result);
    }),
  );

  /* ── AI 建流会话（backlog #45 M1）：多轮迭代临时草稿 → 预览 → 回退 → Apply 落正式流 ── */
  router.get(
    '/builder/sessions',
    h(async (req, res) => {
      res.json(await services.workflowBuilder.listSessions(auth(req).projectId));
    }),
  );
  router.post(
    '/builder/sessions',
    h(async (req, res) => {
      const { goal } = req.body as { goal?: string };
      if (!goal?.trim()) throw new OperationalError('goal is required', { status: 400 });
      res.status(201).json(await services.workflowBuilder.createSession(auth(req).userId, auth(req).projectId, goal));
    }),
  );
  router.get(
    '/builder/sessions/:id',
    h(async (req, res) => {
      res.json(await services.workflowBuilder.getSession(param(req, 'id'), auth(req).projectId));
    }),
  );
  router.post(
    '/builder/sessions/:id/chat',
    h(async (req, res) => {
      if ((await services.repos.settings.get('chat.enabled')) === 'false') {
        throw new OperationalError('Chat is disabled on this instance', { status: 403 });
      }
      const { message, credentialId, model } = req.body as { message?: string; credentialId?: string; model?: string };
      if (!message?.trim()) throw new OperationalError('message is required', { status: 400 });
      const safeModel = typeof model === 'string' && /^[a-zA-Z0-9][\w.-]{1,63}$/.test(model) ? model : undefined;
      res.json(await services.workflowBuilder.chat(param(req, 'id'), auth(req).projectId, message, credentialId, safeModel));
    }),
  );
  router.get(
    '/builder/sessions/:id/revisions/:revisionId',
    h(async (req, res) => {
      const rev = await services.workflowBuilder.getRevision(param(req, 'id'), auth(req).projectId, param(req, 'revisionId'));
      res.json(rev); // 含 nodes/connections,供 ReadOnlyCanvas 预览
    }),
  );
  router.post(
    '/builder/sessions/:id/rollback',
    h(async (req, res) => {
      const { revisionId } = req.body as { revisionId?: string };
      if (!revisionId) throw new OperationalError('revisionId is required', { status: 400 });
      res.json(await services.workflowBuilder.rollback(param(req, 'id'), auth(req).projectId, revisionId));
    }),
  );
  router.post(
    '/builder/sessions/:id/apply',
    h(async (req, res) => {
      const { revisionId } = req.body as { revisionId?: string };
      res.status(201).json(await services.workflowBuilder.apply(param(req, 'id'), auth(req).projectId, auth(req).userId, revisionId));
    }),
  );
  router.delete(
    '/builder/sessions/:id',
    h(async (req, res) => {
      await services.workflowBuilder.discard(param(req, 'id'), auth(req).projectId);
      res.status(204).end();
    }),
  );

  /* ── 有检查点的 AI 线程（backlog #45 M2）：可序列化状态检查点 + 回滚续跑 ── */
  router.get(
    '/instance-ai/threads',
    h(async (req, res) => {
      res.json(await services.instanceAi.listThreads(auth(req).userId));
    }),
  );
  router.post(
    '/instance-ai/threads',
    h(async (req, res) => {
      const { kind, title } = req.body as { kind?: string; title?: string };
      res.status(201).json(await services.instanceAi.createThread(auth(req).userId, { kind, title }));
    }),
  );
  router.get(
    '/instance-ai/threads/:id',
    h(async (req, res) => {
      res.json(await services.instanceAi.getThread(param(req, 'id'), auth(req).userId));
    }),
  );
  router.delete(
    '/instance-ai/threads/:id',
    h(async (req, res) => {
      await services.instanceAi.deleteThread(param(req, 'id'), auth(req).userId);
      res.status(204).end();
    }),
  );
  router.post(
    '/instance-ai/threads/:id/messages',
    h(async (req, res) => {
      const { role, content } = req.body as { role?: string; content?: Record<string, unknown> };
      if (!role || !content) throw new OperationalError('role and content are required', { status: 400 });
      res.status(201).json(await services.instanceAi.append(param(req, 'id'), auth(req).userId, role, content as JsonObject));
    }),
  );
  router.put(
    '/instance-ai/threads/:id/state',
    h(async (req, res) => {
      const { state } = req.body as { state?: Record<string, unknown> };
      if (state === undefined || state === null || typeof state !== 'object') throw new OperationalError('state object is required', { status: 400 });
      res.json(await services.instanceAi.setState(param(req, 'id'), auth(req).userId, state as JsonObject));
    }),
  );
  router.post(
    '/instance-ai/threads/:id/checkpoints',
    h(async (req, res) => {
      const { label } = req.body as { label?: string };
      res.status(201).json(await services.instanceAi.checkpoint(param(req, 'id'), auth(req).userId, label ?? ''));
    }),
  );
  router.post(
    '/instance-ai/threads/:id/restore',
    h(async (req, res) => {
      const { checkpointId } = req.body as { checkpointId?: string };
      if (!checkpointId) throw new OperationalError('checkpointId is required', { status: 400 });
      res.json(await services.instanceAi.restore(param(req, 'id'), auth(req).userId, checkpointId));
    }),
  );
  router.post(
    '/instance-ai/threads/:id/chat',
    h(async (req, res) => {
      if ((await services.repos.settings.get('chat.enabled')) === 'false') {
        throw new OperationalError('Chat is disabled on this instance', { status: 403 });
      }
      const { message, model, credentialId } = req.body as { message?: string; model?: string; credentialId?: string };
      if (!message?.trim()) throw new OperationalError('message is required', { status: 400 });
      const safeModel = typeof model === 'string' && /^[a-zA-Z0-9][\w.-]{1,63}$/.test(model) ? model : undefined;
      res.json(await services.instanceAi.chat(param(req, 'id'), auth(req).userId, auth(req).projectId, message, safeModel, credentialId));
    }),
  );
  // HITL 待确认（backlog #45 M3）：危险动作先挂 pending,人确认后才执行。
  router.get(
    '/instance-ai/threads/:id/actions',
    h(async (req, res) => {
      res.json(await services.instanceAi.listActions(param(req, 'id'), auth(req).userId));
    }),
  );
  router.post(
    '/instance-ai/threads/:id/actions',
    h(async (req, res) => {
      const { tool, args } = req.body as { tool?: string; args?: Record<string, unknown> };
      if (!tool?.trim()) throw new OperationalError('tool is required', { status: 400 });
      res.json(await services.instanceAi.proposeAction(param(req, 'id'), auth(req).userId, auth(req).projectId, tool, (args ?? {}) as JsonObject));
    }),
  );
  router.post(
    '/instance-ai/actions/:actionId/approve',
    h(async (req, res) => {
      res.json(await services.instanceAi.approveAction(param(req, 'actionId'), auth(req).userId, auth(req).projectId));
    }),
  );
  router.post(
    '/instance-ai/actions/:actionId/reject',
    h(async (req, res) => {
      res.json(await services.instanceAi.rejectAction(param(req, 'actionId'), auth(req).userId));
    }),
  );
  // 运行树 + 观察-反思记忆（backlog #45 M4）
  router.get(
    '/instance-ai/threads/:id/runs',
    h(async (req, res) => {
      res.json(await services.instanceAi.listRuns(param(req, 'id'), auth(req).userId));
    }),
  );
  router.post(
    '/instance-ai/threads/:id/memory',
    h(async (req, res) => {
      const { scope, kind, content } = req.body as { scope?: string; kind?: string; content?: string };
      if (!content?.trim()) throw new OperationalError('content is required', { status: 400 });
      const m = await services.instanceAi.remember(param(req, 'id'), auth(req).userId, { scope, kind, content });
      const { embedding: _e, ...rest } = m; // embedding 是内部检索向量,不出 API
      res.status(201).json(rest);
    }),
  );
  router.get(
    '/instance-ai/recall',
    h(async (req, res) => {
      const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
      if (!q.trim()) throw new OperationalError('q is required', { status: 400 });
      const threadId = typeof req.query['threadId'] === 'string' ? req.query['threadId'] : null;
      const mems = await services.instanceAi.recall(auth(req).userId, q, threadId);
      res.json(mems.map(({ embedding: _e, ...rest }) => rest));
    }),
  );
  // MCP 连接（backlog #45 M5）：挂 MCP server → 其工具进工具集,经 HITL gate 执行。
  router.get(
    '/instance-ai/mcp/connections',
    h(async (req, res) => {
      res.json(await services.instanceAi.listMcpConnections(auth(req).userId));
    }),
  );
  router.get(
    '/instance-ai/mcp/registry',
    h(async (req, res) => {
      res.json(await services.instanceAi.mcpRegistryCandidates());
    }),
  );
  router.post(
    '/instance-ai/threads/:id/mcp/connect',
    h(async (req, res) => {
      const { serverName, url, config } = req.body as { serverName?: string; url?: string; config?: Record<string, unknown> };
      if (!url?.trim()) throw new OperationalError('url is required', { status: 400 });
      res.status(201).json(await services.instanceAi.connectMcp(auth(req).userId, param(req, 'id'), { serverName: serverName ?? '', url, config: (config ?? {}) as JsonObject }));
    }),
  );
  router.delete(
    '/instance-ai/mcp/connections/:connId',
    h(async (req, res) => {
      await services.instanceAi.disconnectMcp(param(req, 'connId'), auth(req).userId);
      res.status(204).end();
    }),
  );

  /* ── Chat 会话/个人 Agent 持久化（backlog #14,用户维度;原 localStorage 落库） ── */
  router.get(
    '/chat/sessions',
    h(async (req, res) => {
      res.json(await services.repos.chat.listSessions(auth(req).userId));
    }),
  );
  router.put(
    '/chat/sessions/:id',
    h(async (req, res) => {
      const body = parseBody(chatSessionUpsertSchema, req);
      const id = param(req, 'id');
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new OperationalError('Invalid session id', { status: 400 });
      const row = await services.repos.chat.upsertSession(auth(req).userId, {
        id,
        title: body.title,
        target: (body.target ?? null) as JsonObject | null,
        wfSessionId: body.wfSessionId ?? null,
        messages: body.messages as JsonObject[],
      });
      if (!row) throw new OperationalError('Session belongs to another user', { status: 403 });
      res.json(row);
    }),
  );
  router.delete(
    '/chat/sessions/:id',
    h(async (req, res) => {
      await services.repos.chat.deleteSession(auth(req).userId, param(req, 'id'));
      res.status(204).end();
    }),
  );
  router.get(
    '/chat/agents',
    h(async (req, res) => {
      res.json(await services.repos.chat.listAgents(auth(req).userId));
    }),
  );
  router.put(
    '/chat/agents/:id',
    h(async (req, res) => {
      const body = parseBody(chatAgentUpsertSchema, req);
      const id = param(req, 'id');
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new OperationalError('Invalid agent id', { status: 400 });
      const row = await services.repos.chat.upsertAgent(auth(req).userId, { id, name: body.name, system: body.system });
      if (!row) throw new OperationalError('Agent belongs to another user', { status: 403 });
      res.json(row);
    }),
  );
  router.delete(
    '/chat/agents/:id',
    h(async (req, res) => {
      await services.repos.chat.deleteAgent(auth(req).userId, param(req, 'id'));
      res.status(204).end();
    }),
  );

  /* ── OpenTelemetry 配置（#27，实例 admin；非 license 门，同 /metrics 开放语义） ── */
  router.get(
    '/otel',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json(await services.otel.getConfig());
    }),
  );
  router.put(
    '/otel',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const cfg = await services.otel.setConfig((req.body ?? {}) as Record<string, unknown>);
      recordAudit(services, req, 'otel.config.update', undefined, { enabled: cfg.enabled });
      res.json(cfg);
    }),
  );

  /* ── Chat 设置（Settings → Chat，Preview）：开关 + 默认模型 ── */
  router.get(
    '/chat-settings',
    h(async (_req, res) => {
      res.json({
        enabled: (await services.repos.settings.get('chat.enabled')) !== 'false',
        model: (await services.repos.settings.get('chat.model')) ?? 'claude-sonnet-5',
      });
    }),
  );

  router.put(
    '/chat-settings',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const body = (req.body ?? {}) as { enabled?: boolean; model?: string };
      if (typeof body.enabled === 'boolean') {
        await services.repos.settings.set('chat.enabled', body.enabled ? 'true' : 'false');
      }
      if (typeof body.model === 'string' && body.model.trim()) {
        await services.repos.settings.set('chat.model', body.model.trim());
      }
      recordAudit(services, req, 'chat.settings-update');
      res.json({
        enabled: (await services.repos.settings.get('chat.enabled')) !== 'false',
        model: (await services.repos.settings.get('chat.model')) ?? 'claude-sonnet-5',
      });
    }),
  );

  /* ── 实例级 MCP（Settings → Instance-level MCP，Preview；实例 admin） ── */
  router.get(
    '/mcp',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json(await services.mcp.status());
    }),
  );

  router.post(
    '/mcp/enable',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const { token } = await services.mcp.enable(); // 明文仅此一次；重开即轮换
      recordAudit(services, req, 'mcp.enable');
      res.json({ token, ...(await services.mcp.status()) });
    }),
  );

  router.post(
    '/mcp/disable',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      await services.mcp.disable();
      recordAudit(services, req, 'mcp.disable');
      res.json(await services.mcp.status());
    }),
  );

  router.put(
    '/mcp/workflows',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const body = (req.body ?? {}) as { workflowIds?: string[] };
      if (!Array.isArray(body.workflowIds) || body.workflowIds.some((x) => typeof x !== 'string')) {
        throw new OperationalError('workflowIds must be an array of strings', { status: 400 });
      }
      await services.mcp.setWorkflows(body.workflowIds);
      recordAudit(services, req, 'mcp.workflows-update');
      res.json(await services.mcp.status());
    }),
  );

  /* D144:MCP 页可编辑工作流描述（实例 admin;跨项目 unscoped,仅 description） */
  router.put(
    '/mcp/workflows/:id/description',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const body = (req.body ?? {}) as { description?: string };
      if (typeof body.description !== 'string' || body.description.length > 2000) {
        throw new OperationalError('description must be a string (max 2000 chars)', { status: 400 });
      }
      await services.mcp.setWorkflowDescription(param(req, 'id'), body.description);
      recordAudit(services, req, 'mcp.workflow-description-update', { type: 'workflow', id: param(req, 'id') });
      res.json(await services.mcp.status());
    }),
  );

  /* OAuth redirect 允许清单持久化（backlog #9;OAuth 授权流本体见 #25） */
  router.put(
    '/mcp/redirect-urls',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const body = (req.body ?? {}) as { redirectUrls?: string[] };
      if (!Array.isArray(body.redirectUrls) || body.redirectUrls.some((x) => typeof x !== 'string')) {
        throw new OperationalError('redirectUrls must be an array of strings', { status: 400 });
      }
      await services.mcp.setRedirectUrls(body.redirectUrls);
      recordAudit(services, req, 'mcp.redirect-urls-update');
      res.json(await services.mcp.status());
    }),
  );

  /* ── templates（内置模板库，docs/10 B1） ── */
  router.get(
    '/templates',
    h(async (_req, res) => {
      res.json(templateSummaries());
    }),
  );

  router.get(
    '/templates/:id',
    h(async (req, res) => {
      res.json(getTemplateSummary(param(req, 'id')));
    }),
  );

  router.post(
    '/templates/:id/import',
    editor,
    h(async (req, res) => {
      const template = getTemplate(param(req, 'id'));
      const created = await services.workflows.create(
        { name: template.name, nodes: template.nodes, connections: template.connections },
        auth(req).projectId,
      );
      recordAudit(services, req, 'workflow.create', { type: 'workflow', id: created.id }, { name: created.name, fromTemplate: template.id });
      res.status(201).json(created);
    }),
  );

  router.post(
    '/templates/:id/setup',
    editor,
    workflowUpdate,
    h(async (req, res) => {
      const template = getTemplate(param(req, 'id'));
      const requirements = template.credentialRequirements ?? [];
      const body = (req.body ?? {}) as { workflowId?: string; selections?: Record<string, string> };
      if (!body.workflowId || !body.selections || typeof body.selections !== 'object') {
        throw new OperationalError('workflowId and selections are required', { status: 400 });
      }

      const workflow = await services.workflows.getById(body.workflowId, auth(req).projectId);
      const credentials = await services.credentials.list(auth(req).projectId);
      const credentialById = new Map(credentials.map((credential) => [credential.id, credential]));
      const nodes = JSON.parse(JSON.stringify(workflow.nodes)) as INode[];

      for (const requirement of requirements) {
        const credentialId = body.selections[requirement.id];
        if (!credentialId) {
          throw new OperationalError(`Credential selection is required for "${requirement.credentialName}"`, {
            status: 400,
            requirementId: requirement.id,
          });
        }
        const credential = credentialById.get(credentialId);
        if (!credential) throw new OperationalError('Credential not found', { status: 404, credentialId });
        if (credential.type !== requirement.credentialType) {
          throw new OperationalError(`Credential must be of type "${requirement.credentialType}"`, {
            status: 400,
            credentialId,
          });
        }
        for (const nodeName of requirement.nodeNames) {
          const node = nodes.find((candidate) => candidate.name === nodeName);
          if (!node) {
            throw new OperationalError(`Template setup node "${nodeName}" is missing`, {
              status: 400,
              workflowId: workflow.id,
            });
          }
          node.credentials = {
            ...(node.credentials ?? {}),
            [requirement.credentialType]: { id: credential.id, name: credential.name },
          };
        }
      }

      const updated = await services.workflows.update(
        workflow.id,
        { nodes },
        auth(req).projectId,
        auth(req).userId,
      );
      recordAudit(
        services,
        req,
        'workflow.template-setup',
        { type: 'workflow', id: updated.id },
        { templateId: template.id, credentialGroups: requirements.length },
      );
      res.json(updated);
    }),
  );

  /* ── node-types ── */
  router.get(
    '/node-types',
    h(async (_req, res) => {
      // 带全名 type（内置 nomops.* 与社区 <pkg>.* 一致），前端据此建 type，不再拼前缀
      res.json(services.nodeLoader.describeAll());
    }),
  );

  /* ── 社区节点（owner 安装 npm 节点包，实例级） ── */
  router.get(
    '/community-nodes',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json(await services.communityNodes.list());
    }),
  );

  router.post(
    '/community-nodes',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const { name, version } = parseBody(communityNodeInstallSchema, req);
      const installed = await services.communityNodes.install(name, version, auth(req).userId);
      recordAudit(services, req, 'community-node.install', { type: 'community-node', id: name }, { version: installed.version });
      res.status(201).json(installed);
    }),
  );

  // 名字用 query 传（scoped 包名含 '/'，放路径段会被 Express 拆断）
  router.delete(
    '/community-nodes',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const name = String(req.query['name'] ?? '');
      if (!name) throw new OperationalError('Missing package name', { status: 400 });
      await services.communityNodes.uninstall(name);
      recordAudit(services, req, 'community-node.uninstall', { type: 'community-node', id: name });
      res.status(204).end();
    }),
  );

  /* ── license ── */
  router.get(
    '/license',
    h(async (_req, res) => {
      res.json(services.license.info());
    }),
  );

  // 激活许可证：落库 + 运行时生效，无需重启。实例 admin。
  router.post(
    '/license/activate',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const { activationKey } = parseBody(licenseActivateSchema, req);
      services.license.setKey(activationKey);
      await services.repos.settings.set('license.activationKey', activationKey.trim());
      recordAudit(services, req, 'license.activate', undefined, { plan: services.license.plan() });
      res.json(services.license.info());
    }),
  );

  // 移除许可证（回落社区版）。实例 admin。
  router.delete(
    '/license',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      services.license.setKey(null);
      await services.repos.settings.set('license.activationKey', '');
      recordAudit(services, req, 'license.deactivate');
      res.json(services.license.info());
    }),
  );

  /* ── about（关于弹窗） ── */
  router.get(
    '/about',
    h(async (_req, res) => {
      res.json({
        name: 'nomops',
        version: process.env['NOMOPS_VERSION'] ?? '0.9.0',
        plan: services.license.plan(),
        description: 'Node-based workflow automation platform · shared core + dual deployment modes',
        nodeCount: services.nodeLoader.getAllDescriptions().length,
        docs: 'docs/README.md → 01~09',
      });
    }),
  );

  /* ── me（SSO 着陆页取当前用户） ── */
  router.get(
    '/me',
    h(async (req, res) => {
      const user = await services.repos.users.findById(auth(req).userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        mfaEnabled: user.mfaEnabled,
        settings: user.settings ?? {}, // #43：每用户偏好
        projectId: auth(req).projectId,
      });
    }),
  );

  /* 个人资料：改姓名（Settings → Personal） */
  router.patch(
    '/me',
    h(async (req, res) => {
      const body = parseBody(updateMeSchema, req);
      const user = await services.repos.users.update(auth(req).userId, body);
      res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName });
    }),
  );

  /* #43：每用户偏好落库（替 localStorage,跨设备一致） */
  router.put(
    '/me/settings',
    h(async (req, res) => {
      const settings = (req.body ?? {}) as Record<string, unknown>;
      await services.repos.users.updateSettings(auth(req).userId, settings);
      res.json({ settings });
    }),
  );

  /* #43：实例升级史（实例 admin） */
  router.get(
    '/instance/version-history',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json(await services.repos.platform.listVersionHistory());
    }),
  );

  /* #43：MCP registry 缓存——列表 + 刷新（实例 admin 刷新，写入策划目录作缓存源） */
  router.get(
    '/mcp-registry',
    h(async (_req, res) => {
      res.json(await services.repos.platform.listRegistryServers());
    }),
  );
  router.post(
    '/mcp-registry/refresh',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      // 无外部 registry 客户端时用策划目录充当缓存源（可后续替换为真实拉取）
      await services.repos.platform.replaceRegistryServers([
        { name: 'filesystem', url: 'npx -y @modelcontextprotocol/server-filesystem', description: 'Local filesystem access', category: 'storage' },
        { name: 'github', url: 'npx -y @modelcontextprotocol/server-github', description: 'GitHub repos/issues/PRs', category: 'dev' },
        { name: 'postgres', url: 'npx -y @modelcontextprotocol/server-postgres', description: 'Postgres read-only queries', category: 'database' },
      ]);
      res.json(await services.repos.platform.listRegistryServers());
    }),
  );

  /* #43：文件夹打标 */
  router.get(
    '/folders/:id/tags',
    h(async (req, res) => {
      res.json(await services.repos.platform.folderTags(param(req, 'id')));
    }),
  );
  router.put(
    '/folders/:id/tags',
    editor,
    h(async (req, res) => {
      const body = parseBody(workflowTagsSchema, req); // { tagIds }
      await services.repos.platform.setFolderTags(param(req, 'id'), body.tagIds);
      res.json(await services.repos.platform.folderTags(param(req, 'id')));
    }),
  );

  /* 改口令（登录态，先验当前口令） */
  router.post(
    '/me/password',
    h(async (req, res) => {
      const body = parseBody(changePasswordSchema, req);
      await services.auth.changePassword(auth(req).userId, body.currentPassword, body.newPassword);
      recordAudit(services, req, 'user.password-change', { type: 'user', id: auth(req).userId });
      res.json({ ok: true });
    }),
  );

  /* ── 公共 API 令牌（用户级归属） ── */
  router.get(
    '/api-keys',
    h(async (req, res) => {
      res.json(await services.apiKeys.list(auth(req).userId));
    }),
  );

  // 细粒度 scope 目录（前端 Custom 勾选用）
  router.get(
    '/api-keys/scopes',
    h(async (_req, res) => {
      res.json({ scopes: API_SCOPES });
    }),
  );

  router.post(
    '/api-keys',
    h(async (req, res) => {
      const body = (req.body ?? {}) as { label?: string; expiresInDays?: number | null; scope?: string | string[] };
      const label = String(body.label ?? '').trim();
      if (!label) throw new OperationalError('label is required', { status: 400 });
      const expiresInDays =
        body.expiresInDays == null ? null : Math.max(1, Math.min(3650, Math.floor(Number(body.expiresInDays))));
      if (body.expiresInDays != null && !Number.isFinite(Number(body.expiresInDays))) {
        throw new OperationalError('expiresInDays must be a number', { status: 400 });
      }
      // 宏 all/readonly 或细粒度列表（服务层归一化）
      const scope = body.scope as string | string[] | undefined;
      const created = await services.apiKeys.create(auth(req).userId, label, { expiresInDays, scope: scope as never });
      recordAudit(services, req, 'apiKey.create', { type: 'apiKey', id: created.apiKey.id }, { label });
      // token 明文只在此返回一次
      res.status(201).json(created);
    }),
  );

  router.delete(
    '/api-keys/:id',
    h(async (req, res) => {
      const ok = await services.apiKeys.revoke(param(req, 'id'), auth(req).userId);
      if (!ok) throw new OperationalError('API key not found', { status: 404 });
      recordAudit(services, req, 'apiKey.revoke', { type: 'apiKey', id: param(req, 'id') });
      res.status(204).end();
    }),
  );

  /* ── 两步验证（TOTP，用户级） ── */
  router.post(
    '/mfa/setup',
    h(async (req, res) => {
      // 返回 secret/otpauth/备份码明文（仅此一次）；此时尚未启用，待 enable 确认
      res.json(await services.mfa.setup(auth(req).userId));
    }),
  );

  router.post(
    '/mfa/enable',
    h(async (req, res) => {
      const code = String((req.body as { code?: string })?.code ?? '');
      await services.mfa.enable(auth(req).userId, code);
      recordAudit(services, req, 'mfa.enable', { type: 'user', id: auth(req).userId });
      res.json({ ok: true });
    }),
  );

  router.post(
    '/mfa/disable',
    h(async (req, res) => {
      const code = String((req.body as { code?: string })?.code ?? '');
      await services.mfa.disable(auth(req).userId, code);
      recordAudit(services, req, 'mfa.disable', { type: 'user', id: auth(req).userId });
      res.json({ ok: true });
    }),
  );

  /* ── 实例用户管理（Admin Panel，实例 admin） ── */
  router.get(
    '/instance/users',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const users = await services.repos.users.findAll();
      const invitations = await services.repos.invitations.findAll();
      // Projects 列（对标基线）：成员所属项目数；owner/admin 前端显示 "All projects"
      const projectCounts = new Map<string, number>();
      for (const u of users) {
        projectCounts.set(u.id, (await services.repos.projects.findAllByUserWithRole(u.id)).length);
      }
      // 已激活用户 + 未接受邀请（pending）合并展示（Users 列表）
      res.json([
        ...users.map((u) => ({
          id: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          disabled: u.disabled,
          mfaEnabled: u.mfaEnabled,
          projectCount: projectCounts.get(u.id) ?? 0,
          pending: false,
          lastActiveAt: u.lastActiveAt ?? null,
          createdAt: u.createdAt,
        })),
        ...invitations.map((inv) => ({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          disabled: false,
          pending: true,
          lastActiveAt: null,
          createdAt: inv.createdAt,
        })),
      ]);
    }),
  );

  // 邀请用户（实例 admin）：建邀请 → 返回可复制的邀请链接（无 SMTP 时由 admin 转交）。
  router.post(
    '/instance/users/invite',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const body = parseBody(inviteSchema, req);
      // 席位配额：已激活用户 + 待接受邀请都占席，否则可以靠反复邀请绕过上限
      const [existingUsers, pendingInvites] = await Promise.all([
        services.repos.users.findAll(),
        services.repos.invitations.findAll(),
      ]);
      services.license.assertQuota('users', existingUsers.length + pendingInvites.length);
      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
      const base = process.env['NOMOPS_BASE_URL'] ?? `${proto}://${req.headers.host ?? 'localhost'}`;
      const { invitation, link } = await services.auth.invite({
        email: body.email,
        role: body.role,
        invitedBy: auth(req).userId,
        baseUrl: base,
      });
      recordAudit(services, req, 'user.invite', { type: 'invitation', id: invitation.id }, { email: invitation.email });
      // SMTP 已配置则给受邀人发邮件（backlog #18）;响应仍带链接,便于当面转发
      void services.mailer
        .send(
          invitation.email,
          'You have been invited to nomops',
          `You have been invited to join a nomops instance.\n\nAccept the invite: ${link}\n\nThis link is personal — do not share it.`,
        )
        .catch((e: Error) => console.error('[nomops] 邀请邮件发送失败:', e.message));
      res.status(201).json({ id: invitation.id, email: invitation.email, role: invitation.role, inviteLink: link });
    }),
  );

  // 移除用户或撤销待接受邀请（实例 admin）。同一路由按 id 落到 users 或 invitations。
  router.delete(
    '/instance/users/:id',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const targetId = param(req, 'id');
      const user = await services.repos.users.findById(targetId);
      if (user) {
        if (user.id === auth(req).userId) {
          throw new OperationalError('You cannot remove your own account', { status: 400 });
        }
        if (user.role === 'owner') {
          const owners = (await services.repos.users.findAll()).filter((u) => u.role === 'owner');
          if (owners.length === 1) {
            throw new OperationalError('Cannot remove the last instance owner', { status: 400 });
          }
        }
        await services.repos.users.delete(targetId);
        recordAudit(services, req, 'user.remove', { type: 'user', id: targetId }, { email: user.email });
        res.json({ id: targetId, removed: true });
        return;
      }
      const invitation = await services.repos.invitations.findById(targetId);
      if (invitation) {
        await services.repos.invitations.delete(targetId);
        recordAudit(services, req, 'invitation.revoke', { type: 'invitation', id: targetId }, { email: invitation.email });
        res.json({ id: targetId, removed: true });
        return;
      }
      throw new OperationalError('User or invitation not found', { status: 404 });
    }),
  );

  router.patch(
    '/instance/users/:id/role',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const role = String((req.body as Record<string, string>)?.role ?? '');
      if (!['owner', 'admin', 'member'].includes(role)) {
        throw new OperationalError('Invalid instance role', { status: 400 });
      }
      const targetId = param(req, 'id');
      // 不能把最后一个 owner 降级
      if (role !== 'owner') {
        const users = await services.repos.users.findAll();
        const owners = users.filter((u) => u.role === 'owner');
        if (owners.length === 1 && owners[0]!.id === targetId) {
          throw new OperationalError('Cannot demote the last instance owner', { status: 400 });
        }
      }
      await services.repos.users.update(targetId, { role });
      recordAudit(services, req, 'user.role.update', { type: 'user', id: targetId }, { role });
      res.json({ id: targetId, role });
    }),
  );

  /* ── 安全设置（实例 admin） ── */
  router.get(
    '/security',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const scimConfigured = Boolean(await services.repos.settings.get('scim.tokenHash'));
      const ssoConfig = await services.sso.getConfig().catch(() => null);
      res.json({
        scim: { enabled: services.license.isFeatureEnabled('scim'), tokenConfigured: scimConfigured },
        sso: { enabled: services.license.isFeatureEnabled('sso') && Boolean(ssoConfig?.enabled) },
        userCount: (await services.repos.users.findAll()).length,
      });
    }),
  );

  router.get(
    '/security/encryption-key',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json(
        services.encryptionKeys
          ? await services.encryptionKeys.status()
          : { mode: 'legacy-database', activeKeyId: null, retainedKeys: 1 },
      );
    }),
  );

  router.post(
    '/security/encryption-key/rotate',
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      if (!services.encryptionKeys) {
        throw new OperationalError('External encryption master key is not configured', { status: 409 });
      }
      const result = await services.encryptionKeys.rotate();
      recordAudit(services, req, 'security.encryption-key.rotate', { type: 'setting', id: 'encryptionKeyring' }, {
        activeKeyId: result.activeKeyId,
        retainedKeys: result.retainedKeys,
      });
      res.json(result);
    }),
  );

  return router;
}

/**
 * Webhook 公开入口（无鉴权，按 (path, method) 查路由表触发）。
 * path 支持多段（/webhook/a/b/c → "a/b/c"）。
 */
export function createWebhookRouter(services: AppServices): Router {
  const router = Router();
  const BOT_USER_AGENT = /(?:\bbot\b|crawler|spider|linkpreview|link-preview|slackbot|discordbot|whatsapp|skypeuripreview|safelinks|microsoft office existence discovery)/i;
  const safeEqual = (actual: string, expected: string): boolean => {
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const authenticateWebhook = async (req: Request, node: INode, projectId: string): Promise<boolean> => {
    const mode = String(node.parameters['authentication'] ?? 'none');
    if (mode === 'none') return true;
    const type =
      mode === 'basic' ? 'httpBasicAuth' : mode === 'header' ? 'httpHeaderAuth' : mode === 'jwt' ? 'webhookJwtAuth' : '';
    const reference = type ? node.credentials?.[type] : undefined;
    if (!reference) return false;
    const credential = await services.credentials.getDecryptedData(reference.id, projectId).catch(() => null);
    if (!credential) return false;

    if (mode === 'basic') {
      const authorization = req.headers.authorization ?? '';
      if (!authorization.startsWith('Basic ')) return false;
      let decoded = '';
      try {
        decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      } catch {
        return false;
      }
      return safeEqual(decoded, `${String(credential['user'] ?? '')}:${String(credential['password'] ?? '')}`);
    }
    if (mode === 'header') {
      const name = String(credential['name'] ?? '').toLowerCase();
      const expected = String(credential['value'] ?? '');
      const value = name ? req.headers[name] : undefined;
      return typeof value === 'string' && expected.length > 0 && safeEqual(value, expected);
    }
    if (mode === 'jwt') {
      const authorization = req.headers.authorization ?? '';
      if (!authorization.startsWith('Bearer ')) return false;
      const secret = String(credential['secret'] ?? '');
      if (!secret) return false;
      try {
        jwt.verify(authorization.slice(7), secret, {
          algorithms: ['HS256'],
          ...(credential['issuer'] ? { issuer: String(credential['issuer']) } : {}),
          ...(credential['audience'] ? { audience: String(credential['audience']) } : {}),
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };
  const requestOf = async (req: Request, path: string): Promise<IWebhookRequest> => {
    const contentType = req.headers['content-type'] ?? '';
    const multipart = contentType.toLowerCase().startsWith('multipart/form-data')
      ? await parseMultipartForm(req, services.executions.getBinaryStore())
      : undefined;
    return {
      method: req.method.toUpperCase(),
      path,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined),
      ),
      query: Object.fromEntries(
        Object.entries(req.query).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.map(String) : String(value ?? ''),
        ]),
      ),
      body: multipart?.fields ?? req.body ?? {},
      ...(multipart && Object.keys(multipart.files).length > 0 ? { files: multipart.files } : {}),
    };
  };
  const sendResponse = (res: Response, response: IWebhookResponseData): void => {
    res.status(response.statusCode ?? 200);
    for (const [name, value] of Object.entries(response.headers ?? {})) res.setHeader(name, value);
    if (response.body === null || response.body === undefined) {
      res.end();
      return;
    }
    if (response.contentType) res.type(response.contentType);
    if (typeof response.body === 'string' || response.contentType?.startsWith('text/')) {
      res.send(String(response.body));
      return;
    }
    if (response.body instanceof Uint8Array) {
      res.send(Buffer.from(response.body));
      return;
    }
    res.json(response.body);
  };
  const webhookContext = (
    mode: IWebhookContext['mode'],
    node: INode,
    request: IWebhookRequest,
    context: JsonObject,
  ): IWebhookContext => ({
    mode,
    getNodeParameter(name: string, fallback?: unknown): unknown {
      return name in node.parameters ? node.parameters[name] : fallback;
    },
    getContext: () => context,
    getRequest: () => request,
  });
  // Agent 外部渠道入口（backlog #44 M5,先于通配路由注册）：路径带随机 secret,校验在服务层。
  router.post(
    '/webhook/agent-channel/:channelId/:secret',
    h(async (req, res) => {
      res.json(
        await services.agentChannels.handleTelegramUpdate(
          param(req, 'channelId'),
          param(req, 'secret'),
          (req.body ?? {}) as Record<string, never>,
        ),
      );
    }),
  );
  router.all(
    '/webhook-test/*path',
    h(async (req, res) => {
      const path = String(req.params['path'] ?? '').split(',').join('/');
      const listener = services.webhookTests.peek(path, req.method);
      if (!listener) {
        res.status(404).json({ error: `No webhook is listening: ${req.method} /webhook-test/${path}` });
        return;
      }

      const row = await services.workflows.getById(listener.workflowId, listener.projectId);
      const node = (row.nodes as INode[]).find((candidate) => candidate.name === listener.nodeName);
      if (!node || node.type !== 'nomops.webhook') {
        services.webhookTests.consume(path, req.method, listener.id);
        res.status(404).json({ error: 'Webhook node no longer exists in the workflow draft' });
        return;
      }
      if (!(await authenticateWebhook(req, node, listener.projectId))) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="nomops-webhook", Basic realm="nomops-webhook"');
        res.status(401).json({ error: 'Webhook authentication failed' });
        return;
      }
      if (!services.webhookTests.consume(path, req.method, listener.id)) {
        res.status(404).json({ error: 'Webhook test listener was already consumed' });
        return;
      }

      const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http').split(',')[0]!.trim();
      const webhookUrl = `${proto}://${req.headers.host ?? 'localhost'}/webhook-test/${path}`;
      let seed: INodeExecutionData[] = [{
        json: {
          headers: req.headers as Record<string, unknown>,
          params: {},
          query: req.query as Record<string, unknown>,
          body: (req.body ?? {}) as Record<string, unknown>,
          webhookUrl,
          executionMode: 'test',
        },
      }];
      let nodeResponse: IWebhookResponseData | undefined;
      const nodeType = await services.nodeLoader.getByNameAndVersion(node.type, node.typeVersion);
      if (nodeType.webhook) {
        const webhookRequest = await requestOf(req, path);
        const result = await nodeType.webhook.call(webhookContext('trigger', node, webhookRequest, {}));
        nodeResponse = result.response;
        if (!result.workflowData) {
          sendResponse(res, nodeResponse ?? { statusCode: 204 });
          return;
        }
        seed = result.workflowData;
      }

      let custom: IWebhookResponseData | null = null;
      const summary = await services.executions.runTestWebhook(
        listener.workflowId,
        listener.projectId,
        seed,
        listener.nodeName,
        { onWebhookResponse: (response) => { custom = response as IWebhookResponseData; } },
      );
      services.audit.log({
        projectId: listener.projectId,
        action: 'workflow.run',
        resourceType: 'workflow',
        resourceId: listener.workflowId,
        details: { mode: 'webhook-test', executionId: summary.executionId },
        ip: req.ip ?? null,
      });
      if (custom) {
        sendResponse(res, custom);
        return;
      }
      if (nodeResponse) {
        sendResponse(res, nodeResponse);
        return;
      }
      res.json({ message: 'Workflow was started' });
    }),
  );
  router.all(
    '/webhook/*path',
    h(async (req, res) => {
      const path = String(req.params['path'] ?? '')
        .split(',')
        .join('/'); // Express 5 通配段为数组
      const entity = await services.repos.webhooks.findByPathAndMethod(path, req.method.toUpperCase());
      if (!entity) {
        res.status(404).json({ error: `No active webhook: ${req.method} /webhook/${path}` });
        return;
      }
      let seed: INodeExecutionData[] = [
        {
          json: {
            body: (req.body ?? {}) as Record<string, unknown>,
            query: req.query as Record<string, unknown>,
            headers: req.headers as Record<string, unknown>,
            method: req.method,
            path,
          },
        },
      ];
      let nodeResponse: IWebhookResponseData | undefined;
      const projectId = await services.repos.workflows.getOwnerProjectId(entity.workflowId);
      if (!projectId) throw new OperationalError('Workflow has no owning project', { workflowId: entity.workflowId });
      const row = await services.workflows.productionRow(
        await services.workflows.getById(entity.workflowId, projectId),
      );
      const node = (row.nodes as INode[]).find((candidate) => candidate.name === entity.node);
      if (!node) throw new OperationalError('Webhook node not found in published workflow', { node: entity.node });
      const webhookOptions = node.parameters['options'];
      const ignoreBots = node.parameters['ignoreBots'] === true
        || (webhookOptions && typeof webhookOptions === 'object' && !Array.isArray(webhookOptions)
          && (webhookOptions as Record<string, unknown>)['ignoreBots'] === true);
      if (ignoreBots && BOT_USER_AGENT.test(req.headers['user-agent'] ?? '')) {
        res.setHeader('X-Nomops-Webhook-Ignored', 'bot');
        res.status(204).end();
        return;
      }
      if (!(await authenticateWebhook(req, node, projectId))) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="nomops-webhook", Basic realm="nomops-webhook"');
        res.status(401).json({ error: 'Webhook authentication failed' });
        return;
      }
      const nodeType = await services.nodeLoader.getByNameAndVersion(node.type, node.typeVersion);
      if (nodeType.webhook) {
        const webhookRequest = await requestOf(req, path);
        const result = await nodeType.webhook.call(webhookContext('trigger', node, webhookRequest, {}));
        nodeResponse = result.response;
        if (!result.workflowData) {
          sendResponse(res, nodeResponse ?? { statusCode: 204 });
          return;
        }
        seed = result.workflowData;
      }
      // RespondToWebhook 节点设置的自定义响应（单进程模式;队列模式入队即返默认摘要）
      let custom: { statusCode?: number; contentType?: string; body?: unknown } | null = null;
      const summary = await services.executions.runTriggered(entity.workflowId, 'webhook', seed, entity.node, {
        onWebhookResponse: (r) => {
          custom = r as typeof custom;
        },
      });
      // 系统触发：无用户上下文（docs/06）
      services.audit.log({
        projectId: await services.repos.workflows.getOwnerProjectId(entity.workflowId),
        action: 'workflow.run',
        resourceType: 'workflow',
        resourceId: entity.workflowId,
        details: { mode: 'webhook', executionId: summary.executionId },
        ip: req.ip ?? null,
      });
      const c = custom as IWebhookResponseData | null;
      if (c) {
        sendResponse(res, c);
        return;
      }
      if (nodeResponse) {
        sendResponse(res, nodeResponse);
        return;
      }
      if (node.parameters['responseMode'] === 'lastNode' && summary.status !== 'queued') {
        const data = (await services.repos.executions.getData(summary.executionId)) as IRunExecutionData | null;
        const lastNode = data?.resultData?.lastNodeExecuted;
        const runs = lastNode ? data?.resultData?.runData[lastNode] : undefined;
        const items = runs?.at(-1)?.data?.['main']?.[0] ?? [];
        const output = items.map((item) => item.json);
        res.json(output.length === 1 ? output[0] : output);
        return;
      }
      res.json(summary);
    }),
  );

  /**
   * 匿名恢复 waiting 执行（backlog #15）：审批类流程把 $execution.resumeUrl 发出去,
   * 外部点击/回调即续跑。令牌随执行状态落库,常数时间比较;任何不匹配一律 404 不泄露存在性。
   */
  router.all(
    '/webhook-waiting/:executionId/:token',
    h(async (req, res) => {
      const executionId = String(req.params['executionId'] ?? '');
      const token = String(req.params['token'] ?? '');
      const notFound = (): void => {
        res.status(404).json({ error: 'No waiting execution for this URL' });
      };

      const record = await services.repos.executions.getRecord(executionId).catch(() => null);
      if (!record || record.status !== 'waiting') return notFound();
      const data = (await services.repos.executions.getData(executionId).catch(() => null)) as {
        resumeToken?: string;
      } | null;
      const expected = data?.resumeToken;
      if (!expected || expected.length !== token.length) return notFound();
      const a = Buffer.from(expected);
      const b = Buffer.from(token);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return notFound();

      if (req.method === 'HEAD') {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).end();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, HEAD, POST');
        res.status(405).json({ error: 'Use POST to resume this execution' });
        return;
      }

      let resumeData: INodeExecutionData[] | undefined;
      let nodeResponse: IWebhookResponseData | undefined;
      const state = data as IRunExecutionData;
      const frame = state.executionData?.nodeExecutionStack.at(-1);
      if (frame) {
        const workflowData = await services.repos.executions.getWorkflowData(executionId);
        const node = (workflowData?.['nodes'] as INode[] | undefined)?.find(
          (candidate) => candidate.name === frame.node.name,
        );
        if (node) {
          const nodeType = await services.nodeLoader.getByNameAndVersion(node.type, node.typeVersion);
          if (nodeType.webhook) {
            const context = state.contextData?.[node.name] ?? {};
            const webhookRequest = await requestOf(req, `webhook-waiting/${executionId}`);
            const result = await nodeType.webhook.call(
              webhookContext('waiting', node, webhookRequest, context),
            );
            nodeResponse = result.response;
            if (!result.workflowData) {
              sendResponse(res, nodeResponse ?? { statusCode: 204 });
              return;
            }
            resumeData = result.workflowData;
          }
        }
      }

      // Waiting nodes such as Form may render their own safe GET page above. A GET that
      // produced workflow data is still preview-only: discard it and require explicit POST.
      if (req.method === 'GET') {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
        );
        res.type('html').send(
          '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
            '<title>Resume workflow</title><style>body{font-family:system-ui;max-width:36rem;margin:5rem auto;padding:0 1rem;color:#242424}button{padding:.7rem 1rem}</style></head>' +
            '<body><h1>Resume workflow?</h1><p>This action will continue the paused execution.</p>' +
            '<form method="post"><button type="submit">Continue</button></form></body></html>',
        );
        return;
      }

      const projectId = await services.repos.workflows.getOwnerProjectId(record.workflowId);
      const summary = await services.executions.resume(executionId, projectId ?? undefined, resumeData);
      services.audit.log({
        projectId: await services.repos.workflows.getOwnerProjectId(record.workflowId),
        action: 'execution.resume',
        resourceType: 'execution',
        resourceId: executionId,
        details: { via: 'webhook-waiting' },
        ip: req.ip ?? null,
      });
      if (nodeResponse) sendResponse(res, nodeResponse);
      else res.json({ resumed: true, executionId, status: summary.status });
    }),
  );
  return router;
}

/**
 * 实例信任密钥链公开入口（backlog #47）：对端无 nomops 会话——JWKS 供拉公钥,
 * token/exchange 靠呈递的签名令牌自证。两者 license 门（federation 是企业特性）。
 */
export function createInstanceTrustRouter(services: AppServices): Router {
  const router = Router();
  const feat = requireFeature(services.license, 'instanceTrust');
  router.get(
    '/instance-trust/jwks',
    feat,
    h(async (_req, res) => {
      res.json(await services.instanceTrust.publicJwks());
    }),
  );
  router.post(
    '/instance-trust/token/exchange',
    feat,
    h(async (req, res) => {
      const { token } = req.body as { token?: string };
      if (!token) throw new OperationalError('token is required', { status: 400 });
      res.json(await services.instanceTrust.exchangeToken(token));
    }),
  );
  return router;
}
