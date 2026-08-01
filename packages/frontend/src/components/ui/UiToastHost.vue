<script setup lang="ts">
import { useUiStore } from '../../stores/ui.js';

const ui = useUiStore();
</script>

<template>
  <div class="toast-region" aria-live="polite" aria-label="Notifications" data-test="toast-region">
    <TransitionGroup name="toast-list">
      <article v-for="toast in ui.toasts" :key="toast.id" class="ui-toast" :class="toast.kind" :data-test-toast="toast.kind">
        <span class="toast-icon" aria-hidden="true">
          <svg v-if="toast.kind === 'success'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>
          <svg v-else-if="toast.kind === 'error'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></svg>
          <svg v-else-if="toast.kind === 'warning'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v5M12 17h.01" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>
        </span>
        <span class="toast-copy">
          <strong>{{ toast.title }}</strong>
          <span v-if="toast.message">{{ toast.message }}</span>
        </span>
        <button type="button" class="toast-close" aria-label="Dismiss notification" @click="ui.dismissToast(toast.id)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </article>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-region {
  position: fixed; top: calc(var(--spacing--sm) + var(--toast--offset)); right: calc(var(--spacing--sm) + var(--toast--right));
  z-index: var(--toasts--z); width: min(380px, calc(100vw - 32px));
  display: flex; flex-direction: column; gap: var(--spacing--2xs); pointer-events: none;
}
.ui-toast {
  min-height: 56px; padding: var(--spacing--xs); display: flex; align-items: flex-start; gap: var(--spacing--2xs);
  pointer-events: auto; background: var(--notification--color--background);
  border: var(--border-width) var(--border-style) var(--border-color--strong);
  border-left-width: 3px; border-radius: var(--radius--lg); box-shadow: var(--shadow--md);
}
.ui-toast.success { border-left-color: var(--color--success); }
.ui-toast.error { border-left-color: var(--color--danger); }
.ui-toast.warning { border-left-color: var(--color--warning); }
.ui-toast.info { border-left-color: var(--color--primary); }
.toast-icon { width: 20px; height: 20px; flex: none; color: var(--color--primary); }
.success .toast-icon { color: var(--color--success); }
.error .toast-icon { color: var(--color--danger); }
.warning .toast-icon { color: var(--color--warning); }
.toast-icon svg { width: 20px; height: 20px; }
.toast-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: var(--spacing--4xs); }
.toast-copy strong { color: var(--color--text--shade-1); font-size: var(--font-size--sm); font-weight: var(--font-weight--bold); line-height: var(--line-height--md); }
.toast-copy > span { color: var(--color--text--tint-1); font-size: var(--font-size--xs); line-height: var(--line-height--lg); }
.toast-close { width: 24px; height: 24px; padding: 0; border: none; background: transparent; color: var(--color--text--tint-1); }
.toast-close:hover { background: var(--background--hover); color: var(--color--text--shade-1); }
.toast-close svg { width: 14px; height: 14px; display: block; margin: auto; }
.toast-list-enter-active, .toast-list-leave-active { transition: opacity var(--duration--snappy) ease, transform var(--duration--snappy) ease; }
.toast-list-enter-from, .toast-list-leave-to { opacity: 0; transform: translateX(12px); }
@media (max-width: 640px) { .toast-region { left: var(--spacing--sm); right: var(--spacing--sm); width: auto; } }
@media (prefers-reduced-motion: reduce) { .toast-list-enter-active, .toast-list-leave-active { transition: none; } }
</style>
