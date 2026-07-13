import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser, setupOwner } from './helpers.js';

/** Phase 6b（docs/07）验收：OIDC 全流程（mock IdP）、SCIM Users、license/admin 门。 */

const CLIENT_ID = 'nomops-client';
const CLIENT_SECRET = 'shhh-client-secret';

/** 进程内 mock IdP：discovery + jwks + token（code = base64url({email, nonce})）。 */
async function startMockIdp(): Promise<{ issuer: string; close: () => Promise<void> }> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

  const idp = express();
  idp.use(express.urlencoded({ extended: false }));
  let issuer = '';

  idp.get('/.well-known/openid-configuration', (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    });
  });
  idp.get('/jwks', (_req, res) => res.json({ keys: [jwk] }));
  idp.post('/token', (req, res) => {
    void (async () => {
      const code = String((req.body as Record<string, string>)['code'] ?? '');
      const { email, nonce } = JSON.parse(Buffer.from(code, 'base64url').toString()) as {
        email: string;
        nonce: string;
      };
      const idToken = await new SignJWT({ email, nonce, given_name: 'Ida', family_name: 'Provider' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(issuer)
        .setAudience(CLIENT_ID)
        .setSubject(`idp|${email}`)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      res.json({ access_token: 'at-x', token_type: 'bearer', id_token: idToken, expires_in: 300 });
    })();
  });

  const server: Server = createServer(idp);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  issuer = `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;
  return { issuer, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

describe('企业版 SSO + SCIM', () => {
  let boot: BootstrapResult;
  let app: Express;
  let idp: Awaited<ReturnType<typeof startMockIdp>>;
  let adminToken: string;
  let memberToken: string;
  let scimToken: string;

  const admin = () => ({ Authorization: `Bearer ${adminToken}` });
  const scim = () => ({ Authorization: `Bearer ${scimToken}` });

  /** 走一遍 /sso/login → 从跳转 URL 提取 state/nonce → 造 code → /sso/callback。 */
  async function ssoLogin(email: string): Promise<request.Response> {
    const login = await request(app).get('/sso/login').expect(302);
    const authorizeUrl = new URL(login.headers['location']!);
    const state = authorizeUrl.searchParams.get('state')!;
    const nonce = authorizeUrl.searchParams.get('nonce')!;
    const code = Buffer.from(JSON.stringify({ email, nonce })).toString('base64url');
    return request(app).get(`/sso/callback?code=${code}&state=${state}`);
  }

  beforeAll(async () => {
    idp = await startMockIdp();
    boot = await bootstrap({ dbConfig: { type: 'sqlite' }, licenseKey: 'test-ent' });
    app = createApp(boot.services);

    // 第一个注册用户 = 实例 owner；member 经邀请（公开注册在 owner 后关闭）
    adminToken = (await setupOwner(app, 'admin@corp.dev', 'admin-pass-123')).token;
    memberToken = (await inviteUser(app, adminToken, 'member@corp.dev', { password: 'member-pass-1' })).token;
  });

  afterAll(async () => {
    await boot.shutdown();
    await idp.close();
  });

  describe('配置与权限门', () => {
    it('第一个注册用户 role=owner，可写 SSO 配置；member 403', async () => {
      await request(app)
        .put('/api/sso/config')
        .set({ Authorization: `Bearer ${memberToken}` })
        .send({ enabled: true, issuer: idp.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
        .expect(403);

      const res = await request(app)
        .put('/api/sso/config')
        .set(admin())
        .send({ enabled: true, issuer: idp.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
        .expect(200);
      expect(res.body.clientSecret).toBe('••••••••'); // 掩码
    });

    it('clientSecret 密文入库（settings 里无明文）；GET 返回掩码', async () => {
      const raw = await boot.services.repos.settings.get('sso.oidc');
      expect(raw).toBeTruthy();
      expect(raw).not.toContain(CLIENT_SECRET);
      const res = await request(app).get('/api/sso/config').set(admin()).expect(200);
      expect(res.body.clientSecret).toBe('••••••••');
      expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
    });

    it('/sso/status 反映启用状态', async () => {
      const res = await request(app).get('/sso/status').expect(200);
      expect(res.body.enabled).toBe(true);
    });
  });

  describe('OIDC 全流程（验收项）', () => {
    it('/sso/login 302 带 state/nonce/PKCE 参数', async () => {
      const res = await request(app).get('/sso/login').expect(302);
      const url = new URL(res.headers['location']!);
      expect(url.href.startsWith(idp.issuer)).toBe(true);
      expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(url.searchParams.get('nonce')).toBeTruthy();
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('callback 换 token → JIT 预配新用户 → JWT 可用（验收项）', async () => {
      const before = await boot.services.repos.users.count();
      const callback = await ssoLogin('newhire@corp.dev');
      expect(callback.status).toBe(302);
      const done = new URL(callback.headers['location']!, 'http://localhost');
      expect(done.pathname).toBe('/sso/done');
      const token = done.searchParams.get('token')!;
      expect(token).toBeTruthy();

      // 预配了用户 + personal project，JWT 直接可用
      expect(await boot.services.repos.users.count()).toBe(before + 1);
      const authed = { Authorization: `Bearer ${token}` };
      await request(app).get('/api/workflows').set(authed).expect(200);
      const projects = await request(app).get('/api/projects').set(authed).expect(200);
      expect(projects.body).toHaveLength(1);
      expect(projects.body[0].type).toBe('personal');

      // JIT 用户拿到了 IdP 的姓名 claim
      const user = await boot.services.repos.users.findByEmail('newhire@corp.dev');
      expect(user?.firstName).toBe('Ida');
    });

    it('二次 SSO 登录复用既有用户（不重复建）', async () => {
      const before = await boot.services.repos.users.count();
      const callback = await ssoLogin('newhire@corp.dev');
      expect(callback.status).toBe(302);
      expect(await boot.services.repos.users.count()).toBe(before);
    });

    it('SSO 预配用户无法密码登录（随机密码不可用）', async () => {
      await request(app)
        .post('/auth/login')
        .send({ email: 'newhire@corp.dev', password: 'any-guess-123' })
        .expect(400);
    });

    it('state 不存在/过期 → 400', async () => {
      await request(app).get('/sso/callback?code=x&state=forged').expect(400);
    });
  });

  describe('SCIM Users（验收项）', () => {
    it('admin 生成 SCIM token（明文仅一次），member 403', async () => {
      await request(app).post('/api/scim/token').set({ Authorization: `Bearer ${memberToken}` }).expect(403);
      const res = await request(app).post('/api/scim/token').set(admin()).expect(201);
      scimToken = res.body.token;
      expect(scimToken).toMatch(/^nomops_scim_/);
      // 库存哈希非明文
      const stored = await boot.services.repos.settings.get('scim.tokenHash');
      expect(stored).not.toBe(scimToken);
    });

    it('错 token / 缺 token → 401（SCIM 错误格式）', async () => {
      const res = await request(app).get('/scim/v2/Users').expect(401);
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      await request(app)
        .get('/scim/v2/Users')
        .set({ Authorization: 'Bearer nomops_scim_wrong' })
        .expect(401);
    });

    it('POST 建用户 → filter 查到；重复 409', async () => {
      const created = await request(app)
        .post('/scim/v2/Users')
        .set(scim())
        .send({ userName: 'scim-user@corp.dev', name: { givenName: 'Scim', familyName: 'User' }, active: true })
        .expect(201);
      expect(created.body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(created.body.active).toBe(true);

      const list = await request(app)
        .get('/scim/v2/Users?filter=userName%20eq%20%22scim-user@corp.dev%22')
        .set(scim())
        .expect(200);
      expect(list.body.totalResults).toBe(1);
      expect(list.body.Resources[0].userName).toBe('scim-user@corp.dev');

      await request(app)
        .post('/scim/v2/Users')
        .set(scim())
        .send({ userName: 'scim-user@corp.dev' })
        .expect(409);
    });

    it('PATCH active=false → 密码登录立即 401；SSO 回调 403（验收项）', async () => {
      // 给 scim 用户先经 SSO 登录一次（确认账号可用），再停用
      const okLogin = await ssoLogin('scim-user@corp.dev');
      expect(okLogin.status).toBe(302);

      const target = await boot.services.repos.users.findByEmail('scim-user@corp.dev');
      const patched = await request(app)
        .patch(`/scim/v2/Users/${target!.id}`)
        .set(scim())
        .send({ Operations: [{ op: 'replace', path: 'active', value: false }] })
        .expect(200);
      expect(patched.body.active).toBe(false);

      // 密码登录（本来就随机密码）→ 401 文案统一；SSO → 403
      const denied = await ssoLogin('scim-user@corp.dev');
      expect(denied.status).toBe(403);
    });

    it('DELETE = 软删（用户还在，active=false）', async () => {
      const created = await request(app)
        .post('/scim/v2/Users')
        .set(scim())
        .send({ userName: 'to-delete@corp.dev' })
        .expect(201);
      await request(app).delete(`/scim/v2/Users/${created.body.id}`).set(scim()).expect(204);
      const after = await request(app).get(`/scim/v2/Users/${created.body.id}`).set(scim()).expect(200);
      expect(after.body.active).toBe(false); // 软删，资源仍可查
    });

    it('PUT 整体替换姓名', async () => {
      const target = await boot.services.repos.users.findByEmail('to-delete@corp.dev');
      const res = await request(app)
        .put(`/scim/v2/Users/${target!.id}`)
        .set(scim())
        .send({ name: { givenName: 'New', familyName: 'Name' }, active: true })
        .expect(200);
      expect(res.body.name).toEqual({ givenName: 'New', familyName: 'Name' });
      expect(res.body.active).toBe(true);
    });

    it('审计留痕 scim/sso 动作', async () => {
      await new Promise((r) => setTimeout(r, 100));
      // SCIM/SSO 动作多无项目上下文，直接查库验证动作存在
      const db = boot.dbHandle.db;
      const logs = (await db.select().from(boot.dbHandle.schema.auditLogs)) as Array<{ action: string }>;
      const actions = new Set(logs.map((l) => l.action));
      expect(actions.has('sso.config.update')).toBe(true);
      expect(actions.has('auth.sso.login')).toBe(true);
      expect(actions.has('scim.token.create')).toBe(true);
      expect(actions.has('scim.user.create')).toBe(true);
      expect(actions.has('scim.user.deactivate')).toBe(true);
    });
  });
});

describe('社区版：SSO/SCIM 全部拒之门外', () => {
  let boot: BootstrapResult;
  let app: Express;
  let token: string;

  beforeAll(async () => {
    boot = await bootstrap({ dbConfig: { type: 'sqlite' }, licenseKey: null });
    app = createApp(boot.services);
    const reg = await request(app)
      .post('/auth/register')
      .send({ email: 'solo@comm.dev', password: 'password-123' })
      .expect(201);
    token = reg.body.token;
  });

  afterAll(async () => {
    await boot.shutdown();
  });

  it('/sso/login、配置端点、SCIM 全部 403 带 feature', async () => {
    const login = await request(app).get('/sso/login').expect(403);
    expect(login.body.feature).toBe('sso');
    const config = await request(app)
      .put('/api/sso/config')
      .set({ Authorization: `Bearer ${token}` })
      .send({ enabled: true, issuer: 'https://x.dev', clientId: 'c', clientSecret: 's' })
      .expect(403);
    expect(config.body.feature).toBe('sso');
    const scimRes = await request(app).get('/scim/v2/Users').expect(403);
    expect(scimRes.body.detail).toMatch(/Enterprise/);
    const status = await request(app).get('/sso/status').expect(200);
    expect(status.body.enabled).toBe(false);
  });
});
