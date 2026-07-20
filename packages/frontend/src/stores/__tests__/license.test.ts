import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { LicenseInfo } from '../../api/client.js';
import { useProjectsStore } from '../projects.js';

/**
 * 前端消费 License 的语义（B1）。
 *
 * 关键点：后端在证书失效时已把 plan 回落为 'community'、features 清空，
 * 前端不该再自己判断「有没有 key」来决定解锁——那正是过去的漏洞形态。
 */
const info = (overrides: Partial<LicenseInfo> = {}): LicenseInfo => ({
  plan: 'Business',
  features: ['rbac', 'sourceControl'],
  quotas: { teamProjects: 6 },
  activated: true,
  status: 'active',
  ...overrides,
});

let projects: ReturnType<typeof useProjectsStore>;

beforeEach(() => {
  setActivePinia(createPinia());
  projects = useProjectsStore();
});

describe('hasFeature', () => {
  it('未取到 license 时一律未解锁（默认拒绝）', () => {
    expect(projects.hasFeature('rbac')).toBe(false);
  });

  it('只解锁证书里列出的功能位', () => {
    projects.license = info();

    expect(projects.hasFeature('rbac')).toBe(true);
    expect(projects.hasFeature('sourceControl')).toBe(true);
    expect(projects.hasFeature('sso')).toBe(false);
  });

  it('★过期证书：后端已清空 features，前端跟着全锁', () => {
    projects.license = info({
      plan: 'community',
      features: [],
      quotas: {},
      status: 'expired',
      activated: true,
      message: 'License has expired',
    });

    expect(projects.hasFeature('rbac')).toBe(false);
    expect(projects.hasFeature('sourceControl')).toBe(false);
  });

  it('★验签不过：activated 为 true 但同样全锁（不能因为「填了 key」就放行）', () => {
    projects.license = info({
      plan: 'community',
      features: [],
      status: 'invalid',
      activated: true,
      message: 'License key signature is invalid',
    });

    expect(projects.hasFeature('rbac')).toBe(false);
  });
});

describe('状态区分', () => {
  it('inactive 与 expired 可区分（前者没填，后者要提示续费）', () => {
    projects.license = info({ activated: false, status: 'inactive', features: [], plan: 'community' });
    expect(projects.license.activated).toBe(false);

    projects.license = info({ activated: true, status: 'expired', features: [], plan: 'community' });
    expect(projects.license.activated).toBe(true);
    expect(projects.license.status).toBe('expired');
  });

  it('配额随证书下发，供 UI 展示上限', () => {
    projects.license = info({ quotas: { teamProjects: 6, users: -1 } });

    expect(projects.license.quotas['teamProjects']).toBe(6);
    expect(projects.license.quotas['users']).toBe(-1); // -1 = 不限
  });
});
