import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser, setupOwner, licensedBoot } from './helpers.js';
import { TEST_IDP_CERT_BODY } from './fixtures/saml-idp.js';
import { buildSamlResponse } from './fixtures/saml-responder.js';

/**
 * SAML 2.0 单点登录（B2）。
 *
 * XML 签名校验本身交给 @node-saml/node-saml，所以这里不重测密码学，
 * 而是证明**我们把它接对了**——那几条安全性质在真实请求路径上确实生效：
 * 签名无效拒、篡改拒、重放拒、过期拒、受众不符拒、未请求过的断言拒。
 * 接错一处（比如漏配 audience 或 validateInResponseTo），下面就会红。
 */
const BASE_URL = 'http://localhost:5678';
const SP_ENTITY_ID = `${BASE_URL}/sso/saml/metadata`;
const CALLBACK = `${BASE_URL}/sso/saml/callback`;

let boot: BootstrapResult;
let app: Express;
let owner: string;

beforeAll(async () => {
  process.env['NOMOPS_BASE_URL'] = BASE_URL;
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot() });
  app = createApp(boot.services);
  owner = (await setupOwner(app, 'owner@saml.dev')).token;

  await boot.services.saml.setConfig({
    enabled: true,
    idpEntityId: 'https://idp.test/entity',
    idpSsoUrl: 'https://idp.test/sso',
    idpCertificates: [TEST_IDP_CERT_BODY],
  });
});

afterAll(async () => {
  await boot.shutdown();
  delete process.env['NOMOPS_BASE_URL'];
});

/**
 * 走一次真实的 SP 发起流程，拿到本次 AuthnRequest 的 id。
 * 断言必须带这个 InResponseTo 才可能被接受。
 */
async function issueRequestId(): Promise<string> {
  const url = await boot.services.saml.buildLoginUrl();
  const samlRequest = new URL(url).searchParams.get('SAMLRequest');
  expect(samlRequest).toBeTruthy();
  // node-saml 在生成时已把 requestId 写进缓存;这里从 deflate 后的报文里取回 ID
  const { inflateRawSync } = await import('node:zlib');
  const xml = inflateRawSync(Buffer.from(samlRequest!, 'base64')).toString('utf8');
  return /ID="([^"]+)"/.exec(xml)?.[1] ?? '';
}

const post = (samlResponse: string) =>
  request(app).post('/sso/saml/callback').type('form').send({ SAMLResponse: samlResponse });

const good = (overrides: Partial<Parameters<typeof buildSamlResponse>[0]> = {}) => ({
  audience: SP_ENTITY_ID,
  destination: CALLBACK,
  ...overrides,
});

describe('元数据与配置', () => {
  it('SP 元数据可导出，含我们的 EntityID 与回调地址', async () => {
    const res = await request(app).get('/sso/saml/metadata').expect(200);

    expect(res.text).toContain(SP_ENTITY_ID);
    expect(res.text).toContain(CALLBACK);
  });

  it('配置接口不回明文私钥', async () => {
    await boot.services.saml.setConfig({
      enabled: true,
      idpEntityId: 'https://idp.test/entity',
      idpSsoUrl: 'https://idp.test/sso',
      idpCertificates: [TEST_IDP_CERT_BODY],
      spPrivateKey: 'SUPER-SECRET-KEY',
    });
    const masked = await boot.services.saml.getMaskedConfig();

    expect(masked?.spPrivateKey).toBe('••••••••');
    expect(JSON.stringify(masked)).not.toContain('SUPER-SECRET-KEY');

    // 落库的也必须是密文
    const raw = (await boot.services.repos.settings.get('sso.saml')) ?? '';
    expect(raw).not.toContain('SUPER-SECRET-KEY');

    // 复原配置供后续用例
    await boot.services.saml.setConfig({
      enabled: true,
      idpEntityId: 'https://idp.test/entity',
      idpSsoUrl: 'https://idp.test/sso',
      idpCertificates: [TEST_IDP_CERT_BODY],
    });
  });

  it('SP 发起会跳到 IdP 并带上 SAMLRequest', async () => {
    const url = await boot.services.saml.buildLoginUrl();

    expect(url).toContain('https://idp.test/sso');
    expect(new URL(url).searchParams.get('SAMLRequest')).toBeTruthy();
  });
});

describe('合法断言', () => {
  it('签名有效 → 登录成功并 JIT 建号', async () => {
    const inResponseTo = await issueRequestId();
    const res = await post(
      buildSamlResponse(good({ inResponseTo, email: 'jit@saml.dev', firstName: 'Jit', lastName: 'User' })),
    );

    expect(res.status).toBe(302);
    expect(res.headers['location']).toMatch(/^\/sso\/done\?token=/);

    const user = await boot.services.repos.users.findByEmail('jit@saml.dev');
    expect(user).toBeTruthy();
    expect(user?.firstName).toBe('Jit');
  });
});

