<script setup lang="ts">
import { computed } from 'vue';

/**
 * Insights — 对标 n8n 2.30.4 Community:锁态。
 * H1 "Insights" + 日期范围 chip + 升级锁块(Upgrade to access more detailed insights)。
 * 说明:nomops 后端 /api/insights 仍在(未删),此处仅前端按 1:1 呈现 n8n 的锁态。
 */
const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d: Date) => `${d.getDate()} ${mon[d.getMonth()]}`;
const rangeLabel = computed(() => {
  const to = new Date();
  const from = new Date(Date.now() - 7 * 86_400_000);
  return `${fmt(from)} - ${fmt(to)}, ${to.getFullYear()}`;
});
</script>

<template>
  <div class="page-wrap">
    <header class="head">
      <h1>Insights</h1>
      <button class="range-btn" data-test="insights-range">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i15"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
        {{ rangeLabel }}
      </button>
    </header>

    <section class="lock" data-test="insights-lock">
      <svg class="lock-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
      <h2 class="lock-title">Upgrade to access more detailed insights</h2>
      <p class="lock-desc">Gain access to more granular, per-workflow insights and visual breakdown of production executions over different time periods.</p>
      <button class="btn-upgrade" data-test="insights-upgrade">Upgrade</button>
    </section>
  </div>
</template>

<style scoped>
.page-wrap { padding: 22px 26px 40px; width: 100%; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
.head h1 { margin: 0; font-size: 20px; font-weight: var(--font-weight--bold); letter-spacing: -0.2px; color: var(--color--text--shade-1); }
.range-btn {
  display: inline-flex; align-items: center; gap: 9px;
  height: 32px; padding: 0 14px; font-size: var(--font-size--sm); border-radius: var(--radius);
  background: none; border: var(--border-width) var(--border-style) var(--border-color); color: var(--color--text); cursor: pointer;
}

/* 升级锁块(对标 n8n Community Insights) */
.lock {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  gap: 12px; padding: 96px 24px; max-width: 460px; margin: 0 auto;
}
.lock-ico { width: 40px; height: 40px; color: var(--color--text--tint-1); }
.lock-title { margin: 4px 0 0; font-size: var(--font-size--lg); font-weight: var(--font-weight--bold); color: var(--color--text--shade-1); }
.lock-desc { margin: 0; font-size: var(--font-size--sm); line-height: 1.5; color: var(--color--text--tint-1); }
.btn-upgrade {
  margin-top: 8px; height: 36px; padding: 0 16px; border: none; border-radius: 6px;
  background: var(--button--color--background--primary); color: var(--button--color--text--primary);
  font-size: var(--font-size--sm); font-weight: var(--font-weight--medium); cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--button--border-color--primary), 0 1px 3px -1px var(--color--black-alpha-100);
}
.btn-upgrade:hover { background: var(--button--color--background--primary--hover-active-focus); }
</style>
