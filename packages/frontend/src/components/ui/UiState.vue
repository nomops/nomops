<script setup lang="ts">
withDefaults(defineProps<{
  kind?: 'empty' | 'loading' | 'error';
  title: string;
  description?: string;
  compact?: boolean;
}>(), {
  kind: 'empty',
  description: '',
  compact: false,
});
</script>

<template>
  <div class="ui-state" :class="[{ compact }, kind]" :aria-busy="kind === 'loading'" :role="kind === 'error' ? 'alert' : 'status'">
    <span class="state-visual" aria-hidden="true">
      <span v-if="kind === 'loading'" class="spinner" />
      <svg v-else-if="kind === 'error'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6h16v12H4zM4 10h16" /><path d="M9 14h6" /></svg>
    </span>
    <strong>{{ title }}</strong>
    <p v-if="description">{{ description }}</p>
    <div v-if="$slots.default" class="state-actions"><slot /></div>
  </div>
</template>

<style scoped>
.ui-state {
  min-height: 240px; padding: var(--spacing--xl); display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center;
  border: var(--border-width) dashed var(--border-color); border-radius: var(--radius--lg);
  color: var(--color--text--tint-1);
}
.ui-state.compact { min-height: 144px; padding: var(--spacing--lg); }
.state-visual {
  width: 40px; height: 40px; margin-bottom: var(--spacing--xs); display: inline-flex; align-items: center; justify-content: center;
  color: var(--color--text--tint-1); background: var(--color--background--light-1); border-radius: var(--radius--lg);
}
.state-visual svg { width: 22px; height: 22px; }
.ui-state.error .state-visual { color: var(--color--danger); }
.ui-state strong { color: var(--color--text--shade-1); font-size: var(--font-size--sm); font-weight: var(--font-weight--bold); }
.ui-state p { max-width: 460px; margin: var(--spacing--2xs) 0 0; font-size: var(--font-size--xs); line-height: var(--line-height--xl); }
.state-actions { margin-top: var(--spacing--sm); display: flex; gap: var(--spacing--2xs); }
.spinner {
  width: 20px; height: 20px; border: 2px solid var(--border-color--strong); border-top-color: var(--color--primary);
  border-radius: 50%; animation: ui-state-spin .8s linear infinite;
}
@keyframes ui-state-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 1.8s; } }
</style>
