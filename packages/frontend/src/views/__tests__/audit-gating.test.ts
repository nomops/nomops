import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import type { LicenseInfo } from '../../api/client.js';
import { api } from '../../api/client.js';
import { useProjectsStore } from '../../stores/projects.js';
import AuditView from '../AuditView.vue';

/**
 * 审计日志页的授权门控（A2）。
 *
 * 此前该页完全没有门控：社区版用户进来会看到一句裸的 403 文案
 * （"This feature requires a paid license: auditLogs"），而不是锁卡。
 * 后端拦住了数据，但前端把 license 的实现细节漏给了用户。
 */
const license = (features: string[]): LicenseInfo => ({
  plan: features.length ? 'Enterprise' : 'community',
  features,
  quotas: {},
  activated: features.length > 0,
  status: features.length ? 'active' : 'inactive',
});

function stubStore(features: string[]) {
  const projects = useProjectsStore();
  projects.projects = [{ id: 'p1', name: 'Acme', type: 'team', role: 'project:owner' } as never];
  projects.currentProjectId = 'p1';
  projects.license = license(features);
  // fetch 会重新拉真实数据，这里固定住上面的桩
  vi.spyOn(projects, 'fetch').mockResolvedValue(undefined);
  return projects;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

describe('未授权', () => {
  it('显示锁卡而非裸 403 文案', async () => {
    stubStore([]);
    const listSpy = vi.spyOn(api.auditLogs, 'list');

    const w = mount(AuditView);
    await flushPromises();

    expect(w.find('[data-test="audit-locked"]').exists()).toBe(true);
    expect(w.find('[data-test="audit-error"]').exists()).toBe(false);
    expect(w.find('[data-test="audit-table"]').exists()).toBe(false);
    expect(listSpy).not.toHaveBeenCalled(); // ★连请求都不该发
  });
});

describe('已授权', () => {
  it('正常拉取并渲染表格，不显示锁卡', async () => {
    stubStore(['auditLogs']);
    vi.spyOn(api.auditLogs, 'list').mockResolvedValue([
      {
        id: 'a1',
        timestamp: new Date().toISOString(),
        action: 'workflow.create',
        resourceType: 'workflow',
        details: null,
        ip: '127.0.0.1',
      } as never,
    ]);

    const w = mount(AuditView);
    await flushPromises();

    expect(w.find('[data-test="audit-locked"]').exists()).toBe(false);
    expect(w.find('[data-test="audit-table"]').exists()).toBe(true);
  });

  it('已授权但非项目 owner → 显示后端错误（这条路径仍要保留）', async () => {
    stubStore(['auditLogs']);
    vi.spyOn(api.auditLogs, 'list').mockRejectedValue(new Error('Forbidden'));

    const w = mount(AuditView);
    await flushPromises();

    expect(w.find('[data-test="audit-error"]').text()).toContain('Forbidden');
    expect(w.find('[data-test="audit-locked"]').exists()).toBe(false);
  });
});
