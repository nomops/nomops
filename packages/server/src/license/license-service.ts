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
  constructor(private readonly licenseKey: string | null) {}

  plan(): LicensePlan {
    // 骨架：key 非空即企业版。真实实现需验签 + 过期时间 + 功能位。
    return this.licenseKey && this.licenseKey.trim().length > 0 ? 'enterprise' : 'community';
  }

  isFeatureEnabled(feature: EnterpriseFeature): boolean {
    return this.plan() === 'enterprise' && ENTERPRISE_FEATURES.includes(feature);
  }

  info(): { plan: LicensePlan; features: EnterpriseFeature[] } {
    return {
      plan: this.plan(),
      features: this.plan() === 'enterprise' ? [...ENTERPRISE_FEATURES] : [],
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
