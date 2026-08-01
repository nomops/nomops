import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { api, tokenStorage } from '../../api/client.js';
import { useAuthStore } from '../../stores/auth.js';
import LoginView from '../LoginView.vue';
import SignupView from '../SignupView.vue';
import SsoDoneView from '../SsoDoneView.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'overview', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/signup', name: 'signup', component: { template: '<div />' } },
      { path: '/sso/done', name: 'ssoDone', component: { template: '<div />' } },
    ],
  });
}

function statusResponse(enabled = false) {
  return { ok: true, json: async () => ({ enabled }) } as Response;
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  vi.restoreAllMocks();
  vi.spyOn(api, 'needsSetup').mockResolvedValue({ needsSetup: false });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse(false)));
  window.history.replaceState({}, '', '/');
});

describe('LoginView', () => {
  it('忘记密码使用产品内状态反馈，并隐藏重复提交表单', async () => {
    const router = makeRouter();
    await router.push('/login');
    await router.isReady();
    vi.spyOn(api, 'forgotPassword').mockResolvedValue({ ok: true });
    const wrapper = mount(LoginView, { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();

    await wrapper.get('[data-test="forgot-link"]').trigger('click');
    await wrapper.get('[data-test="forgot-email"]').setValue('owner@example.com');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.forgotPassword).toHaveBeenCalledWith('owner@example.com');
    expect(wrapper.get('[data-test="forgot-sent"]').attributes('role')).toBe('status');
    expect(wrapper.find('[data-test="forgot-submit"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('首装账户在前端执行一致的强密码校验', async () => {
    vi.spyOn(api, 'needsSetup').mockResolvedValue({ needsSetup: true });
    const router = makeRouter();
    await router.push('/login');
    await router.isReady();
    const auth = useAuthStore();
    const register = vi.spyOn(auth, 'register').mockResolvedValue(undefined);
    const wrapper = mount(LoginView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.get('[data-test="email"]').setValue('owner@example.com');
    await wrapper.get('[data-test="first-name"]').setValue('Owner');
    await wrapper.get('[data-test="last-name"]').setValue('User');
    await wrapper.get('[data-test="password"]').setValue('weakpass');
    await wrapper.get('[data-test="setup-form"]').trigger('submit');

    expect(register).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="auth-error"]').attributes('role')).toBe('alert');
  });
});

describe('SignupView', () => {
  it('无效邀请保持失败页，不回退成公开注册表单', async () => {
    vi.spyOn(api, 'lookupInvite').mockRejectedValue(new Error('invalid'));
    const router = makeRouter();
    await router.push('/signup?invite=expired-token');
    await router.isReady();
    const wrapper = mount(SignupView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.get('[data-test="invite-invalid"]').text()).toContain('invalid');
    expect(wrapper.find('[data-test="signup-form"]').exists()).toBe(false);
  });
});

describe('SsoDoneView', () => {
  it('只在 /api/me 验证成功后建立会话', async () => {
    window.history.replaceState({}, '', '/sso/done?token=invalid-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response));
    const clear = vi.spyOn(tokenStorage, 'clear');
    const auth = useAuthStore();
    const setSession = vi.spyOn(auth, 'setSession');
    const router = makeRouter();
    await router.push('/sso/done');
    await router.isReady();
    const wrapper = mount(SsoDoneView, { global: { plugins: [router] } });
    await flushPromises();

    expect(setSession).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    expect(wrapper.get('[data-test="sso-error"]').attributes('role')).toBe('alert');
  });
});
