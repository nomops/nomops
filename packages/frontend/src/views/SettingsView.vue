<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type ApiKeyRow, type CommunityNode } from '../api/client.js';
import { useProjectsStore } from '../stores/projects.js';

/** n8n 式 Settings：左二级导航（← Settings + 图标项 + 版本号）+ 右内容。 */
type Section = 'personal' | 'users' | 'api' | 'community' | 'sso' | 'ldap' | 'security' | 'logstream' | 'secrets' | 'billing';

const route = useRoute();
const router = useRouter();
const projects = useProjectsStore();

const section = ref<Section>((route.query['s'] as Section) ?? 'personal');
const about = ref<Awaited<ReturnType<typeof api.about>> | null>(null);

/* 个人 */
const me = ref<Awaited<ReturnType<typeof api.me>> | null>(null);

/* 两步验证（TOTP） */
const mfaSetup = ref<{ secret: string; otpauthUri: string; backupCodes: string[] } | null>(null);
const mfaCode = ref('');
const mfaError = ref('');

async function refreshMe() {
  me.value = await api.me().catch(() => me.value);
}
async function startMfaSetup() {
  mfaError.value = '';
  mfaCode.value = '';
  try {
    mfaSetup.value = await api.mfa.setup();
  } catch (e) {
    mfaError.value = (e as Error).message;
  }
}
async function confirmMfaEnable() {
  mfaError.value = '';
  try {
    await api.mfa.enable(mfaCode.value.trim());
    mfaSetup.value = null;
    mfaCode.value = '';
    await refreshMe();
  } catch (e) {
    mfaError.value = (e as Error).message;
  }
}
async function disableMfa() {
  mfaError.value = '';
  try {
    await api.mfa.disable(mfaCode.value.trim());
    mfaCode.value = '';
    await refreshMe();
  } catch (e) {
    mfaError.value = (e as Error).message;
  }
}
function cancelMfaSetup() {
  mfaSetup.value = null;
  mfaCode.value = '';
  mfaError.value = '';
}

/* SSO 配置 */
const sso = ref({ enabled: false, issuer: '', clientId: '', clientSecret: '' });
const ssoError = ref('');
const ssoSaved = ref(false);
const ssoLoading = ref(true);

/* 用户管理 */
const users = ref<Awaited<ReturnType<typeof api.instanceUsers.list>>>([]);
const usersError = ref('');

/* 安全 */
const security = ref<Awaited<ReturnType<typeof api.security>> | null>(null);
const securityError = ref('');
const newScimToken = ref('');

/* 日志流（企业） */
const destinations = ref<Awaited<ReturnType<typeof api.logStreaming.list>>>([]);
const lsError = ref('');
const lsForm = ref<{ name: string; url: string; secret: string; events: Array<'execution' | 'audit'> }>({
  name: '',
  url: '',
  secret: '',
  events: ['execution', 'audit'],
});
const lsTestResult = ref<Record<string, string>>({});

/* 外部密钥（企业） */
const secretsStatus = ref<Awaited<ReturnType<typeof api.externalSecrets>> | null>(null);
const secretsError = ref('');
const secretRefExample = '{{ $secrets.KEY }}'; // 字面量，避免模板里 {{ }} 嵌套

/* LDAP（企业） */
const ldap = ref({
  enabled: false,
  url: '',
  bindDn: '',
  bindPassword: '',
  userSearchBase: '',
  loginAttribute: 'uid',
  emailAttribute: 'mail',
});
const ldapError = ref('');
const ldapSaved = ref(false);
const ldapLoading = ref(true);

/* 公共 API 令牌 */
const apiKeysList = ref<ApiKeyRow[]>([]);
const newKeyLabel = ref('');
const createdToken = ref(''); // 新建令牌明文（仅本次会话显示一次）
const apiError = ref('');
const apiBusy = ref(false);

async function loadApiKeys() {
  apiError.value = '';
  try {
    apiKeysList.value = await api.apiKeys.list();
  } catch (e) {
    apiError.value = (e as Error).message;
  }
}
async function createApiKey() {
  apiError.value = '';
  if (!newKeyLabel.value.trim()) {
    apiError.value = 'Please enter a label';
    return;
  }
  apiBusy.value = true;
  try {
    const res = await api.apiKeys.create(newKeyLabel.value.trim());
    createdToken.value = res.token; // 明文只此一次
    newKeyLabel.value = '';
    await loadApiKeys();
  } catch (e) {
    apiError.value = (e as Error).message;
  } finally {
    apiBusy.value = false;
  }
}
async function revokeApiKey(id: string) {
  if (!confirm('Revoke this API key? Any script using it will stop working immediately.')) return;
  try {
    await api.apiKeys.revoke(id);
    await loadApiKeys();
  } catch (e) {
    apiError.value = (e as Error).message;
  }
}

/* 社区节点（对标 n8n：owner 安装 npm 节点包） */
const communityNodes = ref<CommunityNode[]>([]);
const communityError = ref('');
const installName = ref('');
const installVersion = ref('');
const installing = ref(false);

