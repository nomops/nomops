<script setup lang="ts">
withDefaults(defineProps<{
  title: string;
  description?: string;
  width?: string;
}>(), {
  description: '',
  width: '352px',
});
</script>

<template>
  <main class="auth-page">
    <RouterLink class="auth-logo" to="/login" aria-label="nomops sign in">
      <svg class="logo-mark" viewBox="19 37 130 54" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="nomops-auth-brand" gradientUnits="userSpaceOnUse" x1="23" y1="64" x2="145" y2="64">
            <stop offset="0" stop-color="#22d3ee" />
            <stop offset="0.5" stop-color="#6366f1" />
            <stop offset="1" stop-color="#a855f7" />
          </linearGradient>
        </defs>
        <path d="M57 64C73.2 90 75.4 90 84 64C92.6 38 94.8 38 111 64" stroke="url(#nomops-auth-brand)" stroke-width="6.5" stroke-linecap="round" />
        <circle cx="40" cy="64" r="17" fill="url(#nomops-auth-brand)" />
        <circle cx="128" cy="64" r="17" fill="url(#nomops-auth-brand)" />
      </svg>
      <span>nomops</span>
    </RouterLink>

    <section class="auth-card" :style="{ width }">
      <header class="auth-heading">
        <h1>{{ title }}</h1>
        <p v-if="description">{{ description }}</p>
      </header>
      <slot />
    </section>

    <div v-if="$slots.below" class="auth-below"><slot name="below" /></div>
  </main>
</template>

<style scoped>
.auth-page {
  flex: 1; min-height: 100vh; padding: 35px var(--spacing--sm) var(--spacing--xl);
  display: flex; flex-direction: column; align-items: center;
  background: var(--auth-bg); color: var(--color--text);
}
.auth-logo {
  height: 52px; margin-bottom: 19px; display: inline-flex; align-items: center; gap: var(--spacing--2xs);
  color: var(--color--text--shade-1); text-decoration: none;
  font-size: 26px; font-weight: 700; letter-spacing: -.5px;
}
.logo-mark { width: 58px; height: 24px; }
.auth-card {
  max-width: 94vw; padding: var(--spacing--lg); box-sizing: border-box;
  background: var(--auth-card); border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius--lg); box-shadow: 0 4px 16px var(--color--purple-alpha-100);
}
.auth-heading { margin-bottom: var(--spacing--xl); text-align: center; }
.auth-heading h1 {
  margin: 0; color: var(--color--text--shade-1);
  font-size: var(--font-size--xl); font-weight: var(--font-weight--regular); line-height: var(--line-height--sm);
}
.auth-heading p {
  margin: var(--spacing--2xs) 0 0; color: var(--color--text--tint-1);
  font-size: var(--font-size--xs); line-height: var(--line-height--xl);
}
.auth-below { width: 352px; max-width: 94vw; margin-top: var(--spacing--sm); text-align: center; }

:deep(.auth-form) { display: flex; flex-direction: column; }
:deep(.auth-label) {
  display: block; margin: var(--spacing--sm) 0 0; padding-bottom: var(--spacing--2xs);
  color: var(--color--text--shade-1); font-size: var(--font-size--sm);
  font-weight: var(--font-weight--medium); line-height: var(--line-height--lg);
}
:deep(.auth-label:first-child) { margin-top: 0; }
:deep(.auth-required) { color: var(--color--primary); }
:deep(.auth-input) {
  width: 100%; height: 36px; padding: 0 var(--spacing--xs); box-sizing: border-box;
  background: var(--color--background--light-2); color: var(--color--text--shade-1);
  border: none; border-radius: var(--radius--md); box-shadow: inset 0 0 0 1px var(--border-color);
  font-family: inherit; font-size: var(--font-size--sm);
}
:deep(.auth-input:focus) { outline: none; box-shadow: inset 0 0 0 1px var(--color--purple-500); }
:deep(.auth-input[readonly]) { color: var(--color--text--tint-1); cursor: default; }
:deep(.auth-hint) {
  margin: var(--spacing--3xs) 0 0; color: var(--color--text--tint-1);
  font-size: var(--font-size--2xs); line-height: var(--line-height--lg);
}
:deep(.auth-submit-row) { display: flex; justify-content: center; margin-top: var(--spacing--xl); }
:deep(.auth-submit) { min-width: 78px; height: 36px; }
:deep(.auth-link) {
  display: block; margin-top: var(--spacing--sm); text-align: center;
  color: var(--color--primary); font-size: var(--font-size--sm); line-height: var(--line-height--lg); text-decoration: none;
}
:deep(.auth-link:hover) { text-decoration: underline; }
:deep(.auth-divider) {
  margin: var(--spacing--sm) 0 0; display: flex; align-items: center; gap: var(--spacing--2xs);
  color: var(--color--text--tint-1); font-size: var(--font-size--2xs);
}
:deep(.auth-divider::before), :deep(.auth-divider::after) { content: ''; height: 1px; flex: 1; background: var(--border-color); }
:deep(.auth-notice) {
  margin: 0 0 var(--spacing--sm); padding: var(--spacing--xs);
  border: var(--border-width) var(--border-style) var(--border-color--strong); border-radius: var(--radius);
  color: var(--color--text); font-size: var(--font-size--xs); line-height: var(--line-height--xl);
}
:deep(.auth-notice.success) { border-color: var(--border-color--success); background: var(--background--success); color: var(--text-color--success); }
:deep(.auth-notice.error) { margin-top: var(--spacing--xs); margin-bottom: 0; border-color: var(--border-color--danger); background: var(--background--danger); color: var(--text-color--danger); }
:deep(.auth-spinner) {
  width: 24px; height: 24px; margin: 0 auto var(--spacing--sm); display: block;
  border: 2px solid var(--border-color--strong); border-top-color: var(--color--primary); border-radius: 50%;
  animation: auth-spin .8s linear infinite;
}
@keyframes auth-spin { to { transform: rotate(360deg); } }
@media (max-width: 520px) {
  .auth-page { justify-content: flex-start; padding-top: var(--spacing--lg); }
  .auth-logo { margin-bottom: var(--spacing--sm); }
  .auth-card { width: 100% !important; max-width: 400px; }
}
@media (prefers-reduced-motion: reduce) { :deep(.auth-spinner) { animation-duration: 1.8s; } }
</style>
