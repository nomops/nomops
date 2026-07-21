import type { Router } from 'express';
import { OperationalError } from '@nomops/workflow';
import type { AppServices } from '../app-services.js';
import {
  assertInstanceAdmin,
  assertOwnerOf,
  auth,
  h,
  param,
  parseBody,
  recordAudit,
} from '../http/route-helpers.js';
import {
  samlConfigSchema,
  sourceControlConnectSchema,
  sourceControlPushSchema,
  ssoConfigSchema,
} from '../schemas.js';
import { requireFeature } from './license/license-service.js';

/**
 * 企业路由集中注册（C1 下半场）。
 *
 * ★这些路由实现的是**付费功能**，因此必须落在 ee/ 内——LICENSE_EE 按
 * `packages/server/src/ee/**` 划定商业授权范围。放在社区侧的 controllers 里，
 * 它们就受 Sustainable Use License 管，而 SUL 允许自托管者自行修改。
 *
 * 依赖方向：本文件 import 社区侧的 route-helpers，社区侧只调用本文件导出的
 * 这一个函数。ee → 社区，绝不反向。
 *
 * 尚未搬入的混合区段（community + enterprise 交织在同一资源上）：
 * - `/projects` 与成员管理：GET 列表是社区行为，POST/成员管理才受 rbac 门控
 * - `/quota`：用量查询社区可读，限额才是付费
 * 拆这两处需要先按「读/写」重新切路由，属独立改动，未夹带。
 */
export function registerEeRoutes(router: Router, services: AppServices): void {
  /* ── audit logs（docs/06：查询需企业版 + owner） ── */
  router.get(
    '/audit-logs',
    requireFeature(services.license, 'auditLogs'),
    h(async (req, res) => {
      const projectId = typeof req.query['projectId'] === 'string' ? req.query['projectId'] : auth(req).projectId;
      await assertOwnerOf(services, req, projectId);
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


  /* ── 源码同步（工作流 push/pull 到 git；企业版 + 实例 admin） ── */
  const sourceControlFeature = requireFeature(services.license, 'sourceControl');
  router.get(
    '/source-control',
    sourceControlFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
      res.json(await services.git.getConfig());
    }),
  );

  router.put(
    '/source-control',
    sourceControlFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
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
      await assertInstanceAdmin(services, req);
      await services.git.disconnect();
      recordAudit(services, req, 'source-control.disconnect');
      res.status(204).end();
    }),
  );

  router.get(
    '/source-control/status',
    sourceControlFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
      res.json(await services.git.status(auth(req).projectId));
    }),
  );

  router.post(
    '/source-control/push',
    sourceControlFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
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
      await assertInstanceAdmin(services, req);
      const result = await services.git.pull(auth(req).projectId);
      recordAudit(services, req, 'source-control.pull', undefined, { created: result.created, updated: result.updated });
      res.json(result);
    }),
  );

  // 部署 SSH 公钥：取（无则生成）
  router.get(
    '/source-control/key',
    sourceControlFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
      res.json({ publicKey: await services.git.ensureSshKey() });
    }),
  );

  // 部署 SSH 公钥：重新生成（旧的作废，需在 Git 服务端换新公钥）
  router.post(
    '/source-control/key/refresh',
    sourceControlFeature,
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
      const publicKey = await services.git.refreshSshKey();
      recordAudit(services, req, 'source-control.key-refresh');
      res.json({ publicKey });
    }),
  );


  /* ── SSO / SCIM 配置（docs/07：实例 admin + 对应功能） ── */

  router.get(
    '/sso/config',
    requireFeature(services.license, 'sso'),
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
      res.json((await services.sso.getMaskedConfig()) ?? { enabled: false, issuer: '', clientId: '', clientSecret: '' });
    }),
  );

  router.put(
    '/sso/config',
    requireFeature(services.license, 'sso'),
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
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

  /* ── SAML 2.0 配置（B2：实例 admin + saml 功能位） ── */
  router.get(
    '/sso/saml/config',
    requireFeature(services.license, 'saml'),
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
      res.json(
        (await services.saml.getMaskedConfig()) ?? {
          enabled: false,
          idpEntityId: '',
          idpSsoUrl: '',
          idpCertificates: [],
          spPrivateKey: '',
        },
      );
    }),
  );

  router.put(
    '/sso/saml/config',
    requireFeature(services.license, 'saml'),
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
      const body = parseBody(samlConfigSchema, req);
      // 私钥省略 = 保留旧值（与 OIDC 的 clientSecret 同一约定）
      const existing = await services.saml.getConfig();
      const spPrivateKey = body.spPrivateKey ?? existing?.spPrivateKey;
      await services.saml.setConfig({ ...body, ...(spPrivateKey ? { spPrivateKey } : {}) });
      recordAudit(services, req, 'sso.saml.config.update', undefined, {
        idpEntityId: body.idpEntityId,
        enabled: body.enabled,
      });
      res.json(await services.saml.getMaskedConfig());
    }),
  );

  /**
   * IdP 元数据取回代理（SSO 页 Metadata URL 模式）：浏览器直接抓 IdP 元数据会被
   * CORS 拦，由服务端代取后把 XML 原文回给前端解析。仅管理员 + saml 功能位可用，
   * 只允许 http(s)，10s 超时 + 1MB 上限，抑制 SSRF 滥用面。
   */
  router.get(
    '/sso/saml/fetch-metadata',
    requireFeature(services.license, 'saml'),
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
      const raw = typeof req.query['url'] === 'string' ? req.query['url'] : '';
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw new OperationalError('Invalid metadata URL', { status: 400 });
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new OperationalError('Metadata URL must use http or https', { status: 400 });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const resp = await fetch(url, { signal: controller.signal, redirect: 'follow' });
        if (!resp.ok) {
          throw new OperationalError(`Metadata fetch failed: HTTP ${resp.status}`, { status: 400 });
        }
        const xml = await resp.text();
        if (xml.length > 1_000_000) {
          throw new OperationalError('Metadata document too large', { status: 400 });
        }
        res.json({ xml });
      } catch (error) {
        if (error instanceof OperationalError) throw error;
        throw new OperationalError('Could not fetch metadata from that URL', { status: 400 });
      } finally {
        clearTimeout(timer);
      }
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
      await assertInstanceAdmin(services, req);
      res.json((await services.ldap.getMaskedConfig()) ?? emptyLdapConfig);
    }),
  );
  router.put(
    '/ldap/config',
    requireFeature(services.license, 'ldap'),
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
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

  /** LDAP 连通性测试：对已保存配置做服务账号 bind（Test connection 按钮）。 */
  router.post(
    '/ldap/test',
    requireFeature(services.license, 'ldap'),
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
      await services.ldap.testConnection();
      res.json({ ok: true });
    }),
  );

  router.post(
    '/scim/token',
    requireFeature(services.license, 'scim'),
    h(async (req, res) => {
      await assertInstanceAdmin(services, req);
      const token = await services.scim.generateToken();
      recordAudit(services, req, 'scim.token.create');
      // 明文仅此一次（docs/07）
      res.status(201).json({ token, note: 'Save this now; the token will not be shown again' });
    }),
  );

}
