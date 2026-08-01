<script setup lang="ts">
import { ref, watch } from 'vue';
import { api, type LicenseInfo } from '../api/client.js';
import UiDialog from './ui/UiDialog.vue';

/** 许可证激活弹窗。 */
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
  <UiDialog
    :open="open"
    title="Activate your plan"
    description="Unlock Enterprise features on this instance"
    width="460px"
    test-id="license-modal"
    :close-on-overlay="!busy"
    :close-on-escape="!busy"
    @close="emit('close')"
  >
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

        <p v-if="error" class="lic-error" data-test="license-error" role="alert">{{ error }}</p>

        <p class="lic-hint">
          Don’t have a key? Talk to us about an Enterprise plan or a trial.
        </p>
      </div>

      <template #footer>
        <button class="lic-btn ghost" data-test="license-cancel" @click="emit('close')">Cancel</button>
        <button class="lic-btn primary" data-test="license-activate" :disabled="busy" @click="activate">
          {{ busy ? 'Activating…' : 'Activate' }}
        </button>
      </template>
  </UiDialog>
</template>

<style scoped>
.lic-body { padding: 0 0 4px; }
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
