<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api, type CredentialView } from '../../api/client.js';
import { CREDENTIAL_TYPES, credentialTypeMeta } from '../../lib/credential-types.js';
import { credentialIcon } from '../../lib/icons.js';
import IconSvg from '../IconSvg.vue';
import { LINKS } from '../../lib/links.js';

/**
 * 「Add new credential」弹窗：
 *  ① pick：单个「Select an app or service」下拉搜索框（纯文字应用列表）+ Continue。
 *  ② config：宽弹窗 + 左侧竖排标签（Connection / Sharing / Details）+ 头部可编辑名 + 右上 Save，
 *     字段支持 文本 / 密码 / 下拉 / 开关；OAuth2 走 Connect my account；非 OAuth 支持 Test connection。
 */
const emit = defineEmits<{ close: []; created: [cred: CredentialView]; updated: [cred: CredentialView] }>();

/** edit：编辑已有凭证（对标基线卡片 Open）——跳过选类型，字段留空 = 保持不变。
 *  createType：直达新建某类型（如 Chat provider 弹窗的 Create new credential）。 */
const props = defineProps<{ edit?: CredentialView; createType?: string }>();

const step = ref<'pick' | 'config'>('pick');
const tab = ref<'connection' | 'sharing' | 'details'>('connection');

/* pick 步：combobox */
const search = ref('');
const pickerOpen = ref(false);
const pendingType = ref('');
const comboRef = ref<HTMLElement | null>(null);

/* config 步 */
const selectedType = ref('');
const name = ref('');
const values = ref<Record<string, unknown>>({});
const error = ref('');
const busy = ref(false);
const copied = ref(false);

/* OAuth 状态 */
const credId = ref<string | null>(null);
const createdView = ref<CredentialView | null>(null);

/* D050 Details tab:已保存凭证的 Created / Last modified / ID(编辑态用 props.edit,新建后用 createdView)。 */
const credInfo = computed<CredentialView | null>(() => props.edit ?? createdView.value);

