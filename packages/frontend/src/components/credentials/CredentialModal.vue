<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { api, type CredentialView } from '../../api/client.js';
import { useProjectsStore } from '../../stores/projects.js';
import { useUiStore } from '../../stores/ui.js';
import { CREDENTIAL_TYPES, credentialTypeMeta } from '../../lib/credential-types.js';
import { credentialIcon } from '../../lib/icons.js';
import IconSvg from '../IconSvg.vue';
import { LINKS } from '../../lib/links.js';
import CredentialExpressionField from './CredentialExpressionField.vue';
import UiDialog from '../ui/UiDialog.vue';

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

/* backlog #12:Sharing tab 真实现(licensed + 已保存凭证);受享方打开 → owner 专属 403 原样呈现 */
const projectsStore = useProjectsStore();
const ui = useUiStore();
const sharingLicensed = computed(() => projectsStore.hasFeature('sharing'));
const shareTargets = ref<Array<{ projectId: string; kind: 'user' | 'project'; label: string }>>([]);
const shareSelected = ref<Set<string>>(new Set());
const shareBusy = ref(false);
const shareError = ref('');
async function loadShares() {
  if (!credId.value) return;
  shareError.value = '';
  try {
    const [targets, shares] = await Promise.all([api.shareTargets(), api.credentials.shares(credId.value)]);
    shareTargets.value = targets.targets;
    shareSelected.value = new Set(shares.shares.filter((s) => !s.role.endsWith(':owner')).map((s) => s.projectId));
  } catch (e) {
    shareError.value = (e as Error).message;
  }
}
watch(tab, (t) => {
  if (t === 'sharing' && sharingLicensed.value && credId.value) void loadShares();
});
function toggleShare(projectId: string) {
  const next = new Set(shareSelected.value);
  if (next.has(projectId)) next.delete(projectId);
  else next.add(projectId);
  shareSelected.value = next;
}
async function saveShares() {
  if (!credId.value) return;
  shareBusy.value = true;
  shareError.value = '';
  try {
    await api.credentials.setShares(credId.value, [...shareSelected.value]);
    ui.notify({ kind: 'success', title: 'Credential sharing updated' });
  } catch (e) {
    shareError.value = (e as Error).message;
  } finally {
    shareBusy.value = false;
  }
}

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