async function loadCommunityNodes() {
  communityError.value = '';
  try {
    communityNodes.value = await api.communityNodes.list();
  } catch (e) {
    communityError.value = (e as Error).message; // 非 admin → 403
  }
}
async function installCommunityNode() {
  communityError.value = '';
  const name = installName.value.trim();
  if (!name) {
    communityError.value = 'Enter an npm package name';
    return;
  }
  installing.value = true;
  try {
    await api.communityNodes.install(name, installVersion.value.trim() || undefined);
    installName.value = '';
    installVersion.value = '';
    await loadCommunityNodes();
  } catch (e) {
    communityError.value = (e as Error).message;
  } finally {
    installing.value = false;
  }
}
async function uninstallCommunityNode(name: string) {
  if (!confirm(`Uninstall ${name}? Workflows using its nodes will stop working.`)) return;
  communityError.value = '';
  try {
    await api.communityNodes.uninstall(name);
    await loadCommunityNodes();
  } catch (e) {
    communityError.value = (e as Error).message;
  }
}

/* 计费 */
const usage = ref<{ used: number; limit: number | null; plan: string } | null>(null);
const months = ref(1);
const billingError = ref('');

/* 实例管理员手动配额覆盖（企业版 quotas 功能，PUT /api/projects/:id/quota） */
const isInstanceAdmin = computed(() => me.value?.role === 'owner' || me.value?.role === 'admin');
const quotaPlan = ref<'free' | 'pro' | 'unlimited' | 'custom'>('unlimited');
const quotaCustom = ref(1000);
const quotaSaving = ref(false);
const quotaSaved = ref(false);

async function saveQuota() {
  const current = projects.current;
  if (!current) return;
  quotaSaving.value = true;
  quotaSaved.value = false;
  billingError.value = '';
  try {
    const body: { plan: string; monthlyExecutions?: number } = { plan: quotaPlan.value };
    if (quotaPlan.value === 'custom') body.monthlyExecutions = quotaCustom.value;
    usage.value = await api.projects.setQuota(current.id, body);
    quotaSaved.value = true;
    setTimeout(() => (quotaSaved.value = false), 2000);
  } catch (e) {
    billingError.value = (e as Error).message; // 非 admin 403 / 社区版 403
  } finally {
    quotaSaving.value = false;
  }
}

onMounted(async () => {
  await projects.fetch().catch(() => undefined);
  me.value = await api.me().catch(() => null);
  about.value = await api.about().catch(() => null);
  await loadSection();
});

function go(s: Section) {
  section.value = s;
  void router.replace({ query: { s } });
  void loadSection();
}

async function loadSection() {
  if (section.value === 'sso') {
    ssoError.value = '';
    ssoLoading.value = true;
    try {
      const cfg = await api.sso.config();
      sso.value = { ...cfg, clientSecret: '' }; // 掩码不回填，留空表示不改
    } catch (e) {
      ssoError.value = (e as Error).message; // 社区版 403 / 非 admin 403
    } finally {
      ssoLoading.value = false;
    }
  } else if (section.value === 'users') {
    usersError.value = '';
    try {
      users.value = await api.instanceUsers.list();
    } catch (e) {
      usersError.value = (e as Error).message; // 非 admin → 403
    }
  } else if (section.value === 'security') {
    securityError.value = '';
    try {
      security.value = await api.security();
    } catch (e) {
      securityError.value = (e as Error).message;
    }
  } else if (section.value === 'logstream') {
    lsError.value = '';
    try {
      destinations.value = await api.logStreaming.list();
    } catch (e) {
      lsError.value = (e as Error).message; // 社区版 403
    }
  } else if (section.value === 'ldap') {
    ldapError.value = '';
    ldapLoading.value = true;
    try {
      const cfg = await api.ldap.config();
      ldap.value = { ...cfg, bindPassword: '' }; // 掩码不回填，留空表示不改
    } catch (e) {
      ldapError.value = (e as Error).message; // 社区版 403 / 非 admin 403
    } finally {
      ldapLoading.value = false;
    }
  } else if (section.value === 'secrets') {
    secretsError.value = '';
    try {
      secretsStatus.value = await api.externalSecrets();
    } catch (e) {
      secretsError.value = (e as Error).message; // 社区版 403
    }
  } else if (section.value === 'api') {
    createdToken.value = ''; // 切到该页清掉上次明文
    await loadApiKeys();
  } else if (section.value === 'community') {
    await loadCommunityNodes();
  } else if (section.value === 'billing') {
    const current = projects.current;
    if (current) usage.value = await api.projects.usage(current.id).catch(() => null);
    // 用当前生效套餐预置配额下拉
    const p = usage.value?.plan;
    if (p && ['free', 'pro', 'unlimited', 'custom'].includes(p)) {
      quotaPlan.value = p as typeof quotaPlan.value;
      if (p === 'custom' && usage.value?.limit) quotaCustom.value = usage.value.limit;
    }
  }
}

async function addDestination() {
  lsError.value = '';
  try {
    await api.logStreaming.create({
      name: lsForm.value.name,
      url: lsForm.value.url,
      secret: lsForm.value.secret || undefined,
      events: lsForm.value.events,
    });
    lsForm.value = { name: '', url: '', secret: '', events: ['execution', 'audit'] };
    destinations.value = await api.logStreaming.list();
  } catch (e) {
    lsError.value = (e as Error).message;
  }
}

