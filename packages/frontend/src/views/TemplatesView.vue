<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import UiState from '../components/ui/UiState.vue';
import { useUiStore } from '../stores/ui.js';

/** 实例内模板库（docs/10 B1）：画廊 + 搜索/分类 + 一键导入进画布。 */
type TemplateSummary = Awaited<ReturnType<typeof api.templates.list>>[number];

const router = useRouter();
const ui = useUiStore();
const templates = ref<TemplateSummary[]>([]);
const search = ref('');
const category = ref<string | null>(null);
const importing = ref<string | null>(null);
const error = ref('');
const loading = ref(true);

async function load() {
  loading.value = true;
  error.value = '';
  try { templates.value = await api.templates.list(); }
  catch (e) { error.value = (e as Error).message; }
  finally { loading.value = false; }
}
onMounted(load);

const categories = computed(() => [...new Set(templates.value.map((t) => t.category))]);
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return templates.value.filter(
    (t) =>
      (!category.value || t.category === category.value) &&
      (!q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)),
  );
});

async function useTemplate(id: string) {
  error.value = '';
  importing.value = id;
  try {
    const template = templates.value.find((entry) => entry.id === id);
    const wf = await api.templates.import(id);
    ui.notify({ kind: 'success', title: 'Template imported', message: wf.name });
    if (template?.credentialRequirements.length) {
      void router.push({
        name: 'templateSetup',
        params: { id },
        query: { workflow: wf.id },
      });
    } else {
      void router.push({ name: 'canvas', params: { id: wf.id } });
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    importing.value = null;
  }
}
</script>

<template>
  <div class="page-wrap">
    <!-- ── Header ── -->
    <div class="tpl-head">
      <h1>Templates</h1>
      <p class="tpl-sub">
        {{ templates.length }} built-in templates — import one to get a ready-to-run workflow
      </p>
    </div>

    <!-- ── Search + category filter ── -->
    <div class="tpl-controls">
      <input
        v-model="search"
        data-test="tpl-search"
        class="tpl-search"
        placeholder="Search templates"
      />
      <div class="cat-row">
        <button
          class="cat-pill"
          :class="{ active: category === null }"
          data-test="tpl-cat-all"
          @click="category = null"
        >
          All
        </button>
        <button
          v-for="c in categories"
          :key="c"
          class="cat-pill"
          :class="{ active: category === c }"
          :data-test-tpl-cat="c"
          @click="category = c"
        >
          {{ c }}
        </button>
      </div>
    </div>

    <UiState v-if="loading" kind="loading" title="Loading templates" description="Preparing the built-in workflow gallery." />
    <UiState v-else-if="error" kind="error" title="Could not load templates" :description="error" data-test="tpl-error">
      <button type="button" @click="load">Retry</button>
    </UiState>

    <!-- ── Template grid ── -->
    <div v-else class="tpl-grid" data-test="tpl-grid">
      <div v-for="t in filtered" :key="t.id" class="tpl-card" :data-test-template="t.id">
        <div class="tpl-card-head">
          <span class="tpl-name">{{ t.name }}</span>
          <span class="owner-chip">{{ t.category }}</span>
        </div>
        <p class="tpl-desc">{{ t.description }}</p>
        <div v-if="t.nodeTags.length" class="tpl-tags">
          <code v-for="tag in t.nodeTags" :key="tag" class="node-tag">{{ tag }}</code>
        </div>
        <ul v-if="t.setupHints.length" class="hints">
          <li v-for="h in t.setupHints" :key="h">{{ h }}</li>
        </ul>
        <button
          class="primary use-btn"
          :data-test-use-template="t.id"
          :disabled="importing === t.id"
          @click="useTemplate(t.id)"
        >
          {{ importing === t.id ? 'Importing…' : 'Use template' }}
        </button>
      </div>
    </div>

    <UiState v-if="!loading && !error && filtered.length === 0" compact :title="templates.length ? 'No matching templates' : 'No templates available'" :description="templates.length ? 'Try another search term or category.' : 'Built-in templates will appear here when the server provides them.'">
      <button v-if="templates.length" type="button" @click="search = ''; category = null">Clear filters</button>
    </UiState>
  </div>
</template>

<style scoped>
.page-wrap { padding: 22px 26px 40px; width: 100%; }

/* Header */
.tpl-head { margin-bottom: 18px; }
.tpl-head h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.2px; color: var(--text-hi); }
.tpl-sub { margin: 4px 0 0; color: var(--text-dim); font-size: 14px; }

/* Search + category filter */
.tpl-controls { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
.tpl-search { width: 100%; max-width: 360px; height: 34px; }
.cat-row { display: flex; gap: 8px; flex-wrap: wrap; }
.cat-pill {
  padding: 5px 14px; border-radius: 999px; font-size: 13px;
  background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-dim);
}
.cat-pill:hover { border-color: var(--border-strong); color: var(--text); }
.cat-pill.active {
  background: var(--accent); border-color: var(--accent); color: #fff;
}
.cat-pill.active:hover { background: var(--accent-dim); border-color: var(--accent-dim); color: #fff; }

/* Grid */
.tpl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.tpl-card {
  display: flex; flex-direction: column;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 18px 20px;
}
.tpl-card:hover { border-color: var(--border-strong); }

.tpl-card-head { display: flex; align-items: center; gap: 10px; }
.tpl-name { font-size: 15px; font-weight: 600; color: var(--text-hi); }
.tpl-desc { font-size: 13px; color: var(--text-dim); margin: 8px 0 12px; line-height: 1.5; }

.tpl-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.node-tag {
  background: var(--bg-input); border: 1px solid var(--border); padding: 2px 8px; border-radius: 4px;
  font-size: 11.5px; color: var(--text-dim);
}
.hints { font-size: 12px; color: var(--text-dim); margin: 0 0 14px; padding-left: 16px; line-height: 1.6; }

.use-btn { width: 100%; margin-top: auto; }

.tpl-empty { color: var(--text-dim); text-align: center; padding: 40px; font-size: 14px; }

@media (max-width: 900px) { .tpl-grid { grid-template-columns: 1fr; } }
</style>