/* D054:头部垃圾桶删除已存凭证。 */
const deleting = ref(false);
async function deleteCredential() {
  const id = credInfo.value?.id;
  if (!id || deleting.value) return;
  if (!window.confirm('Delete this credential? Workflows using it will stop working.')) return;
  deleting.value = true;
  try {
    await api.credentials.remove(id);
    emit('close');
  } catch {
    deleting.value = false;
  }
}
/* 基线式相对时间(粗粒度:秒/分/时/天,再退化为日期)。 */
function fmtWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}
const connected = ref(false);
const connecting = ref(false);
let msgHandler: ((e: MessageEvent) => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/* D056 对标基线 credentials.store：类型列表按 displayName 字母序，不用数组序 */
const sortedTypes = computed(() =>
  [...CREDENTIAL_TYPES].sort((a, b) => a.displayName.localeCompare(b.displayName)),
);
const filteredTypes = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (pendingType.value && search.value === (credentialTypeMeta(pendingType.value)?.displayName ?? '')) {
    return sortedTypes.value;
  }
  return q
    ? sortedTypes.value.filter(
        (t) => t.displayName.toLowerCase().includes(q) || t.type.toLowerCase().includes(q),
      )
    : sortedTypes.value;
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
  // 按字段 default 初始化（toggle=false / select=首项）
  const init: Record<string, unknown> = {};
  for (const f of m?.fields ?? []) {
    if (f.default !== undefined) init[f.name] = f.default;
    else if (f.type === 'toggle') init[f.name] = false;
    else if (f.type === 'select') init[f.name] = f.options?.[0]?.value ?? '';
  }
  values.value = init;
  credId.value = null;
  createdView.value = null;
  connected.value = false;
  testResult.value = null;
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
function buildData(): Record<string, unknown> {
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
    if (props.edit) {
      const updated = await api.credentials.update(props.edit.id, { name: name.value, data: values.value });
      emit('updated', updated);
    } else {
      await ensureSaved();
      if (createdView.value) emit('created', createdView.value);
    }
    emit('close');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

/* 连接测试：先保存 → 打服务端点看状态 */
const testing = ref(false);
const testResult = ref<{ ok: boolean; tested: boolean; message?: string } | null>(null);

async function testConnection() {
  error.value = '';
  testResult.value = null;
  testing.value = true;
  try {
    await ensureSaved();
    if (createdView.value) emit('created', createdView.value);
    testResult.value = await api.credentials.test(credId.value!);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    testing.value = false;
  }
}

/** 编辑态打开即自动测一次连接(对标基线):仅测已存在凭证,不保存、不 emit;失败静默(用户仍可手动 Test connection 重试)。 */
async function autoTestOnOpen() {
  if (!props.edit || !credId.value || meta.value?.oauth) return;
  testing.value = true;
  try {
    testResult.value = await api.credentials.test(credId.value);
  } catch {
    // 自动测失败不打断编辑流；手动 Test connection 仍可用
  } finally {
    testing.value = false;
  }
}

function onDocClick(e: MouseEvent) {
  if (pickerOpen.value && comboRef.value && !comboRef.value.contains(e.target as Node)) {
    pickerOpen.value = false;
  }
}
onMounted(() => {
  window.addEventListener('mousedown', onDocClick);
  if (props.edit) {
    // 编辑模式：类型锁定、字段全空（占位提示保持不变）；旧值绝不回显（铁律 3）
    selectedType.value = props.edit.type;
    name.value = props.edit.name;
    credId.value = props.edit.id;
    createdView.value = props.edit;
    values.value = {};
    tab.value = 'connection';
    step.value = 'config';
    void autoTestOnOpen(); // 对标基线:编辑态打开即自动测连接
  } else if (props.createType) {
    pickType(props.createType); // 直达该类型的 config 步
  }
});
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
              <svg class="combo-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              <input
                v-model="search"
                class="combo-input"
                data-test="cred-search"
                placeholder="Search for app..."
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
                {{ t.displayName }}
              </button>
              <p v-if="filteredTypes.length === 0" class="combo-empty">No matching apps</p>
            </div>
          </div>

          <div class="pick-actions">
            <button class="btn primary" data-test="cred-continue" :disabled="!pendingType" @click="pickType(pendingType)">Continue</button>
          </div>
        </div>
      </template>

      <!-- ── Step 2: configure (wide, left rail tabs) ── -->
      <template v-else>
        <header class="cred-head config">
          <span class="head-icon"><IconSvg v-bind="credentialIcon(selectedType)" :size="26" /></span>
          <div class="head-name">
            <input v-model="name" class="name-input" data-test="cred-name" placeholder="Name this credential" />
            <div class="head-type">{{ meta?.displayName }}</div>
          </div>
          <button class="btn neutral head-save" data-test="cred-save" :disabled="busy" @click="save">
            {{ busy ? 'Saving…' : 'Save' }}
          </button>
          <!-- D054 对标基线:已存凭证头部有垃圾桶(删除) -->
          <button v-if="credInfo" class="icon-trash" data-test="cred-delete" title="Delete credential" :disabled="deleting" @click="deleteCredential">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
          </button>
          <button class="icon-x" data-test="cred-close" @click="emit('close')">✕</button>
        </header>

        <div class="config-body">
          <!-- 左侧竖排标签 -->
          <nav class="side-tabs">
            <button :class="{ active: tab === 'connection' }" @click="tab = 'connection'">Connection</button>
            <button :class="{ active: tab === 'sharing' }" @click="tab = 'sharing'">Sharing</button>
            <button :class="{ active: tab === 'details' }" @click="tab = 'details'">Details</button>
          </nav>

          <!-- 右侧内容 -->
          <div class="tab-content">
            <!-- Connection -->
            <template v-if="tab === 'connection'">
              <p class="setup-help">
                <!-- D055 基线原文：Need help filling out these fields? / Read our docs -->
                Need help filling out these fields?
                <a href="#docs" @click.prevent>Read our docs</a>
              </p>

              <template v-if="meta?.oauth">
                <div class="field">
                  <label>OAuth Redirect URL</label>
                  <div class="copy-field">
                    <input :value="redirectUrl" readonly />
                    <button type="button" class="copy-btn" @click="copyRedirect">{{ copied ? 'Copied' : 'Copy' }}</button>
                  </div>
                  <p class="fld-hint">In your provider’s app settings, add this as an allowed redirect / callback URL.</p>
                </div>
              </template>

              <!-- 字段：文本 / 密码 / 下拉 / 开关 -->
              <div v-for="f in meta?.fields ?? []" :key="f.name" class="field">
                <label :for="`fld-${f.name}`">{{ f.label }} <span v-if="f.required" class="req-star">*</span></label>

                <button
                  v-if="f.type === 'toggle'"
                  type="button"
                  class="switch"
                  :class="{ on: values[f.name] }"
                  role="switch"
                  :aria-checked="!!values[f.name]"
                  :data-test-cred-field="f.name"
                  @click="values[f.name] = !values[f.name]"
                >
                  <span class="knob" />
                </button>

                <div v-else-if="f.type === 'select'" class="select-wrap">
                  <select :id="`fld-${f.name}`" v-model="values[f.name]" :data-test-cred-field="f.name">
                    <option v-for="o in f.options ?? []" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                  <svg class="select-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6" /></svg>
                </div>

                <input
                  v-else
                  :id="`fld-${f.name}`"
                  v-model="values[f.name]"
                  :type="f.type"
                  :placeholder="props.edit ? '••••••  (leave blank to keep current value)' : f.placeholder"
                  :data-test-cred-field="f.name"
                />

                <p v-if="f.hint" class="fld-hint">{{ f.hint }}</p>
              </div>

              <!-- 非 OAuth：Test connection -->
              <div v-if="!meta?.oauth" class="test-row">
                <button class="btn neutral" data-test="cred-test" :disabled="testing" @click="testConnection">
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

              <!-- OAuth2: Connect my account（整块琥珀横幅） -->
              <div v-if="meta?.oauth" class="oauth-banner" :class="connected ? 'ok' : 'warn'" data-test="oauth-banner">
                <span class="oauth-icon">{{ connected ? '✓' : '⚠' }}</span>
                <span>{{ connected ? 'Account connected' : 'Connect your account to use this credential' }}</span>
                <span class="grow" />
                <button
                  class="btn"
                  :class="connected ? 'neutral' : 'primary'"
                  :disabled="connecting"
                  data-test="cred-connect"
                  @click="connect"
                >
                  {{ connecting ? 'Connecting…' : connected ? 'Reconnect' : 'Connect' }}
                </button>
              </div>

              <p v-if="error" class="error-text" data-test="cred-error">{{ error }}</p>

              <p class="vault-note">
                <span class="vault-i">ⓘ</span> Enterprise plan users can pull in credentials from external vaults.
                <a href="#docs" @click.prevent>More info</a>
              </p>
            </template>

            <!-- D049 Sharing:对标基线 Community 的虚线升级卡 -->
            <template v-else-if="tab === 'sharing'">
              <div class="sharing-lock" data-test="cred-sharing-lock">
                <h4>Upgrade to collaborate</h4>
                <p>You can share credentials with others when you upgrade your plan.</p>
                <a class="btn primary" :href="LINKS.pricing" target="_blank" rel="noopener">View plans</a>
              </div>
            </template>

            <!-- D050 Details:对标基线:已存 = Created / Last modified / ID 三行;未存 = 空白 -->
            <template v-else>
              <template v-if="credInfo">
                <div class="detail-row"><span class="k">Created</span><span class="v">{{ fmtWhen(credInfo.createdAt) }}</span></div>
                <div class="detail-row"><span class="k">Last modified</span><span class="v">{{ fmtWhen(credInfo.updatedAt) }}</span></div>
                <div class="detail-row"><span class="k">ID</span><span class="v mono">{{ credInfo.id }}</span></div>
              </template>
              <p v-else class="detail-note">Save the credential to see its details.</p>
            </template>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 基线实测：遮罩 = --dialog--overlay--color--background(slate-alpha-700)；
   面板 bg light-3 / 1px border / 圆角 8 / el-dialog 阴影 0 6px 16px rgba(68,28,23,.06)；
   pick 步 420px；config 步 70% 视宽 */
.cred-overlay {
  position: fixed; inset: 0; z-index: var(--modals--z); background: var(--dialog--overlay--color--background);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.cred-modal {
  background: var(--dialog--color--background); border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius--lg);
  display: flex; flex-direction: column; max-height: 86vh;
  box-shadow: 0 6px 16px rgba(68, 28, 23, 0.06); /* el-dialog 实测值，无对应全局令牌 */
}
.cred-modal.pick { width: 420px; max-width: 94vw; overflow: visible; }
.cred-modal.config { width: 70vw; max-width: 94vw; overflow: hidden; }

/* Header */
.cred-head { display: flex; align-items: center; gap: 14px; padding: var(--spacing--sm) var(--spacing--lg); border-bottom: var(--border-width) var(--border-style) var(--border-color); }
/* 基线实测：模态标题 20px/400 白 */
.cred-title { font-size: var(--font-size--xl); font-weight: var(--font-weight--regular); color: var(--color--text--shade-1); flex: 1; }
.icon-x {
  width: 30px; height: 30px; border-radius: 7px; border: none; background: none; color: var(--text-dim);
  cursor: pointer; font-size: 14px; flex-shrink: 0;
}
.icon-x:hover { background: var(--bg-hover); color: var(--text); }

.cred-head.config { align-items: center; }
/* 基线实测：品牌图标 26×26 裸图，无底框 */
.head-icon {
  width: 26px; height: 26px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.head-name { flex: 1; min-width: 0; }
.name-input {
  width: 100%; max-width: 420px; background: none; border: 1px solid transparent; border-radius: var(--radius--2xs); padding: 3px 6px;
  color: var(--color--text--shade-1); font-size: var(--font-size--xl); font-weight: var(--font-weight--regular); font-family: inherit;
}
.name-input:hover { border-color: var(--border); }
.name-input:focus { outline: none; border-color: var(--accent); background: var(--bg-input); }
.head-type { font-size: 12.5px; color: var(--text-dim); padding: 0 6px; margin-top: 1px; }
.head-save { flex-shrink: 0; height: 34px; padding: 0 20px; }

/* Config: two-column body */
.config-body { flex: 1 1 auto; min-height: 0; display: flex; }
/* 基线实测：左栏 tab 14px；未激活 neutral-200、激活白 + light-1 底 */
.side-tabs {
  width: 176px; flex-shrink: 0; border-right: var(--border-width) var(--border-style) var(--border-color); padding: 14px 12px;
  display: flex; flex-direction: column; gap: 2px;
}
.side-tabs button {
  text-align: left; padding: 8px 12px; border: none; background: none; border-radius: var(--radius);
  color: var(--color--text); font-size: var(--font-size--sm); cursor: pointer; font-family: inherit; height: auto;
}
.side-tabs button:hover { background: var(--color--background--light-1); color: var(--color--text--shade-1); }
.side-tabs button.active { background: var(--color--background--light-1); color: var(--color--text--shade-1); font-weight: var(--font-weight--regular); }

.tab-content { flex: 1; min-width: 0; overflow-y: auto; padding: 22px 26px 26px; }

/* Body (pick step) */
/* 基线实测：内容衬 24px；说明行 16px neutral-200、下距 16 */
.cred-body { padding: var(--spacing--md) var(--spacing--lg) var(--spacing--lg); }
.fld-label { display: block; font-size: var(--font-size--md); color: var(--color--text); margin-bottom: var(--spacing--sm); }
.pick-actions { margin-top: 16px; }
/* 基线实测：模态主按钮 36px 高 / 圆角 6 / 衬 0 16 */
.pick-actions .btn { height: 36px; border-radius: var(--radius--2xs); padding: 0 var(--spacing--sm); }

/* Fields */
.field { margin-bottom: 18px; }
.field:last-child { margin-bottom: 0; }
/* 基线实测：模态/NDV 输入 36px 高 / 圆角 6 / 14px 字 / bg light-2 */
.field label { display: block; margin: 0 0 7px; color: var(--color--text); font-size: var(--font-size--sm); }
.field input,
.select-wrap select {
  width: 100%; height: 36px; padding: 0 var(--spacing--xs); background: var(--color--background--light-2);
  border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius--2xs); color: var(--color--text--shade-1); font-size: var(--font-size--sm); font-family: inherit;
}
.field input:focus, .select-wrap select:focus { outline: none; border-color: var(--color--primary); }
.fld-hint { font-size: 11.5px; color: var(--text-faint); margin: 6px 0 0; }

.setup-help { font-size: 12.5px; color: var(--text-dim); margin: 0 0 20px; }
.setup-help a { color: var(--accent); text-decoration: none; }
.setup-help a:hover { text-decoration: underline; }

/* Select (下拉) */
.select-wrap { position: relative; }
.select-wrap select { appearance: none; -webkit-appearance: none; padding-right: 34px; cursor: pointer; }
.select-caret { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; color: var(--text-faint); pointer-events: none; }

/* Switch (开关) */
.switch {
  position: relative; width: 40px; height: 22px; border-radius: 11px; border: none; cursor: pointer;
  background: var(--bg-hover); border: 1px solid var(--border); transition: background 0.16s, border-color 0.16s; padding: 0;
}
.switch .knob {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; transition: transform 0.16s;
}
.switch.on { background: var(--accent); border-color: var(--accent); }
.switch.on .knob { transform: translateX(18px); }

/* Combobox (pick step) */
.combo { position: relative; }
/* 基线实测：类型选择组合框 48px 高 / bg light-2 / 圆角 4 / 16px 字 */
.combo-control {
  display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 10px 0 12px;
  background: var(--color--background--light-2); border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); cursor: text;
}
.combo.open .combo-control { border-color: var(--accent); }
.combo-search { width: 15px; height: 15px; flex-shrink: 0; color: var(--text-faint); }
.combo-input { flex: 1; height: 100%; background: none !important; border: none !important; padding: 0 !important; box-shadow: none !important; color: var(--color--text--shade-1); font-size: var(--font-size--md); }
.combo-input:focus { outline: none; }
.combo-caret { width: 15px; height: 15px; flex-shrink: 0; color: var(--text-faint); transition: transform 0.15s; }
.combo.open .combo-caret { transform: rotate(180deg); }
.combo-list {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 20; max-height: 300px; overflow-y: auto;
  background: var(--bg-panel); border: 1px solid var(--border-strong); border-radius: 10px; padding: 6px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
}
.combo-item {
  display: block; width: 100%; text-align: left; padding: 9px 12px; border: none; background: none;
  border-radius: 7px; cursor: pointer; color: var(--text); font-size: 13.5px; font-family: inherit;
}
.combo-item:hover, .combo-item.sel { background: var(--bg-hover); }
.combo-empty { padding: 16px; text-align: center; color: var(--text-dim); font-size: 13px; }

/* OAuth redirect copy field */
.copy-field { display: flex; gap: 8px; }
.copy-field input { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--text-dim); }
.copy-btn {
  flex-shrink: 0; height: 40px; padding: 0 14px; border-radius: var(--radius); border: 1px solid var(--border);
  background: var(--bg-hover); color: var(--text); font-size: 13px; cursor: pointer; font-family: inherit;
}
.copy-btn:hover { border-color: var(--border-strong); }

