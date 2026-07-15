<script setup lang="ts">
import { ref, watch } from 'vue';
import { api, type LicenseInfo } from '../api/client.js';

/** 许可证激活弹窗（对标 n8n「Enter activation key」）。 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'activated', info: LicenseInfo): void }>();

const activationKey = ref('');
const busy = ref(false);
const error = ref('');
const keyInput = ref<HTMLInputElement>();

watch(
  () => props.open,
  (open) => {
    if (open) {
      activationKey.value = '';
      error.value = '';
      setTimeout(() => keyInput.value?.focus(), 40);
    }
  },
);

async function activate() {
  error.value = '';
  const key = activationKey.value.trim();
  if (!key) {
    error.value = 'Please enter your activation key';
    return;
  }
  busy.value = true;
  try {
    const info = await api.activateLicense(key);
    emit('activated', info);
    emit('close');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="open" class="lic-overlay" data-test="license-modal" @click.self="emit('close')">
    <div class="lic-modal">
      <div class="lic-head">
        <div>
          <div class="lic-title">Activate your plan</div>
          <div class="lic-sub">Unlock Enterprise features on this instance</div>
        </div>
        <button class="lic-close" data-test="license-close" @click="emit('close')">✕</button>
      </div>

      <div class="lic-body">
        <p class="lic-desc">
          Enter the activation key you received to enable Enterprise capabilities — SSO, SCIM, LDAP,
          audit logs, source control, external secrets and more.
        </p>

        <label class="lic-label" for="lic-key">Activation key</label>
        <input
          id="lic-key"
          ref="keyInput"
          v-model="activationKey"
          class="lic-input"
          data-test="license-key"
          placeholder="Paste your activation key"
          autocomplete="off"
          spellcheck="false"
          @keyup.enter="activate"
        />

        <p v-if="error" class="lic-error" data-test="license-error">{{ error }}</p>

        <p class="lic-hint">
          Don’t have a key? Talk to us about an Enterprise plan or a trial.
        </p>
      </div>

      <div class="lic-foot">
        <button class="lic-btn ghost" data-test="license-cancel" @click="emit('close')">Cancel</button>
        <button class="lic-btn primary" data-test="license-activate" :disabled="busy" @click="activate">
          {{ busy ? 'Activating…' : 'Activate' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lic-overlay {
  position: fixed; inset: 0; z-index: 70;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
}
.lic-modal {
  width: 460px; max-width: 92vw;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
  display: flex; flex-direction: column; overflow: hidden;
}
.lic-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 20px 22px 16px; border-bottom: 1px solid var(--border);
}
.lic-title { font-size: 18px; font-weight: 600; color: var(--text-hi, var(--text)); }
.lic-sub { font-size: 12.5px; color: var(--text-dim); margin-top: 3px; }
.lic-close { background: none; border: none; color: var(--text-dim); font-size: 15px; cursor: pointer; line-height: 1; }
.lic-close:hover { color: var(--text); }

.lic-body { padding: 18px 22px 4px; }
.lic-desc { margin: 0 0 16px; font-size: 13.5px; line-height: 1.55; color: var(--text-dim); }
.lic-label { display: block; font-size: 12px; color: var(--text-dim); margin-bottom: 6px; }
.lic-input {
  width: 100%; height: 40px; padding: 0 12px;
  background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); font-size: 14px; font-family: 'SF Mono', ui-monospace, Menlo, monospace;
}
.lic-input:focus { outline: none; border-color: var(--accent); }
.lic-error { color: var(--err); font-size: 12.5px; margin: 10px 0 0; }
.lic-hint { font-size: 11.5px; color: var(--text-faint, var(--text-dim)); margin: 14px 0 4px; }

.lic-foot {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 22px 20px;
}
.lic-btn {
  height: 36px; padding: 0 16px; border-radius: 8px; font-size: 13.5px; font-weight: 500;
  cursor: pointer; font-family: inherit; border: 1px solid transparent;
}
.lic-btn.ghost { background: transparent; border-color: var(--border); color: var(--text); }
.lic-btn.ghost:hover { border-color: var(--border-strong); }
.lic-btn.primary { background: var(--accent); color: #fff; }
.lic-btn.primary:hover:not(:disabled) { background: var(--accent-dim); }
.lic-btn.primary:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
