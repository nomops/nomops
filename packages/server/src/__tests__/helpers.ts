import request from 'supertest';
import type { Express } from 'express';
import { generateKeyPairSync } from 'node:crypto';
import { signLicenseCert } from '../ee/license/license-cert.js';

/**
 * 测试用户创建助手（自托管：首个用户 = owner，其余经邀请）。
 * 公开注册 `/auth/register` 只对无用户的实例开放（创建 owner）；此后要靠 owner 邀请。
 */

const PW = 'password-123';

/** 首个用户 = 实例 owner。返回 token + userId。 */
export async function setupOwner(
  app: Express,
  email: string,
  password = PW,
): Promise<{ token: string; userId: string; projectId: string }> {
  const res = await request(app).post('/auth/register').send({ email, password }).expect(201);
  return {
    token: res.body.token as string,
    userId: res.body.user.id as string,
    projectId: res.body.projectId as string,
  };
}

/**
 * 邀请一个用户并立即接受（走真实的 invite → accept 端点），返回其已登录会话。
 * 需传实例 admin/owner 的 token 来发起邀请。
 */
export async function inviteUser(
  app: Express,
  ownerToken: string,
  email: string,
  opts: { role?: 'admin' | 'member'; password?: string } = {},
): Promise<{ token: string; userId: string; projectId: string; inviteToken: string }> {
  const password = opts.password ?? PW;
  const inv = await request(app)
    .post('/api/instance/users/invite')
    .set({ Authorization: `Bearer ${ownerToken}` })
    .send({ email, role: opts.role ?? 'member' })
    .expect(201);
  const inviteToken = new URL(inv.body.inviteLink).searchParams.get('invite') ?? '';
  const accept = await request(app)
    .post(`/auth/invite/${inviteToken}/accept`)
    .send({ password })
    .expect(201);
  return {
    token: accept.body.token as string,
    userId: accept.body.user.id as string,
    projectId: accept.body.projectId as string,
    inviteToken,
  };
}

/* ────────────── License 证书（B1：验签生效，假 key 不再解锁任何东西） ────────────── */

/**
 * 测试专用签发密钥对。生产私钥不在仓库里（也不该在），
 * 所以测试自带一副自签自验，并把配套公钥经 bootstrap 注入实例。
 */
const TEST_KEYS = (() => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
})();

export const TEST_LICENSE_PUBLIC_KEY = TEST_KEYS.publicKey;

/** 全功能证书的功能位（= 当前 LICENSE_FEATURES 全集）。 */
export const ALL_TEST_FEATURES = [
  'rbac',
  'auditLogs',
  'sso',
  'saml',
  'scim',
  'quotas',
  'logStreaming',
  'externalSecrets',
  'ldap',
  'sourceControl',
];

/**
 * 签发一张测试证书。缺省：全功能、无配额上限、昨天起一年有效。
 * 传 validFrom/validTo 可造过期或尚未生效的证书。
 */
export function testLicense(
  overrides: {
    plan?: string;
    features?: string[];
    quotas?: Record<string, number>;
    validFrom?: Date;
    validTo?: Date;
    issuedTo?: string;
  } = {},
): string {
  const now = Date.now();
  return signLicenseCert(
    {
      id: 'test-license',
      plan: overrides.plan ?? 'Enterprise',
      features: overrides.features ?? ALL_TEST_FEATURES,
      quotas: overrides.quotas ?? {},
      ...(overrides.issuedTo ? { issuedTo: overrides.issuedTo } : {}),
      validFrom: (overrides.validFrom ?? new Date(now - 86_400_000)).toISOString(),
      validTo: (overrides.validTo ?? new Date(now + 365 * 86_400_000)).toISOString(),
    },
    TEST_KEYS.privateKey,
  );
}

/** 起测试实例常用的 license 三件套（全功能证书 + 配套公钥）。 */
export function licensedBoot(overrides?: Parameters<typeof testLicense>[0]) {
  return { licenseKey: testLicense(overrides), licensePublicKey: TEST_LICENSE_PUBLIC_KEY };
}
