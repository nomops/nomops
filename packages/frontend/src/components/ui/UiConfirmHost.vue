<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '../../stores/ui.js';
import UiDialog from './UiDialog.vue';

const ui = useUiStore();
const request = computed(() => ui.confirmDialog);
</script>

<template>
  <UiDialog
    :open="Boolean(request)"
    :title="request?.title"
    width="440px"
    data-test="confirm-dialog"
    @close="ui.resolveConfirm(false)"
  >
    <p class="confirm-message">{{ request?.message }}</p>
    <template #footer>
      <button type="button" data-test="confirm-cancel" @click="ui.resolveConfirm(false)">
        {{ request?.cancelLabel ?? 'Cancel' }}
      </button>
      <button
        type="button"
        class="primary"
        :class="{ danger: request?.tone === 'danger' }"
        data-test="confirm-submit"
        autofocus
        @click="ui.resolveConfirm(true)"
      >
        {{ request?.confirmLabel ?? 'Confirm' }}
      </button>
    </template>
  </UiDialog>
</template>

<style scoped>
.confirm-message {
  margin: 0; color: var(--color--text); font-size: var(--font-size--sm); line-height: var(--line-height--xl);
  white-space: pre-line;
}
button.danger {
  background: var(--color--danger); color: var(--color--neutral-white);
  box-shadow: inset 0 0 0 1px var(--button--border-color--danger), var(--shadow--xs);
}
button.danger:hover { background: var(--color--danger--shade-1); }
</style>