describe('★安全性质', () => {
  it('未签名的断言被拒', async () => {
    const inResponseTo = await issueRequestId();
    const res = await post(buildSamlResponse(good({ inResponseTo, unsigned: true })));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rejected/i);
  });

  it('★只签外层 Response、不签 Assertion 被拒（签名包装攻击的形态）', async () => {
    const inResponseTo = await issueRequestId();
    const res = await post(
      buildSamlResponse(good({ inResponseTo, signResponseOnly: true, email: 'xsw@saml.dev' })),
    );

    expect(res.status).toBe(400);
    expect(await boot.services.repos.users.findByEmail('xsw@saml.dev')).toBeNull();
  });

  it('用别的私钥签的断言被拒', async () => {
    const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const inResponseTo = await issueRequestId();

    const res = await post(buildSamlResponse(good({ inResponseTo, signingKey: attacker })));

    expect(res.status).toBe(400);
  });

  it('签完之后篡改内容被拒（签名与摘要不再匹配）', async () => {
    const inResponseTo = await issueRequestId();
    const res = await post(
      buildSamlResponse(good({ inResponseTo, tamperEmailAfterSigning: 'attacker@evil.dev' })),
    );

    expect(res.status).toBe(400);
    expect(await boot.services.repos.users.findByEmail('attacker@evil.dev')).toBeNull();
  });

  it('已过期的断言被拒（NotOnOrAfter 在过去）', async () => {
    const inResponseTo = await issueRequestId();
    const res = await post(
      buildSamlResponse(
        good({ inResponseTo, notOnOrAfter: new Date(Date.now() - 60_000), email: 'expired@saml.dev' }),
      ),
    );

    expect(res.status).toBe(400);
    expect(await boot.services.repos.users.findByEmail('expired@saml.dev')).toBeNull();
  });

  it('受众不是我们的断言被拒（防把别处的断言重放过来）', async () => {
    const inResponseTo = await issueRequestId();
    const res = await post(
      buildSamlResponse(
        good({ inResponseTo, audience: 'https://someone-else.example/sp', email: 'wrongaud@saml.dev' }),
      ),
    );

    expect(res.status).toBe(400);
    expect(await boot.services.repos.users.findByEmail('wrongaud@saml.dev')).toBeNull();
  });

  it('我们从未请求过的断言被拒（未经请求的注入）', async () => {
    const res = await post(
      buildSamlResponse(good({ inResponseTo: `_${randomUUID()}`, email: 'unsolicited@saml.dev' })),
    );

    expect(res.status).toBe(400);
    expect(await boot.services.repos.users.findByEmail('unsolicited@saml.dev')).toBeNull();
  });

  it('★同一份断言不能用第二次（重放）', async () => {
    const inResponseTo = await issueRequestId();
    const assertion = buildSamlResponse(good({ inResponseTo, email: 'replay@saml.dev' }));

    await post(assertion).expect(302); // 首次通过
    const second = await post(assertion);

    expect(second.status).toBe(400);
  });
});

describe('配置接口（前端设置页用）', () => {
  const admin = () => ({ Authorization: `Bearer ${owner}` });

  it('读回掩码后的配置，私钥不出 API', async () => {
    await request(app)
      .put('/api/sso/saml/config')
      .set(admin())
      .send({
        enabled: true,
        idpEntityId: 'https://idp.test/entity',
        idpSsoUrl: 'https://idp.test/sso',
        idpCertificates: [TEST_IDP_CERT_BODY],
        spPrivateKey: 'PRIVATE-KEY-MUST-NOT-LEAK',
      })
      .expect(200);

    const res = await request(app).get('/api/sso/saml/config').set(admin()).expect(200);

    expect(res.body.spPrivateKey).toBe('••••••••');
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE-KEY-MUST-NOT-LEAK');
  });

  it('★私钥省略 = 保留旧值（前端不必回传它，也就不必先拿到明文）', async () => {
    await request(app)
      .put('/api/sso/saml/config')
      .set(admin())
      .send({
        enabled: false, // 只改这一项，不传私钥
        idpEntityId: 'https://idp.test/entity',
        idpSsoUrl: 'https://idp.test/sso',
        idpCertificates: [TEST_IDP_CERT_BODY],
      })
      .expect(200);

    const config = await boot.services.saml.getConfig();
    expect(config?.enabled).toBe(false);
    expect(config?.spPrivateKey).toBe('PRIVATE-KEY-MUST-NOT-LEAK'); // 没被清掉
  });

  it('缺证书的配置被拒（启用了却验不了签是最坏的情况）', async () => {
    await request(app)
      .put('/api/sso/saml/config')
      .set(admin())
      .send({
        enabled: true,
        idpEntityId: 'https://idp.test/entity',
        idpSsoUrl: 'https://idp.test/sso',
        idpCertificates: [],
      })
      .expect(400);
  });

  it('非实例 admin 读不到也改不了', async () => {
    const member = await inviteUser(app, owner, 'member@saml.dev');
    const asMember = { Authorization: `Bearer ${member.token}` };

    await request(app).get('/api/sso/saml/config').set(asMember).expect(403);
    await request(app).put('/api/sso/saml/config').set(asMember).send({}).expect(403);
  });

  it('复原配置供后续用例', async () => {
    await boot.services.saml.setConfig({
      enabled: true,
      idpEntityId: 'https://idp.test/entity',
      idpSsoUrl: 'https://idp.test/sso',
      idpCertificates: [TEST_IDP_CERT_BODY],
    });
    expect(await boot.services.saml.isEnabled()).toBe(true);
  });
});

describe('license 门控', () => {
  let ce: BootstrapResult;

  beforeEach(async () => {
    ce = await bootstrap({ dbConfig: { type: 'sqlite' }, licenseKey: null });
  });

  it('社区版:登录/元数据/回调全部 403，status 报未启用', async () => {
    const ceApp = createApp(ce.services);
    try {
      await request(ceApp).get('/sso/saml/login').expect(403);
      await request(ceApp).get('/sso/saml/metadata').expect(403);
      await request(ceApp).post('/sso/saml/callback').type('form').send({ SAMLResponse: 'x' }).expect(403);
      const status = await request(ceApp).get('/sso/saml/status').expect(200);
      expect(status.body.enabled).toBe(false);
    } finally {
      await ce.shutdown();
    }
  });
});
