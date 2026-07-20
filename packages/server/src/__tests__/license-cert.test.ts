import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { signLicenseCert, verifyLicenseCert } from '../license/license-cert.js';
import type { ILicensePayload } from '../license/license-cert.js';
import { LicenseService } from '../license/license-service.js';

/**
 * License 验签与降级（B1）。
 *
 * 此前「key 非空即企业版」等于没有 license。这组用例守的是：
 * 伪造进不来、篡改进不来、过期自动降级、且降级只锁功能不锁数据。
 */

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

const KEYS = keypair();

const payload = (overrides: Partial<ILicensePayload> = {}): ILicensePayload => ({
  id: 'lic-1',
  plan: 'Business',
  features: ['rbac', 'sourceControl'],
  quotas: { teamProjects: 6, users: -1 },
  validFrom: new Date(Date.now() - 86_400_000).toISOString(),
  validTo: new Date(Date.now() + 86_400_000).toISOString(),
  ...overrides,
});

const issue = (o: Partial<ILicensePayload> = {}, key = KEYS.privateKey) =>
  signLicenseCert(payload(o), key);

const service = (cert: string | null) => new LicenseService(cert, KEYS.publicKey);

/* ────────────── 验签 ────────────── */

describe('证书验签', () => {
  it('合法证书验得过，字段原样解出', () => {
    const result = verifyLicenseCert(issue(), KEYS.publicKey);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.plan).toBe('Business');
    expect(result.payload.features).toEqual(['rbac', 'sourceControl']);
    expect(result.payload.quotas).toEqual({ teamProjects: 6, users: -1 });
  });

  it('★别人的私钥签的证书验不过', () => {
    const attacker = keypair();
    const result = verifyLicenseCert(issue({}, attacker.privateKey), KEYS.publicKey);

    expect(result).toMatchObject({ ok: false, reason: 'badSignature' });
  });

  it('★改 payload 但留原签名 → 验不过', () => {
    const [prefix, payloadPart, sig] = issue().split('.') as [string, string, string];
    const tampered = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    tampered.features = ['rbac', 'sourceControl', 'sso', 'scim'];
    const forged = `${prefix}.${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${sig}`;

    expect(verifyLicenseCert(forged, KEYS.publicKey)).toMatchObject({
      ok: false,
      reason: 'badSignature',
    });
  });

  it('格式不对的输入一律 malformed，不抛异常', () => {
    for (const bad of ['', 'garbage', 'NOMOPS1.only-two-parts', 'WRONG.aaa.bbb', 'NOMOPS1..']) {
      expect(verifyLicenseCert(bad, KEYS.publicKey).ok).toBe(false);
    }
  });

  it('公钥配错时按验不过处理，不崩', () => {
    expect(verifyLicenseCert(issue(), 'not-a-key').ok).toBe(false);
  });

  it('签名对但字段不合法 → badPayload（签发端 bug 也要拦）', () => {
    const bad = signLicenseCert(
      { ...payload(), validTo: payload().validFrom } as ILicensePayload,
      KEYS.privateKey,
    );

    expect(verifyLicenseCert(bad, KEYS.publicKey)).toMatchObject({
      ok: false,
      reason: 'badPayload',
    });
  });
});

/* ────────────── 自签绕过通道（A1） ────────────── */

describe('★公钥不可经配置覆盖', () => {
  it('设了环境变量也不改变验签用的公钥（否则自签即可解锁）', () => {
    const attacker = keypair();
    const forged = issue({ plan: 'Enterprise', features: ['rbac'] }, attacker.privateKey);
    const saved = process.env['NOMOPS_LICENSE_PUBLIC_KEY'];

    process.env['NOMOPS_LICENSE_PUBLIC_KEY'] = attacker.publicKey;
    try {
      // 不传构造参数 = 走生产路径，必须用编译进产物的公钥
      const s = new LicenseService(forged);
      expect(s.status()).toBe('invalid');
      expect(s.plan()).toBe('community');
      expect(s.isFeatureEnabled('rbac')).toBe(false);
    } finally {
      if (saved === undefined) delete process.env['NOMOPS_LICENSE_PUBLIC_KEY'];
      else process.env['NOMOPS_LICENSE_PUBLIC_KEY'] = saved;
    }
  });

  it('生产路径用内置公钥，认不出测试密钥签的证书', () => {
    expect(new LicenseService(issue()).status()).toBe('invalid');
  });
});

/* ────────────── 状态与降级 ────────────── */

