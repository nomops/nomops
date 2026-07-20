import type { NextFunction, Request, Response } from 'express';
import { OperationalError } from '@nomops/workflow';
import { LICENSE_PUBLIC_KEY, verifyLicenseCert } from './license-cert.js';
import type { CertFailureReason, ILicensePayload } from './license-cert.js';

/**
 * License（docs/06 功能开关 → B1 真实化）。
 *
 * 无 key = 社区版；有 key 则必须是**验签通过且在有效期内**的证书才解锁功能。
 * 这里没有「key 非空即企业版」的后门——那等于没有 license。
 *
 * ★降级不锁数据：过期后功能位关闭、端点返回 403，但已有的团队项目/变量/审计
 * 记录一律保留。用户续费即恢复，不会因为晚付几天丢东西。
 */

/**
 * 功能位清单。
 *
 * ★只登记**当前真有强制点**的功能位。声明了却没人消费的开关，等于骗用户
 * 「配了就生效」——B0 刚清理过一批这种债，不再制造新的。
 * 后续切片（SAML/S3/…）实现时，连同它的强制点一起加进来。
 */
export const LICENSE_FEATURES = [
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
] as const;
export type LicenseFeature = (typeof LICENSE_FEATURES)[number];

/**
 * 配额清单。同上：只登记真正守门的配额。
 * 证书里 -1 = 不限；证书未给该项 = 不限（旧证书遇到新配额时不该突然被卡死）。
 */
export const LICENSE_QUOTAS = ['teamProjects', 'users'] as const;
export type LicenseQuota = (typeof LICENSE_QUOTAS)[number];

export const COMMUNITY_PLAN = 'community';

/** 证书当前处于什么状态——展示与排错都需要区分「没填」「填错了」「过期了」。 */
export type LicenseStatus = 'inactive' | 'active' | 'expired' | 'notYetValid' | 'invalid';

export interface ILicenseInfo {
  plan: string;
  features: LicenseFeature[];
  quotas: Record<string, number>;
  activated: boolean;
  status: LicenseStatus;
  validFrom?: string;
  validTo?: string;
  issuedTo?: string;
  /** status 非 active 时的人类可读原因。 */
  message?: string;
}

/** 配额超限：HTTP 层映射为 402（付费即可解除，与 429 限流区分开）。 */
export class LicenseQuotaExceededError extends OperationalError {
  constructor(quota: LicenseQuota, limit: number, used: number) {
    super(`Plan limit reached for ${quota}: ${used}/${limit}`, {
      status: 402,
      quota,
      limit,
      used,
    });
  }
}

export class LicenseService {
  private raw: string | null = null;
  private payload: ILicensePayload | null = null;
  private failure: { reason: CertFailureReason; message: string } | null = null;

  private readonly publicKey: string;

  /**
   * @param publicKeyBase64 仅供**测试**注入自签密钥对。
   *   生产路径（bootstrap）不传，一律用编译进产物的 LICENSE_PUBLIC_KEY——
   *   这是构造参数而非环境变量，改它必须改源码 + 重新构建，不能靠配置绕过。
   */
  constructor(licenseKey: string | null, publicKeyBase64?: string) {
    this.publicKey = publicKeyBase64 ?? LICENSE_PUBLIC_KEY;
    this.setKey(licenseKey);
  }

  /** 运行时设置/清除激活码（激活弹窗用）。持久化由调用方负责。 */
  setKey(key: string | null): void {
    const trimmed = key?.trim() ?? '';
    this.raw = trimmed === '' ? null : trimmed;
    this.payload = null;
    this.failure = null;
    if (!this.raw) return;

    const result = verifyLicenseCert(this.raw, this.publicKey);
    if (result.ok) this.payload = result.payload;
    else this.failure = { reason: result.reason, message: result.message };
  }

  /** 验签通过**且**当前时刻落在有效期内。每次查询都重算，长跑实例自然降级。 */
  private activeCert(): ILicensePayload | null {
    if (!this.payload) return null;
    const now = Date.now();
    if (now < Date.parse(this.payload.validFrom)) return null;
    if (now >= Date.parse(this.payload.validTo)) return null;
    return this.payload;
  }

  status(): LicenseStatus {
    if (!this.raw) return 'inactive';
    if (!this.payload) return 'invalid';
    const now = Date.now();
    if (now < Date.parse(this.payload.validFrom)) return 'notYetValid';
    if (now >= Date.parse(this.payload.validTo)) return 'expired';
    return 'active';
  }

  /** 套餐名。未激活/无效/过期一律回落社区版。 */
  plan(): string {
    return this.activeCert()?.plan ?? COMMUNITY_PLAN;
  }

  isFeatureEnabled(feature: LicenseFeature): boolean {
    return this.activeCert()?.features.includes(feature) ?? false;
  }

  /** 已填了 key（不代表有效）——用于区分「没填」与「填了但不认」。 */
  isActivated(): boolean {
    return this.raw !== null;
  }

  /** 配额上限；null = 不限（未激活、证书没给该项、或显式 -1）。 */
  quota(name: LicenseQuota): number | null {
    const value = this.activeCert()?.quotas[name];
    if (value === undefined || value < 0) return null;
    return value;
  }

  /**
   * 配额守门：用量已达上限则抛 402。
   * `used` 由调用方查当前值传入（各配额的计数口径不同，不在此耦合）。
   */
  assertQuota(name: LicenseQuota, used: number): void {
    const limit = this.quota(name);
    if (limit !== null && used >= limit) {
      throw new LicenseQuotaExceededError(name, limit, used);
    }
  }

  info(): ILicenseInfo {
    const cert = this.activeCert();
    const status = this.status();
    return {
      plan: this.plan(),
      features: cert ? (cert.features.filter(isKnownFeature) as LicenseFeature[]) : [],
      quotas: cert?.quotas ?? {},
      activated: this.isActivated(),
      status,
      ...(this.payload
        ? {
            validFrom: this.payload.validFrom,
            validTo: this.payload.validTo,
            ...(this.payload.issuedTo ? { issuedTo: this.payload.issuedTo } : {}),
          }
        : {}),
      ...(status === 'invalid' && this.failure ? { message: this.failure.message } : {}),
      ...(status === 'expired' ? { message: 'License has expired' } : {}),
      ...(status === 'notYetValid' ? { message: 'License is not valid yet' } : {}),
    };
  }
}

function isKnownFeature(feature: string): boolean {
  return (LICENSE_FEATURES as readonly string[]).includes(feature);
}

/** 路由级功能门：未解锁 → 403 { error, feature }（docs/06）。 */
export function requireFeature(license: LicenseService, feature: LicenseFeature) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!license.isFeatureEnabled(feature)) {
      res.status(403).json({
        error: `This feature requires a paid license: ${feature}`,
        feature,
      });
      return;
    }
    next();
  };
}