/* OAuth connect banner (整块琥珀) */
.oauth-banner {
  display: flex; align-items: center; gap: 10px; margin-top: 4px; padding: 14px 16px;
  border-radius: 8px; font-size: 13px; border: 1px solid transparent;
}
.oauth-banner .oauth-icon { flex-shrink: 0; font-size: 14px; }
.oauth-banner .grow { flex: 1; }
.oauth-banner.warn { background: rgba(245, 166, 35, 0.13); border-color: rgba(245, 166, 35, 0.4); color: var(--running); }
.oauth-banner.ok { background: rgba(76, 195, 138, 0.12); border-color: rgba(76, 195, 138, 0.4); color: var(--ok); }

/* Test connection */
.test-row { display: flex; align-items: center; gap: 12px; margin-top: 4px; flex-wrap: wrap; }
.test-result { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; }
.test-result.ok { color: var(--ok); }
.test-result.bad { color: var(--err); }
.test-result.neutral { color: var(--text-dim); }
.test-result .tr-icon { font-weight: 700; }

/* Enterprise vault 提示 */
.vault-note { display: flex; align-items: baseline; gap: 7px; margin-top: 20px; font-size: 12px; color: var(--text-faint); }
.vault-note .vault-i { flex-shrink: 0; }
.vault-note a { color: var(--accent); text-decoration: none; }
.vault-note a:hover { text-decoration: underline; }

