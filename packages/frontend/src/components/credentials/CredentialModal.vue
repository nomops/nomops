<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api, type CredentialView } from '../../api/client.js';
import { CREDENTIAL_TYPES, credentialTypeMeta } from '../../lib/credential-types.js';

/**
 * n8n 式「Add new credential」弹窗：
 *  ① pick：单个「Select an app or service」下拉搜索框 + Continue（对齐 n8n，不是一整列卡片）
 *  ② config：更宽的详情框——可编辑标题名 + 顶部 Save + Connection/Details 分页 + OAuth 回调 URL + 帮助提示。
 * OAuth2 类型走 Connect my account 授权流程。
 */
const emit = defineEmits<{ close: []; created: [cred: CredentialView] }>();

const step = ref<'pick' | 'config'>('pick');
const tab = ref<'connection' | 'details'>('connection');

/* pick 步：combobox */
const search = ref('');
const pickerOpen = ref(false);
const pendingType = ref(''); // 选中但尚未 Continue
const comboRef = ref<HTMLElement | null>(null);

/* config 步 */
const selectedType = ref('');
const name = ref('');
const values = ref<Record<string, string>>({});
const error = ref('');
const busy = ref(false);
const copied = ref(false);

/* OAuth 状态 */
const credId = ref<string | null>(null);
const createdView = ref<CredentialView | null>(null);
const connected = ref(false);
const connecting = ref(false);
let msgHandler: ((e: MessageEvent) => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const filteredTypes = computed(() => {
  const q = search.value.trim().toLowerCase();
  // 已选定（输入框显示的是 displayName）时不再过滤，展示全部便于换选
  if (pendingType.value && search.value === (credentialTypeMeta(pendingType.value)?.displayName ?? '')) {
    return CREDENTIAL_TYPES;
  }
  return q
    ? CREDENTIAL_TYPES.filter(
        (t) => t.displayName.toLowerCase().includes(q) || t.type.toLowerCase().includes(q),
      )
    : CREDENTIAL_TYPES;
});

const meta = computed(() => credentialTypeMeta(selectedType.value));
const pendingMeta = computed(() => credentialTypeMeta(pendingType.value));
const redirectUrl = computed(() => `${window.location.origin}/oauth2/callback`);

function choose(type: string) {
  pendingType.value = type;
  search.value = credentialTypeMeta(type)?.displayName ?? '';
  pickerOpen.value = false;
}

function pickType(type: string) {
  if (!type) return;
  selectedType.value = type;
  const m = credentialTypeMeta(type);
  name.value = m ? `${m.displayName} account` : '';
  values.value = {};
  credId.value = null;
  createdView.value = null;
  connected.value = false;
  error.value = '';
  tab.value = 'connection';
  step.value = 'config';
}

function backToPick() {
  pendingType.value = selectedType.value;
  search.value = meta.value?.displayName ?? '';
  pickerOpen.value = false;
  step.value = 'pick';
}

async function copyRedirect() {
  try {
    await navigator.clipboard.writeText(redirectUrl.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* 剪贴板不可用时静默 */
  }
}

/** 组装写入的 data：presetData（如 demo 标记）+ 用户字段。 */
function buildData(): Record<string, string> {
  return { ...(meta.value?.presetData ?? {}), ...values.value };
}

/** 首次保存（创建）；已创建则幂等返回。 */
async function ensureSaved(): Promise<void> {
  if (credId.value) return;
  const created = await api.credentials.create({ name: name.value, type: selectedType.value, data: buildData() });
  credId.value = created.id;
  createdView.value = created;
}

function cleanupConnect() {
  if (msgHandler) window.removeEventListener('message', msgHandler);
  msgHandler = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  connecting.value = false;
}

/** OAuth2「Connect my account」：保存 → 拿授权 URL → 弹窗授权 → 回连接状态。 */
async function connect() {
  error.value = '';
  connecting.value = true;
  try {
    await ensureSaved();
    const { authUrl } = await api.oauth2.authUrl(credId.value!);
    const popup = window.open(authUrl, 'nomops-oauth2', 'width=640,height=760');
    if (!popup) {
      error.value = 'Popup blocked — allow popups for this site and try again.';
      connecting.value = false;
      return;
    }
    msgHandler = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      if (e.data === 'nomops-oauth2:done') {
        connected.value = true;
        cleanupConnect();
      } else if (e.data.startsWith('nomops-oauth2:error:')) {
        error.value = e.data.slice('nomops-oauth2:error:'.length);
        cleanupConnect();
      }
    };
    window.addEventListener('message', msgHandler);
    pollTimer = setInterval(async () => {
      if (popup.closed) {
        const s = await api.credentials.oauthStatus(credId.value!).catch(() => ({ connected: false }));
        connected.value = s.connected;
        cleanupConnect();
      }
    }, 800);
  } catch (e) {
    error.value = (e as Error).message;
    connecting.value = false;
  }
}

async function save() {
  error.value = '';
  busy.value = true;
  try {
    await ensureSaved();
    if (createdView.value) emit('created', createdView.value);
    emit('close');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

/* 连接测试（对标 n8n Test connection）：先保存 → 打服务端点看状态 */
const testing = ref(false);
const testResult = ref<{ ok: boolean; tested: boolean; message?: string } | null>(null);

async function testConnection() {
  error.value = '';
  testResult.value = null;
  testing.value = true;
  try {
    await ensureSaved();
    if (createdView.value) emit('created', createdView.value); // 列表即时出现
    testResult.value = await api.credentials.test(credId.value!);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    testing.value = false;
  }
}

function onDocClick(e: MouseEvent) {
  if (pickerOpen.value && comboRef.value && !comboRef.value.contains(e.target as Node)) {
    pickerOpen.value = false;
  }
}
onMounted(() => window.addEventListener('mousedown', onDocClick));
onUnmounted(() => {
  window.removeEventListener('mousedown', onDocClick);
  cleanupConnect();
});
</script>

<template>
  <div class="cred-overlay" data-test="credential-modal" @click.self="emit('close')">
    <div class="cred-modal" :class="step">
      <!-- ── Step 1: pick type (combobox + Continue) ── -->
      <template v-if="step === 'pick'">
        <header class="cred-head">
          <div class="cred-title">Add new credential</div>
          <button class="icon-x" data-test="cred-close" @click="emit('close')">✕</button>
        </header>

        <div class="cred-body">
          <label class="fld-label">Select an app or service to connect to</label>
          <div ref="comboRef" class="combo" :class="{ open: pickerOpen }">
            <div class="combo-control" @click="pickerOpen = true">
              <span v-if="pendingType" class="combo-ico">{{ pendingMeta?.icon }}</span>
              <input
                v-model="search"
                class="combo-input"
                data-test="cred-search"
                placeholder="Search for an app…"
                autocomplete="off"
                @focus="pickerOpen = true"
                @input="pickerOpen = true; pendingType = ''"
              />
              <svg class="combo-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6" /></svg>
            </div>
            <div v-if="pickerOpen" class="combo-list">
              <button
                v-for="t in filteredTypes"
                :key="t.type"
                class="combo-item"
                :class="{ sel: t.type === pendingType }"
                :data-test-cred-type="t.type"
                @click="choose(t.type)"
              >
                <span class="type-icon">{{ t.icon }}</span>
                <span class="combo-item-body">
                  <span class="type-name">{{ t.displayName }}<span v-if="t.oauth" class="oauth-tag">OAuth2</span></span>
                  <span class="type-desc">{{ t.description }}</span>
                </span>
              </button>
              <p v-if="filteredTypes.length === 0" class="combo-empty">No matching apps</p>
            </div>
          </div>
        </div>

        <footer class="cred-foot">
          <button class="btn ghost" @click="emit('close')">Cancel</button>
          <button class="btn primary" data-test="cred-continue" :disabled="!pendingType" @click="pickType(pendingType)">Continue</button>
        </footer>
      </template>

      <!-- ── Step 2: configure (name header + tabs + fields) ── -->
      <template v-else>
        <header class="cred-head config">
          <span class="head-icon">{{ meta?.icon }}</span>
          <div class="head-name">
            <input v-model="name" class="name-input" data-test="cred-name" placeholder="Name this credential" />
            <div class="head-type">{{ meta?.displayName }} · <a href="#" @click.prevent="backToPick">change</a></div>
          </div>
          <button class="btn primary head-save" data-test="cred-save" :disabled="busy" @click="save">
            {{ busy ? 'Saving…' : 'Save' }}
          </button>
          <button class="icon-x" data-test="cred-close" @click="emit('close')">✕</button>
        </header>

        <nav class="cred-tabs">
          <button :class="{ active: tab === 'connection' }" @click="tab = 'connection'">Connection</button>
          <button :class="{ active: tab === 'details' }" @click="tab = 'details'">Details</button>
        </nav>

        <div class="cred-body">
          <!-- Connection tab -->
          <template v-if="tab === 'connection'">
            <template v-if="meta?.oauth">
              <label>OAuth Redirect URL</label>
              <div class="copy-field">
                <input :value="redirectUrl" readonly />
                <button type="button" class="copy-btn" @click="copyRedirect">{{ copied ? 'Copied' : 'Copy' }}</button>
              </div>
              <p class="fld-hint">In your provider’s app settings, add this as an allowed redirect / callback URL.</p>
            </template>

            <template v-for="f in meta?.fields ?? []" :key="f.name">
              <label>{{ f.label }}</label>
              <input v-model="values[f.name]" :type="f.type" :placeholder="f.placeholder" :data-test-cred-field="f.name" />
            </template>

            <!-- 非 OAuth：Test connection（对标 n8n） -->
            <div v-if="!meta?.oauth" class="test-row">
              <button class="btn secondary" data-test="cred-test" :disabled="testing" @click="testConnection">
                {{ testing ? 'Testing…' : 'Test connection' }}
              </button>
              <span
                v-if="testResult"
                class="test-result"
                :class="{ ok: testResult.ok, bad: !testResult.ok, neutral: !testResult.tested }"
                data-test="cred-test-result"
              >
                <span class="tr-icon">{{ testResult.tested ? (testResult.ok ? '✓' : '✕') : 'ⓘ' }}</span>
                <span>{{ testResult.message }}</span>
              </span>
            </div>

            <!-- OAuth2: Connect my account -->
            <div v-if="meta?.oauth" class="oauth-banner" :class="connected ? 'ok' : 'warn'" data-test="oauth-banner">
              <span class="oauth-icon">{{ connected ? '✓' : '⚠' }}</span>
              <span>{{ connected ? 'Account connected' : 'Connect your account to use this credential' }}</span>
              <span class="grow" />
              <button
                class="btn"
                :class="connected ? 'secondary' : 'primary'"
                :disabled="connecting"
                data-test="cred-connect"
                @click="connect"
              >
                {{ connecting ? 'Connecting…' : connected ? 'Reconnect' : 'Connect' }}
              </button>
            </div>

            <div class="help-callout">
              <span class="help-ico">?</span>
              <span>Need help filling out these fields? Check the documentation for {{ meta?.displayName }}.</span>
            </div>

            <p v-if="error" class="error-text" data-test="cred-error">{{ error }}</p>
          </template>

          <!-- Details tab -->
          <template v-else>
            <div class="detail-row"><span class="k">Type</span><span class="v">{{ meta?.displayName }}</span></div>
            <div v-if="credId" class="detail-row"><span class="k">Credential ID</span><span class="v mono">{{ credId }}</span></div>
            <div class="detail-row"><span class="k">Encryption</span><span class="v">AES-256-GCM at rest</span></div>
            <p class="detail-note">The decrypted secret is never returned by the API or written to logs.</p>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.cred-overlay {
  position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.cred-modal {
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 12px;
  display: flex; flex-direction: column; max-height: 86vh;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
}
/* pick 步 overflow 可见，让 combobox 下拉溢出模态；config 步裁剪并让 body 内部滚动 */
.cred-modal.pick { width: 500px; max-width: 94vw; overflow: visible; }
.cred-modal.config { width: 580px; max-width: 94vw; overflow: hidden; }

/* Header */
.cred-head { display: flex; align-items: center; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--border); }
.cred-title { font-size: 16px; font-weight: 600; color: var(--text-hi); flex: 1; }
.icon-x {
  width: 30px; height: 30px; border-radius: 7px; border: none; background: none; color: var(--text-dim);
  cursor: pointer; font-size: 14px; flex-shrink: 0;
}
.icon-x:hover { background: var(--bg-hover); color: var(--text); }

.cred-head.config { align-items: flex-start; }
.head-icon {
  width: 38px; height: 38px; flex-shrink: 0; border-radius: 9px; background: var(--bg-input);
  display: flex; align-items: center; justify-content: center; font-size: 18px;
}
.head-name { flex: 1; min-width: 0; }
.name-input {
  width: 100%; background: none; border: 1px solid transparent; border-radius: 6px; padding: 4px 6px;
  color: var(--text-hi); font-size: 16px; font-weight: 600; font-family: inherit;
}
.name-input:hover { border-color: var(--border); }
.name-input:focus { outline: none; border-color: var(--accent); background: var(--bg-input); }
.head-type { font-size: 12px; color: var(--text-dim); padding: 0 6px; margin-top: 2px; }
.head-type a { color: var(--accent); text-decoration: none; }
.head-type a:hover { text-decoration: underline; }
.head-save { flex-shrink: 0; height: 34px; padding: 0 18px; }

/* Tabs */
.cred-tabs { display: flex; gap: 4px; padding: 0 18px; border-bottom: 1px solid var(--border); }
.cred-tabs button {
  padding: 11px 6px; margin-bottom: -1px; background: none; border: none; border-bottom: 2px solid transparent;
  color: var(--text-dim); font-size: 13.5px; cursor: pointer; font-family: inherit;
}
.cred-tabs button:hover { color: var(--text); }
.cred-tabs button.active { color: var(--text-hi); border-bottom-color: var(--accent); }

/* Body */
.cred-body { padding: 16px 18px 20px; }
.cred-modal.config .cred-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.fld-label { display: block; font-size: 12px; color: var(--text-dim); margin-bottom: 8px; }
.cred-body label { display: block; margin: 14px 0 6px; color: var(--text-dim); font-size: 12px; }
.cred-body label:first-child { margin-top: 0; }
.cred-body input {
  width: 100%; height: 38px; padding: 0 12px; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text); font-size: 13.5px; font-family: inherit;
}
.cred-body input:focus { outline: none; border-color: var(--accent); }

/* Combobox (pick step) */
.combo { position: relative; }
.combo-control {
  display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 10px 0 12px;
  background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius); cursor: text;
}
.combo.open .combo-control { border-color: var(--accent); }
.combo-ico { flex-shrink: 0; font-size: 15px; }
.combo-input { flex: 1; height: 100%; background: none !important; border: none !important; padding: 0 !important; color: var(--text); font-size: 14px; }
.combo-input:focus { outline: none; }
.combo-caret { width: 15px; height: 15px; flex-shrink: 0; color: var(--text-faint); transition: transform 0.15s; }
.combo.open .combo-caret { transform: rotate(180deg); }
.combo-list {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 20; max-height: 300px; overflow-y: auto;
  background: var(--bg-panel); border: 1px solid var(--border-strong); border-radius: 10px; padding: 6px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
}
.combo-item {
  display: flex; align-items: center; gap: 11px; width: 100%; text-align: left;
  padding: 9px 10px; border: none; background: none; border-radius: 8px; cursor: pointer;
}
.combo-item:hover, .combo-item.sel { background: var(--bg-hover); }
.combo-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.combo-empty { padding: 16px; text-align: center; color: var(--text-dim); font-size: 13px; }

.type-icon {
  width: 32px; height: 32px; flex-shrink: 0; border-radius: 8px; background: var(--bg-input);
  display: flex; align-items: center; justify-content: center; font-size: 15px;
}
.type-name { font-size: 13.5px; color: var(--text); display: flex; align-items: center; gap: 8px; }
.type-desc { font-size: 11.5px; color: var(--text-dim); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oauth-tag {
  font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px;
  background: var(--bg-input); color: var(--text-dim); border: 1px solid var(--border); flex-shrink: 0;
}

/* OAuth redirect copy field */
.copy-field { display: flex; gap: 8px; }
.copy-field input { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--text-dim); }
.copy-btn {
  flex-shrink: 0; height: 38px; padding: 0 14px; border-radius: var(--radius); border: 1px solid var(--border);
  background: var(--bg-hover); color: var(--text); font-size: 13px; cursor: pointer; font-family: inherit;
}
.copy-btn:hover { border-color: var(--border-strong); }
.fld-hint { font-size: 11.5px; color: var(--text-faint); margin: 6px 0 0; }

/* OAuth connect banner */
.oauth-banner {
  display: flex; align-items: center; gap: 10px; margin-top: 16px; padding: 12px 14px;
  border-radius: 8px; font-size: 13px; border: 1px solid var(--border);
}
.oauth-banner .oauth-icon { flex-shrink: 0; font-size: 14px; }
.oauth-banner .grow { flex: 1; }
.oauth-banner.warn { background: rgba(245, 166, 35, 0.1); border-color: rgba(245, 166, 35, 0.35); color: var(--running); }
.oauth-banner.ok { background: rgba(76, 195, 138, 0.1); border-color: rgba(76, 195, 138, 0.35); color: var(--ok); }

/* Help callout (n8n 式琥珀提示) */
.help-callout {
  display: flex; align-items: flex-start; gap: 10px; margin-top: 18px; padding: 12px 14px;
  background: rgba(245, 166, 35, 0.08); border: 1px solid rgba(245, 166, 35, 0.28); border-radius: 8px;
  font-size: 12.5px; color: var(--text-dim); line-height: 1.5;
}
.help-ico {
  flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%; background: rgba(245, 166, 35, 0.25);
  color: var(--running); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700;
}
.test-row { display: flex; align-items: center; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
.test-result { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; }
.test-result.ok { color: var(--ok); }
.test-result.bad { color: var(--err); }
.test-result.neutral { color: var(--text-dim); }
.test-result .tr-icon { font-weight: 700; }

/* Details tab */
.detail-row { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.detail-row .k { color: var(--text-dim); }
.detail-row .v { color: var(--text); }
.detail-row .v.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.detail-note { font-size: 11.5px; color: var(--text-faint); margin-top: 14px; }

/* Footer (pick step) */
.cred-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 18px; border-top: 1px solid var(--border); }

/* Buttons */
.btn { height: 34px; padding: 0 16px; border-radius: var(--radius); border: none; font-size: 13.5px; font-weight: 500; cursor: pointer; font-family: inherit; color: #fff; }
.btn.primary { background: var(--accent); }
.btn.primary:hover { background: var(--accent-dim); }
.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.secondary { background: var(--bg-hover); color: var(--text); }
.btn.ghost { background: none; border: 1px solid var(--border); color: var(--text); }
.btn.ghost:hover { background: var(--bg-hover); }

.error-text { color: var(--err); font-size: 13px; margin: 12px 0 0; }
</style>
