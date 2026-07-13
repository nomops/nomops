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
import { getTemplate, templateSummaries } from '../services/template-registry.js';
import {
  activateBodySchema,
  addMemberSchema,
  createProjectSchema,
  credentialBodySchema,
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
  ssoConfigSchema,
  variableBodySchema,
  workflowBodySchema,
  workflowPatchSchema,
  communityNodeInstallSchema,
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
      // ?folderId 缺省 → 全部；'root'/'' → 项目根；其它 → 指定文件夹
      const fq = req.query['folderId'];
      const folderId = fq === undefined ? undefined : fq === 'root' || fq === '' ? null : String(fq);
      res.json(await services.workflows.list(auth(req).projectId, folderId));
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
      res.json(await services.workflows.getById(param(req, 'id'), auth(req).projectId));
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

  /* ── 工作流版本历史（对标 n8n：编辑保存快照、可查看/回滚） ── */
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

  /* ── 文件夹（对标 n8n：项目内组织工作流，支持嵌套） ── */
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
      const row = await services.workflows.getById(param(req, 'id'), auth(req).projectId);
      if (body.active) {
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
      res.json(computeInsights(executions, new Date()));
    }),
  );

  /* ── AI 助手（docs/10 B2） ── */
  router.post(
    '/assistant/chat',
    h(async (req, res) => {
      const body = (req.body ?? {}) as {
        messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
        credentialId?: string;
      };
      if (!Array.isArray(body.messages)) {
        throw new OperationalError('messages is required', { status: 400 });
      }
      const result = await services.assistant.chat(auth(req).projectId, body.messages, body.credentialId);
      res.json(result);
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

  /* ── 社区节点（对标 n8n：owner 安装 npm 节点包，实例级） ── */
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

  /* ── 公共 API 令牌（对标 n8n 的 n8n API；用户级归属） ── */
  router.get(
    '/api-keys',
    h(async (req, res) => {
      res.json(await services.apiKeys.list(auth(req).userId));
    }),
  );

  router.post(
    '/api-keys',
    h(async (req, res) => {
      const label = String((req.body as { label?: string })?.label ?? '').trim();
      if (!label) throw new OperationalError('label is required', { status: 400 });
      const created = await services.apiKeys.create(auth(req).userId, label);
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
      res.json(
        users.map((u) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          disabled: u.disabled,
          createdAt: u.createdAt,
        })),
      );
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