describe('LicenseService 状态机', () => {
  it('无 key = 社区版（零回归基线）', () => {
    const s = service(null);

    expect(s.status()).toBe('inactive');
    expect(s.plan()).toBe('community');
    expect(s.isActivated()).toBe(false);
    expect(s.isFeatureEnabled('rbac')).toBe(false);
  });

  it('合法且在有效期内 → 功能解锁', () => {
    const s = service(issue());

    expect(s.status()).toBe('active');
    expect(s.plan()).toBe('Business');
    expect(s.isFeatureEnabled('rbac')).toBe(true);
    expect(s.isFeatureEnabled('sourceControl')).toBe(true);
  });

  it('证书没给的功能位不解锁（不是「有证书就全开」）', () => {
    const s = service(issue({ features: ['rbac'] }));

    expect(s.isFeatureEnabled('rbac')).toBe(true);
    expect(s.isFeatureEnabled('sso')).toBe(false);
    expect(s.isFeatureEnabled('externalSecrets')).toBe(false);
  });

  it('★过期 → 降级社区版，但 activated 仍为 true（与「没填」可区分）', () => {
    const s = service(
      issue({
        validFrom: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        validTo: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    expect(s.status()).toBe('expired');
    expect(s.plan()).toBe('community');
    expect(s.isFeatureEnabled('rbac')).toBe(false);
    expect(s.isActivated()).toBe(true);
    expect(s.info().message).toBe('License has expired');
  });

  it('尚未生效的证书同样不解锁', () => {
    const s = service(
      issue({
        validFrom: new Date(Date.now() + 86_400_000).toISOString(),
        validTo: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }),
    );

    expect(s.status()).toBe('notYetValid');
    expect(s.isFeatureEnabled('rbac')).toBe(false);
  });

  it('★到期是按调用时刻算的（长跑实例无需重启即自然降级）', () => {
    const s = service(issue({ validTo: new Date(Date.now() + 40).toISOString() }));
    expect(s.isFeatureEnabled('rbac')).toBe(true);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(s.status()).toBe('expired');
        expect(s.isFeatureEnabled('rbac')).toBe(false);
        resolve();
      }, 60);
    });
  });

  it('无效 key 报出原因，供排错', () => {
    const s = service('NOMOPS1.garbage.garbage');

    expect(s.status()).toBe('invalid');
    expect(s.plan()).toBe('community');
    expect(s.info().message).toBeTruthy();
  });

  it('info 只回报已知功能位（证书里的未知位不外泄给前端）', () => {
    const s = service(issue({ features: ['rbac', 'someFutureFeature'] }));

    expect(s.info().features).toEqual(['rbac']);
  });

  it('setKey 可运行时切换，无需重启', () => {
    const s = service(null);
    expect(s.isFeatureEnabled('rbac')).toBe(false);

    s.setKey(issue());
    expect(s.isFeatureEnabled('rbac')).toBe(true);

    s.setKey(null);
    expect(s.isFeatureEnabled('rbac')).toBe(false);
  });
});

/* ────────────── 配额 ────────────── */

describe('配额', () => {
  it('未激活时一律不限（社区版不设卡）', () => {
    const s = service(null);

    expect(s.quota('teamProjects')).toBeNull();
    expect(() => s.assertQuota('teamProjects', 9999)).not.toThrow();
  });

  it('-1 表示不限', () => {
    const s = service(issue({ quotas: { users: -1 } }));

    expect(s.quota('users')).toBeNull();
    expect(() => s.assertQuota('users', 9999)).not.toThrow();
  });

  it('证书没给的配额项不限（旧证书遇到新配额不该被卡死）', () => {
    const s = service(issue({ quotas: {} }));

    expect(s.quota('teamProjects')).toBeNull();
  });

  it('未达上限放行，达到即抛 402', () => {
    const s = service(issue({ quotas: { teamProjects: 3 } }));

    expect(() => s.assertQuota('teamProjects', 2)).not.toThrow();
    expect(() => s.assertQuota('teamProjects', 3)).toThrow(/teamProjects/);

    try {
      s.assertQuota('teamProjects', 3);
    } catch (error) {
      expect((error as { context: Record<string, unknown> }).context).toMatchObject({
        status: 402,
        quota: 'teamProjects',
        limit: 3,
        used: 3,
      });
    }
  });

  it('过期后配额回落为不限（降级不该反而把人锁得更死）', () => {
    const s = service(
      issue({
        quotas: { teamProjects: 1 },
        validFrom: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        validTo: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    expect(s.quota('teamProjects')).toBeNull();
  });
});
