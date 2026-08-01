import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { api, type LicenseInfo, type ProjectRow } from '../../../api/client.js';
import { useProjectsStore } from '../../../stores/projects.js';
import SideBar from '../SideBar.vue';

const enterpriseLicense: LicenseInfo = {
  plan: 'Enterprise',
  features: ['rbac'],
  quotas: {},
  activated: true,
  status: 'active',
};

async function mountSideBar() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'overview', component: { template: '<div />' } },
      { path: '/settings', name: 'settings', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();
  vi.spyOn(router, 'go').mockImplementation(() => undefined);
  return {
    router,
    wrapper: mount(SideBar, {
      attachTo: document.body,
      global: {
        plugins: [router],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    }),
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
  vi.spyOn(api.chatSettings, 'get').mockResolvedValue({ enabled: true } as never);
  const projects = useProjectsStore();
  projects.projects = [{ id: 'personal', name: 'Personal', type: 'personal', role: 'project:owner' }];
  projects.currentProjectId = 'personal';
  projects.license = enterpriseLicense;
});

describe('SideBar 新建项目', () => {
  it('使用产品内 Modal，不调用浏览器 prompt', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const { wrapper } = await mountSideBar();

    await wrapper.find('[data-test="quick-create"]').trigger('click');
    await wrapper.find('[data-test="quick-project"]').trigger('click');

    expect(promptSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="project-modal"]').exists()).toBe(true);
    expect((wrapper.find('[data-test="project-name-input"]').element as HTMLInputElement).value).toBe('My project');
    expect(document.activeElement).toBe(wrapper.find('[data-test="project-name-input"]').element);
    wrapper.unmount();
  });

  it('提交去除首尾空格的项目名，并进入新项目', async () => {
    const projects = useProjectsStore();
    const created: ProjectRow = { id: 'team-1', name: 'Design team', type: 'team', role: 'project:owner' };
    const createSpy = vi.spyOn(projects, 'createProject').mockResolvedValue(created);
    const { router, wrapper } = await mountSideBar();

    await wrapper.find('[data-test="quick-create"]').trigger('click');
    await wrapper.find('[data-test="quick-project"]').trigger('click');
    await wrapper.find('[data-test="project-name-input"]').setValue('  Design team  ');
    await wrapper.find('[data-test="project-create"]').trigger('submit');
    await flushPromises();

    expect(createSpy).toHaveBeenCalledWith('Design team');
    expect(projects.currentProjectId).toBe('team-1');
    expect(router.currentRoute.value.query['project']).toBe('team-1');
    expect(wrapper.find('[data-test="project-modal"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
