import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { AppServices } from '../app-services.js';
import { requireRole } from '../auth/middleware.js';
import { verifyHandoff } from '../auth/handoff.js';
import { requireFeature } from '../license/license-service.js';
import { isProjectRole } from '../auth/rbac.js';
import { computeInsights } from '../services/insights.js';
import { CHAT_PROVIDERS } from '../services/assistant-service.js';
import { getTemplate, templateSummaries } from '../services/template-registry.js';
import {
  acceptInviteSchema,
  activateBodySchema,
  addMemberSchema,
  createProjectSchema,
  inviteSchema,
  credentialBodySchema,
  credentialPatchSchema,
  dataTableBodySchema,
  dataTableColumnSchema,
  dataTableRenameSchema,
  dataTableRowSchema,
  folderBodySchema,
  folderPatchSchema,
  loginSchema,
  patchMemberSchema,
  quotaBodySchema,
  registerSchema,
  runBodySchema,
  chatBodySchema,
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

/** Zod 校验失败 → 400（含字段级错误）。 */
function parseBody<S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> {
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
const h =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const auth = (req: Request) => req.auth!; // 路由挂在 authMiddleware 之后，一定存在

/** Express 5 的 params 值类型为 string | string[]（通配符），这里统一取 string。 */
const param = (req: Request, name: string): string => String(req.params[name]);

/** 审计留痕（docs/06）：fire-and-forget，details 只放元数据（铁律 3）。 */
function recordAudit(
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
  router.get(
    '/internal/usage',
    h(async (req, res) => {
      const token = process.env['NOMOPS_INTERNAL_TOKEN'];
      if (!token) throw new OperationalError('Not found', { status: 404 });
      const provided = Buffer.from(req.header('x-internal-token') ?? '');
      const expected = Buffer.from(token);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        throw new OperationalError('Unauthorized', { status: 401 });
      }
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
      const result = await services.auth.login(body.email, body.password, body.mfaCode);
      // 口令通过但需第二因素：回中间态，客户端补 mfaCode 再提交
      if ('mfaRequired' in result) {
        res.json({ mfaRequired: true });
        return;
      }
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
        console.log(`[nomops] 密码重置链接（${result.email}）: ${link}`);
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
  const rbacFeature = requireFeature(services.license, 'rbac');
  const auditFeature = requireFeature(services.license, 'auditLogs');

  /** 成员管理等按 URL 参数指定项目操作：校验请求者是该项目 owner。 */
  async function assertOwnerOf(req: Request, projectId: string): Promise<void> {
    const role = await services.repos.projects.findMemberRole(projectId, auth(req).userId);
    if (role !== 'project:owner') {
      throw new OperationalError('Requires project:owner permission for this project', { status: 403, projectId });
    }
  }

  /* ── workflows ── */
  router.get(
    '/workflows',
    h(async (req, res) => {
      // ?folderId 缺省 → 全部；'root'/'' → 项目根；其它 → 指定文件夹。?archived=true 只看归档。
      const fq = req.query['folderId'];
      const folderId = fq === undefined ? undefined : fq === 'root' || fq === '' ? null : String(fq);
      const archived = req.query['archived'] === 'true';
      res.json(await services.workflows.list(auth(req).projectId, folderId, archived));
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
    editor,
    h(async (req, res) => {
      const row = await services.workflows.getById(param(req, 'id'), auth(req).projectId);
      const favorite = Boolean((req.body as { favorite?: boolean })?.favorite);
      res.json(await services.repos.workflows.setFlags(row.id, { favorite }));
    }),
  );

  router.post(
    '/workflows/:id/archive',
    editor,
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
    editor,
    h(async (req, res) => {
      const row = await services.workflows.getById(param(req, 'id'), auth(req).projectId);
      const updated = await services.repos.workflows.setFlags(row.id, { archived: false });
      recordAudit(services, req, 'workflow.unarchive', { type: 'workflow', id: row.id });
      res.json(updated);
    }),
  );

  router.post(
    '/workflows',
    editor,
    h(async (req, res) => {
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
    editor,
    h(async (req, res) => {
      const row = await services.workflows.publish(param(req, 'id'), auth(req).projectId, auth(req).userId);
      // 激活中的工作流重发布 → 重注册触发器（webhook 路径/轮询间隔可能变了）
      if (row.active) await services.activeWorkflows.add(row);
      recordAudit(services, req, 'workflow.publish', { type: 'workflow', id: row.id });
      res.json({ id: row.id, publishedVersionId: row.publishedVersionId, publishedAt: row.publishedAt, publishedDirty: false });
    }),
  );

  router.patch(
    '/workflows/:id',
    editor,
    h(async (req, res) => {
      const body = parseBody(workflowPatchSchema, req);
      const updated = await services.workflows.update(param(req, 'id'), body, auth(req).projectId, auth(req).userId);
      recordAudit(services, req, 'workflow.update', { type: 'workflow', id: updated.id }, { name: updated.name });
      res.json(updated);
    }),
  );

  router.delete(
    '/workflows/:id',
    editor,
    h(async (req, res) => {
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
    editor,
    h(async (req, res) => {
      const restored = await services.workflows.restoreVersion(
        param(req, 'id'),
        param(req, 'versionId'),
        auth(req).projectId,
        auth(req).userId,
      );
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
    editor,
    h(async (req, res) => {
      const body = parseBody(chatBodySchema, req);
      res.json(await services.executions.chat(param(req, 'id'), auth(req).projectId, body.message, body.sessionId));
    }),
  );

  router.post(
    '/workflows/:id/run',
    editor,
    h(async (req, res) => {
      const body = parseBody(runBodySchema, req);
      const summary = await services.executions.runManually(param(req, 'id'), auth(req).projectId, body);
      recordAudit(services, req, 'workflow.run', { type: 'workflow', id: param(req, 'id') }, { mode: 'manual', executionId: summary.executionId });
      res.json(summary);
    }),
  );

  /* ── activate / deactivate ── */
  router.post(
    '/workflows/:id/activate',
    editor,
    h(async (req, res) => {
      const body = parseBody(activateBodySchema, req);
      let row = await services.workflows.getById(param(req, 'id'), auth(req).projectId);
      if (body.active) {
        // 从未发布 → 激活即发布当前定义（对标基线：激活总是让「此刻的定义」上生产）
        if (!row.publishedVersionId) {
          row = await services.workflows.publish(row.id, auth(req).projectId, auth(req).userId);
        }
        await services.activeWorkflows.add(row); // 失败抛 OperationalError → 400（activationError）
        await services.repos.workflows.setActive(row.id, true);
      } else {
        await services.activeWorkflows.remove(row.id);
        await services.repos.workflows.setActive(row.id, false);
      }
      recordAudit(services, req, body.active ? 'workflow.activate' : 'workflow.deactivate', {
        type: 'workflow',
        id: row.id,
      });
      res.json({ id: row.id, active: body.active });
    }),
  );

  /* ── executions ── */
  router.get(
    '/executions',
    h(async (req, res) => {
      res.json(await services.executions.list(auth(req).projectId));
    }),
  );

  router.get(
    '/executions/:id',
    h(async (req, res) => {
      res.json(await services.executions.getById(param(req, 'id'), auth(req).projectId));
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

  /* 重试（B5）：useOriginal=true 用执行时的定义快照，否则用当前保存的草稿 */
  router.post(
    '/executions/:id/retry',
    editor,
    h(async (req, res) => {
      const useOriginal = Boolean((req.body as { useOriginal?: boolean })?.useOriginal);
      const summary = await services.executions.retry(param(req, 'id'), auth(req).projectId, useOriginal);
      recordAudit(services, req, 'execution.retry', { type: 'execution', id: param(req, 'id') });
      res.json(summary);
    }),
  );

  // 唤醒 waiting 执行（Wait 节点的外部信号模式；到点唤醒由 wait-tracker 负责）
  router.post(
    '/executions/:id/resume',
    editor,
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
    editor,
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
    editor, // viewer 只读：test 会触发解密（docs/06）
    h(async (req, res) => {
      res.json(await services.credentials.test(param(req, 'id'), auth(req).projectId));
    }),
  );

  /* 编辑凭证（对标基线卡片 Open）：改名 + 覆写填写的字段（留空 = 保持不变） */
  router.patch(
    '/credentials/:id',
    editor,
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

  router.delete(
    '/credentials/:id',
    editor,
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
      if (!isProjectRole(body.role)) throw new OperationalError('Invalid role', { status: 400 });
      if (body.role !== 'project:owner') await assertNotLastOwner(projectId, targetId);
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

  /* ── audit logs（docs/06：查询需企业版 + owner） ── */
  router.get(
    '/audit-logs',
    auditFeature,
    h(async (req, res) => {
      const projectId = typeof req.query['projectId'] === 'string' ? req.query['projectId'] : auth(req).projectId;
      await assertOwnerOf(req, projectId);
      const limit = Math.min(Number(req.query['limit'] ?? 50) || 50, 200);
      const before = typeof req.query['before'] === 'string' ? new Date(req.query['before']) : undefined;
      res.json(await services.repos.auditLogs.findAllByProject(projectId, { limit, before }));
    }),
  );

  /* ── 日志流（docs/10 B3，企业功能；密钥绝不出 API） ── */
  const logStreamFeature = requireFeature(services.license, 'logStreaming');
  router.get(
    '/log-streaming/destinations',
    logStreamFeature,
    h(async (_req, res) => {
      res.json(await services.logStreaming.list());
    }),
  );
  router.post(
    '/log-streaming/destinations',
    logStreamFeature,
    h(async (req, res) => {
      const body = (req.body ?? {}) as {
        name?: string;
        url?: string;
        secret?: string;
        events?: Array<'execution' | 'audit'>;
      };
      const created = await services.logStreaming.create({
        name: body.name ?? '',
        url: body.url ?? '',
        secret: body.secret,
        events: body.events,
      });
      res.status(201).json(created);
    }),
  );
  router.delete(
    '/log-streaming/destinations/:id',
    logStreamFeature,
    h(async (req, res) => {
      await services.logStreaming.remove(req.params['id'] as string);
      res.status(204).end();
    }),
  );
  router.post(
    '/log-streaming/destinations/:id/test',
    logStreamFeature,
    h(async (req, res) => {
      res.json(await services.logStreaming.test(req.params['id'] as string));
    }),
  );

  /* ── 外部密钥（docs/10 B4，企业功能；只回 provider + key 名，绝不回值） ── */
  router.get(
    '/external-secrets',
    requireFeature(services.license, 'externalSecrets'),
    h(async (_req, res) => {
      res.json(services.secrets.status());
    }),
  );

  /* ── insights（当前 project 执行聚合，任意成员可读） ── */
  router.get(
    '/insights',
    h(async (req, res) => {
      const executions = await services.executions.list(auth(req).projectId);
      // E2 对标基线：?from=ISO&to=ISO 自定义日期范围；缺省近 7 日
      const parse = (v: unknown): Date | null => {
        if (typeof v !== 'string' || !v) return null;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
      };
      const from = parse(req.query['from']);
      const to = parse(req.query['to']);
      const range = from && to && from.getTime() <= to.getTime() ? { from, to } : undefined;
      res.json(computeInsights(executions, new Date(), range));
    }),
  );

  /* Chat provider 注册表 + 各家已存配置（Chat 页与 Settings 数据源；不含任何密钥） */
  const providerConfig = async (id: string): Promise<{ enabled: boolean; credentialId: string | null; contextWindow: number; lastEditedAt: string | null }> => {
    const raw = await services.repos.settings.get(`chat.provider.${id}`);
    const parsed = raw ? (JSON.parse(raw) as { enabled?: boolean; credentialId?: string | null; contextWindow?: number; lastEditedAt?: string }) : {};
    return {
      enabled: parsed.enabled !== false,
      credentialId: parsed.credentialId ?? null,
      contextWindow: parsed.contextWindow ?? 20,
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
      const body = (req.body ?? {}) as { enabled?: boolean; credentialId?: string | null; contextWindow?: number };
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

  /* ── templates（内置模板库，docs/10 B1） ── */
  router.get(
    '/templates',
    h(async (_req, res) => {
      res.json(templateSummaries());
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

  /* ── 源码同步（工作流 push/pull 到 git；企业版 + 实例 admin） ── */
  const sourceControlFeature = requireFeature(services.license, 'sourceControl');
  router.get(
    '/source-control',
    sourceControlFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json(await services.git.getConfig());
    }),
  );

  router.put(
    '/source-control',
    sourceControlFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const body = parseBody(sourceControlConnectSchema, req);
      const config = await services.git.connect(body);
      recordAudit(services, req, 'source-control.connect', undefined, { branch: config.branch });
      res.json(config);
    }),
  );

  router.delete(
    '/source-control',
    sourceControlFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      await services.git.disconnect();
      recordAudit(services, req, 'source-control.disconnect');
      res.status(204).end();
    }),
  );

  router.get(
    '/source-control/status',
    sourceControlFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json(await services.git.status(auth(req).projectId));
    }),
  );

  router.post(
    '/source-control/push',
    sourceControlFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const { message } = parseBody(sourceControlPushSchema, req);
      const user = await services.repos.users.findById(auth(req).userId);
      const authorName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'nomops';
      const result = await services.git.push({
        projectId: auth(req).projectId,
        message: message ?? 'Update workflows',
        authorName,
        authorEmail: user?.email ?? 'nomops@localhost',
      });
      recordAudit(services, req, 'source-control.push', undefined, { committed: result.committed });
      res.json(result);
    }),
  );

  router.post(
    '/source-control/pull',
    sourceControlFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const result = await services.git.pull(auth(req).projectId);
      recordAudit(services, req, 'source-control.pull', undefined, { created: result.created, updated: result.updated });
      res.json(result);
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

  router.post(
    '/api-keys',
    h(async (req, res) => {
      const body = (req.body ?? {}) as { label?: string; expiresInDays?: number | null; scope?: string };
      const label = String(body.label ?? '').trim();
      if (!label) throw new OperationalError('label is required', { status: 400 });
      const expiresInDays =
        body.expiresInDays == null ? null : Math.max(1, Math.min(3650, Math.floor(Number(body.expiresInDays))));
      if (body.expiresInDays != null && !Number.isFinite(Number(body.expiresInDays))) {
        throw new OperationalError('expiresInDays must be a number', { status: 400 });
      }
      const scope = body.scope === 'readonly' ? 'readonly' : 'all';
      const created = await services.apiKeys.create(auth(req).userId, label, { expiresInDays, scope });
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

  /* ── SSO / SCIM 配置（docs/07：实例 admin + 对应功能） ── */

  /** 实例管理员检查（users.role ∈ owner/admin）。 */
  async function assertInstanceAdmin(req: Request): Promise<void> {
    const user = await services.repos.users.findById(auth(req).userId);
    if (!user || !['owner', 'admin'].includes(user.role)) {
      throw new OperationalError('Requires instance administrator (owner/admin) permission', { status: 403 });
    }
  }

  router.get(
    '/sso/config',
    requireFeature(services.license, 'sso'),
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json((await services.sso.getMaskedConfig()) ?? { enabled: false, issuer: '', clientId: '', clientSecret: '' });
    }),
  );

  router.put(
    '/sso/config',
    requireFeature(services.license, 'sso'),
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const body = parseBody(ssoConfigSchema, req);
      // secret 省略 = 保留旧值
      const existing = await services.sso.getConfig();
      const clientSecret = body.clientSecret ?? existing?.clientSecret ?? '';
      if (body.enabled && !clientSecret) {
        throw new OperationalError('Enabling SSO requires clientSecret', { status: 400 });
      }
      await services.sso.setConfig({ ...body, clientSecret });
      recordAudit(services, req, 'sso.config.update', undefined, { issuer: body.issuer, enabled: body.enabled });
      res.json(await services.sso.getMaskedConfig());
    }),
  );

  /* ── LDAP 配置（docs/10 B5：实例 admin + ldap 功能；bindPassword 绝不出 API） ── */
  const emptyLdapConfig = {
    enabled: false,
    url: '',
    bindDn: '',
    bindPassword: '',
    userSearchBase: '',
    loginAttribute: 'uid',
    emailAttribute: 'mail',
    firstNameAttribute: 'givenName',
    lastNameAttribute: 'sn',
  };
  router.get(
    '/ldap/config',
    requireFeature(services.license, 'ldap'),
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      res.json((await services.ldap.getMaskedConfig()) ?? emptyLdapConfig);
    }),
  );
  router.put(
    '/ldap/config',
    requireFeature(services.license, 'ldap'),
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const str = (k: string): string | undefined => (typeof b[k] === 'string' ? (b[k] as string) : undefined);
      const enabled = b['enabled'] === true;
      if (enabled && !str('url')) {
        throw new OperationalError('Enabling LDAP requires a server url', { status: 400 });
      }
      await services.ldap.setConfig({
        enabled,
        ...(str('url') !== undefined ? { url: str('url')! } : {}),
        ...(str('bindDn') !== undefined ? { bindDn: str('bindDn')! } : {}),
        // bindPassword 省略/空 = 保留旧密文
        ...(str('bindPassword') ? { bindPassword: str('bindPassword')! } : {}),
        ...(str('userSearchBase') !== undefined ? { userSearchBase: str('userSearchBase')! } : {}),
        ...(str('loginAttribute') !== undefined ? { loginAttribute: str('loginAttribute')! } : {}),
        ...(str('emailAttribute') !== undefined ? { emailAttribute: str('emailAttribute')! } : {}),
        ...(str('firstNameAttribute') !== undefined ? { firstNameAttribute: str('firstNameAttribute')! } : {}),
        ...(str('lastNameAttribute') !== undefined ? { lastNameAttribute: str('lastNameAttribute')! } : {}),
      });
      recordAudit(services, req, 'ldap.config.update', undefined, { enabled });
      res.json(await services.ldap.getMaskedConfig());
    }),
  );

  router.post(
    '/scim/token',
    requireFeature(services.license, 'scim'),
    h(async (req, res) => {
      await assertInstanceAdmin(req);
      const token = await services.scim.generateToken();
      recordAudit(services, req, 'scim.token.create');
      // 明文仅此一次（docs/07）
      res.status(201).json({ token, note: 'Save this now; the token will not be shown again' });
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
          createdAt: u.createdAt,
        })),
        ...invitations.map((inv) => ({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          disabled: false,
          pending: true,
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

  return router;
}

/**
 * Webhook 公开入口（无鉴权，按 (path, method) 查路由表触发）。
 * path 支持多段（/webhook/a/b/c → "a/b/c"）。
 */
export function createWebhookRouter(services: AppServices): Router {
  const router = Router();
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
      const seed = [
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
      const summary = await services.executions.runTriggered(
        entity.workflowId,
        'webhook',
        seed,
        entity.node,
      );
      // 系统触发：无用户上下文（docs/06）
      services.audit.log({
        projectId: await services.repos.workflows.getOwnerProjectId(entity.workflowId),
        action: 'workflow.run',
        resourceType: 'workflow',
        resourceId: entity.workflowId,
        details: { mode: 'webhook', executionId: summary.executionId },
        ip: req.ip ?? null,
      });
      res.json(summary);
    }),
  );
  return router;
}
