<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/**
 * Shared with you — 对标基线 /shared/workflows | /shared/credentials。
 * nomops 自托管暂无跨用户共享数据,恒空态(对齐基线 Community 空态)。
 */
const route = useRoute();
const router = useRouter();
const tab = computed<'workflows' | 'credentials'>(() => (route.path.includes('credentials') ? 'credentials' : 'workflows'));
const noun = computed(() => (tab.value === 'credentials' ? 'credential' : 'workflow'));

async function createWorkflow() {
  await router.push('/');
}
</script>

<template>
  <div class="shared">
    <header class="head">
      <div>
        <h1>Shared with you</h1>
        <p class="sub">Workflows and credentials other users have shared with you</p>
      </div>
      <button class="btn primary create" data-test="shared-create" @click="createWorkflow">Create workflow</button>
    </header>

    <div class="tabs-row">
      <RouterLink class="tab" :class="{ active: tab === 'workflows' }" to="/shared/workflows">Workflows</RouterLink>
      <RouterLink class="tab" :class="{ active: tab === 'credentials' }" to="/shared/credentials">Credentials</RouterLink>
    </div>

    <div v-if="tab === 'workflows'" class="notice" data-test="shared-archived-notice">
      Archived workflows are hidden in this view. <a href="#" class="link" @click.prevent>Update filters</a>
    </div>

    <div class="empty" data-test="shared-empty">
      <p class="empty-text">No {{ noun }} has been shared with you</p>
      <RouterLink class="link back" to="/" data-test="shared-back">Back to Personal</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.shared { padding: 24px 48px 40px; width: 100%; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
.head h1 { margin: 0; font-size: 20px; font-weight: var(--font-weight--bold); color: var(--color--text--shade-1); }
.sub { margin: 4px 0 0; font-size: var(--font-size--sm); color: var(--text-dim); }
.create { height: 32px; }
.tabs-row { display: flex; gap: var(--spacing--4xs); margin-bottom: 14px; }
.tabs-row .tab {
  background: none; border: none; border-bottom: 2px solid transparent; border-radius: 0;
  color: var(--color--text); padding: 0 var(--spacing--sm) 8px; font-size: var(--font-size--sm);
  font-weight: var(--font-weight--medium); text-decoration: none;
}
.tabs-row .tab.active { color: var(--color--primary); border-bottom-color: var(--color--primary); }
.notice {
  font-size: var(--font-size--sm); color: var(--text-dim);
  padding: 10px 14px; margin-bottom: 18px;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius);
}
.link { color: var(--accent); text-decoration: none; }
.link:hover { text-decoration: underline; }
.empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 96px 24px; text-align: center;
}
.empty-text { margin: 0; font-size: var(--font-size--md); color: var(--text-dim); }
.back { font-size: var(--font-size--sm); }
</style>
