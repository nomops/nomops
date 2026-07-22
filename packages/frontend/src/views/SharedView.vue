<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type CredentialView, type WorkflowRow } from '../api/client.js';
import { credentialIcon } from '../lib/icons.js';
import IconSvg from '../components/IconSvg.vue';

/**
 * Shared with you — 对标基线 /shared/workflows | /shared/credentials。
 * backlog #12:接真数据——共享**给**当前项目的资源(受享侧,role != owner)。
 */
const route = useRoute();
const router = useRouter();
const tab = computed<'workflows' | 'credentials'>(() => (route.path.includes('credentials') ? 'credentials' : 'workflows'));
const noun = computed(() => (tab.value === 'credentials' ? 'credential' : 'workflow'));

const workflows = ref<WorkflowRow[]>([]);
const credentials = ref<CredentialView[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const [wfs, creds] = await Promise.all([
      api.shared.workflows().catch(() => [] as WorkflowRow[]),
      api.shared.credentials().catch(() => [] as CredentialView[]),
    ]);
    workflows.value = wfs.filter((w) => !w.archived);
    credentials.value = creds;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(tab, () => void load());

const isEmpty = computed(() =>
  tab.value === 'workflows' ? workflows.value.length === 0 : credentials.value.length === 0,
);

const fmtWhen = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString() : '—');

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

    <!-- 受享清单（真数据;受享方可开可跑,删除/再共享仍归 owner 项目） -->
    <template v-if="!loading && !isEmpty">
      <div v-if="tab === 'workflows'" class="rows" data-test="shared-workflows">
        <RouterLink v-for="w in workflows" :key="w.id" class="row" :to="`/workflow/${w.id}`" :data-test-shared-wf="w.id">
          <span class="row-name">{{ w.name }}</span>
          <span class="row-meta dim">Last updated {{ fmtWhen(w.updatedAt) }}</span>
        </RouterLink>
      </div>
      <div v-else class="rows" data-test="shared-credentials">
        <div v-for="c in credentials" :key="c.id" class="row" :data-test-shared-cred="c.id">
          <IconSvg :svg="credentialIcon(c.type).svg" :color="credentialIcon(c.type).color" :size="18" />
          <span class="row-name">{{ c.name }}</span>
          <span class="row-meta dim">{{ c.type }} · usable in your workflows — the secret stays hidden</span>
        </div>
      </div>
    </template>

    <div v-else-if="!loading" class="empty" data-test="shared-empty">
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
.rows { display: flex; flex-direction: column; gap: 8px; }
.row {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg-panel); color: var(--text); text-decoration: none;
}
.row:hover { border-color: var(--border-strong); }
.row-name { font-weight: var(--font-weight--medium); color: var(--color--text--shade-1); }
.row-meta { margin-left: auto; font-size: var(--font-size--2xs); }
.empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 96px 24px; text-align: center;
}
.empty-text { margin: 0; font-size: var(--font-size--md); color: var(--text-dim); }
.back { font-size: var(--font-size--sm); }
</style>