/* Sharing tab */
/* D049 Sharing 虚线升级卡(对标基线) */
.sharing-lock {
  text-align: center; padding: 40px 24px; margin: 8px 0;
  border: 1px dashed var(--border-strong); border-radius: 10px;
}
.sharing-lock h4 { margin: 0 0 10px; font-size: 16px; font-weight: 600; color: var(--text-hi); }
.sharing-lock p { margin: 0 auto 20px; max-width: 34em; font-size: 13.5px; color: var(--text-dim); line-height: 1.55; }
/* D053 必填星号 */
.req-star { color: var(--err); }
/* D054 头部垃圾桶 */
.icon-trash {
  flex-shrink: 0; width: 34px; height: 34px; display: grid; place-items: center;
  background: none; border: none; border-radius: var(--radius); color: var(--text-dim); cursor: pointer;
}
.icon-trash svg { width: 17px; height: 17px; }
.icon-trash:hover:not(:disabled) { background: var(--bg-hover); color: var(--err); }
.icon-trash:disabled { opacity: 0.5; cursor: default; }

/* Details tab */
.detail-row { display: flex; justify-content: space-between; gap: 16px; padding: 13px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.detail-row .k { color: var(--text-dim); }
.detail-row .v { color: var(--text); }
.detail-row .v.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.detail-note { font-size: 11.5px; color: var(--text-faint); margin-top: 14px; }

/* Buttons */
.btn { height: 34px; padding: 0 16px; border-radius: var(--radius); border: none; font-size: 13.5px; font-weight: 500; cursor: pointer; font-family: inherit; color: #fff; }
.btn.primary { background: var(--accent); }
.btn.primary:hover { background: var(--accent-dim); }
.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.neutral { background: var(--bg-hover); color: var(--text); border: 1px solid var(--border); }
.btn.neutral:hover { border-color: var(--border-strong); }
.btn.neutral:disabled { opacity: 0.5; cursor: not-allowed; }

.error-text { color: var(--err); font-size: 13px; margin: 14px 0 0; }
</style>
