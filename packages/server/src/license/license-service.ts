import type { NextFunction, Request, Response } from 'express';

/**
 * License（docs/04 Phase 5 骨架 → docs/06 功能开关落地）。
 * 不加 key = 社区版；加 key = 解锁企业功能。
 * TODO(Phase 6b+)：真实校验（签名验证 / license server）。
 */

export type LicensePlan = 'community' | 'enterprise';

/** 企业功能清单（docs/06 + docs/07）。 */
export const ENTERPRISE_FEATURES = [
  'rbac',
  'auditLogs',
  'sso',
  'scim',
  'quotas',
  'logStreaming',
  'externalSecrets',
  'ldap',
  'sourceControl',
] as const;
export type EnterpriseFeature = (typeof ENTERPRISE_FEATURES)[number];

export class LicenseService {
  private licenseKey: string | null;

  constructor(licenseKey: string | null) {
    this.licenseKey = licenseKey;
  }

  plan(): LicensePlan {
    // 骨架：key 非空即企业版。真实实现需验签 + 过期时间 + 功能位。
    return this.licenseKey && this.licenseKey.trim().length > 0 ? 'enterprise' : 'community';
  }

  isFeatureEnabled(feature: EnterpriseFeature): boolean {
    return this.plan() === 'enterprise' && ENTERPRISE_FEATURES.includes(feature);
  }

  /** 是否已激活（有非空 key）。 */
  isActivated(): boolean {
    return !!this.licenseKey && this.licenseKey.trim().length > 0;
  }

  /** 运行时设置/清除激活码（激活弹窗用）。持久化由调用方（settings）负责。 */
  setKey(key: string | null): void {
    this.licenseKey = key && key.trim().length > 0 ? key.trim() : null;
  }

  info(): { plan: LicensePlan; features: EnterpriseFeature[]; activated: boolean } {
    return {
      plan: this.plan(),
      features: this.plan() === 'enterprise' ? [...ENTERPRISE_FEATURES] : [],
      activated: this.isActivated(),
    };
  }
}

/** 路由级功能门：未解锁 → 403 { error, feature }（docs/06）。 */
export function requireFeature(license: LicenseService, feature: EnterpriseFeature) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!license.isFeatureEnabled(feature)) {
      res.status(403).json({
        error: `This feature requires an Enterprise license: ${feature}`,
        feature,
      });
      return;
    }
    next();
  };
}
