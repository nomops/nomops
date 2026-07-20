<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type ApiKeyRow, type CommunityNode, type LicenseInfo } from '../api/client.js';
import { useProjectsStore } from '../stores/projects.js';
import { useUiStore } from '../stores/ui.js';
import { SETTINGS_SECTIONS, SETTINGS_ICONS } from '../lib/settings-nav.js';
import CredentialModal from '../components/credentials/CredentialModal.vue';
import { credentialTypeMeta } from '../lib/credential-types.js';
import LicenseModal from '../components/LicenseModal.vue';
import { LOCALES, locale, setLocale, t, type Locale } from '../lib/i18n.js';

/** Settings：左二级导航（← Settings + 图标项 + 版本号）+ 右内容。结构对标基线 Settings。 */
type Section =
  | 'billing'
  | 'personal'
  | 'languages'
  | 'users'
  | 'roles'
  | 'api'
  | 'secrets'
  | 'sourcecontrol'
  | 'sso'
  | 'security'
  | 'ldap'
  | 'logstream'
  | 'opentelemetry'
  | 'community'
  | 'mcp'
  | 'chat';

const route = useRoute();
const router = useRouter();
const projects = useProjectsStore();
const ui = useUiStore();

const section = ref<Section>((route.query['s'] as Section) ?? 'billing'); // 对标基线：默认落在 Usage and plan
const about = ref<Awaited<ReturnType<typeof api.about>> | null>(null);

/* 个人 */
const me = ref<Awaited<ReturnType<typeof api.me>> | null>(null);

/* 个人资料编辑（Basic Information） */
const profileFirst = ref('');
const profileLast = ref('');
const profileSaving = ref(false);
const profileSaved = ref(false);
const profileError = ref('');

async function saveProfile() {
  profileError.value = '';
  profileSaving.value = true;
  profileSaved.value = false;
  try {
    await api.updateMe({ firstName: profileFirst.value.trim(), lastName: profileLast.value.trim() });
    await refreshMe();
    profileSaved.value = true;
    setTimeout(() => (profileSaved.value = false), 2000);
  } catch (e) {
    profileError.value = (e as Error).message;
  } finally {
    profileSaving.value = false;
  }
}

/* 改口令（先验当前口令） */
const showPassForm = ref(false);
const passCurrent = ref('');
const passNew = ref('');
const passNew2 = ref('');
const passError = ref('');
const passSaved = ref(false);

async function submitChangePassword() {
  passError.value = '';
  if (passNew.value.length < 8) {
    passError.value = t('New password must be at least 8 characters');
    return;
  }
  if (passNew.value !== passNew2.value) {
    passError.value = t('Passwords do not match');
    return;
  }
  try {
    await api.changePassword(passCurrent.value, passNew.value);
    passCurrent.value = passNew.value = passNew2.value = '';
    showPassForm.value = false;
    passSaved.value = true;
    setTimeout(() => (passSaved.value = false), 2500);
  } catch (e) {
    passError.value = (e as Error).message;
  }
}

/** 头像缩写（基线风格圆形色块）。 */
const initialsOf = (first: string | null, last: string | null, email: string): string => {
  const a = (first ?? '').trim().charAt(0);
  const b = (last ?? '').trim().charAt(0);
  return (a + b || email.slice(0, 2)).toUpperCase();
};
const displayName = (first: string | null, last: string | null, email: string): string =>
  `${first ?? ''} ${last ?? ''}`.trim() || email;

/* 两步验证（TOTP） */
const mfaSetup = ref<{ secret: string; otpauthUri: string; backupCodes: string[] } | null>(null);
const mfaCode = ref('');
const mfaError = ref('');

async function refreshMe() {
  me.value = await api.me().catch(() => me.value);
  profileFirst.value = me.value?.firstName ?? '';
  profileLast.value = me.value?.lastName ?? '';
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

/* 公共 API 令牌（对标基线 "Create API Key" 弹窗） */
const apiKeysList = ref<ApiKeyRow[]>([]);
const newKeyLabel = ref('');
const createdToken = ref(''); // 新建令牌明文（仅弹窗内显示一次）
const apiError = ref('');
const apiBusy = ref(false);
const apiModalOpen = ref(false);
/* 对标基线 Create API Key：Expiration 下拉 + Scopes 单选（真实生效：过期拒绝、readonly 拦写） */
const apiExpireDays = ref<number | null | 'custom'>(30);
const apiExpireCustom = ref(''); // D141:Custom 过期日期(YYYY-MM-DD)
const apiScope = ref<'all' | 'readonly' | 'custom'>('all'); // D141:加 Custom scope
/* D141 对标基线:Expiration = 7/30/60/90 days + Custom(No expiration 为 nomops 保留项) */
const API_EXPIRATIONS: Array<{ label: string; value: number | null | 'custom' }> = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '90 days', value: 90 },
  { label: 'Custom', value: 'custom' },
  { label: 'No expiration', value: null },
];
const apiExpireText = computed(() => {
  if (apiExpireDays.value === 'custom') {
    return apiExpireCustom.value ? `The API key will expire on ${new Date(apiExpireCustom.value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}` : 'Pick an expiration date';
  }
  if (apiExpireDays.value == null) return 'The API key will never expire';
  const d = new Date(Date.now() + apiExpireDays.value * 24 * 60 * 60 * 1000);
  return `The API key will expire on ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`;
});

function openApiModal() {
  newKeyLabel.value = '';
  createdToken.value = '';
  apiError.value = '';
  apiExpireDays.value = 30;
  apiScope.value = 'all';
  apiModalOpen.value = true;
}

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
    // D141:Custom 过期→按所选日期换算天数;Custom scope 后端未支持,提交按 all
    const expiresInDays =
      apiExpireDays.value === 'custom'
        ? apiExpireCustom.value
          ? Math.max(1, Math.ceil((new Date(apiExpireCustom.value).getTime() - Date.now()) / 86_400_000))
          : null
        : apiExpireDays.value;
    const scope = apiScope.value === 'custom' ? 'all' : apiScope.value;
    const res = await api.apiKeys.create(newKeyLabel.value.trim(), { expiresInDays, scope });
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

/* 社区节点（owner 安装 npm 节点包） */
const communityNodes = ref<CommunityNode[]>([]);
const communityError = ref('');
const installName = ref('');
const installVersion = ref('');
const installing = ref(false);
/* 安装弹窗（对标基线 "Install community nodes"：说明卡 + 包名 + 风险确认） */
const communityModalOpen = ref(false);
const riskAccepted = ref(false);

function openCommunityModal() {
  installName.value = '';
  installVersion.value = '';
  riskAccepted.value = false;
  communityError.value = '';
  communityModalOpen.value = true;
}

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
    communityModalOpen.value = false;
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
const publishedWfCount = ref(0); // D138:已发布工作流数

/* D133 Personalisation → Theme 偏好(存 localStorage;nomops 暗色优先,
   偏好写到根 data-theme,浅色主题令牌为后续)。 */
const themePref = ref<string>(localStorage.getItem('nomops.theme') ?? 'system');
function applyTheme() {
  localStorage.setItem('nomops.theme', themePref.value);
  document.documentElement.setAttribute('data-theme', themePref.value);
}
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

const userMenuOpen = ref<string | null>(null);

function closePopovers() {
  providerMenuFor.value = null;
  mcpShowDetails.value = false;
  userMenuOpen.value = null;
}

onMounted(async () => {
  window.addEventListener('click', closePopovers);
  await projects.fetch().catch(() => undefined);
  await refreshMe();
  about.value = await api.about().catch(() => null);
  await loadSection();
});
onUnmounted(() => window.removeEventListener('click', closePopovers));

/* 用户列表搜索（基线 Users 页顶部搜索框） */
const userSearch = ref('');
const filteredUsers = computed(() => {
  const q = userSearch.value.trim().toLowerCase();
  if (!q) return users.value;
  return users.value.filter(
    (u) => u.email.toLowerCase().includes(q) || `${u.firstName ?? ''} ${u.lastName ?? ''}`.toLowerCase().includes(q),
  );
});

/* Roles 页（固定内置角色，对标基线的 Instance/Project roles 两个 tab） */
// Roles 页现为基线 Enterprise 锁态,仅保留 tab 切换(instance/project 描述已随锁态移除)
const rolesTab = ref<'instance' | 'project'>('instance');

/** 企业功能是否已解锁（决定显示真实表单还是基线式锁定卡）。 */
const licensed = (feature: string): boolean => projects.hasFeature(feature);

/* OpenTelemetry 表单本地态(对标基线 /settings/opentelemetry;后端持久化留后续)。
   默认值取自基线页面 live 真值(Disabled / :4318 / /v1/traces / 2000ms / 1.00)。 */
const otel = ref({
  status: 'Disabled',
  endpoint: 'http://localhost:4318',
  serviceName: 'nomops',
  tracePath: '/v1/traces',
  startupTimeout: 2000,
  sampleRate: 1.0,
  includeNodeSpans: false,
  injectTraceparent: false,
  publishedOnly: false,
});
/* 原自有 Prometheus 抓取配置示例留档(后端 /metrics 端点保留,便于回退) */
const promScrape = `- job_name: nomops\n  static_configs:\n    - targets: ['your-host:5678']`;