async function removeDestination(id: string) {
  await api.logStreaming.remove(id).catch((e) => (lsError.value = (e as Error).message));
  destinations.value = await api.logStreaming.list();
}

async function testDestination(id: string) {
  lsTestResult.value = { ...lsTestResult.value, [id]: 'Sending…' };
  try {
    const res = await api.logStreaming.test(id);
    lsTestResult.value = { ...lsTestResult.value, [id]: res.ok ? `✅ ${res.status}` : `⚠️ ${res.status}` };
  } catch (e) {
    lsTestResult.value = { ...lsTestResult.value, [id]: `❌ ${(e as Error).message}` };
  }
}

async function changeUserRole(id: string, event: Event) {
  usersError.value = '';
  try {
    await api.instanceUsers.setRole(id, (event.target as HTMLSelectElement).value);
    users.value = await api.instanceUsers.list();
  } catch (e) {
    usersError.value = (e as Error).message;
    users.value = await api.instanceUsers.list();
  }
}

async function rotateScimToken() {
  securityError.value = '';
  try {
    const res = await api.scimToken();
    newScimToken.value = res.token; // 仅此一次显示
    security.value = await api.security();
  } catch (e) {
    securityError.value = (e as Error).message;
  }
}

async function saveSso() {
  ssoError.value = '';
  ssoSaved.value = false;
  try {
    const body: { enabled: boolean; issuer: string; clientId: string; clientSecret?: string } = {
      enabled: sso.value.enabled,
      issuer: sso.value.issuer,
      clientId: sso.value.clientId,
    };
    if (sso.value.clientSecret) body.clientSecret = sso.value.clientSecret;
    const saved = await api.sso.save(body);
    sso.value = { ...saved, clientSecret: '' };
    ssoSaved.value = true;
  } catch (e) {
    ssoError.value = (e as Error).message;
  }
}

async function saveLdap() {
  ldapError.value = '';
  ldapSaved.value = false;
  try {
    const body = {
      enabled: ldap.value.enabled,
      url: ldap.value.url,
      bindDn: ldap.value.bindDn,
      userSearchBase: ldap.value.userSearchBase,
      loginAttribute: ldap.value.loginAttribute,
      emailAttribute: ldap.value.emailAttribute,
      ...(ldap.value.bindPassword ? { bindPassword: ldap.value.bindPassword } : {}),
    };
    const saved = await api.ldap.save(body);
    ldap.value = { ...ldap.value, enabled: saved.enabled, bindPassword: '' };
    ldapSaved.value = true;
  } catch (e) {
    ldapError.value = (e as Error).message;
  }
}

async function upgrade() {
  billingError.value = '';
  try {
    const { payUrl } = await api.billing.checkout('pro', months.value);
    location.href = payUrl; // 跳支付宝收银台
  } catch (e) {
    billingError.value = (e as Error).message;
  }
}

const planLabel = computed(() => (projects.license?.plan === 'enterprise' ? 'Enterprise' : 'Community'));

/** 单路径/多路径图标（内联 SVG 内容，stroke 由父 svg 提供）。 */
const icons: Record<Section, string> = {
  personal: '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c0-3.4 3-5.2 6.5-5.2s6.5 1.8 6.5 5.2"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.2 2.6-5 5.5-5 1 0 1.9.2 2.7.6"/><circle cx="17" cy="10" r="2.6"/><path d="M12.5 20c0-2.8 2.2-4.4 4.7-4.4S22 17.2 22 20"/>',
  api: '<circle cx="7" cy="12" r="3.2"/><path d="M10.2 12H21M17 12v3.5M20.5 12v2.5"/>',
  community: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14v7M14 17.5h7"/>',
  sso: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3.5M21.5 12v2.5"/>',
  ldap: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v3M6 16v-2.5h12V16"/>',
  security: '<path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z"/>',
  logstream: '<path d="M4 12h11M11 8l4 4-4 4M20 5v14"/>',
  secrets: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  billing: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10.5h18"/>',
};

const sections: Array<{ key: Section; label: string }> = [
  { key: 'personal', label: 'Personal' },
  { key: 'users', label: 'Users' },
  { key: 'api', label: 'API' },
  { key: 'community', label: 'Community nodes' },
  { key: 'sso', label: 'SSO' },
  { key: 'ldap', label: 'LDAP' },
  { key: 'security', label: 'Security & policies' },
  { key: 'logstream', label: 'Log Streaming' },
  { key: 'secrets', label: 'External Secrets' },
  { key: 'billing', label: 'Usage and plan' },
];
</script>

