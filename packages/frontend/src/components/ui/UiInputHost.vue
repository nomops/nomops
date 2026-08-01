<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useUiStore } from '../../stores/ui.js';
import UiDialog from './UiDialog.vue';

const ui = useUiStore();
const request = computed(() => ui.inputDialog);
const draft = ref('');

watch(request, (next) => {
  draft.value = next?.value ?? '';
});

function submit() {
  const value = draft.value.trim();
  if (value) ui.resolveInput(value);
}
</script>

<template>
  <UiDialog
    :open="Boolean(request)"
    :title="request?.title"
    :description="request?.message"
    width="480px"
    test-id="input-dialog"
    @close="ui.resolveInput(null)"
  >
    <label class="input-field">
      <span>{{ request?.label }}</span>
      <input v-model="draft" autofocus :placeholder="request?.placeholder" data-test="input-dialog-field" @keyup.enter="submit" />
    </label>
    <template #footer>
      <button type="button" data-test="input-dialog-cancel" @click="ui.resolveInput(null)">Cancel</button>
      <button type="button" class="primary" data-test="input-dialog-submit" :disabled="!draft.trim()" @click="submit">
        {{ request?.submitLabel ?? 'Save' }}
      </button>
    </template>
  </UiDialog>
</template>

<style scoped>
.input-field { display: flex; flex-direction: column; gap: var(--spacing--2xs); color: var(--color--text); font-size: var(--font-size--xs); }
.input-field input { width: 100%; }
</style>
