import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import type { LicenseInfo } from '../../api/client.js';
import { api } from '../../api/client.js';
import { useProjectsStore } from '../../stores/projects.js';
import SettingsView from '../SettingsView.vue';

/**
 * SSO 设置页的双协议分段（B2 前端）。
 *
 * 页面文案早就写着 "Supports SAML 2.0 and OpenID Connect"，但此前只有 OIDC
 * 能配——UI 承诺了没兑现。这组用例守三件事：两协议各自独立启用、
 * SAML 有独立的功能位门控、以及私钥不经前端回传。
 */
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { s: 'sso' }, path: '/settings' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const license = (features: string[]): LicenseInfo => ({
  plan: features.length ? 'Enterprise' : 'community',
  features,
  quotas: {},
  activated: features.length > 0,
  status: features.length ? 'active' : 'inactive',
});

function stub(features: string[]) {
  const projects = useProjectsStore();
  projects.license = license(features);
  vi.spyOn(projects, 'fetch').mockResolvedValue(undefined);

  vi.spyOn(api.sso, 'config').mockResolvedValue({
    enabled: true,
    issuer: 'https://oidc.test',
    clientId: 'cid',
    clientSecret: '••••••••',
  });
  vi.spyOn(api.saml, 'config').mockResolvedValue({
    enabled: false,
    idpEntityId: 'https://idp.test/entity',
    idpSsoUrl: 'https://idp.test/sso',
    idpCertificates: ['CERT-A', 'CERT-B'],
    spPrivateKey: '••••••••',
  });
  return projects;
}

const mountSettings = async () => {
  const w = mount(SettingsView, { global: { stubs: { RouterLink: true } } });
  await flushPromises();
  return w;
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

describe('协议分段', () => {
  it('两个协议都有入口，缺省停在 OIDC', async () => {
    stub(['sso', 'saml']);
    const w = await mountSettings();

    expect(w.find('[data-test="sso-tab-oidc"]').exists()).toBe(true);
    expect(w.find('[data-test="sso-tab-saml"]').exists()).toBe(true);
    expect(w.find('[data-test="sso-save"]').exists()).toBe(true); // OIDC 表单
    expect(w.find('[data-test="saml-form"]').exists()).toBe(false);
  });

  it('切到 SAML 显示 SAML 表单，且证书按行回填（支持轮换）', async () => {
    stub(['sso', 'saml']);
    const w = await mountSettings();

    await w.find('[data-test="sso-tab-saml"]').trigger('click');

    expect(w.find('[data-test="saml-form"]').exists()).toBe(true);
    expect((w.find('[data-test="saml-certs"]').element as HTMLTextAreaElement).value).toBe(
      'CERT-A\nCERT-B',
    );
  });

  it('★两协议独立启用：只启用 OIDC 时 SAML 不受影响', async () => {
    stub(['sso', 'saml']);
    const w = await mountSettings();

    // OIDC 已启用 → 它那个 tab 有亮点；SAML 未启用 → 没有
    expect(w.find('[data-test="sso-tab-oidc"]').find('.proto-on').exists()).toBe(true);
    expect(w.find('[data-test="sso-tab-saml"]').find('.proto-on').exists()).toBe(false);
  });
});

describe('SAML 是独立功能位', () => {
  it('有 sso 但没 saml → SAML 分段出锁卡，不出表单', async () => {
    stub(['sso']);
    const w = await mountSettings();

    await w.find('[data-test="sso-tab-saml"]').trigger('click');

    expect(w.find('[data-test="saml-locked"]').exists()).toBe(true);
    expect(w.find('[data-test="saml-form"]').exists()).toBe(false);
  });

  it('未授权时不拉 SAML 配置（省一次注定 403 的请求）', async () => {
    stub(['sso']);
    const spy = vi.spyOn(api.saml, 'config');
    await mountSettings();

    expect(spy).not.toHaveBeenCalled();
  });

  it('SAML 拉取失败不影响 OIDC 那半', async () => {
    stub(['sso', 'saml']);
    vi.spyOn(api.saml, 'config').mockRejectedValue(new Error('boom'));
    const w = await mountSettings();

    expect(w.find('[data-test="sso-save"]').exists()).toBe(true); // OIDC 表单照常
  });
});

describe('★私钥不经前端回传', () => {
  it('留空提交时不带 spPrivateKey 字段（后端据此保留旧值）', async () => {
    stub(['sso', 'saml']);
    const save = vi.spyOn(api.saml, 'save').mockResolvedValue({
      enabled: true,
      idpEntityId: 'https://idp.test/entity',
      idpSsoUrl: 'https://idp.test/sso',
      idpCertificates: ['CERT-A'],
      spPrivateKey: '••••••••',
    });
    const w = await mountSettings();
    await w.find('[data-test="sso-tab-saml"]').trigger('click');

    await w.find('[data-test="saml-save"]').trigger('click');
    await flushPromises();

    const body = save.mock.calls[0]![0];
    expect(body).not.toHaveProperty('spPrivateKey'); // ★掩码绝不当成真值回传
    expect(body.idpCertificates).toEqual(['CERT-A', 'CERT-B']);
  });

  it('启用但没填证书 → 前端就拦下，不发注定失败的请求', async () => {
    stub(['sso', 'saml']);
    const save = vi.spyOn(api.saml, 'save');
    const w = await mountSettings();
    await w.find('[data-test="sso-tab-saml"]').trigger('click');

    await w.find('[data-test="saml-certs"]').setValue('');
    await w.find('[data-test="saml-form"] input[type="checkbox"]').setValue(true);
    await w.find('[data-test="saml-save"]').trigger('click');
    await flushPromises();

    expect(save).not.toHaveBeenCalled();
    expect(w.find('[data-test="saml-error"]').text()).toMatch(/certificate/i);
  });
});
