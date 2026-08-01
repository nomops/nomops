<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  open: boolean;
  title?: string;
  description?: string;
  width?: string;
  closeOnOverlay?: boolean;
  closeOnEscape?: boolean;
  testId?: string;
}>(), {
  title: '',
  description: '',
  width: '440px',
  closeOnOverlay: true,
  closeOnEscape: true,
  testId: 'ui-dialog-overlay',
});

const emit = defineEmits<{ (event: 'close'): void }>();
const panel = ref<HTMLElement | null>(null);
const titleId = `ui-dialog-title-${Math.random().toString(36).slice(2)}`;
const descriptionId = `ui-dialog-description-${Math.random().toString(36).slice(2)}`;
let previouslyFocused: HTMLElement | null = null;

const labelledBy = computed(() => props.title ? titleId : undefined);
const describedBy = computed(() => props.description ? descriptionId : undefined);

function close() {
  emit('close');
}

function onOverlay() {
  if (props.closeOnOverlay) close();
}

function focusableElements() {
  return Array.from(panel.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ) ?? []);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.closeOnEscape) {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = focusableElements();
  if (!focusable.length) {
    event.preventDefault();
    panel.value?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      await nextTick();
      const autofocus = panel.value?.querySelector<HTMLElement>('[autofocus]');
      (autofocus ?? focusableElements()[0] ?? panel.value)?.focus();
    } else {
      previouslyFocused?.focus();
      previouslyFocused = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => previouslyFocused?.focus());
</script>

<template>
  <Transition name="ui-dialog-fade">
    <div v-if="open" class="ui-dialog-overlay" :data-test="testId" @mousedown.self="onOverlay">
      <section
        ref="panel"
        class="ui-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="labelledBy"
        :aria-describedby="describedBy"
        :style="{ width }"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <header v-if="title || $slots.header" class="ui-dialog-header">
          <slot name="header">
            <div class="ui-dialog-heading">
              <h2 :id="titleId">{{ title }}</h2>
              <p v-if="description" :id="descriptionId">{{ description }}</p>
            </div>
          </slot>
          <button type="button" class="ui-dialog-close" aria-label="Close" data-test="ui-dialog-close" @click="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div class="ui-dialog-body"><slot /></div>
        <footer v-if="$slots.footer" class="ui-dialog-footer"><slot name="footer" /></footer>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.ui-dialog-overlay {
  position: fixed; inset: 0; z-index: var(--modals--z);
  display: flex; align-items: center; justify-content: center;
  padding: var(--spacing--lg); background: var(--dialog--overlay--color--background);
}
.ui-dialog {
  max-width: 100%; max-height: calc(100vh - 48px); overflow: hidden;
  display: flex; flex-direction: column;
  background: var(--dialog--color--background);
  border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius--lg); box-shadow: var(--shadow--xl);
}
.ui-dialog:focus { outline: none; }
.ui-dialog-header {
  min-height: 64px; padding: var(--spacing--sm) var(--spacing--lg);
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--spacing--sm);
  border-bottom: var(--border-width) var(--border-style) var(--border-color);
}
.ui-dialog-heading { min-width: 0; }
.ui-dialog-heading h2 {
  margin: 0; color: var(--color--text--shade-1);
  font-size: var(--font-size--lg); font-weight: var(--font-weight--bold); line-height: var(--line-height--md);
}
.ui-dialog-heading p {
  margin: var(--spacing--4xs) 0 0; color: var(--color--text--tint-1);
  font-size: var(--font-size--xs); line-height: var(--line-height--lg);
}
.ui-dialog-close {
  width: 28px; height: 28px; padding: 0; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--color--text--tint-1);
}
.ui-dialog-close:hover { background: var(--background--hover); color: var(--color--text--shade-1); }
.ui-dialog-close svg { width: 16px; height: 16px; }
.ui-dialog-body { padding: var(--spacing--lg); overflow-y: auto; }
.ui-dialog-footer {
  padding: var(--spacing--sm) var(--spacing--lg); display: flex; justify-content: flex-end; gap: var(--spacing--2xs);
  border-top: var(--border-width) var(--border-style) var(--border-color);
}
.ui-dialog-fade-enter-active, .ui-dialog-fade-leave-active { transition: opacity var(--duration--snappy) ease; }
.ui-dialog-fade-enter-active .ui-dialog, .ui-dialog-fade-leave-active .ui-dialog { transition: transform var(--duration--snappy) ease; }
.ui-dialog-fade-enter-from, .ui-dialog-fade-leave-to { opacity: 0; }
.ui-dialog-fade-enter-from .ui-dialog, .ui-dialog-fade-leave-to .ui-dialog { transform: translateY(-4px) scale(.99); }
@media (max-width: 640px) {
  .ui-dialog-overlay { align-items: flex-end; padding: 0; }
  .ui-dialog { width: 100% !important; max-height: calc(100vh - 24px); border-radius: var(--radius--lg) var(--radius--lg) 0 0; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-dialog-fade-enter-active, .ui-dialog-fade-leave-active,
  .ui-dialog-fade-enter-active .ui-dialog, .ui-dialog-fade-leave-active .ui-dialog { transition: none; }
}
</style>
