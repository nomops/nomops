import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import type { LicenseInfo } from '../../api/client.js';
import { api } from '../../api/client.js';
import { useProjectsStore } from '../../stores/projects.js';
import SettingsView from '../SettingsView.vue';

/**
 * SSO 设置页的双协议分段（B2 前端；P3-EE2 改为基线元数据驱动表单）。
 *
 * 这组用例守四件事：两协议各自独立启用、SAML 有独立的功能位门控、
 * SAML 配置由 IdP 元数据解析而来（entityId/ssoUrl/证书轮换）、
 * 以及私钥/掩码密钥绝不经前端回传。
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

/** 双证书 IdP 元数据（带命名空间前缀，验证解析器不吃前缀）。 */
const IDP_METADATA_XML = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.test/entity">
  <md:IDPSSODescriptor>
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>CERT-A</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>CERT-B</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.test/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

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
  it('协议下拉存在，缺省停在 SAML（对标基线）', async () => {
    stub(['sso', 'saml']);
    const w = await mountSettings();

    expect(w.find('[data-test="sso-protocol"]').exists()).toBe(true);
    expect(w.find('[data-test="saml-form"]').exists()).toBe(true);
    expect(w.find('[data-test="oidc-form"]').exists()).toBe(false);
  });

  it('切到 OIDC 显示 OIDC 表单（Redirect URL + Discovery Endpoint）', async () => {
    stub(['sso', 'saml']);
    const w = await mountSettings();

    await w.find('[data-test="sso-protocol"]').setValue('oidc');

    expect(w.find('[data-test="oidc-form"]').exists()).toBe(true);
    expect(w.find('[data-test="oidc-redirect-url"]').exists()).toBe(true);
    expect(w.find('[data-test="saml-form"]').exists()).toBe(false);
  });

  it('★两协议独立启用：只启用 OIDC 时 SAML 不受影响', async () => {
    stub(['sso', 'saml']);
    const w = await mountSettings();

    // SAML 未启用（config.enabled=false）→ 它的 SSO 下拉停在 disabled
    expect((w.find('[data-test="saml-enabled"]').element as HTMLSelectElement).value).toBe('disabled');
    // OIDC 已启用（config.enabled=true）→ 它的 SSO 下拉停在 enabled
    await w.find('[data-test="sso-protocol"]').setValue('oidc');
    expect((w.find('[data-test="sso-enabled"]').element as HTMLSelectElement).value).toBe('enabled');
  });
});

describe('SAML 是独立功能位', () => {
  it('有 sso 但没 saml → SAML 分段出锁卡，不出表单', async () => {
    stub(['sso']);
    const w = await mountSettings();

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

    await w.find('[data-test="sso-protocol"]').setValue('oidc');
    expect(w.find('[data-test="sso-save"]').exists()).toBe(true); // OIDC 表单照常
  });
});

describe('★SAML 元数据驱动 + 密钥不回传', () => {
  it('粘贴元数据 XML → 解析出 entityId/ssoUrl/双证书提交；绝不携带 spPrivateKey', async () => {
    stub(['sso', 'saml']);
    const save = vi.spyOn(api.saml, 'save').mockResolvedValue({
      enabled: true,
      idpEntityId: 'https://idp.test/entity',
      idpSsoUrl: 'https://idp.test/sso',
      idpCertificates: ['CERT-A', 'CERT-B'],
      spPrivateKey: '••••••••',
    });
    const w = await mountSettings();

    // 切到 XML 模式贴元数据
    const xmlTab = w.findAll('[data-test="saml-ips-mode"] button')[1]!;
    await xmlTab.trigger('click');
    await w.find('[data-test="saml-metadata-xml"]').setValue(IDP_METADATA_XML);
    await w.find('[data-test="saml-enabled"]').setValue('enabled');
    await w.find('[data-test="saml-save"]').trigger('click');
    await flushPromises();

    const body = save.mock.calls[0]![0];
    expect(body.idpEntityId).toBe('https://idp.test/entity');
    expect(body.idpSsoUrl).toBe('https://idp.test/sso');
    expect(body.idpCertificates).toEqual(['CERT-A', 'CERT-B']); // 证书轮换保留
    expect(body).not.toHaveProperty('spPrivateKey'); // ★私钥绝不经前端回传
  });

  it('URL 模式走服务端代取（浏览器直抓被 CORS 拦），仍解析后提交', async () => {
    stub(['sso', 'saml']);
    const fetchMeta = vi.spyOn(api.saml, 'fetchMetadata').mockResolvedValue({ xml: IDP_METADATA_XML });
    const save = vi.spyOn(api.saml, 'save').mockResolvedValue({
      enabled: false,
      idpEntityId: 'https://idp.test/entity',
      idpSsoUrl: 'https://idp.test/sso',
      idpCertificates: ['CERT-A', 'CERT-B'],
      spPrivateKey: '',
    });
    const w = await mountSettings();

    await w.find('[data-test="saml-metadata-url"]').setValue('https://idp.test/metadata');
    await w.find('[data-test="saml-save"]').trigger('click');
    await flushPromises();

    expect(fetchMeta).toHaveBeenCalledWith('https://idp.test/metadata');
    const body = save.mock.calls[0]![0];
    expect(body.idpCertificates).toEqual(['CERT-A', 'CERT-B']);
    expect(body.idpMetadataUrl).toBe('https://idp.test/metadata'); // 存 URL 供回显
  });

  it('无任何元数据且无存量配置时启用 → 前端拦下，不发注定失败的请求', async () => {
    stub(['sso', 'saml']);
    vi.spyOn(api.saml, 'config').mockResolvedValue({
      enabled: false,
      idpEntityId: '',
      idpSsoUrl: '',
      idpCertificates: [],
      spPrivateKey: '',
    });
    const save = vi.spyOn(api.saml, 'save');
    const w = await mountSettings();

    await w.find('[data-test="saml-enabled"]').setValue('enabled');
    await w.find('[data-test="saml-save"]').trigger('click');
    await flushPromises();

    expect(save).not.toHaveBeenCalled();
    expect(w.find('[data-test="saml-error"]').text()).toMatch(/metadata/i);
  });
});