/* ── 实例级 MCP（Preview） ── */
const mcpStatus = ref<import('../api/client.js').McpStatus | null>(null);
const mcpError = ref('');
const mcpToken = ref(''); // 明文仅签发时显示一次
const mcpTab = ref<'workflows' | 'clients' | 'oauth'>('workflows');
const mcpRedirectUrls = ref(''); // MCP OAuth redirect URL allowlist(前端表单;后端持久化留后续)
const mcpShowDetails = ref(false);
const mcpConnMode = ref<'oauth' | 'token'>('oauth'); // D143 连接详情里的认证方式分段
const mcpBusy = ref(false);
/* Enable workflows 弹窗（对标基线：搜索 + 多选，仅限已发布的工作流） */
const mcpModalOpen = ref(false);
const mcpSearch = ref('');
const mcpPick = ref<Set<string>>(new Set());
const mcpEnabledWorkflows = computed(() => mcpStatus.value?.workflows.filter((w) => w.enabled) ?? []);
const mcpCandidates = computed(() => {
  const q = mcpSearch.value.trim().toLowerCase();
  return (mcpStatus.value?.workflows ?? []).filter(
    (w) => w.published && !w.enabled && (!q || w.name.toLowerCase().includes(q) || w.projectName.toLowerCase().includes(q)),
  );
});
function openMcpModal() {
  mcpPick.value = new Set();
  mcpSearch.value = '';
  mcpModalOpen.value = true;
  void loadMcp(); // 候选来自最新状态（刚发布的工作流立刻可见）
}
function togglePick(id: string) {
  const next = new Set(mcpPick.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  mcpPick.value = next;
}
async function confirmEnableWorkflows() {
  mcpError.value = '';
  try {
    const ids = [...new Set([...(mcpStatus.value?.workflowIds ?? []), ...mcpPick.value])];
    mcpStatus.value = await api.mcp.setWorkflows(ids);
    mcpModalOpen.value = false;
  } catch (e) {
    mcpError.value = (e as Error).message;
  }
}
async function removeMcpWorkflow(id: string) {
  mcpError.value = '';
  try {
    mcpStatus.value = await api.mcp.setWorkflows((mcpStatus.value?.workflowIds ?? []).filter((x) => x !== id));
  } catch (e) {
    mcpError.value = (e as Error).message;
  }
}
// dev 下前端与后端不同端口，展示给 MCP 客户端的必须是后端地址（5680；5678 被基线实例占用）
const mcpServerUrl = computed(
  () => `${location.origin.replace(/:(5173|5180|5181)$/, ':5680')}${mcpStatus.value?.serverPath ?? '/mcp-server/http'}`,
);

async function loadMcp() {
  mcpError.value = '';
  try {
    mcpStatus.value = await api.mcp.status();
  } catch (e) {
    mcpError.value = (e as Error).message; // 非 admin → 403
  }
}
async function mcpEnable() {
  mcpError.value = '';
  mcpBusy.value = true;
  try {
    const res = await api.mcp.enable();
    mcpToken.value = res.token;
    mcpStatus.value = res;
  } catch (e) {
    mcpError.value = (e as Error).message;
  } finally {
    mcpBusy.value = false;
  }
}
async function mcpToggleEnabled() {
  if (!mcpStatus.value) return;
  if (mcpStatus.value.enabled) {
    mcpToken.value = '';
    mcpStatus.value = await api.mcp.disable().catch((e) => ((mcpError.value = (e as Error).message), mcpStatus.value));
  } else {
    await mcpEnable();
  }
}

/* ── Chat 设置（Preview） ── */
const chatSettings = ref<{ enabled: boolean; model: string } | null>(null);
const chatError = ref('');
const chatSaving = ref(false);
/* Chat providers（服务端注册表 + 各家配置：Anthropic / DeepSeek / 豆包 / 千问 / Kimi / GLM）。
   注:后端 assistant-service 6 家真实 provider 接口保留(chatProviders/loadChatProviders),便于回退。 */
type ProviderRow = Awaited<ReturnType<typeof api.assistant.providers>>[number];
const chatProviders = ref<ProviderRow[]>([]);

/* B 类锁墙:Chat 页 provider 表 1:1 镜像基线的 15 家(2026-07-19 /settings/chat live 逐字取证)。
   品牌图标不复制基线的第三方厂商 logo 资源,改用品牌色字母 monogram 芯片(视觉对等)。 */
const CHAT_PROVIDERS: Array<{ name: string; mark: string; color: string }> = [
  { name: 'OpenAI', mark: 'O', color: '#10a37f' },
  { name: 'Anthropic', mark: 'A', color: '#d97757' },
  { name: 'Google', mark: 'G', color: '#4285f4' },
  { name: 'Azure (API Key)', mark: 'Az', color: '#0078d4' },
  { name: 'Azure (Entra ID)', mark: 'Az', color: '#0078d4' },
  { name: 'Ollama', mark: 'Ol', color: '#5a5a5a' },
  { name: 'AWS Bedrock', mark: 'aws', color: '#ff9900' },
  { name: 'Vercel AI Gateway', mark: 'V', color: '#111111' },
  { name: 'xAI Grok', mark: 'X', color: '#111111' },
  { name: 'Groq', mark: 'Gq', color: '#f55036' },
  { name: 'OpenRouter', mark: 'OR', color: '#6566f1' },
  { name: 'DeepSeek', mark: 'DS', color: '#4d6bfe' },
  { name: 'Cohere', mark: 'Co', color: '#39594d' },
  { name: 'Mistral Cloud', mark: 'M', color: '#ff7000' },
  { name: 'NVIDIA Nemotron', mark: 'N', color: '#76b900' },
];
const credentials = ref<Awaited<ReturnType<typeof api.credentials.list>>>([]);
async function loadChatProviders() {
  chatProviders.value = await api.assistant.providers().catch(() => []);
  credentials.value = await api.credentials.list().catch(() => []);
}
onMounted(loadChatProviders);

/* Configure provider 弹窗（对标基线：Enable {Provider} / Default credential / Context window） */
const providerMenuFor = ref<string | null>(null);
const providerModalOpen = ref(false);
const providerModal = ref<ProviderRow | null>(null);
const provEnabled = ref(true);
const provCredentialId = ref<string>('');
const provContextWindow = ref(20);
const provSaving = ref(false);
const provError = ref('');
/** 该 provider 类型下项目内可选的凭证列表。 */
const provCredOptions = computed(() =>
  credentials.value.filter((c) => c.type === providerModal.value?.credentialType),
);
const provCredOpen = ref(false);
const provCreateOpen = ref(false);
const meInfo = ref<{ name: string; email: string } | null>(null);
onMounted(async () => {
  const m = await api.me().catch(() => null);
  if (m) meInfo.value = { name: [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email, email: m.email };
});
const credLabel2 = (type: string) => credentialTypeMeta(type)?.displayName ?? type;
const provSelectedCredName = computed(
  () => provCredOptions.value.find((c) => c.id === provCredentialId.value)?.name ?? '',
);
function openProviderModal(p: ProviderRow) {
  providerMenuFor.value = null;
  providerModal.value = p;
  provEnabled.value = p.enabled;
  provCredentialId.value = p.credentialId ?? '';
  provContextWindow.value = p.contextWindow;
  provError.value = '';
  provCredOpen.value = false;
  providerModalOpen.value = true;
}
/** Create new credential（下拉底部）：预选类型直达 config；创建完自动选中。 */
async function onProvCredCreated(created: { id: string }) {
  credentials.value = await api.credentials.list().catch(() => credentials.value);
  provCredentialId.value = created.id;
}
async function confirmProvider() {
  if (!providerModal.value) return;
  provSaving.value = true;
  provError.value = '';
  try {
    await api.assistant.updateProvider(providerModal.value.id, {
      enabled: provEnabled.value,
      credentialId: provCredentialId.value || null,
      contextWindow: provContextWindow.value,
    });
    providerModalOpen.value = false;
    await loadChatProviders();
  } catch (e) {
    provError.value = (e as Error).message;
  } finally {
    provSaving.value = false;
  }
}


async function loadChat() {
  chatError.value = '';
  try {
    chatSettings.value = await api.chatSettings.get();
    ui.setChatEnabled(chatSettings.value.enabled);
  } catch (e) {
    chatError.value = (e as Error).message;
  }
}
async function saveChat(patch: { enabled?: boolean; model?: string }) {
  chatError.value = '';
  chatSaving.value = true;
  try {
    chatSettings.value = await api.chatSettings.update(patch);
    ui.setChatEnabled(chatSettings.value.enabled); // 侧栏 Chat 入口实时显隐
  } catch (e) {
    chatError.value = (e as Error).message; // 非 admin → 403
    await loadChat();
  } finally {
    chatSaving.value = false;
  }
}

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
  } else if (section.value === 'sourcecontrol') {
    await loadSourceControl();
  } else if (section.value === 'mcp') {
    mcpToken.value = ''; // 切页清掉上次明文
    mcpShowDetails.value = false;
    await loadMcp();
  } else if (section.value === 'chat') {
    await loadChat();
  } else if (section.value === 'billing') {
    const current = projects.current;
    if (current) usage.value = await api.projects.usage(current.id).catch(() => null);
    // D138:已发布(active)工作流数,用于 "Published workflows — N of Unlimited"
    const wfs = await api.workflows.list().catch(() => []);
    publishedWfCount.value = wfs.filter((w) => w.active).length;
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

/* 邀请用户（对标基线 "Invite new users" 弹窗；无 SMTP：生成可转交的邀请链接） */
const inviteModalOpen = ref(false);
const inviteEmail = ref(''); // 逗号分隔支持多个（对标基线）
const inviteRole = ref<'admin' | 'member'>('member');
const inviting = ref(false);
const inviteLinks = ref<Array<{ email: string; link: string }>>([]);
const inviteError = ref('');

function openInviteModal() {
  inviteEmail.value = '';
  inviteRole.value = 'member';
  inviteLinks.value = [];
  inviteError.value = '';
  inviteModalOpen.value = true;
}

async function inviteNewUser() {
  inviteError.value = '';
  const emails = inviteEmail.value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!emails.length) {
    inviteError.value = 'Enter at least one email address';
    return;
  }
  inviting.value = true;
  try {
    const links: Array<{ email: string; link: string }> = [];
    for (const email of emails) {
      const res = await api.instanceUsers.invite(email, inviteRole.value);
      links.push({ email, link: res.inviteLink });
    }
    inviteLinks.value = links;
    inviteEmail.value = '';
    users.value = await api.instanceUsers.list();
  } catch (e) {
    inviteError.value = (e as Error).message;
  } finally {
    inviting.value = false;
  }
}

async function removeUser(id: string, email: string, pending: boolean) {
  const verb = pending ? 'Revoke the invitation for' : 'Remove';
  if (!confirm(`${verb} ${email}?`)) return;
  usersError.value = '';
  try {
    await api.instanceUsers.remove(id);
    users.value = await api.instanceUsers.list();
  } catch (e) {
    usersError.value = (e as Error).message;
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

// 套餐名直接取证书里的显示名;未激活/失效时后端已回落为 'community'
const planLabel = computed(() => {
  const plan = projects.license?.plan;
  return !plan || plan === 'community' ? 'Community' : plan;
});
/** 填了 key 但没生效(过期/验签不过)——要让用户看见原因,不能静默当社区版。 */
const licenseProblem = computed(() => {
  const info = projects.license;
  return info && info.activated && info.status !== 'active' ? (info.message ?? 'License is not active') : '';
});
const licenseValidTo = computed(() => {
  const iso = projects.license?.validTo;
  return iso ? new Date(iso).toLocaleDateString() : '';
});

/* 许可证激活弹窗 */
const licenseModalOpen = ref(false);
const licenseBusy = ref(false);
const licenseError = ref('');
const isActivated = computed(() => projects.license?.activated ?? false);

function onLicenseActivated(info: LicenseInfo) {
  projects.license = info; // 立即反映解锁的功能
}
async function removeLicense() {
  if (!confirm('Remove the activation key? Enterprise features will be disabled.')) return;
  licenseError.value = '';
  licenseBusy.value = true;
  try {
    projects.license = await api.deactivateLicense();
  } catch (e) {
    licenseError.value = (e as Error).message;
  } finally {
    licenseBusy.value = false;
  }
}

/* 源码同步 */
const scConfig = ref<import('../api/client.js').SourceControlConfig | null>(null);
const scStatus = ref<import('../api/client.js').SourceControlStatus | null>(null);
const scRepoUrl = ref('');
const scBranch = ref('main');
const scMessage = ref('');
const scError = ref('');
const scBusy = ref(''); // 当前进行中的操作名，用于按钮 loading
const scResult = ref('');

async function loadSourceControl() {
  scError.value = '';
  scResult.value = '';
  scStatus.value = null;
  try {
    scConfig.value = await api.sourceControl.config();
    if (scConfig.value.connected) {
      scBranch.value = scConfig.value.branch;
      await refreshScStatus();
    }
  } catch (e) {
    scError.value = (e as Error).message; // 社区版 / 非 admin → 403
    scConfig.value = null;
  }
}
async function refreshScStatus() {
  try {
    scStatus.value = await api.sourceControl.status();
  } catch (e) {
    scError.value = (e as Error).message;
  }
}
async function scConnect() {
  scError.value = '';
  if (!scRepoUrl.value.trim()) {
    scError.value = 'Enter a repository URL';
    return;
  }
  scBusy.value = 'connect';
  try {
    scConfig.value = await api.sourceControl.connect(scRepoUrl.value.trim(), scBranch.value.trim() || 'main');
    scRepoUrl.value = '';
    await refreshScStatus();
  } catch (e) {
    scError.value = (e as Error).message;
  } finally {
    scBusy.value = '';
  }
}
async function scDisconnect() {
  if (!confirm('Disconnect the source control repository?')) return;
  scBusy.value = 'disconnect';
  scError.value = '';
  try {
    await api.sourceControl.disconnect();
    scConfig.value = await api.sourceControl.config();
    scStatus.value = null;
  } catch (e) {
    scError.value = (e as Error).message;
  } finally {
    scBusy.value = '';
  }
}
async function scPush() {
  scBusy.value = 'push';
  scError.value = '';
  scResult.value = '';
  try {
    const r = await api.sourceControl.push(scMessage.value.trim() || 'Update workflows');
    scResult.value = r.committed ? `Pushed ${r.files.length} workflow file(s).` : 'Nothing to push — already up to date.';
    scMessage.value = '';
    await refreshScStatus();
  } catch (e) {
    scError.value = (e as Error).message;
  } finally {
    scBusy.value = '';
  }
}
async function scPull() {
  scBusy.value = 'pull';
  scError.value = '';
  scResult.value = '';
  try {
    const r = await api.sourceControl.pull();
    const parts = [`${r.created} created`, `${r.updated} updated`];
    if (r.skipped.length) parts.push(`${r.skipped.length} skipped`);
    scResult.value = `Pulled: ${parts.join(', ')}.`;
    await refreshScStatus();
  } catch (e) {
    scError.value = (e as Error).message;
  } finally {
    scBusy.value = '';
  }
}

/** 单路径/多路径图标（内联 SVG 内容，stroke 由父 svg 提供）。 */
const icons = SETTINGS_ICONS;
const sections = SETTINGS_SECTIONS as Array<{ key: Section; label: string; badge?: string }>;
</script>

<template>
  <div class="settings-shell">
    <div class="settings-body">
    <nav class="settings-nav">
      <button class="settings-back" data-test="settings-back" @click="router.push({ name: 'overview' })">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6" /></svg>
        {{ t('Settings') }}
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
        <span>{{ t(s.label) }}</span>
        <span v-if="s.badge" class="nav-badge">{{ t(s.badge) }}</span>
      </button>
      <div class="settings-version">{{ t('Version {v}', { v: about?.version ?? '…' }) }}</div>
    </nav>

    <div class="settings-content">
      <!-- 个人设置（对标基线 Personal：右上头像 chip + Basic Information + Security） -->
      <section v-if="section === 'personal'" data-test="settings-personal">
        <div class="page-head">
          <h1 class="page-title">{{ t('Personal Settings') }}</h1>
          <div v-if="me" class="me-chip">
            <div class="me-chip-text">
              <b>{{ displayName(me.firstName, me.lastName, me.email) }}</b>
              <span class="dim" style="text-transform: capitalize">{{ me.role }}</span>
            </div>
            <span class="avatar">{{ initialsOf(me.firstName, me.lastName, me.email) }}</span>
          </div>
        </div>

        <h3 class="sec-title">{{ t('Basic Information') }}</h3>
        <div class="form-grid" style="max-width: 760px">
          <div class="field">
            <label>{{ t('First Name') }} <span class="req">*</span></label>
            <input v-model="profileFirst" data-test="profile-first" />
          </div>
          <div class="field">
            <label>{{ t('Last Name') }} <span class="req">*</span></label>
            <input v-model="profileLast" data-test="profile-last" />
          </div>
          <div class="field">
            <label>{{ t('Email') }} <span class="req">*</span></label>
            <div class="ro-field">{{ me?.email ?? '—' }}</div>
          </div>
        </div>
        <h3 class="sec-title">{{ t('Security') }}</h3>
        <div style="max-width: 760px">
          <b style="font-size: 14px">{{ t('Password') }}</b>
          <div v-if="!showPassForm" style="margin-top: 6px">
            <a href="#" class="accent-link" data-test="change-password" @click.prevent="showPassForm = true">{{ t('Change password') }}</a>
            <span v-if="passSaved" class="saved-hint" style="margin-left: 10px">{{ t('Password updated ✓') }}</span>
          </div>
          <div v-else class="card" style="margin-top: 10px; max-width: 480px">
            <label>{{ t('Current password') }}</label>
            <input v-model="passCurrent" data-test="pass-current" type="password" autocomplete="current-password" />
            <label>{{ t('New password') }}</label>
            <input v-model="passNew" data-test="pass-new" type="password" autocomplete="new-password" />
            <p class="dim" style="font-size: 12px; margin: 4px 0 0">{{ t('8+ characters') }}</p>
            <label>{{ t('Confirm new password') }}</label>
            <input v-model="passNew2" data-test="pass-new2" type="password" autocomplete="new-password" @keyup.enter="submitChangePassword" />
            <p v-if="passError" class="error-text">{{ passError }}</p>
            <div style="display: flex; gap: 10px; margin-top: 14px">
              <button class="btn primary" data-test="pass-save" @click="submitChangePassword">{{ t('Save password') }}</button>
              <button class="btn secondary" @click="showPassForm = false; passError = ''">{{ t('Cancel') }}</button>
            </div>
          </div>

          <div style="margin-top: 22px" data-test="settings-mfa">
            <b style="font-size: 14px">{{ t('Two-factor authentication (2FA)') }}</b>
            <p class="dim" style="font-size: 13px; margin: 6px 0 0">
              {{ t(me?.mfaEnabled ? 'Two-factor authentication is currently enabled.' : 'Two-factor authentication is currently disabled.') }}
              {{ t('Use an authenticator app (Google Authenticator / Authy…) to protect sign-in.') }}
            </p>

            <!-- 未开启 & 未开始设置 -->
            <button
              v-if="!me?.mfaEnabled && !mfaSetup"
              class="btn secondary"
              style="margin-top: 12px"
              data-test="mfa-enable-start"
              @click="startMfaSetup"
            >
              {{ t('Enable 2FA') }}
            </button>

            <!-- 设置中：展示 secret / 备份码 + 输码确认 -->
            <div v-else-if="mfaSetup" style="margin-top: 12px">
              <p class="dim" style="font-size: 12.5px; margin: 0 0 6px">
                {{ t('Add the secret below to your authenticator app (or use the otpauth link), then enter the 6-digit code to confirm:') }}
              </p>
              <code class="api-token" data-test="mfa-secret">{{ mfaSetup.secret }}</code>
              <details style="margin-top: 8px">
                <summary class="dim" style="font-size: 12px; cursor: pointer">{{ t('otpauth link') }}</summary>
                <code class="api-token" style="margin-top: 6px">{{ mfaSetup.otpauthUri }}</code>
              </details>
              <div style="margin-top: 12px">
                <div class="dim" style="font-size: 12px; margin-bottom: 4px">{{ t('Backup codes (single-use — store them safely):') }}</div>
                <div class="mfa-backup" data-test="mfa-backup">
                  <code v-for="c in mfaSetup.backupCodes" :key="c">{{ c }}</code>
                </div>
              </div>
              <div style="display: flex; gap: 10px; align-items: center; margin-top: 14px; flex-wrap: wrap">
                <input v-model="mfaCode" data-test="mfa-code" :placeholder="t('6-digit code')" style="width: 130px" @keyup.enter="confirmMfaEnable" />
                <button class="btn primary" data-test="mfa-confirm" @click="confirmMfaEnable">{{ t('Confirm') }}</button>
                <button class="btn secondary" @click="cancelMfaSetup">{{ t('Cancel') }}</button>
              </div>
            </div>

            <!-- 已开启：输码停用 -->
            <div v-else style="margin-top: 12px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
              <input v-model="mfaCode" data-test="mfa-code" :placeholder="t('Code or backup code')" style="width: 170px" @keyup.enter="disableMfa" />
              <button class="btn secondary btn-sm" data-test="mfa-disable" @click="disableMfa">{{ t('Disable 2FA') }}</button>
            </div>

            <p v-if="mfaError" class="error-text" data-test="mfa-error">{{ mfaError }}</p>
          </div>
        </div>

        <!-- D133 Personalisation:Theme 下拉(对标基线:System default/Light theme/Dark theme) -->
        <h3 class="sec-title">{{ t('Personalisation') }}</h3>
        <div class="setting-card" style="max-width: 880px">
          <div class="setting-row">
            <div class="setting-text"><b>{{ t('Theme') }}</b></div>
            <select class="sec-select" v-model="themePref" data-test="theme-select" @change="applyTheme">
              <option value="system">{{ t('System default') }}</option>
              <option value="light">{{ t('Light theme') }}</option>
              <option value="dark">{{ t('Dark theme') }}</option>
            </select>
          </div>
        </div>

        <div style="margin-top: 30px; display: flex; align-items: center; gap: 12px">
          <button class="btn primary" data-test="profile-save" :disabled="profileSaving" @click="saveProfile">
            {{ profileSaving ? t('Saving…') : t('Save') }}
          </button>
          <span v-if="profileSaved" class="saved-hint" style="margin: 0">{{ t('Saved ✓') }}</span>
          <span v-if="profileError" class="error-text" style="margin: 0">{{ profileError }}</span>
        </div>
      </section>

      <!-- 语言设置（全局，存 localStorage，切换即时生效） -->
      <section v-else-if="section === 'languages'" data-test="settings-languages">
        <h1 class="page-title">{{ t('Languages') }}</h1>
        <p class="sub">
          {{ t('Choose the language of the nomops interface.') }}
          {{ t('The setting is saved in this browser and applies to the whole app immediately.') }}
        </p>
        <div class="card" style="max-width: 480px">
          <label>{{ t('Language') }}</label>
          <select
            :value="locale"
            data-test="language-select"
            style="width: 100%"
            @change="setLocale(($event.target as HTMLSelectElement).value as Locale)"
          >
            <option v-for="l in LOCALES" :key="l.value" :value="l.value">{{ l.label }}</option>
          </select>
          <p class="dim" style="font-size: 12.5px; margin: 10px 0 0">{{ t('Untranslated text falls back to English.') }}</p>
        </div>
      </section>

      <!-- Roles（内置角色说明，对标基线 Roles 页的 Instance/Project 两个 tab） -->
      <section v-else-if="section === 'roles'" data-test="settings-roles">
        <div style="display: flex; align-items: center; gap: 10px">
          <h1 class="page-title" style="margin-bottom: 0">Roles</h1>
          <span class="nav-badge">New</span>
        </div>
        <p class="sub" style="margin-top: 10px; max-width: 760px">
          Roles allow you to manage specific permissions tailored to your team's needs. Define granular access to
          workflows, credentials, project resources and instance settings.
          <a class="link" href="/docs" @click.prevent>Learn more in documentation</a>
        </p>
        <div class="tabs">
          <button class="tab" :class="{ active: rolesTab === 'instance' }" data-test="roles-tab-instance" @click="rolesTab = 'instance'">Instance roles</button>
          <button class="tab" :class="{ active: rolesTab === 'project' }" data-test="roles-tab-project" @click="rolesTab = 'project'">Project roles</button>
        </div>
        <!-- Enterprise 锁卡(对标基线 Community Roles):三权限卡图形 + Upgrade to Enterprise -->
        <div class="ent-lock" data-test="roles-lock">
          <div class="ent-cards"><span /><span /><span /></div>
          <h2 class="ent-title">Upgrade to Enterprise</h2>
          <p class="ent-desc">Upgrade to Enterprise to unlock custom roles. It will allow to create custom, granular permissions that let you fine-tune access.</p>
          <div class="ent-actions">
            <a class="btn-learn" href="/docs" @click.prevent>Learn more</a>
            <button class="btn-upgrade" data-test="roles-upgrade">Upgrade</button>
          </div>
        </div>
      </section>

      <!-- 用户管理（实例 admin，对标基线 Users：计数副标题 + 搜索 + 右侧 Invite + 头像表格） -->
      <section v-else-if="section === 'users'" data-test="settings-users">
        <h1 class="page-title" style="margin-bottom: 4px">Users</h1>
        <p class="dim" style="margin: 0 0 18px; font-size: 13.5px">{{ users.length }} user{{ users.length === 1 ? '' : 's' }}</p>

        <!-- D134 对标基线 Community:顶部米黄升级条 -->
        <div v-if="!isActivated" class="users-upgrade" data-test="users-upgrade">
          Upgrade to unlock the ability to create additional admin users
        </div>

        <div class="users-toolbar" style="max-width: 880px">
          <div class="search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="i15"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input v-model="userSearch" data-test="users-search" placeholder="Search by name or email" />
          </div>
          <span style="flex: 1" />
          <button class="btn primary" data-test="invite-open" @click="openInviteModal">Invite</button>
        </div>

        <p v-if="usersError" class="error-text" data-test="users-error">{{ usersError }}</p>

        <!-- 弹窗：Invite new users（对标基线） -->
        <div v-if="inviteModalOpen" class="modal-mask" data-test="invite-modal" @click.self="inviteModalOpen = false">
          <div class="modal-card" style="width: 560px">
            <div style="display: flex; align-items: flex-start; justify-content: space-between">
              <h2 class="modal-title">Invite new users</h2>
              <button class="modal-x" @click="inviteModalOpen = false">×</button>
            </div>
            <template v-if="!inviteLinks.length">
              <label class="modal-label">New User Email Addresses <span class="req">*</span></label>
              <input
                v-model="inviteEmail"
                data-test="invite-email"
                type="text"
                placeholder="name1@email.com, name2@email.com, ..."
                style="width: 100%"
                @keyup.enter="inviteNewUser"
              />
              <label class="modal-label">Role <span class="req">*</span></label>
              <select v-model="inviteRole" data-test="invite-role" style="width: 100%">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <p v-if="inviteError" class="error-text" data-test="invite-error">{{ inviteError }}</p>
              <div style="margin-top: 20px">
                <button class="btn primary" data-test="invite-submit" :disabled="inviting || !inviteEmail.trim()" @click="inviteNewUser">
                  {{ inviting ? 'Creating…' : 'Create invite link' }}
                </button>
              </div>
            </template>
            <template v-else>
              <p class="dim" style="font-size: 13px; margin: 0 0 10px">
                Copy each link and send it to the invitee — valid until accepted (no SMTP on this instance).
              </p>
              <div v-for="l in inviteLinks" :key="l.email" data-test="invite-link" style="margin-bottom: 10px">
                <div class="dim" style="font-size: 12px">{{ l.email }}</div>
                <code class="api-token" style="margin-top: 4px">{{ l.link }}</code>
              </div>
              <div class="modal-actions">
                <button class="btn primary" data-test="invite-link-done" @click="inviteModalOpen = false">Done</button>
              </div>
            </template>
          </div>
        </div>
        <div class="card" style="max-width: 1000px; padding: 0">
          <table class="api-table">
            <thead>
              <tr><th>User</th><th>Account Type</th><th>Last Active</th><th>2FA</th><th>Projects</th><th style="width: 44px"></th></tr>
            </thead>
            <tbody>
              <tr v-for="u in filteredUsers" :key="u.id" data-test="user-row">
                <td>
                  <div class="user-cell">
                    <span class="avatar">{{ initialsOf(u.firstName ?? null, u.lastName ?? null, u.email) }}</span>
                    <div class="user-cell-text">
                      <b>
                        {{ displayName(u.firstName ?? null, u.lastName ?? null, u.email) }}
                        <span v-if="u.pending" class="badge" data-test="user-pending" style="margin-left: 6px">Pending</span>
                        <span v-else-if="u.disabled" class="badge" style="margin-left: 6px">Disabled</span>
                      </b>
                      <span class="dim">{{ u.email }}</span>
                    </div>
                  </div>
                </td>
                <!-- D135 对标基线:Account Type 纯文本(角色变更移到 ⋮ 菜单,changeUserRole 保留) -->
                <td style="width: 140px">
                  <span :data-test-user-role="u.id" style="text-transform: capitalize">{{ u.role }}</span>
                  <span v-if="u.pending" class="dim"> (Pending)</span>
                </td>
                <td class="dim">—</td>
                <td class="dim">{{ u.pending ? '—' : u.mfaEnabled ? 'Enabled' : 'Disabled' }}</td>
                <td class="dim">
                  {{ u.pending ? '—' : u.role === 'owner' || u.role === 'admin' ? 'All projects' : (u.projectCount ?? 0) }}
                </td>
                <td style="text-align: right; position: relative" @click.stop>
                  <button class="row-dots" :data-test-user-menu="u.id" @click="userMenuOpen = userMenuOpen === u.id ? null : u.id">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="i16"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
                  </button>
                  <div v-if="userMenuOpen === u.id" class="row-menu-pop">
                    <button class="menu-item" data-test="user-remove" @click="userMenuOpen = null; removeUser(u.id, u.email, u.pending)">
                      {{ u.pending ? 'Revoke invitation' : 'Delete user' }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 安全（实例 admin，对标基线 Security & policies 的设置行卡片） -->
      <section v-else-if="section === 'security'" data-test="settings-security">
        <h1 class="page-title">Security &amp; policies</h1>
        <!-- B 类锁墙:对标基线 Community 的 Security & policies 三分区(全 Enterprise 锁,Upgrade 徽章)。
             注:安全数据 loader(loadSecurity/rotateScimToken)后端接口保留,便于回退到自有实现。 -->
        <!-- 1) Enforce two-factor authentication -->
        <h3 class="sec-title" style="margin-top: 6px">Enforce two-factor authentication</h3>
        <div class="setting-card" style="max-width: 880px">
          <div class="setting-row">
            <div class="setting-text">
              <b>Enforce two-factor authentication <span class="chip-upgrade">Upgrade</span></b>
              <p>Enforces 2FA for all users on this instance authenticating with email and password logins.</p>
            </div>
            <span class="switch" title="Available on the Enterprise plan" style="cursor: default">
              <input type="checkbox" disabled /><span class="slider" />
            </span>
          </div>
        </div>

        <!-- 2) Data redaction -->
        <h3 class="sec-title">Data redaction</h3>
        <div class="setting-card" style="max-width: 880px">
          <div class="setting-row">
            <div class="setting-text">
              <b>Enforce data redaction <span class="chip-upgrade">Upgrade</span></b>
              <p>Override workflow-level settings and enforce data redaction on all executions across the instance. <a class="link" href="/docs" @click.prevent>Learn more</a></p>
            </div>
            <span class="switch" title="Available on the Enterprise plan" style="cursor: default">
              <input type="checkbox" disabled /><span class="slider" />
            </span>
          </div>
          <div class="setting-row">
            <div class="setting-text">
              <b>Redact executions <span class="chip-upgrade">Upgrade</span></b>
              <p>Select whether to redact production executions, or manual and production executions.</p>
            </div>
            <select class="sec-select" disabled title="Available on the Enterprise plan">
              <option>Production executions (Recommended)</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-text"><b>Affected scope</b></div>
            <span class="dim">No executions</span>
          </div>
        </div>

        <!-- 3) Personal Space -->
        <h3 class="sec-title">Personal Space</h3>
        <div class="setting-card" style="max-width: 880px">
          <div class="setting-row">
            <div class="setting-text">
              <b>Sharing <span class="chip-upgrade">Upgrade</span></b>
              <p>Sharing of workflows, credentials and other resources from personal space. Changing the setting doesn't revoke existing shares.</p>
            </div>
            <span class="switch" title="Available on the Enterprise plan" style="cursor: default">
              <input type="checkbox" disabled /><span class="slider" />
            </span>
          </div>
          <div class="setting-row">
            <div class="setting-text"><b>Existing shares</b></div>
            <span class="dim">0 workflows, 0 credentials</span>
          </div>
          <div class="setting-row">
            <div class="setting-text">
              <b>Workflow publishing <span class="chip-upgrade">Upgrade</span></b>
              <p>Publishing workflows in personal space. Changing the setting doesn't unpublish existing workflows.</p>
            </div>
            <span class="switch" title="Available on the Enterprise plan" style="cursor: default">
              <input type="checkbox" disabled /><span class="slider" />
            </span>
          </div>
          <div class="setting-row">
            <div class="setting-text"><b>Existing published workflows</b></div>
            <span class="dim">0 workflows</span>
          </div>
        </div>
      </section>

      <!-- SSO 配置 -->
      <section v-else-if="section === 'sso'" data-test="settings-sso">
        <h1 class="page-title">Single Sign-On</h1>
        <p class="sub">
          <!-- D147 live 实测基线文案（documentation 按仓库政策指向自有文档） -->
          Configure SSO to let your team sign in using your identity provider. Supports SAML 2.0 and OpenID Connect
          protocols. Learn more in the
          <a class="link" href="https://github.com/nomops/nomops/tree/main/docs" target="_blank" rel="noreferrer">documentation</a>
        </p>
        <div v-if="!licensed('sso')" class="locked-card" data-test="sso-locked">
          <h2>Available on the Enterprise plan</h2>
          <p>Use Single Sign-On to consolidate authentication into a single platform to improve security and agility.</p>
          <a class="btn primary" href="https://基线.io/pricing" target="_blank" rel="noopener">See plans</a>
        </div>
        <p v-else-if="ssoError" class="error-text" data-test="sso-error">{{ ssoError }}</p>
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
          LDAP allows users to authenticate with their centralized account. It’s compatible with services that provide
          an LDAP interface like Active Directory and OpenLDAP; first login provisions the account automatically.
        </p>
        <div v-if="!licensed('ldap')" class="locked-card" data-test="ldap-locked">
          <h2>Available on the Enterprise plan</h2>
          <p>LDAP is available as a paid feature — sign your team in with the corporate directory.</p>
          <a class="btn primary" href="https://基线.io/pricing" target="_blank" rel="noopener">See plans</a>
        </div>
        <p v-else-if="ldapError" class="error-text" data-test="ldap-error">{{ ldapError }}</p>
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
          Send logs to external endpoints of your choice (SIEM / data lake / alerting) in real time. Each event is
          signed with the destination secret via HMAC-SHA256 in the <code>x-nomops-signature</code> header.
        </p>
        <div v-if="!licensed('logStreaming')" class="locked-card" data-test="ls-locked">
          <h2>Available on the Enterprise plan</h2>
          <p>Log Streaming is available as a paid feature — push execution and audit events to your SIEM.</p>
          <a class="btn primary" href="https://基线.io/pricing" target="_blank" rel="noopener">See plans</a>
        </div>
        <p v-else-if="lsError" class="error-text" data-test="ls-error">{{ lsError }}</p>
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
              <button class="btn secondary btn-sm" data-test="ls-test" @click="testDestination(d.id)">Test</button>
              <button class="btn secondary btn-sm danger" data-test="ls-remove" @click="removeDestination(d.id)">Delete</button>
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
          secrets land in the DB. The current provider reads from <code>NOMOPS_SECRET_&lt;KEY&gt;</code> env vars.
        </p>
        <div v-if="!licensed('externalSecrets')" class="locked-card" data-test="secrets-locked">
          <h2>Available on the Enterprise plan</h2>
          <p>Use External Secrets to keep credentials in an external vault and reference them at run time.</p>
          <a class="btn primary" href="https://基线.io/pricing" target="_blank" rel="noopener">See plans</a>
        </div>
        <p v-else-if="secretsError" class="error-text" data-test="secrets-error">{{ secretsError }}</p>
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

      <!-- 公共 API 令牌（对标基线 API 页：空态虚线卡 + Create API Key 弹窗） -->
      <section v-else-if="section === 'api'" data-test="settings-api">
        <h1 class="page-title">API</h1>

        <!-- 空态：基线式虚线卡 -->
        <div v-if="!apiKeysList.length" class="locked-card" data-test="api-empty">
          <!-- D149 live 实测基线句式：Control <产品> programmatically using the <产品> API（尾部橙色链接） -->
          <p style="margin-top: 0">
            Control nomops programmatically using the
            <a class="link" href="https://github.com/nomops/nomops/tree/main/docs" target="_blank" rel="noreferrer">nomops API</a>
          </p>
          <button class="btn primary" data-test="api-create-open" @click="openApiModal">Create API key</button>
        </div>

        <!-- 已有令牌：列表 + 右下创建按钮 -->
        <template v-else>
          <div class="card" style="max-width: 720px; margin-top: 4px; padding: 0">
            <table class="api-table">
              <thead><tr><th>Label</th><th>API key</th><th>Scope</th><th>Expires</th><th>Last used</th><th></th></tr></thead>
              <tbody>
                <tr v-for="k in apiKeysList" :key="k.id" data-test="api-key-row">
                  <td>{{ k.label }}</td>
                  <td class="mono dim">{{ k.prefix }}…</td>
                  <td class="dim">{{ k.scope === 'readonly' ? 'Read only' : 'All' }}</td>
                  <td class="dim">{{ k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never' }}</td>
                  <td class="dim">{{ k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never' }}</td>
                  <td style="text-align: right">
                    <button class="btn secondary btn-sm" data-test="api-revoke" @click="revokeApiKey(k.id)">Revoke</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style="max-width: 720px; margin-top: 12px; display: flex; justify-content: flex-end">
            <button class="btn primary" data-test="api-create-open" @click="openApiModal">Create API key</button>
          </div>
        </template>

        <!-- 弹窗：Create API Key（对标基线） -->
        <div v-if="apiModalOpen" class="modal-mask" data-test="api-modal" @click.self="apiModalOpen = false">
          <div class="modal-card" style="width: 560px">
            <div style="display: flex; align-items: flex-start; justify-content: space-between">
              <h2 class="modal-title">Create API Key</h2>
              <button class="modal-x" @click="apiModalOpen = false">×</button>
            </div>
            <template v-if="!createdToken">
              <label class="modal-label">Label</label>
              <input v-model="newKeyLabel" data-test="api-label" placeholder="e.g. Internal Project" style="width: 100%" @keyup.enter="createApiKey" />

              <label class="modal-label">Expiration</label>
              <div style="display: flex; align-items: center; gap: 14px">
                <select v-model="apiExpireDays" data-test="api-expiration" style="width: 160px">
                  <option v-for="o in API_EXPIRATIONS" :key="o.label" :value="o.value">{{ o.label }}</option>
                </select>
                <input v-if="apiExpireDays === 'custom'" v-model="apiExpireCustom" type="date" data-test="api-expiration-custom" style="width: 170px" />
                <span class="dim" style="font-size: 13.5px" data-test="api-expire-text">{{ apiExpireText }}</span>
              </div>

              <label class="modal-label">Scopes</label>
              <label class="radio-row">
                <input v-model="apiScope" type="radio" value="all" data-test="api-scope-all" />
                <span>All</span>
              </label>
              <label class="radio-row">
                <input v-model="apiScope" type="radio" value="readonly" data-test="api-scope-readonly" />
                <span>Read only</span>
              </label>
              <!-- D141 对标基线:Custom scope 单选 -->
              <label class="radio-row">
                <input v-model="apiScope" type="radio" value="custom" data-test="api-scope-custom" />
                <span>Custom</span>
              </label>
              <p class="dim" style="font-size: 12px; margin: 6px 0 0">
                {{ apiScope === 'custom' ? 'Custom keys grant a specific subset of scopes.' : 'Read-only keys can call GET endpoints only — write requests are rejected with 403.' }}
              </p>
              <p v-if="apiError" class="error-text" data-test="api-error">{{ apiError }}</p>
              <div class="modal-actions">
                <button class="btn primary" data-test="api-create" :disabled="apiBusy || !newKeyLabel.trim()" @click="createApiKey">
                  {{ apiBusy ? 'Saving…' : 'Save' }}
                </button>
              </div>
            </template>
            <template v-else>
              <p class="dim" style="font-size: 13px; margin: 0 0 8px">
                Make sure to copy your API key now — you won't be able to see it again.
              </p>
              <code class="api-token" data-test="api-new-token">{{ createdToken }}</code>
              <div class="modal-actions">
                <button class="btn primary" data-test="api-token-done" @click="apiModalOpen = false; createdToken = ''">Done</button>
              </div>
            </template>
          </div>
        </div>
      </section>

      <!-- 社区节点（对标基线：空态虚线卡） -->
      <section v-else-if="section === 'community'" data-test="settings-community">
        <!-- D139 对标基线:标题行右上常驻 Install 橙钮 -->
        <div class="page-head" style="max-width: 720px; display: flex; align-items: center; justify-content: space-between">
          <h1 class="page-title" style="margin-bottom: 0">Community nodes</h1>
          <button v-if="communityNodes.length" class="btn primary" data-test="community-install-open" @click="openCommunityModal">Install</button>
        </div>

        <!-- 空态：基线式虚线卡 -->
        <div v-if="!communityNodes.length" class="locked-card" data-test="community-empty" style="margin-top: 16px">
          <h2 style="font-weight: 400">Supercharge your workflows with community nodes</h2>
          <p>Install node packages contributed by the community (npm packages exporting a <code>nomopsNodes</code> array).</p>
          <button class="btn primary" data-test="community-empty-install" @click="openCommunityModal">Install a community node</button>
        </div>

        <!-- D140 对标基线:包卡片(包名 + "N node(s): 节点名" + 版本 + Uninstall) -->
        <div v-else class="cn-list" style="max-width: 720px">
          <div v-for="p in communityNodes" :key="p.packageName" class="cn-card" data-test="community-row">
            <div class="cn-main">
              <b>{{ p.packageName }}</b>
              <span class="dim cn-nodes">
                {{ p.nodeTypes.length }} node{{ p.nodeTypes.length === 1 ? '' : 's' }}: {{ p.nodeTypes.map((t) => t.split('.').pop()).join(', ') }}
                <span class="mono"> · {{ p.version }}</span>
              </span>
            </div>
            <button class="btn secondary btn-sm" data-test="community-uninstall" @click="uninstallCommunityNode(p.packageName)">Uninstall</button>
          </div>
        </div>

        <!-- 弹窗：Install community nodes（对标基线：说明卡 + 包名 + 风险确认） -->
        <div v-if="communityModalOpen" class="modal-mask" data-test="community-modal" @click.self="communityModalOpen = false">
          <div class="modal-card" style="width: 620px">
            <div style="display: flex; align-items: flex-start; justify-content: space-between">
              <h2 class="modal-title">Install community nodes</h2>
              <button class="modal-x" @click="communityModalOpen = false">×</button>
            </div>
            <div class="info-callout" style="display: flex; align-items: center; gap: 14px">
              <span style="flex: 1">Find community nodes to add on the npm public registry.</span>
              <a class="btn primary btn-sm" style="text-decoration: none; display: inline-flex; align-items: center" href="https://www.npmjs.com/search?q=nomops-nodes" target="_blank" rel="noopener">Browse</a>
            </div>
            <label class="modal-label">npm Package Name</label>
            <input v-model="installName" data-test="community-name" placeholder="e.g. nomops-nodes-weather" style="width: 100%" @keyup.enter="installCommunityNode" />
            <label class="check-row" style="margin-top: 16px; font-size: 13.5px">
              <input v-model="riskAccepted" type="checkbox" data-test="community-risk" />
              <span>I understand the risks of installing unverified code from a public source — installed nodes run with full server privileges.</span>
            </label>
            <p v-if="communityError" class="error-text" data-test="community-error">{{ communityError }}</p>
            <div style="margin-top: 20px">
              <button
                class="btn primary"
                data-test="community-install"
                :disabled="installing || !riskAccepted || !installName.trim()"
                @click="installCommunityNode"
              >
                {{ installing ? 'Installing…' : 'Install' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Environments（Git 源码同步，对标基线 Environments） -->
      <section v-else-if="section === 'sourcecontrol'" data-test="settings-sourcecontrol">
        <h1 class="page-title">Environments</h1>
        <p class="sub">
          Use multiple instances for different environments (dev, prod, etc.), deploying between them via a Git
          repository — push local changes and pull updates. Only workflows are synced (no credentials).
          Authentication uses the host's Git configuration (SSH deploy key or credential helper).
        </p>

        <div v-if="!licensed('sourceControl')" class="locked-card" data-test="sc-locked">
          <h2>Available on the Enterprise plan</h2>
          <p>Use multiple instances for different environments (dev, prod, etc.), deploying between them via a Git repository.</p>
          <div class="locked-actions">
            <a class="btn secondary" href="https://docs.基线.io/source-control-environments/" target="_blank" rel="noopener">More info</a>
            <a class="btn primary" href="https://基线.io/pricing" target="_blank" rel="noopener">See plans</a>
          </div>
        </div>
        <p v-else-if="scError" class="error-text" data-test="sc-error">{{ scError }}</p>

        <!-- 未连接：连接表单 -->
        <div v-if="scConfig && !scConfig.connected" class="card" style="max-width: 620px; margin-top: 16px">
          <label style="font-size: 12px; color: var(--dim)">Repository URL</label>
          <input v-model="scRepoUrl" data-test="sc-repo" placeholder="git@github.com:org/workflows.git" style="width: 100%; margin-bottom: 12px" />
          <div style="display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap">
            <div style="width: 180px">
              <label style="font-size: 12px; color: var(--dim)">Branch</label>
              <input v-model="scBranch" data-test="sc-branch" placeholder="main" style="width: 100%" />
            </div>
            <button class="btn primary" data-test="sc-connect" :disabled="scBusy === 'connect'" @click="scConnect">
              {{ scBusy === 'connect' ? 'Connecting…' : 'Connect' }}
            </button>
          </div>
        </div>

        <!-- 已连接：状态 + push/pull -->
        <template v-else-if="scConfig && scConfig.connected">
          <div class="card" style="max-width: 620px; margin-top: 16px">
            <div style="display: flex; align-items: center; gap: 12px">
              <div style="min-width: 0">
                <div class="dim" style="font-size: 12px">Connected repository</div>
                <div class="mono" style="font-size: 13px; margin-top: 3px; word-break: break-all">{{ scConfig.repoUrl }}</div>
                <div class="dim" style="font-size: 12px; margin-top: 3px">Branch: <code>{{ scConfig.branch }}</code></div>
              </div>
              <span style="flex: 1" />
              <button class="btn secondary btn-sm" data-test="sc-disconnect" :disabled="scBusy === 'disconnect'" @click="scDisconnect">
                Disconnect
              </button>
            </div>
          </div>

          <div class="card" style="max-width: 620px; margin-top: 16px">
            <div style="display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap">
              <div style="flex: 1; min-width: 220px">
                <label style="font-size: 12px; color: var(--dim)">Commit message</label>
                <input v-model="scMessage" data-test="sc-message" placeholder="Update workflows" style="width: 100%" @keyup.enter="scPush" />
              </div>
              <button class="btn primary" data-test="sc-push" :disabled="!!scBusy" @click="scPush">
                {{ scBusy === 'push' ? 'Pushing…' : '↑ Push' }}
              </button>
              <button class="btn secondary" data-test="sc-pull" :disabled="!!scBusy" @click="scPull">
                {{ scBusy === 'pull' ? 'Pulling…' : '↓ Pull' }}
              </button>
            </div>
            <p v-if="scResult" class="dim" data-test="sc-result" style="font-size: 12.5px; margin-top: 12px; color: var(--ok)">{{ scResult }}</p>

            <!-- 待提交改动 -->
            <div v-if="scStatus" style="margin-top: 14px; border-top: 1px solid var(--border); padding-top: 12px">
              <div class="dim" style="font-size: 12px; margin-bottom: 8px">
                {{ scStatus.files.length ? `${scStatus.files.length} local change(s) to push` : 'No local changes — up to date.' }}
              </div>
              <ul v-if="scStatus.files.length" class="sc-changes" data-test="sc-changes">
                <li v-for="f in scStatus.files" :key="f.path">
                  <span class="sc-stat">{{ f.status || '·' }}</span>
                  <span class="mono">{{ f.path }}</span>
                </li>
              </ul>
              <button class="btn secondary btn-sm" data-test="sc-refresh" style="margin-top: 6px" @click="refreshScStatus">Refresh status</button>
            </div>
          </div>
        </template>
      </section>

      <!-- Observability（Prometheus /metrics，对应基线的 OpenTelemetry 观测位） -->
      <!-- OpenTelemetry(对标基线 /settings/opentelemetry:Collector connection + Tracing 两区)。
           注:原自有 Prometheus /metrics 端点后端保留(promScrape 常量留档),便于回退。 -->
      <section v-else-if="section === 'opentelemetry'" data-test="settings-opentelemetry">
        <h1 class="page-title" style="margin-bottom: 6px">OpenTelemetry</h1>
        <div class="otel-status">
          <select class="sec-select" v-model="otel.status" data-test="otel-status">
            <option value="Disabled">Disabled</option>
            <option value="Enabled">Enabled</option>
          </select>
          <span class="dim otel-status-hint">When disabled, no traces leave this instance.</span>
        </div>

        <h3 class="sec-title">Collector connection</h3>
        <div class="setting-card" style="max-width: 880px">
          <div class="otel-field">
            <label>OTLP endpoint</label>
            <input v-model="otel.endpoint" placeholder="https://collector.example.com" data-test="otel-endpoint" />
            <p class="otel-hint">The base URL of your OTLP collector (e.g. https://collector.example.com).</p>
          </div>
          <div class="otel-field">
            <label>Service name</label>
            <input v-model="otel.serviceName" placeholder="nomops-production" data-test="otel-service" />
            <p class="otel-hint">How this instance appears in your collector.</p>
          </div>
          <div class="otel-field">
            <label>Custom headers</label>
            <button class="btn secondary btn-sm" data-test="otel-add-header">Add header</button>
            <p class="otel-hint">Sent with every OTLP export. Use for Bearer tokens or tenant IDs.</p>
          </div>
          <div class="otel-field">
            <label>Trace path</label>
            <input v-model="otel.tracePath" placeholder="/v1/traces" data-test="otel-trace-path" />
            <p class="otel-hint">Appended to the endpoint. /v1/traces is the OTLP default.</p>
          </div>
          <div class="otel-field">
            <label>Startup connectivity timeout</label>
            <div class="otel-inline"><input v-model.number="otel.startupTimeout" type="number" data-test="otel-startup" /><span class="dim">ms</span></div>
            <p class="otel-hint">Reachability check at startup. nomops boots regardless.</p>
          </div>
          <div class="otel-field">
            <label>Verify configuration</label>
            <button class="btn secondary btn-sm" data-test="otel-test-trace">Send test trace</button>
            <p class="otel-hint">Send a test span to check nomops can reach your collector.</p>
          </div>
        </div>

        <h3 class="sec-title">Tracing</h3>
        <div class="setting-card" style="max-width: 880px">
          <div class="otel-field">
            <label>Trace sample rate</label>
            <div class="otel-inline"><input v-model.number="otel.sampleRate" type="number" step="0.01" min="0" max="1" data-test="otel-sample" /><span class="dim">of 1.00</span></div>
            <p class="otel-hint">Fraction of traces exported. 1.00 = all traces.</p>
          </div>
          <div class="setting-row">
            <div class="setting-text">
              <b>Include node spans</b>
              <p>One span per node, or workflow-level spans only.</p>
            </div>
            <span class="switch"><input v-model="otel.includeNodeSpans" type="checkbox" data-test="otel-node-spans" /><span class="slider" /></span>
          </div>
          <div class="setting-row">
            <div class="setting-text">
              <b>Inject outbound traceparent</b>
              <p>Add a W3C traceparent header to outbound HTTP so downstream services join the same trace.</p>
            </div>
            <span class="switch"><input v-model="otel.injectTraceparent" type="checkbox" data-test="otel-traceparent" /><span class="slider" /></span>
          </div>
          <div class="setting-row">
            <div class="setting-text">
              <b>Track published workflows only</b>
              <p>Skip manual canvas runs. Less noise in production.</p>
            </div>
            <span class="switch"><input v-model="otel.publishedOnly" type="checkbox" data-test="otel-published-only" /><span class="slider" /></span>
          </div>
        </div>

        <div class="otel-actions">
          <button class="btn primary" data-test="otel-save">Save settings</button>
          <button class="btn secondary" data-test="otel-discard">Discard changes</button>
        </div>
      </section>

      <!-- 实例级 MCP（Preview，对标基线 Instance-level MCP） -->
      <section v-else-if="section === 'mcp'" data-test="settings-mcp">
        <div class="page-head" style="max-width: 1000px">
          <div style="display: flex; align-items: center; gap: 10px">
            <h1 class="page-title" style="margin-bottom: 0">Instance-level MCP</h1>
            <span class="nav-badge preview">Preview</span>
          </div>
          <div v-if="mcpStatus" style="display: flex; align-items: center; gap: 12px">
            <label class="toggle-label" :class="{ on: mcpStatus.enabled }">
              {{ mcpStatus.enabled ? 'Enabled' : 'Disabled' }}
              <span class="switch" data-test="mcp-toggle">
                <input type="checkbox" :checked="mcpStatus.enabled" @change="mcpToggleEnabled" />
                <span class="slider" />
              </span>
            </label>
            <div class="dropdown-anchor" @click.stop>
              <button class="btn secondary" data-test="mcp-details" :disabled="!mcpStatus.enabled" @click="mcpShowDetails = !mcpShowDetails">
                Connection details
              </button>
              <div v-if="mcpShowDetails" class="mcp-pop" data-test="mcp-pop">
                <!-- D143 对标基线：认证方式是 OAuth | Access token 分段控件，Server URL 两种模式都显示 -->
                <div class="seg" data-test="mcp-conn-seg">
                  <button class="seg-btn" :class="{ active: mcpConnMode === 'oauth' }" data-test="mcp-conn-oauth" @click="mcpConnMode = 'oauth'">OAuth</button>
                  <button class="seg-btn" :class="{ active: mcpConnMode === 'token' }" data-test="mcp-conn-token" @click="mcpConnMode = 'token'">Access token</button>
                </div>
                <label style="font-size: 12px; color: var(--dim); display: block; margin-top: 12px">Server URL</label>
                <code class="api-token" style="margin-top: 4px">{{ mcpServerUrl }}</code>
                <template v-if="mcpConnMode === 'token'">
                  <label style="font-size: 12px; color: var(--dim); display: block; margin-top: 12px">Access token</label>
                  <code v-if="mcpToken" class="api-token" data-test="mcp-token" style="margin-top: 4px">{{ mcpToken }}</code>
                  <p v-else class="dim" style="font-size: 12px; margin: 4px 0 0">
                    Shown once when MCP access is enabled. Toggle off and on again to rotate the token.
                  </p>
                  <p class="dim" style="font-size: 12px; margin: 10px 0 0">
                    Send requests as <code>Authorization: Bearer &lt;token&gt;</code> (MCP Streamable HTTP, JSON-RPC 2.0).
                  </p>
                </template>
                <p v-else class="dim" style="font-size: 12px; margin: 10px 0 0">
                  The client runs the OAuth consent flow against this URL — no token to copy. Add its callback to the
                  allowlist under <b>OAuth settings</b> first.
                </p>
              </div>
            </div>
          </div>
        </div>
        <p class="sub" style="max-width: 1000px">
          <!-- live 实测基线副标文案 -->
          Connect MCP clients like Claude Code and Cursor to build, run, and iterate on workflows in your instance.
        </p>
        <p v-if="mcpError" class="error-text" data-test="mcp-error">{{ mcpError }}</p>

        <!-- 未启用：基线式虚线卡 -->
        <div v-if="mcpStatus && !mcpStatus.enabled" class="locked-card" style="max-width: 1000px" data-test="mcp-empty">
          <h2 style="font-weight: 400">Connect AI assistants to run workflows</h2>
          <p>Enable MCP access so clients can list the workflows you expose below and execute them (production semantics, quota enforced).</p>
          <button class="btn primary" data-test="mcp-enable" :disabled="mcpBusy" @click="mcpEnable">
            {{ mcpBusy ? 'Enabling…' : 'Enable MCP access' }}
          </button>
        </div>

        <!-- 启用：token 一次性展示 + Workflows / Connected clients 两个 tab -->
        <template v-else-if="mcpStatus">
          <div v-if="mcpToken" class="card api-new" style="max-width: 1000px; margin-bottom: 14px">
            <div class="dim" style="font-size: 12px">Access token — copy it now, it won't be shown again</div>
            <code class="api-token" data-test="mcp-new-token">{{ mcpToken }}</code>
          </div>

          <!-- D142 基线实测(2.30.4 运行实例 DOM + 2.31.0 源码结构双重印证):
               warning 告示条位于**页级**——在 MCP 已启用区块内、Tab 行之上,且不可关闭 -->
          <div class="warn-callout" data-test="mcp-oauth-warning" style="max-width: 1000px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="i15">
              <path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
            <span>
              Configure a redirect URL allowlist to control which applications can complete the OAuth consent flow.
              Without one, a malicious application could register an OAuth client with an attacker-controlled redirect URL
              and use it to obtain access tokens for your instance.
            </span>
          </div>
          <div class="tabs" style="max-width: 1000px">
            <button class="tab" :class="{ active: mcpTab === 'workflows' }" data-test="mcp-tab-workflows" @click="mcpTab = 'workflows'">Workflows</button>
            <button class="tab" :class="{ active: mcpTab === 'clients' }" data-test="mcp-tab-clients" @click="mcpTab = 'clients'">Connected clients</button>
            <button class="tab" :class="{ active: mcpTab === 'oauth' }" data-test="mcp-tab-oauth" @click="mcpTab = 'oauth'">OAuth settings</button>
            <span style="flex: 1" />
            <button class="icon-refresh" data-test="mcp-refresh" title="Refresh" @click="loadMcp">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="i15"><path d="M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5" /></svg>
            </button>
          </div>

          <!-- Workflows：仅列已启用；添加走弹窗（对标基线 Enable workflows） -->
          <template v-if="mcpTab === 'workflows'">
            <div class="card" style="max-width: 1000px; padding: 0">
              <table class="api-table">
                <!-- D144 对标基线:Workflows 表列 = Name / Location / Description -->
                <thead><tr><th>Name</th><th>Location</th><th>Description</th><th></th></tr></thead>
                <tbody>
                  <tr v-for="w in mcpEnabledWorkflows" :key="w.id" data-test="mcp-wf-row">
                    <td>{{ w.name }}</td>
                    <td class="dim">{{ w.projectName }}</td>
                    <td class="dim" data-test="mcp-wf-desc">{{ w.description || t('No description') }}</td>
                    <td style="text-align: right">
                      <button class="btn secondary btn-sm" :data-test-mcp-remove="w.id" @click="removeMcpWorkflow(w.id)">Remove</button>
                    </td>
                  </tr>
                  <tr v-if="!mcpEnabledWorkflows.length">
                    <td colspan="4">
                      <div class="table-empty" data-test="mcp-wf-empty">
                        <h3>No workflows enabled</h3>
                        <p>Add published workflows so MCP clients can discover and execute them</p>
                        <button class="btn primary" data-test="mcp-open-enable" @click="openMcpModal">Enable workflows</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="mcpEnabledWorkflows.length" style="max-width: 1000px; margin-top: 12px; display: flex; justify-content: flex-end">
              <button class="btn primary" data-test="mcp-open-enable" @click="openMcpModal">Enable workflows</button>
            </div>
            <p class="dim" style="font-size: 12.5px; margin-top: 10px; max-width: 1000px">
              Enabled workflows become MCP tools. Calls run the <b>published</b> version, count against the project quota
              and appear in Executions (mode <code>mcp</code>).
            </p>
          </template>

          <template v-else-if="mcpTab === 'clients'">
            <div class="card" style="max-width: 1000px; padding: 0">
              <table class="api-table">
                <!-- D150 live 实测基线列名：Client Name / Connected At（+ 末列留空） -->
                <thead><tr><th>Client Name</th><th>Connected At</th><th></th></tr></thead>
                <tbody>
                  <tr v-for="c in mcpStatus.clients" :key="c.name + c.version" data-test="mcp-client-row">
                    <td>{{ c.name }}</td>
                    <td class="dim">{{ c.version || '—' }}</td>
                    <td class="dim">{{ new Date(c.lastSeen).toLocaleString() }}</td>
                  </tr>
                  <tr v-if="!mcpStatus.clients.length">
                    <td colspan="3">
                      <div class="table-empty">
                        <h3>No clients connected yet</h3>
                        <p>Clients appear here after their first <code>initialize</code> handshake (since last server restart)</p>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <!-- OAuth settings：redirect URL 允许清单(对标基线 MCP OAuth settings tab) -->
          <template v-else>
            <div class="card" style="max-width: 1000px; padding: 16px">
              <label class="oauth-label" for="mcp-oauth-urls">Allowed OAuth Redirect URLs</label>
              <textarea
                id="mcp-oauth-urls"
                v-model="mcpRedirectUrls"
                class="oauth-input"
                data-test="mcp-oauth-urls"
                rows="4"
                placeholder="https://example.com/callback"
              />
              <div style="margin-top: 12px">
                <button class="btn primary" data-test="mcp-oauth-save">Save Redirect URLs</button>
              </div>
            </div>
          </template>
        </template>

        <!-- Enable workflows 弹窗（对标基线 Enable workflow MCP access） -->
        <div v-if="mcpModalOpen" class="modal-mask" data-test="mcp-modal" @click.self="mcpModalOpen = false">
          <div class="modal-card" style="width: 640px">
            <div style="display: flex; align-items: flex-start; justify-content: space-between">
              <h2 class="modal-title">Enable workflow MCP access</h2>
              <button class="modal-x" @click="mcpModalOpen = false">×</button>
            </div>
            <div class="info-callout">
              Workflows that are <b>published</b> can be enabled for MCP access — calls always run the published version.
            </div>
            <div class="search-box" style="width: 100%; margin-bottom: 10px">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="i15"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              <input v-model="mcpSearch" data-test="mcp-search" placeholder="Search workflows to connect" />
            </div>
            <div class="pick-list" data-test="mcp-candidates">
              <label v-for="w in mcpCandidates" :key="w.id" class="pick-row">
                <input type="checkbox" :checked="mcpPick.has(w.id)" :data-test-mcp-pick="w.id" style="width: auto" @change="togglePick(w.id)" />
                <span class="dim">{{ w.projectName }} /</span>
                <span>{{ w.name }}</span>
              </label>
              <p v-if="!mcpCandidates.length" class="dim" style="font-size: 13px; padding: 14px 4px">
                No published workflows available — publish a workflow first (open it and press Publish).
              </p>
            </div>
            <div class="modal-actions">
              <button class="btn secondary" @click="mcpModalOpen = false">Cancel</button>
              <button class="btn primary" data-test="mcp-confirm-enable" :disabled="!mcpPick.size" @click="confirmEnableWorkflows">Enable</button>
            </div>
          </div>
        </div>
      </section>

      <!-- Chat 设置（Preview，对标基线 Chat） -->
      <section v-else-if="section === 'chat'" data-test="settings-chat">
        <div style="display: flex; align-items: center; gap: 10px">
          <h1 class="page-title" style="margin-bottom: 0">Chat</h1>
          <span class="nav-badge preview">Preview</span>
        </div>
        <p v-if="chatError" class="error-text" style="margin-top: 14px" data-test="chat-error">{{ chatError }}</p>
        <template v-if="chatSettings">
          <!-- Enable Chat：无边框设置行 + 胶囊开关（对标基线） -->
          <div class="setting-row" style="max-width: 1000px; margin-top: 20px; border-bottom: none; padding: 0">
            <div class="setting-text">
              <b>Enable Chat</b>
              <p>When disabled, the AI Assistant is hidden across the app and its API endpoints are turned off. You can re-enable it here at any time.</p>
            </div>
            <!-- 必须是 label：全局 .switch 把 input 藏了，点滑块靠 label 联动 -->
            <label class="switch" data-test="chat-toggle" style="margin: 0">
              <input type="checkbox" :checked="chatSettings.enabled" :disabled="chatSaving" @change="saveChat({ enabled: !chatSettings.enabled })" />
              <span class="slider" />
            </label>
          </div>

          <p v-if="!chatSettings.enabled" class="dim" data-test="chat-disabled-note" style="margin-top: 26px; font-size: 14.5px">
            Chat is currently disabled. Enable it above to configure providers.
          </p>

          <div v-if="chatSettings.enabled" style="display: flex; align-items: center; max-width: 1000px; margin-top: 26px">
            <h3 class="sec-title" style="margin: 0">Providers</h3>
            <span style="flex: 1" />
            <button class="icon-refresh" data-test="chat-refresh" title="Refresh" @click="loadChat">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="i15"><path d="M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5" /></svg>
            </button>
          </div>
          <!-- Provider 表:1:1 镜像基线 15 家(品牌色 monogram 芯片代替第三方 logo) -->
          <div v-if="chatSettings.enabled" class="card" style="max-width: 1000px; padding: 0; margin-top: 10px">
            <table class="api-table">
              <thead><tr><th>Provider</th><th>Models</th><th>Last edited</th></tr></thead>
              <tbody>
                <tr v-for="p in CHAT_PROVIDERS" :key="p.name" :data-test="`chat-provider-${p.name}`">
                  <td>
                    <span style="display: inline-flex; align-items: center; gap: 10px">
                      <span class="prov-mark" :style="{ background: p.color }">{{ p.mark }}</span>
                      <b>{{ p.name }}</b>
                    </span>
                  </td>
                  <td class="dim">All models</td>
                  <td class="dim">-</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Configure Anthropic 弹窗（对标基线 Configure provider） -->
          <div v-if="providerModalOpen" class="modal-mask" data-test="chat-provider-modal" @click.self="providerModalOpen = false">
            <div class="modal-card" style="width: 620px">
              <div style="display: flex; align-items: flex-start; justify-content: space-between">
                <h2 class="modal-title">Configure {{ providerModal?.label }}</h2>
                <button class="modal-x" @click="providerModalOpen = false">×</button>
              </div>

              <!-- ① Enable {Provider} -->
              <div class="prov-section">
                <div class="prov-label">Enable {{ providerModal?.label }}</div>
                <label class="switch" data-test="prov-enable">
                  <input type="checkbox" :checked="provEnabled" @change="provEnabled = !provEnabled" />
                  <span class="slider" />
                </label>
              </div>

              <!-- ② Default credential（对标基线：凭证卡片 + Create new credential；关闭 provider 时隐藏） -->
              <div v-if="provEnabled" class="prov-section" @click.stop>
                <div class="prov-label">Default credential</div>
                <button class="prov-cred-btn" data-test="prov-credential" :class="{ open: provCredOpen }" @click="provCredOpen = !provCredOpen">
                  {{ provSelectedCredName || 'Select' }}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width: 14px; height: 14px"><path :d="provCredOpen ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'" /></svg>
                </button>
                <div v-if="provCredOpen" class="prov-cred-pop" data-test="prov-cred-pop">
                  <button
                    v-for="c in provCredOptions"
                    :key="c.id"
                    class="prov-cred-item"
                    :class="{ sel: c.id === provCredentialId }"
                    :data-test-prov-cred="c.id"
                    @click="provCredentialId = c.id; provCredOpen = false"
                  >
                    <span class="prov-cred-name">{{ c.name }}</span>
                    <span class="prov-cred-sub dim">
                      {{ credLabel2(c.type) }}<template v-if="meInfo"> - {{ meInfo.name }} &lt;{{ meInfo.email }}&gt;</template>
                    </span>
                  </button>
                  <button class="prov-cred-create" data-test="prov-cred-create" @click="provCreateOpen = true; provCredOpen = false">
                    ＋ Create new credential
                  </button>
                </div>
              </div>

              <!-- ③ Context window (messages)；关闭 provider 时隐藏 -->
              <div v-if="provEnabled" class="prov-section">
                <div class="prov-label">Context window (messages)</div>
                <p class="dim" style="font-size: 12.5px; margin: 4px 0 8px">
                  Number of previous interactions (message and reply pairs) to include as context for the model (default: 20)
                </p>
                <div class="prov-stepper">
                  <button data-test="prov-cw-dec" @click="provContextWindow = Math.max(1, provContextWindow - 1)">−</button>
                  <input
                    v-model.number="provContextWindow"
                    data-test="prov-cw"
                    type="number"
                    min="1"
                    max="100"
                  />
                  <button data-test="prov-cw-inc" @click="provContextWindow = Math.min(100, provContextWindow + 1)">＋</button>
                </div>
              </div>

              <p v-if="provError" class="error-text" style="font-size: 12.5px">{{ provError }}</p>
              <div class="modal-actions">
                <button class="btn secondary" @click="providerModalOpen = false">Cancel</button>
                <button class="btn primary" data-test="chat-provider-confirm" :disabled="provSaving" @click="confirmProvider">
                  {{ provSaving ? 'Saving…' : 'Confirm' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Create new credential（从 provider 下拉进入，类型预选） -->
          <CredentialModal
            v-if="provCreateOpen"
            :create-type="providerModal?.credentialType"
            @close="provCreateOpen = false"
            @created="onProvCredCreated"
          />
        </template>
      </section>

      <!-- 计费与套餐（对标基线 Usage and plan） -->
      <section v-else data-test="settings-billing">
        <h1 class="page-title">Usage and plan</h1>
        <h3 class="sec-title" style="margin-top: 0" data-test="plan-line">You’re on the {{ planLabel }} Edition</h3>

        <!-- 填了 key 但未生效(过期/验签不过):必须显式告知,否则用户以为还在付费档 -->
        <p v-if="licenseProblem" class="license-problem" data-test="license-problem">
          ⚠ {{ licenseProblem }} — paid features are currently disabled.
          <template v-if="licenseValidTo"> Valid until {{ licenseValidTo }}.</template>
        </p>

        <!-- D137 Unlock 横幅(对标基线逐字) -->
        <button v-if="!isActivated" class="unlock-banner" data-test="license-open" @click="licenseModalOpen = true">
          <b>Unlock</b>
          <span>selected paid features for free (forever)</span>
        </button>

        <!-- D138 用量行:Published workflows — N of Unlimited(对标基线) -->
        <div class="usage-row" data-test="usage-row">
          <span class="dim">Published workflows</span>
          <span>{{ publishedWfCount }} of Unlimited</span>
        </div>
        <p class="dim" style="font-size: 12.5px; max-width: 880px; margin-top: 8px">
          Published workflows with multiple triggers count multiple times. Error and Sub-workflow triggers are excluded.
        </p>

        <!-- 底部按钮行：Enter activation key + View plans（右对齐，对标基线） -->
        <div class="plan-actions">
          <button v-if="!isActivated" class="btn secondary" data-test="license-open-2" @click="licenseModalOpen = true">Enter activation key</button>
          <button v-else class="btn secondary" data-test="license-remove" :disabled="licenseBusy" @click="removeLicense">
            {{ licenseBusy ? 'Removing…' : 'Remove license' }}
          </button>
          <button class="btn primary" data-test="billing-upgrade" @click="upgrade">View plans</button>
        </div>
        <p v-if="licenseError" class="error-text" data-test="license-remove-error">{{ licenseError }}</p>
        <p v-if="billingError" class="error-text" data-test="billing-error">{{ billingError }}</p>

        <!-- Pro 购买（支付宝） -->
        <div class="card" style="max-width: 880px; margin-top: 18px">
          <div class="dim" style="font-size: 12px">Upgrade to Pro (¥99/month, Alipay)</div>
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px">
            <label style="margin: 0">Months</label>
            <input v-model.number="months" type="number" min="1" max="36" style="width: 90px" />
            <button class="btn primary" data-test="billing-pay" @click="upgrade">
              Pay ¥{{ (99 * months).toFixed(2) }}
            </button>
          </div>
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

    <LicenseModal :open="licenseModalOpen" @close="licenseModalOpen = false" @activated="onLicenseActivated" />
  </div>
</template>

<style scoped>
/* 证书失效提示：填了 key 却没生效时必须显式告知,不能静默当社区版 */
.license-problem { margin: 8px 0 0; font-size: 12.5px; color: var(--color--warning-text, #e0a34a); }

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
  padding: 4px 6px 16px; background: var(--bg); display: flex; flex-direction: column;
}
/* 基线实测：返回行 43px(衬 12px)/文字 14px-500 白;
   条目与主侧栏同规格 32px/衬 4/圆角 4/gap 4/白字 14px/图标 16;激活 light-1 */
.settings-back {
  display: flex; align-items: center; gap: 6px; width: 100%; text-align: left;
  padding: 12px; border: none; background: none; color: var(--color--text--shade-1);
  font-size: var(--font-size--sm); font-weight: var(--font-weight--medium); cursor: pointer; height: auto;
}
.settings-back svg { width: 16px; height: 16px; flex-shrink: 0; }
.settings-nav-item {
  display: flex; align-items: center; gap: var(--spacing--4xs); width: 100%; text-align: left;
  height: 32px; padding: var(--spacing--4xs); border: none; background: none; border-radius: var(--radius);
  color: var(--color--text--shade-1); font-size: var(--font-size--sm); cursor: pointer; margin-bottom: 1px;
}
.settings-nav-item:hover { background: var(--color--background--light-1); }
.settings-nav-item.active { background: var(--color--background--light-1); }
.settings-nav-item .nav-ico { width: 16px; height: 16px; flex-shrink: 0; margin: var(--spacing--4xs); color: var(--color--text--shade-1); }
.settings-nav-item.active .nav-ico { color: var(--color--text--shade-1); }
.settings-version { margin-top: auto; padding: 12px 10px 4px; font-size: 12px; color: var(--accent); }

.settings-content { flex: 1; overflow-y: auto; padding: 26px 40px 60px; }
/* 基线实测：Settings 表单系统 = 输入 36px/圆角 6/bg light-2;主按钮 36px/圆角 6/衬 0 16 */
.settings-content :deep(input[type='text']), .settings-content :deep(input[type='email']),
.settings-content :deep(input[type='password']), .settings-content :deep(input:not([type])),
.settings-content :deep(select) {
  height: 36px; background: var(--color--background--light-2); border: none;
  box-shadow: inset 0 0 0 1px var(--border-color);
  border-radius: var(--radius--2xs); color: var(--color--text--shade-1);
  font-size: var(--font-size--sm); padding: 0 var(--spacing--xs);
}
.settings-content :deep(input:focus), .settings-content :deep(select:focus) {
  outline: none; box-shadow: inset 0 0 0 1px var(--color--primary);
}
.settings-content :deep(button.primary) {
  height: 36px; border-radius: var(--radius--2xs); padding: 0 var(--spacing--sm);
}
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
.btn.secondary { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-hi); }
.btn.secondary:hover { border-color: var(--accent); }
.btn.secondary.danger { color: var(--err, #e5484d); }
.btn.secondary.danger:hover { border-color: var(--err, #e5484d); }
.btn-sm { height: 28px; padding: 0 12px; font-size: 12.5px; }
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

/* ── 基线对齐新增 ── */
/* a.btn 抵消全局链接样式（如 Observability 的 Open /metrics） */
a.btn {
  display: inline-flex; align-items: center; text-decoration: none;
  background: var(--bg-input); border: 1px solid var(--border); color: var(--text-hi);
}
a.btn:hover { border-color: var(--accent); color: var(--text-hi); }
/* 多行代码块（Prometheus 抓取配置） */
.api-token.pre { white-space: pre; overflow-x: auto; }
/* 侧栏徽标（New / Preview） */
.nav-badge {
  margin-left: auto; font-size: 10.5px; padding: 1px 7px; border-radius: 8px;
  background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-dim);
}
.nav-badge.preview { color: #a78bfa; border-color: rgba(167, 139, 250, 0.45); background: rgba(167, 139, 250, 0.12); }

/* 胶囊开关标签（Enabled 绿字，对标基线） */
.toggle-label { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 13.5px; color: var(--text-dim); cursor: pointer; }
.toggle-label.on { color: var(--ok); }

/* tabs 行右侧刷新按钮 */
.icon-refresh {
  width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
  background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
  color: var(--text-dim); cursor: pointer;
}
.icon-refresh:hover { color: var(--text-hi); border-color: var(--accent); }
.icon-refresh .i15 { width: 15px; height: 15px; }

/* 表格内空态（对标基线表格容器内居中空态） */
.table-empty { text-align: center; padding: 48px 24px 52px; }
/* MCP OAuth settings tab */
.oauth-label { display: block; font-size: 14px; font-weight: 600; color: var(--text-hi); }
.oauth-input {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
  padding: 8px 12px; font-size: 13px; color: var(--text); font-family: var(--font-family--monospace); resize: vertical;
}
.oauth-input:focus { outline: none; border-color: var(--accent); }
.table-empty h3 { margin: 0 0 10px; font-size: 17px; font-weight: 500; color: var(--text-hi); }
.table-empty p { margin: 0 0 20px; font-size: 13.5px; color: var(--text-dim); }

/* 弹窗（对标基线模态：标题 + × + 右下 Cancel/Confirm） */
.modal-mask {
  position: fixed; inset: 0; z-index: 100; background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh;
}
.modal-card {
  max-width: 94vw; background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 10px; padding: 22px 24px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.modal-title { margin: 0 0 16px; font-size: 19px; font-weight: 500; color: var(--text-hi); }
.modal-label { display: block; margin: 14px 0 6px; font-size: 14px; font-weight: 600; color: var(--text-hi); }
.modal-x { background: none; border: none; color: var(--text-dim); font-size: 20px; cursor: pointer; padding: 0 6px; line-height: 1; }
.modal-x:hover { color: var(--text-hi); }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

/* 弹窗顶部提示卡（左竖条，对标基线 callout） */
.warn-callout {
  display: flex; gap: 9px; align-items: flex-start;
  border: 1px solid #7a5b12; border-left: 3px solid var(--accent);
  border-radius: 6px; padding: 11px 13px; margin: 6px 0 12px;
  font-size: 12.5px; line-height: 1.55; color: var(--text-hi);
  background: rgba(255, 105, 0, 0.07);
}
.warn-callout svg { flex: 0 0 auto; margin-top: 1px; color: var(--accent); }

/* 分段控件（MCP 连接详情：OAuth | Access token） */
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.seg-btn {
  border: 0; background: transparent; cursor: pointer;
  padding: 5px 12px; font-size: 12.5px; color: var(--text-dim);
}
.seg-btn.active { background: var(--surface-3, rgba(255, 255, 255, 0.07)); color: var(--text-hi); }

.info-callout {
  border: 1px solid var(--border); border-left: 3px solid var(--text-dim);
  border-radius: 6px; padding: 12px 14px; margin-bottom: 14px;
  font-size: 13px; color: var(--text-dim);
}

/* 弹窗内单选行（Scopes）：橙色 radio，收回全局 input 宽度 */
.radio-row { display: flex; align-items: center; gap: 9px; margin: 8px 0 0; cursor: pointer; font-size: 14px; color: var(--text-hi); }
.radio-row input[type='radio'] { width: 15px; height: 15px; flex: 0 0 auto; margin: 0; accent-color: var(--accent); }

/* 弹窗内勾选行（风险确认等）：收回全局 input 宽度 */
.check-row { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; color: var(--text-hi); line-height: 1.5; }
.check-row input[type='checkbox'] { width: 16px; height: 16px; flex: 0 0 auto; margin: 2px 0 0; accent-color: var(--accent); }

/* 弹窗内工作流多选列表 */
.pick-list { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.pick-row {
  display: flex; align-items: center; gap: 9px; padding: 8px 6px; margin: 0;
  border-radius: 6px; cursor: pointer; font-size: 13.5px; color: var(--text-hi);
}
.pick-row:hover { background: var(--bg-input); }
.pick-row input[type='checkbox'] { width: 15px; height: 15px; flex: 0 0 auto; margin: 0; accent-color: var(--accent); }

/* 表格行 ⋮ 菜单 */
.row-dots {
  width: 30px; height: 30px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
  background: none; border: none; border-radius: 6px; color: var(--text-dim); cursor: pointer;
}
.row-dots:hover { background: var(--bg-input); color: var(--text-hi); }
.row-dots .i16 { width: 16px; height: 16px; }
.row-menu-pop {
  position: absolute; right: 8px; top: calc(100% - 6px); z-index: 40; min-width: 150px;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 4px; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
}
.row-menu-pop .menu-item {
  display: block; width: 100%; text-align: left; padding: 8px 10px; font-size: 13.5px;
  background: none; border: none; border-radius: 6px; color: var(--text-hi); cursor: pointer;
}
.row-menu-pop .menu-item:hover { background: var(--bg-input); }
/* MCP Connection details 弹层 */
.dropdown-anchor { position: relative; }
.mcp-pop {
  position: absolute; right: 0; top: calc(100% + 8px); z-index: 30; width: 460px;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 14px 16px 16px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
}
/* 页头（标题 + 右上用户 chip） */
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; max-width: 880px; }
.me-chip { display: flex; align-items: center; gap: 10px; }
.me-chip-text { display: flex; flex-direction: column; align-items: flex-end; font-size: 13px; }
.avatar {
  width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #f5a623, #a855f7); color: #fff;
  font-size: 12.5px; font-weight: 600; letter-spacing: 0.3px;
}
.req { color: var(--accent); }
.accent-link { color: var(--accent); text-decoration: none; font-size: 13.5px; }
.accent-link:hover { text-decoration: underline; }

/* Roles 页 tab（对标基线的 Instance roles / Project roles） */
.tabs { display: flex; gap: 22px; border-bottom: 1px solid var(--border); margin: 4px 0 18px; max-width: 720px; }
.tab {
  background: none; border: none; padding: 8px 2px 10px; font-size: 14px; cursor: pointer;
  color: var(--text-dim); border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }

/* 企业功能锁定卡（对标基线 "Available on the Enterprise plan" 虚线卡） */
.locked-card {
  max-width: 880px; border: 1px dashed var(--border); border-radius: 8px;
  padding: 56px 40px; text-align: center; margin-top: 8px;
}
.locked-card h2 { margin: 0 0 14px; font-size: 20px; font-weight: 500; color: var(--text-hi); }
.locked-card p { margin: 0 0 22px; color: var(--text-dim); font-size: 14px; }
.locked-actions { display: flex; gap: 10px; justify-content: center; }

/* Roles Enterprise 锁卡(对标基线 Community):三权限卡图形 + Upgrade to Enterprise */
.ent-lock {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 14px;
  max-width: 720px; border: 1px dashed var(--border); border-radius: 8px; padding: 40px 24px 36px; margin-top: 8px;
}
.ent-cards { display: flex; gap: 10px; margin-bottom: 6px; }
.ent-cards span {
  width: 54px; height: 68px; border-radius: 6px;
  background: var(--bg-input); border: 1px solid var(--border);
}
.ent-cards span:nth-child(2) { transform: translateY(-6px); }
.ent-title { margin: 0; font-size: 20px; font-weight: 500; color: var(--text-hi); }
.ent-desc { margin: 0; max-width: 460px; font-size: 14px; line-height: 1.5; color: var(--text-dim); }
.ent-actions { display: flex; align-items: center; gap: 12px; margin-top: 6px; }
.btn-learn { font-size: 14px; color: var(--text-hi); text-decoration: none; padding: 0 4px; }
.btn-learn:hover { text-decoration: underline; }
.ent-lock .btn-upgrade {
  height: 36px; padding: 0 16px; border: none; border-radius: 6px;
  background: var(--button--color--background--primary); color: var(--button--color--text--primary);
  font-size: 14px; font-weight: var(--font-weight--medium); cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--button--border-color--primary), 0 1px 3px -1px var(--color--black-alpha-100);
}
.ent-lock .btn-upgrade:hover { background: var(--button--color--background--primary--hover-active-focus); }

/* 设置行卡片（对标基线 Security & policies / OpenTelemetry 的 row 布局） */
.setting-card { border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); }
.setting-row {
  display: flex; align-items: center; gap: 18px; padding: 16px;
  border-bottom: 1px solid var(--border);
}
.setting-row:last-child { border-bottom: none; }
.setting-text { flex: 1; min-width: 0; }
.setting-text b { font-size: 14px; color: var(--text-hi); }
.setting-text p { margin: 4px 0 0; font-size: 13px; color: var(--text-dim); }
.chip-upgrade {
  font-size: 11px; font-weight: 400; padding: 1px 8px; margin-left: 6px;
  border: 1px solid var(--border); border-radius: 6px; color: var(--text-dim);
}
/* 通用只读/表单下拉(Security 的 Redact executions、OTel 的状态) */
.sec-select {
  width: 260px; flex-shrink: 0; height: 34px; padding: 0 10px; font-size: 13px;
  background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); cursor: pointer;
}
.sec-select:disabled { opacity: 0.65; cursor: default; }

/* OpenTelemetry 页 */
.otel-status { display: flex; align-items: center; gap: 12px; margin: 8px 0 4px; }
.otel-status-hint { font-size: 13px; }
.otel-field { padding: 16px; border-bottom: 1px solid var(--border); }
.otel-field:last-child { border-bottom: none; }
.otel-field > label { display: block; font-size: 13px; font-weight: 500; color: var(--text-hi); margin-bottom: 7px; }
.otel-field input { width: 100%; max-width: 480px; }
.otel-hint { margin: 7px 0 0; font-size: 12.5px; color: var(--text-dim); }
.otel-inline { display: flex; align-items: center; gap: 8px; }
.otel-inline input { width: 140px; }
.otel-actions { display: flex; gap: 10px; margin-top: 20px; }

/* Chat provider 品牌色 monogram 芯片(代替第三方 logo) */
.prov-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; flex-shrink: 0; border-radius: 5px;
  font-size: 10px; font-weight: 700; letter-spacing: -0.02em; color: #fff;
  text-transform: none; line-height: 1;
}

/* Users 工具条（搜索 + Invite） */
/* D140 Community nodes 包卡片 */
.cn-list { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
.cn-card {
  display: flex; align-items: center; gap: 16px; padding: 14px 16px;
  border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel);
}
.cn-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.cn-main b { font-size: 14px; color: var(--text-hi); }
.cn-nodes { font-size: 12.5px; }

/* D134 Users 米黄升级条 */
.users-upgrade {
  max-width: 880px; margin: 0 0 16px; padding: 12px 16px; border-radius: 8px;
  background: rgba(245, 166, 35, 0.12); border: 1px solid rgba(245, 166, 35, 0.32);
  color: var(--running, #f5a623); font-size: 13.5px;
}
.users-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.search-box {
  display: flex; align-items: center; gap: 8px; width: 320px;
  background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 0 12px; color: var(--text-dim);
}
.search-box input { border: none; background: none; padding: 9px 0; width: 100%; }
.search-box input:focus { outline: none; }
.search-box .i15 { width: 15px; height: 15px; flex-shrink: 0; }
.user-cell { display: flex; align-items: center; gap: 10px; }
.user-cell-text { display: flex; flex-direction: column; min-width: 0; }
.user-cell-text .dim { font-size: 12px; }

/* Usage and plan（Unlock 横幅 + 计量行 + 右对齐按钮） */
.unlock-banner {
  display: block; width: 100%; max-width: 880px; text-align: left; cursor: pointer;
  background: rgba(255, 105, 0, 0.08); border: 1px solid rgba(255, 105, 0, 0.45);
  border-left: 4px solid var(--accent); border-radius: 6px; padding: 14px 16px; margin-bottom: 14px;
  color: var(--text-hi); font-size: 13.5px;
}
.unlock-banner b { color: var(--accent); margin-right: 6px; }
.unlock-banner span { color: var(--text-dim); }
.usage-row {
  display: flex; align-items: center; justify-content: space-between; max-width: 880px;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 16px; font-size: 14px;
}
.plan-actions { display: flex; justify-content: flex-end; gap: 10px; max-width: 880px; margin-top: 22px; }

/* 源码同步 */
.mono { font-family: 'SF Mono', ui-monospace, Menlo, monospace; }
.sc-changes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; }
.sc-changes li { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
.sc-stat { width: 20px; text-align: center; color: var(--accent); font-family: 'SF Mono', ui-monospace, Menlo, monospace; font-size: 11px; }

/* Configure provider 弹窗（三层：Enable / Default credential / Context window） */
.prov-section { margin-top: 18px; }
.prov-label { font-size: 14px; font-weight: 600; color: var(--text-hi); margin-bottom: 6px; }
.prov-stepper { display: flex; align-items: stretch; }
.prov-stepper button {
  width: 38px; padding: 0; font-size: 16px; border: 1px solid var(--border);
  background: var(--bg-panel); color: var(--text); cursor: pointer;
}
.prov-stepper button:first-child { border-radius: 8px 0 0 8px; }
.prov-stepper button:last-child { border-radius: 0 8px 8px 0; }
.prov-stepper input {
  flex: 1; text-align: center; border: 1px solid var(--border); border-left: none; border-right: none;
  border-radius: 0; background: transparent; color: var(--text); font-size: 13.5px; padding: 8px 0;
  -moz-appearance: textfield; appearance: textfield; outline: none;
}
.prov-stepper input::-webkit-outer-spin-button, .prov-stepper input::-webkit-inner-spin-button { -webkit-appearance: none; }

/* provider 弹窗：凭证下拉（对标基线） */
.prov-cred-btn {
  display: flex; align-items: center; justify-content: space-between; width: 100%;
  padding: 10px 14px; margin-top: 6px; font-size: 13.5px; text-align: left;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px; color: var(--text); cursor: pointer;
}
.prov-cred-btn.open { border-color: #7c5cd6; }
.prov-cred-pop {
  margin-top: 8px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
  background: var(--color--background--light-1); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
}
.prov-cred-item {
  display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
  background: none; border: none; border-bottom: 1px solid var(--border);
  padding: 12px 16px; cursor: pointer;
}
.prov-cred-item:hover, .prov-cred-item.sel { background: var(--hover, rgba(255, 255, 255, 0.06)); }
.prov-cred-name { font-size: 14px; font-weight: 600; color: var(--text-hi); }
.prov-cred-sub { font-size: 12.5px; }
.prov-cred-create {
  display: block; width: 100%; text-align: left; background: none; border: none;
  padding: 13px 16px; font-size: 14px; font-weight: 600; color: var(--accent); cursor: pointer;
}
.prov-cred-create:hover { background: var(--hover, rgba(255, 255, 255, 0.06)); }
</style>