<template>
  <div class="settings-shell">
    <div class="settings-body">
    <nav class="settings-nav">
      <button class="settings-back" data-test="settings-back" @click="router.push({ name: 'overview' })">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6" /></svg>
        Settings
      </button>
      <button
        v-for="s in sections"
        :key="s.key"
        class="settings-nav-item"
        :class="{ active: section === s.key }"
        :data-test-settings="s.key"
        @click="go(s.key)"
      >
        <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" v-html="icons[s.key]" />
        <span>{{ s.label }}</span>
      </button>
      <div class="settings-version">nomops v{{ about?.version ?? '…' }}</div>
    </nav>

    <div class="settings-content">
      <!-- 个人设置 -->
      <section v-if="section === 'personal'" data-test="settings-personal">
        <h1 class="page-title">Personal Settings</h1>
        <h3 class="sec-title">Basic Information</h3>
        <div class="form-grid" style="max-width: 560px">
          <div class="field">
            <label>Email</label>
            <div class="ro-field">{{ me?.email ?? '—' }}</div>
          </div>
          <div class="field">
            <label>Instance role</label>
            <div class="ro-field">{{ me?.role ?? '—' }}</div>
          </div>
        </div>
        <h3 class="sec-title">Plan</h3>
        <div class="ro-field" style="max-width: 560px; display: inline-block">
          <span class="plan-badge" :class="projects.license?.plan">{{ planLabel }}</span>
        </div>

        <!-- 两步验证 -->
        <h3 class="sec-title">Two-factor authentication</h3>
        <div class="card" style="max-width: 560px" data-test="settings-mfa">
          <div style="display: flex; align-items: center; gap: 10px">
            <span class="mfa-badge" :class="{ on: me?.mfaEnabled }" data-test="mfa-status">
              {{ me?.mfaEnabled ? '已开启' : '未开启' }}
            </span>
            <span class="dim" style="font-size: 12.5px">用验证器 App（Google Authenticator / Authy…）的一次性码保护登录。</span>
          </div>

          <!-- 未开启 & 未开始设置 -->
          <button
            v-if="!me?.mfaEnabled && !mfaSetup"
            class="btn primary"
            style="margin-top: 14px"
            data-test="mfa-enable-start"
            @click="startMfaSetup"
          >
            开启两步验证
          </button>

          <!-- 设置中：展示 secret / 备份码 + 输码确认 -->
          <div v-else-if="mfaSetup" style="margin-top: 14px">
            <p class="dim" style="font-size: 12.5px; margin: 0 0 6px">
              在验证器里手动录入下面的密钥（或用 otpauth 链接），再输入生成的 6 位码确认：
            </p>
            <code class="api-token" data-test="mfa-secret">{{ mfaSetup.secret }}</code>
            <details style="margin-top: 8px">
              <summary class="dim" style="font-size: 12px; cursor: pointer">otpauth 链接</summary>
              <code class="api-token" style="margin-top: 6px">{{ mfaSetup.otpauthUri }}</code>
            </details>
            <div style="margin-top: 12px">
              <div class="dim" style="font-size: 12px; margin-bottom: 4px">备份码（每个仅一次，妥善保存）：</div>
              <div class="mfa-backup" data-test="mfa-backup">
                <code v-for="c in mfaSetup.backupCodes" :key="c">{{ c }}</code>
              </div>
            </div>
            <div style="display: flex; gap: 10px; align-items: center; margin-top: 14px; flex-wrap: wrap">
              <input v-model="mfaCode" data-test="mfa-code" placeholder="6 位验证码" style="width: 130px" @keyup.enter="confirmMfaEnable" />
              <button class="btn primary" data-test="mfa-confirm" @click="confirmMfaEnable">确认开启</button>
              <button class="btn secondary" @click="cancelMfaSetup">取消</button>
            </div>
          </div>

          <!-- 已开启：输码停用 -->
          <div v-else style="margin-top: 14px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
            <input v-model="mfaCode" data-test="mfa-code" placeholder="验证码或备份码" style="width: 160px" @keyup.enter="disableMfa" />
            <button class="btn secondary btn-sm" data-test="mfa-disable" @click="disableMfa">停用两步验证</button>
          </div>

          <p v-if="mfaError" class="error-text" data-test="mfa-error">{{ mfaError }}</p>
        </div>
      </section>

      <!-- 用户管理（实例 admin） -->
      <section v-else-if="section === 'users'" data-test="settings-users">
        <h1 class="page-title">Users</h1>
        <p class="sub">All users in this instance and their instance role (requires owner / admin).</p>
        <p v-if="usersError" class="error-text" data-test="users-error">{{ usersError }}</p>
        <div v-else class="card" style="max-width: 680px; padding: 0">
          <table>
            <thead>
              <tr><th>Email</th><th>Instance role</th><th>Status</th><th>Joined</th></tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td>{{ u.email }}</td>
                <td style="width: 160px">
                  <select :value="u.role" :data-test-user-role="u.id" @change="changeUserRole(u.id, $event)">
                    <option value="owner">Owner</option>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                </td>
                <td class="dim">{{ u.disabled ? 'Disabled' : 'Active' }}</td>
                <td class="dim">{{ new Date(u.createdAt).toLocaleDateString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 安全（实例 admin） -->
      <section v-else-if="section === 'security'" data-test="settings-security">
        <h1 class="page-title">Security &amp; policies</h1>
        <p v-if="securityError" class="error-text" data-test="security-error">{{ securityError }}</p>
        <div v-else-if="security" class="card" style="max-width: 580px">
          <div class="sec-row">
            <div><b>SSO login</b><div class="dim" style="font-size: 12px">OIDC single sign-on</div></div>
            <span class="badge" :class="{ on: security.sso.enabled }">{{ security.sso.enabled ? 'Enabled' : 'Disabled' }}</span>
          </div>
          <div class="sec-row">
            <div><b>SCIM provisioning</b><div class="dim" style="font-size: 12px">IdP user sync ({{ security.scim.tokenConfigured ? 'token configured' : 'not configured' }})</div></div>
            <button v-if="security.scim.enabled" data-test="rotate-scim" @click="rotateScimToken">
              {{ security.scim.tokenConfigured ? 'Rotate token' : 'Generate token' }}
            </button>
            <span v-else class="badge">Enterprise</span>
          </div>
          <div v-if="newScimToken" class="token-box" data-test="scim-token">
            <div class="dim" style="font-size: 12px; margin-bottom: 4px">New SCIM token (shown once — save it now)</div>
            <code>{{ newScimToken }}</code>
          </div>
          <div class="sec-row">
            <div><b>Instance users</b></div>
            <span class="dim">{{ security.userCount }}</span>
          </div>
        </div>
      </section>

      <!-- SSO 配置 -->
      <section v-else-if="section === 'sso'" data-test="settings-sso">
        <h1 class="page-title">SSO</h1>
        <p class="sub">
          Configure an OIDC identity provider to show “Sign in with SSO” on the login page. Requires Enterprise + instance admin.
        </p>
        <p v-if="ssoError" class="error-text" data-test="sso-error">{{ ssoError }}</p>
        <div v-else-if="!ssoLoading" class="card" style="max-width: 580px">
          <label class="inline-check"><input type="checkbox" v-model="sso.enabled" /> Enable SSO login</label>
          <label>Issuer (discovery URL)</label>
          <input v-model="sso.issuer" placeholder="https://idp.example.com" />
          <label>Client ID</label>
          <input v-model="sso.clientId" placeholder="nomops-client" />
          <label>Client Secret (leave blank to keep)</label>
          <input v-model="sso.clientSecret" type="password" placeholder="••••••••" />
          <p v-if="ssoSaved" class="saved-hint">Saved ✓</p>
          <div style="margin-top: 14px">
            <button class="btn primary" data-test="sso-save" @click="saveSso">Save</button>
          </div>
        </div>
      </section>

      <!-- LDAP 配置（企业） -->
      <section v-else-if="section === 'ldap'" data-test="settings-ldap">
        <h1 class="page-title">LDAP</h1>
        <p class="sub">
          Connect a corporate directory (AD / OpenLDAP) so employees sign in with their domain account; first login provisions
          automatically. Requires Enterprise + instance admin.
        </p>
        <p v-if="ldapError" class="error-text" data-test="ldap-error">{{ ldapError }}</p>
        <div v-else-if="!ldapLoading" class="card" style="max-width: 580px">
          <label class="inline-check"><input type="checkbox" v-model="ldap.enabled" data-test="ldap-enabled" /> Enable LDAP login</label>
          <label>Server URL</label>
          <input v-model="ldap.url" data-test="ldap-url" placeholder="ldap://ldap.corp.com:389" />
          <label>Bind DN (service account)</label>
          <input v-model="ldap.bindDn" placeholder="cn=svc,dc=corp,dc=com" />
          <label>Bind password (leave blank to keep)</label>
          <input v-model="ldap.bindPassword" data-test="ldap-password" type="password" placeholder="••••••••" />
          <label>User search base</label>
          <input v-model="ldap.userSearchBase" placeholder="ou=people,dc=corp,dc=com" />
          <div style="display: flex; gap: 12px">
            <div style="flex: 1">
              <label>Login attribute</label>
              <input v-model="ldap.loginAttribute" placeholder="uid / sAMAccountName" />
            </div>
            <div style="flex: 1">
              <label>Email attribute</label>
              <input v-model="ldap.emailAttribute" placeholder="mail" />
            </div>
          </div>
          <p v-if="ldapSaved" class="saved-hint">Saved ✓</p>
          <div style="margin-top: 14px">
            <button class="btn primary" data-test="ldap-save" @click="saveLdap">Save</button>
          </div>
        </div>
      </section>

      <!-- 日志流（企业） -->
      <section v-else-if="section === 'logstream'" data-test="settings-logstream">
        <h1 class="page-title">Log Streaming</h1>
        <p class="sub">
          Push execution-finished and audit events to an external webhook (SIEM / data lake / alerting) in real time. Each event is
          signed with the destination secret via HMAC-SHA256 in the <code>x-nomops-signature</code> header. Requires Enterprise.
        </p>
        <p v-if="lsError" class="error-text" data-test="ls-error">{{ lsError }}</p>
        <template v-else>
          <div v-if="destinations.length" class="card" style="max-width: 680px; margin-bottom: 16px">
            <div
              v-for="d in destinations"
              :key="d.id"
              data-test="ls-row"
              style="display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border)"
            >
              <div style="flex: 1; min-width: 0">
                <b>{{ d.name }}</b>
                <div class="dim" style="font-size: 12px; word-break: break-all">{{ d.url }}</div>
                <div class="dim" style="font-size: 11px">
                  Events: {{ d.events.join(' / ') }} · Secret: {{ d.secretConfigured ? 'configured' : 'none' }}
                </div>
              </div>
              <span v-if="lsTestResult[d.id]" style="font-size: 12px">{{ lsTestResult[d.id] }}</span>
              <button data-test="ls-test" @click="testDestination(d.id)">Test</button>
              <button class="danger" data-test="ls-remove" @click="removeDestination(d.id)">Delete</button>
            </div>
          </div>

          <div class="card" style="max-width: 680px">
            <h3 style="margin: 0 0 12px">Add destination</h3>
            <label>Name</label>
            <input v-model="lsForm.name" data-test="ls-name" placeholder="Splunk / internal alerts" />
            <label>Webhook URL</label>
            <input v-model="lsForm.url" data-test="ls-url" placeholder="https://siem.example.com/ingest" />
            <label>Signing secret (optional)</label>
            <input v-model="lsForm.secret" data-test="ls-secret" type="password" placeholder="••••••••" />
            <label style="margin-top: 10px">Events</label>
            <div style="display: flex; gap: 16px; margin-top: 4px">
              <label class="inline-check" style="font-weight: 400"><input type="checkbox" value="execution" v-model="lsForm.events" /> Execution finished</label>
              <label class="inline-check" style="font-weight: 400"><input type="checkbox" value="audit" v-model="lsForm.events" /> Audit events</label>
            </div>
            <div style="margin-top: 14px">
              <button class="btn primary" data-test="ls-add" :disabled="!lsForm.name || !lsForm.url" @click="addDestination">Add</button>
            </div>
          </div>
        </template>
      </section>

      <!-- 外部密钥（企业） -->
      <section v-else-if="section === 'secrets'" data-test="settings-secrets">
        <h1 class="page-title">External Secrets</h1>
        <p class="sub">
          Keep third-party secrets in an external backend; credentials only store a reference
          <code>{{ secretRefExample }}</code> that resolves at run time — rotate a secret without touching credentials, and no real
          secrets land in the DB. The current provider reads from <code>NOMOPS_SECRET_&lt;KEY&gt;</code> env vars. Requires Enterprise.
        </p>
        <p v-if="secretsError" class="error-text" data-test="secrets-error">{{ secretsError }}</p>
        <div v-else-if="secretsStatus" class="card" style="max-width: 580px">
          <div style="display: flex; justify-content: space-between; padding: 8px 0">
            <span class="dim">Provider</span><b>{{ secretsStatus.provider }}</b>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 8px 0">
            <span class="dim">Status</span>
            <b :style="{ color: secretsStatus.available ? 'var(--ok)' : 'var(--text-dim)' }">
              {{ secretsStatus.available ? 'Ready' : 'No secrets configured' }}
            </b>
          </div>
          <div style="padding: 8px 0">
            <div class="dim" style="margin-bottom: 8px">Available secrets (names only — values never shown)</div>
            <div v-if="secretsStatus.keys.length" style="display: flex; flex-wrap: wrap; gap: 6px">
              <code
                v-for="k in secretsStatus.keys"
                :key="k"
                data-test="secret-key"
                style="background: var(--bg-input); padding: 3px 8px; border-radius: 6px; font-size: 12px"
              >$secrets.{{ k }}</code>
            </div>
            <p v-else class="dim" style="font-size: 12px">
              Set <code>NOMOPS_SECRET_MY_KEY=xxx</code> and restart the instance to see <code>MY_KEY</code> here.
            </p>
          </div>
        </div>
      </section>

      <!-- 公共 API 令牌 -->
      <section v-else-if="section === 'api'" data-test="settings-api">
        <h1 class="page-title">API</h1>
        <p class="dim" style="margin-top: -4px; max-width: 560px; font-size: 13px">
          用 API 令牌（请求头 <code>X-Nomops-Api-Key</code>）调用本实例 REST API——脚本、CI、第三方集成用。
        </p>

        <!-- 新令牌明文：仅显示一次 -->
        <div v-if="createdToken" class="card api-new" style="max-width: 560px; margin-top: 16px">
          <div class="dim" style="font-size: 12px">新令牌 — 现在复制，之后不再显示</div>
          <code class="api-token" data-test="api-new-token">{{ createdToken }}</code>
          <button class="btn secondary" style="margin-top: 10px" data-test="api-token-done" @click="createdToken = ''">
            我已复制
          </button>
        </div>

        <!-- 创建 -->
        <div class="card" style="max-width: 560px; margin-top: 16px">
          <div style="display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap">
            <div style="flex: 1; min-width: 200px">
              <label style="font-size: 12px; color: var(--dim)">名称</label>
              <input v-model="newKeyLabel" data-test="api-label" placeholder="如 CI 部署" style="width: 100%" @keyup.enter="createApiKey" />
            </div>
            <button class="btn primary" data-test="api-create" :disabled="apiBusy" @click="createApiKey">
              {{ apiBusy ? '创建中…' : '创建令牌' }}
            </button>
          </div>
          <p v-if="apiError" class="error-text" data-test="api-error">{{ apiError }}</p>
        </div>

        <!-- 列表 -->
        <div class="card" style="max-width: 560px; margin-top: 16px; padding: 0">
          <div v-if="!apiKeysList.length" class="dim" style="padding: 20px; text-align: center">还没有 API 令牌。</div>
          <table v-else class="api-table">
            <thead><tr><th>名称</th><th>令牌</th><th>最近使用</th><th></th></tr></thead>
            <tbody>
              <tr v-for="k in apiKeysList" :key="k.id" data-test="api-key-row">
                <td>{{ k.label }}</td>
                <td class="mono dim">{{ k.prefix }}…</td>
                <td class="dim">{{ k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : '从未' }}</td>
                <td style="text-align: right">
                  <button class="btn secondary btn-sm" data-test="api-revoke" @click="revokeApiKey(k.id)">吊销</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 社区节点 -->
      <section v-else-if="section === 'community'" data-test="settings-community">
        <h1 class="page-title">Community nodes</h1>
        <p class="dim" style="margin-top: -4px; max-width: 620px; font-size: 13px">
          Install extra nodes from npm. Packages must export a <code>nomopsNodes</code> array. Installed nodes
          run with full server privileges (like the Code node) — only install packages you trust. Requires
          instance owner / admin.
        </p>

        <!-- 安装 -->
        <div class="card" style="max-width: 620px; margin-top: 16px">
          <div style="display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap">
            <div style="flex: 1; min-width: 200px">
              <label style="font-size: 12px; color: var(--dim)">npm package</label>
              <input v-model="installName" data-test="community-name" placeholder="e.g. n8n-nodes-weather" style="width: 100%" @keyup.enter="installCommunityNode" />
            </div>
            <div style="width: 120px">
              <label style="font-size: 12px; color: var(--dim)">Version</label>
              <input v-model="installVersion" data-test="community-version" placeholder="latest" style="width: 100%" @keyup.enter="installCommunityNode" />
            </div>
            <button class="btn primary" data-test="community-install" :disabled="installing" @click="installCommunityNode">
              {{ installing ? 'Installing…' : 'Install' }}
            </button>
          </div>
          <p v-if="communityError" class="error-text" data-test="community-error">{{ communityError }}</p>
        </div>

        <!-- 列表 -->
        <div class="card" style="max-width: 620px; margin-top: 16px; padding: 0">
          <div v-if="!communityNodes.length" class="dim" style="padding: 20px; text-align: center">No community nodes installed.</div>
          <table v-else class="api-table">
            <thead><tr><th>Package</th><th>Version</th><th>Nodes</th><th></th></tr></thead>
            <tbody>
              <tr v-for="p in communityNodes" :key="p.packageName" data-test="community-row">
                <td>{{ p.packageName }}</td>
                <td class="mono dim">{{ p.version }}</td>
                <td class="dim">{{ p.nodeTypes.length }}</td>
                <td style="text-align: right">
                  <button class="btn secondary btn-sm" data-test="community-uninstall" @click="uninstallCommunityNode(p.packageName)">Uninstall</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 计费与套餐 -->
      <section v-else data-test="settings-billing">
        <h1 class="page-title">Usage and plan</h1>
        <div class="card" style="max-width: 560px">
          <div style="display: flex; align-items: center; gap: 12px">
            <div>
              <div class="dim" style="font-size: 12px">Current plan</div>
              <div style="font-size: 18px; font-weight: 600; margin-top: 2px">{{ usage?.plan ?? 'unlimited' }}</div>
            </div>
            <span style="flex: 1" />
            <div v-if="usage" class="dim" style="font-size: 13px; text-align: right">
              {{ usage.used }} / {{ usage.limit === null ? 'unlimited' : usage.limit }} executions this month
            </div>
          </div>
          <hr style="border: none; border-top: 1px solid var(--border); margin: 16px 0" />
          <div class="dim" style="font-size: 12px">Upgrade to Pro (¥99/month, Alipay)</div>
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px">
            <label style="margin: 0">Months</label>
            <input v-model.number="months" type="number" min="1" max="36" style="width: 90px" />
            <button class="btn primary" data-test="billing-upgrade" @click="upgrade">
              Pay ¥{{ (99 * months).toFixed(2) }}
            </button>
          </div>
          <p v-if="billingError" class="error-text" data-test="billing-error">{{ billingError }}</p>
          <p class="dim" style="font-size: 11.5px; margin-top: 12px">
            Payment is credited via Alipay async notification; the plan activates immediately and extends by month.
          </p>
        </div>

        <!-- 实例管理员：手动设置当前项目配额/套餐（企业版 quotas 功能） -->
        <div
          v-if="isInstanceAdmin && projects.hasFeature('quotas')"
          class="card"
          style="max-width: 560px; margin-top: 16px"
          data-test="quota-admin"
        >
          <h3 class="sec-title">Admin · project quota override</h3>
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap">
            <select v-model="quotaPlan" data-test="quota-plan">
              <option value="free">Free (100 / mo)</option>
              <option value="pro">Pro (10,000 / mo)</option>
              <option value="unlimited">Unlimited</option>
              <option value="custom">Custom…</option>
            </select>
            <input
              v-if="quotaPlan === 'custom'"
              v-model.number="quotaCustom"
              type="number"
              min="1"
              style="width: 130px"
              placeholder="executions / mo"
              data-test="quota-custom"
            />
            <button class="btn primary" :disabled="quotaSaving" data-test="quota-apply" @click="saveQuota">
              {{ quotaSaving ? 'Applying…' : 'Apply' }}
            </button>
            <span v-if="quotaSaved" class="dim" style="color: var(--ok)">Applied</span>
          </div>
          <p class="dim" style="font-size: 11.5px; margin-top: 10px">
            Sets the monthly execution quota for the current project ({{ projects.currentName }}). Enforced on
            execution; enterprise-only.
          </p>
        </div>
      </section>
    </div>
    </div>
  </div>
</template>

<style scoped>
/* ── API 令牌 ── */
.api-new { border-color: var(--accent); }
.api-token {
  display: block; margin-top: 8px; padding: 10px 12px; border-radius: 8px;
  background: var(--bg); border: 1px solid var(--border);
  font-family: 'SF Mono', ui-monospace, Menlo, monospace; font-size: 13px;
  word-break: break-all; user-select: all; color: var(--text-hi);
}
.api-table { width: 100%; border-collapse: collapse; }
.api-table th {
  text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.4px;
  color: var(--dim); font-weight: 500; padding: 10px 14px; border-bottom: 1px solid var(--border);
}
.api-table td { padding: 11px 14px; border-bottom: 1px solid var(--border); font-size: 13px; }
.api-table tr:last-child td { border-bottom: none; }
.api-table .mono { font-family: 'SF Mono', ui-monospace, Menlo, monospace; }
.btn-sm { padding: 4px 10px; font-size: 12px; }

/* ── 两步验证 ── */
.mfa-badge { font-size: 12px; padding: 2px 10px; border-radius: 10px; border: 1px solid var(--border); color: var(--dim); }
.mfa-badge.on { color: var(--ok, #3ecf8e); border-color: var(--ok, #3ecf8e); }
.mfa-backup { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.mfa-backup code {
  font-family: 'SF Mono', ui-monospace, Menlo, monospace; font-size: 12.5px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; user-select: all;
}

/* 根元素被 App.vue 的 RouterView 内联样式强制为 flex column + overflow-y auto，
   故在内部再包一层 flex row 承载「左导航 + 右内容」。 */
.settings-body { flex: 1; display: flex; min-height: 0; }
.settings-nav {
  width: 230px; flex-shrink: 0; border-right: 1px solid var(--border);
  padding: 16px 12px; background: var(--bg); display: flex; flex-direction: column;
}
.settings-back {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  padding: 6px 8px 14px; border: none; background: none; color: var(--text-hi);
  font-size: 15px; font-weight: 600; cursor: pointer;
}
.settings-back svg { width: 18px; height: 18px; flex-shrink: 0; }
.settings-nav-item {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  padding: 8px 10px; border: none; background: none; border-radius: 8px;
  color: var(--text); font-size: 14px; cursor: pointer; margin-bottom: 1px;
}
.settings-nav-item:hover { background: var(--bg-hover); }
.settings-nav-item.active { background: var(--bg-panel); }
.settings-nav-item .nav-ico { width: 18px; height: 18px; flex-shrink: 0; color: var(--text-dim); }
.settings-nav-item.active .nav-ico { color: var(--text-hi); }
.settings-version { margin-top: auto; padding: 12px 10px 4px; font-size: 12px; color: var(--accent); }

.settings-content { flex: 1; overflow-y: auto; padding: 26px 40px 60px; }
.page-title { margin: 0 0 22px; font-size: 28px; font-weight: 400; letter-spacing: -0.3px; color: var(--text-hi); }
.sec-title { margin: 26px 0 12px; font-size: 18px; font-weight: 400; color: var(--text-hi); }
.sub { margin: -14px 0 18px; color: var(--text-dim); font-size: 13.5px; max-width: 620px; line-height: 1.6; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
.field { min-width: 0; }
.ro-field {
  background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 9px 12px; font-size: 13px;
}
.inline-check { display: flex; align-items: center; gap: 8px; color: var(--text); }
.inline-check input { width: auto; }
.plan-badge { font-size: 12px; padding: 2px 10px; border-radius: 10px; border: 1px solid var(--border); }
.plan-badge.enterprise { color: var(--accent); border-color: var(--accent); }
.saved-hint { color: var(--ok); font-size: 12px; margin-top: 10px; }
.btn { height: 34px; padding: 0 16px; border-radius: var(--radius); border: none; font-size: 14px; font-weight: 500; cursor: pointer; }
.btn.primary { background: var(--accent); color: #fff; }
.btn.primary:hover { background: var(--accent-dim); }
.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.sec-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 0; border-bottom: 1px solid var(--border);
}
.sec-row:last-child { border-bottom: none; }
.badge { font-size: 12px; padding: 2px 10px; border-radius: 10px; border: 1px solid var(--border); color: var(--text-dim); }
.badge.on { color: var(--ok); border-color: var(--ok); }
.token-box { background: var(--bg-input); border-radius: 8px; padding: 12px; margin: 4px 0 12px; }
.token-box code { font-size: 12px; word-break: break-all; color: var(--accent); }
.danger { color: var(--err); }
</style>