/* 凭证专属表达式（#33）：可用的外部密钥键 + 是否启用（externalSecrets 企业功能）。 */
const secretKeys = ref<string[]>([]);
const secretsEnabled = ref(false);
async function loadSecrets() {
  const s = await api.externalSecrets().catch(() => null);
  if (s) {
    secretsEnabled.value = s.enabled;
    secretKeys.value = s.keys ?? [];
  }
}

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
  // #40b：删前查引用方,把工作流名列进确认框
  const usage = await api.credentials.usage(id).catch(() => ({ workflows: [] as Array<{ name: string }> }));
  const used = usage.workflows;
  const message = used.length
    ? `This credential is used by ${used.length} workflow(s):\n${used.map((w) => `• ${w.name}`).join('\n')}\n\nDelete anyway? They will stop working.`
    : 'Delete this credential? Workflows using it will stop working.';
  const confirmed = await ui.requestConfirm({
    title: 'Delete credential?',
    message,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!confirmed) return;
  deleting.value = true;
  try {
    await api.credentials.remove(id);
    ui.notify({ kind: 'success', title: 'Credential deleted', message: credInfo.value?.name });
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
    ui.notify({ kind: 'success', title: props.edit ? 'Credential saved' : 'Credential created', message: name.value });
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
  void loadSecrets(); // #33：拉外部密钥键供表达式补全
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
  <UiDialog
    :open="true"
    :width="step === 'pick' ? '420px' : 'min(1080px, 70vw)'"
    test-id="credential-modal"
    @close="emit('close')"
  >
    <template #header>
      <template v-if="step === 'pick'">
        <div class="cred-title">Add new credential</div>
      </template>
      <template v-else>
        <div class="cred-head config">
          <span class="head-icon"><IconSvg v-bind="credentialIcon(selectedType)" :size="26" /></span>
          <div class="head-name">
            <input v-model="name" class="name-input" data-test="cred-name" placeholder="Name this credential" />
            <div class="head-type">{{ meta?.displayName }}</div>
          </div>
          <button class="btn neutral head-save" data-test="cred-save" :disabled="busy" @click="save">
            {{ busy ? 'Saving…' : 'Save' }}
          </button>
          <button v-if="credInfo" class="icon-trash" data-test="cred-delete" title="Delete credential" :disabled="deleting" @click="deleteCredential">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
          </button>
        </div>
      </template>
    </template>

    <div class="cred-modal" :class="step">
      <!-- ── Step 1: pick type (combobox + Continue) ── -->
      <template v-if="step === 'pick'">
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
                autofocus
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
                <a :href="LINKS.docs" target="_blank" rel="noopener">Read our docs</a>
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

                <CredentialExpressionField
                  v-else
                  :field-id="`fld-${f.name}`"
                  :model-value="String(values[f.name] ?? '')"
                  :type="f.type as 'text' | 'password'"
                  :placeholder="props.edit ? '••••••  (leave blank to keep current value)' : f.placeholder"
                  :secrets="secretKeys"
                  :secrets-enabled="secretsEnabled"
                  @update:model-value="values[f.name] = $event"
                />

                <p v-if="f.hint" class="fld-hint">{{ f.hint }}</p>
              </div>

              <!-- 非 OAuth：自动测试状态条 + Retry -->
              <div v-if="!meta?.oauth" class="test-area">
                <div v-if="testing" class="test-banner neutral" role="status" data-test="cred-test-loading">
                  <span class="test-spinner" />
                  <div><strong>Testing connection…</strong><span>Checking these settings securely.</span></div>
                </div>
                <div
                  v-else-if="testResult"
                  class="test-banner"
                  :class="{ ok: testResult.ok, bad: !testResult.ok, neutral: !testResult.tested }"
                  :role="testResult.ok ? 'status' : 'alert'"
                  data-test="cred-test-result"
                >
                  <span class="tr-icon">{{ testResult.tested ? (testResult.ok ? '✓' : '✕') : 'ⓘ' }}</span>
                  <div>
                    <strong>{{ testResult.tested ? (testResult.ok ? 'Connection successful' : "Couldn't connect with these settings") : 'Connection test unavailable' }}</strong>
                    <span v-if="testResult.message">{{ testResult.message }}</span>
                  </div>
                  <button class="btn neutral" data-test="cred-test" @click="testConnection">Retry</button>
                </div>
                <button v-else class="btn neutral" data-test="cred-test" @click="testConnection">Test connection</button>
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

              <p v-if="error" class="error-text" role="alert" data-test="cred-error">{{ error }}</p>

              <p class="vault-note">
                <span class="vault-i">ⓘ</span> Enterprise plan users can pull in credentials from external vaults.
                <a :href="LINKS.docs" target="_blank" rel="noopener">More info</a>
              </p>
            </template>

            <!-- D049 Sharing:对标基线 Community 的虚线升级卡 -->
            <template v-else-if="tab === 'sharing'">
              <!-- backlog #12:licensed('sharing') + 已保存凭证 → 真共享面;否则保留升级卡 -->
              <template v-if="sharingLicensed && credId">
                <p class="setup-help" style="margin-top: 0">
                  Shared users and projects can use this credential in their workflows — they can never view or edit the secret.
                </p>
                <p v-if="shareError" class="error-text" data-test="cred-share-error">{{ shareError }}</p>
                <div class="share-list" data-test="cred-share-list">
                  <p v-if="!shareTargets.length" class="share-empty">No one to share with yet — invite users under Settings → Users.</p>
                  <label v-for="tgt in shareTargets" :key="tgt.projectId" class="share-row" :data-test-cred-share="tgt.projectId">
                    <input type="checkbox" :checked="shareSelected.has(tgt.projectId)" @change="toggleShare(tgt.projectId)" />
                    <span>{{ tgt.label }}</span>
                  </label>
                </div>
                <button class="btn primary" data-test="cred-share-save" :disabled="shareBusy" style="margin-top: 14px" @click="saveShares">
                  {{ shareBusy ? 'Saving…' : 'Save sharing' }}
                </button>
              </template>
              <div v-else-if="sharingLicensed" class="sharing-lock" data-test="cred-sharing-unsaved">
                <p>Save the credential first, then share it here.</p>
              </div>
              <div v-else class="sharing-lock" data-test="cred-sharing-lock">
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
  </UiDialog>
</template>

<style scoped>
/* UiDialog 提供遮罩、焦点圈、Escape 和移动端底部面板；凭证组件只负责内容布局。 */
:deep(.ui-dialog-body) { padding: 0; }
.cred-modal {
  display: flex; flex-direction: column; min-height: 0;
}
.cred-modal.config { height: min(620px, calc(100vh - 136px)); overflow: hidden; }

/* Header */
.cred-head { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
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
.test-area { margin-top: 4px; }
.test-banner {
  display: flex; align-items: center; gap: 10px; padding: 11px 12px;
  border: 1px solid currentColor; border-radius: var(--radius--2xs); font-size: 12.5px;
}
.test-banner > div { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 2px; }
.test-banner strong { color: currentColor; font-size: 13px; font-weight: var(--font-weight--medium); }
.test-banner > div > span { color: var(--color--text); line-height: var(--line-height--lg); }
.test-banner.ok { color: var(--ok); background: rgba(76, 195, 138, 0.1); }
.test-banner.bad { color: var(--err); background: rgba(239, 111, 108, 0.1); }
.test-banner.neutral { color: var(--color--text--tint-1); background: var(--color--background--light-2); border-color: var(--border-color); }
.test-banner .tr-icon { flex: none; font-size: 15px; font-weight: 700; }
.test-spinner {
  width: 14px; height: 14px; flex: none; border: 2px solid var(--border-color--strong);
  border-top-color: var(--color--primary); border-radius: 50%; animation: credential-spin .75s linear infinite;
}
@keyframes credential-spin { to { transform: rotate(360deg); } }

/* Enterprise vault 提示 */
.vault-note { display: flex; align-items: baseline; gap: 7px; margin-top: 20px; font-size: 12px; color: var(--text-faint); }
.vault-note .vault-i { flex-shrink: 0; }
.vault-note a { color: var(--accent); text-decoration: none; }
.vault-note a:hover { text-decoration: underline; }

/* Sharing tab */
/* D049 Sharing 虚线升级卡(对标基线) */
.share-list {
  display: flex; flex-direction: column; gap: 2px; max-height: 240px; overflow: auto;
  border: 1px solid var(--border); border-radius: 8px; padding: 6px;
}
.share-row {
  display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 6px;
  font-size: 13.5px; cursor: pointer;
}
.share-row:hover { background: var(--bg-hover); }
.share-row input[type='checkbox'] { width: 15px; height: 15px; flex: 0 0 auto; }
.share-empty { padding: 8px 4px; font-size: 13px; color: var(--text-dim); }
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

@media (max-width: 720px) {
  .cred-modal.config { height: min(680px, calc(100vh - 112px)); }
  .config-body { flex-direction: column; }
  .side-tabs {
    width: 100%; padding: var(--spacing--2xs) var(--spacing--sm); flex-direction: row;
    overflow-x: auto; border-right: none; border-bottom: var(--border-width) var(--border-style) var(--border-color);
  }
  .side-tabs button { flex: 1; min-width: max-content; text-align: center; }
  .tab-content { padding: var(--spacing--sm); }
  .name-input { font-size: var(--font-size--md); }
  .head-type { display: none; }
  .head-save { padding: 0 var(--spacing--xs); }
  .test-banner { align-items: flex-start; flex-wrap: wrap; }
  .test-banner .btn { margin-left: 24px; }
}
@media (prefers-reduced-motion: reduce) {
  .test-spinner { animation: none; }
}
</style>
