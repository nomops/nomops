<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { api, type CredentialView } from '../../api/client.js';
import { CREDENTIAL_TYPES, credentialTypeMeta } from '../../lib/credential-types.js';

/** n8n 式「添加新凭证」弹窗：① 选类型 → ② 填字段；OAuth2 类型走 Connect my account 流程。 */
const emit = defineEmits<{ close: []; created: [cred: CredentialView] }>();

const step = ref<'pick' | 'config'>('pick');
const search = ref('');
const selectedType = ref('');
const name = ref('');
const values = ref<Record<string, string>>({});
const error = ref('');
const busy = ref(false);

/* OAuth 状态 */
const credId = ref<string | null>(null); // 保存后拿到（Connect 需要 id）
const createdView = ref<CredentialView | null>(null);
const connected = ref(false);
const connecting = ref(false);
let msgHandler: ((e: MessageEvent) => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const filteredTypes = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q
    ? CREDENTIAL_TYPES.filter(
        (t) => t.displayName.toLowerCase().includes(q) || t.type.toLowerCase().includes(q),
      )
    : CREDENTIAL_TYPES;
});

const meta = computed(() => credentialTypeMeta(selectedType.value));

function pickType(type: string) {
  selectedType.value = type;
  const m = credentialTypeMeta(type);
  name.value = m ? `${m.displayName} account` : '';
  values.value = {};
  credId.value = null;
  createdView.value = null;
  connected.value = false;
  error.value = '';
  step.value = 'config';
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
onUnmounted(cleanupConnect);

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
    // 兜底：弹窗关闭后查一次真实状态（有些提供方回调不 postMessage）
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
</script>

<template>
  <div class="cred-overlay" data-test="credential-modal" @click.self="emit('close')">
    <div class="cred-modal">
      <header class="cred-head">
        <div>
          <div class="cred-title">Add new credential</div>
          <div class="cred-sub">
            {{ step === 'pick' ? 'Choose an app or service to connect' : meta?.description }}
          </div>
        </div>
        <button data-test="cred-close" @click="emit('close')">✕</button>
      </header>

      <!-- 步骤 1：选类型 -->
      <div v-if="step === 'pick'" class="cred-body">
        <div class="cred-search">
          <span class="search-icon">🔍</span>
          <input v-model="search" data-test="cred-search" placeholder="Search apps…" autofocus />
        </div>
        <div class="type-list">
          <button
            v-for="t in filteredTypes"
            :key="t.type"
            class="type-item"
            :data-test-cred-type="t.type"
            @click="pickType(t.type)"
          >
            <span class="type-icon">{{ t.icon }}</span>
            <span class="type-body">
              <span class="type-name">{{ t.displayName }}<span v-if="t.oauth" class="oauth-tag">OAuth2</span></span>
              <span class="type-desc">{{ t.description }}</span>
            </span>
            <span class="type-arrow">→</span>
          </button>
          <p v-if="filteredTypes.length === 0" class="dim" style="padding: 16px; text-align: center">No matching types</p>
        </div>
      </div>

      <!-- 步骤 2：配字段 -->
      <div v-else class="cred-body">
        <div class="type-banner">
          <span class="type-icon">{{ meta?.icon }}</span>
          <span>{{ meta?.displayName }}</span>
          <span style="flex: 1" />
          <a href="#" class="dim" style="font-size: 12px" @click.prevent="step = 'pick'">← Change type</a>
        </div>
        <label>Credential name</label>
        <input v-model="name" data-test="cred-name" placeholder="Name this credential" />

        <template v-for="f in meta?.fields ?? []" :key="f.name">
          <label>{{ f.label }}</label>
          <input v-model="values[f.name]" :type="f.type" :placeholder="f.placeholder" :data-test-cred-field="f.name" />
        </template>

        <!-- OAuth2：Connect my account -->
        <div v-if="meta?.oauth" class="oauth-banner" :class="connected ? 'ok' : 'warn'" data-test="oauth-banner">
          <span class="oauth-icon">{{ connected ? '✓' : '⚠' }}</span>
          <span>{{ connected ? 'Account connected' : 'Connect your account to use this credential' }}</span>
          <span style="flex: 1" />
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

        <p v-if="error" class="error-text" data-test="cred-error">{{ error }}</p>
        <p class="dim" style="font-size: 11.5px; margin-top: 12px">
          Stored encrypted with AES-256-GCM; the plaintext is never returned.
        </p>
        <div style="margin-top: 14px; display: flex; justify-content: flex-end; gap: 8px">
          <button @click="step = 'pick'">Back</button>
          <button class="btn primary" style="width: auto; padding: 9px 20px" data-test="cred-save" :disabled="busy" @click="save">
            {{ busy ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cred-overlay {
  position: fixed; inset: 0; z-index: 60;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
}
.cred-modal {
  width: 480px; max-width: 92vw;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 12px;
  display: flex; flex-direction: column; max-height: 82vh; overflow: hidden;
}
.cred-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 18px 20px 14px; border-bottom: 1px solid var(--border);
}
.cred-title { font-size: 17px; font-weight: 600; }
.cred-sub { font-size: 12.5px; color: var(--text-dim); margin-top: 3px; }
.cred-body { padding: 16px 20px 20px; overflow-y: auto; }
.cred-search { position: relative; margin-bottom: 8px; }
.cred-search .search-icon { position: absolute; left: 11px; top: 9px; font-size: 12px; opacity: 0.6; }
.cred-search input { padding-left: 32px; }
.type-list { display: flex; flex-direction: column; }
.type-item {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
  padding: 11px 10px; border: none; background: none; border-radius: 8px; cursor: pointer;
}
.type-item:hover { background: var(--bg-hover); }
.type-icon {
  width: 34px; height: 34px; flex-shrink: 0; border-radius: 8px;
  background: var(--bg-input); display: flex; align-items: center; justify-content: center; font-size: 16px;
}
.type-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.type-name { font-size: 13.5px; color: var(--text); display: flex; align-items: center; gap: 8px; }
.oauth-tag {
  font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px;
  background: var(--bg-input); color: var(--text-dim); border: 1px solid var(--border);
}
.type-desc { font-size: 11.5px; color: var(--text-dim); margin-top: 2px; }
.type-arrow { color: var(--text-dim); opacity: 0; transition: opacity 0.12s; }
.type-item:hover .type-arrow { opacity: 1; }
.type-banner {
  display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
  padding: 10px 12px; background: var(--bg-input); border-radius: 8px; font-size: 13.5px;
}
.cred-body label { margin: 12px 0 5px; color: var(--text-dim); font-size: 12px; display: block; }

/* OAuth Connect 横幅 */
.oauth-banner {
  display: flex; align-items: center; gap: 10px; margin-top: 16px;
  padding: 12px 14px; border-radius: 8px; font-size: 13px; border: 1px solid var(--border);
}
.oauth-banner .oauth-icon { flex-shrink: 0; font-size: 14px; }
.oauth-banner.warn { background: rgba(245, 166, 35, 0.1); border-color: rgba(245, 166, 35, 0.35); color: var(--running); }
.oauth-banner.ok { background: rgba(76, 195, 138, 0.1); border-color: rgba(76, 195, 138, 0.35); color: var(--ok); }
.btn { height: 32px; padding: 0 14px; border-radius: var(--radius); border: none; font-size: 13px; font-weight: 500; cursor: pointer; }
.btn.primary { background: var(--accent); color: #fff; }
.btn.primary:hover { background: var(--accent-dim); }
.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.secondary { background: var(--bg-hover); color: var(--text); }
</style>
