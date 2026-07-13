<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, type CredentialView, type WorkflowRow } from '../../api/client.js';
import { useUiStore } from '../../stores/ui.js';

/** 命令面板：全局搜索工作流 + 凭证 + 快捷动作。⌘K / 点搜索打开。 */
const ui = useUiStore();
const router = useRouter();

const query = ref('');
const workflows = ref<WorkflowRow[]>([]);
const credentials = ref<CredentialView[]>([]);
const loaded = ref(false);
const active = ref(0);
const inputEl = ref<HTMLInputElement>();

watch(
  () => ui.paletteOpen,
  async (open) => {
    if (!open) return;
    query.value = '';
    active.value = 0;
    await nextTick();
    inputEl.value?.focus();
    if (!loaded.value) {
      const [wf, cred] = await Promise.all([
        api.workflows.list().catch(() => []),
        api.credentials.list().catch(() => []),
      ]);
      workflows.value = wf;
      credentials.value = cred;
      loaded.value = true;
    }
  },
);

interface Item {
  kind: 'action' | 'workflow' | 'credential';
  icon: string;
  label: string;
  sub: string;
  run: () => void;
}

const actions = computed<Item[]>(() => [
  { kind: 'action', icon: '＋', label: 'New workflow', sub: 'Action', run: createWorkflow },
  { kind: 'action', icon: '🔑', label: 'New credential', sub: 'Action', run: () => go('/?tab=credentials') },
  { kind: 'action', icon: '📋', label: 'View executions', sub: 'Action', run: () => go('/?tab=executions') },
]);

const results = computed<Item[]>(() => {
  const q = query.value.trim().toLowerCase();
  const wfItems: Item[] = workflows.value
    .filter((w) => !q || w.name.toLowerCase().includes(q))
    .map((w) => ({
      kind: 'workflow',
      icon: '🔀',
      label: w.name,
      sub: `Workflow · ${w.nodes.length} nodes`,
      run: () => go(`/workflow/${w.id}`),
    }));
  const credItems: Item[] = credentials.value
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .map((c) => ({
      kind: 'credential',
      icon: '🔑',
      label: c.name,
      sub: `Credential · ${c.type}`,
      run: () => go('/?tab=credentials'),
    }));
  const acts = q ? actions.value.filter((a) => a.label.toLowerCase().includes(q)) : actions.value;
  return [...acts, ...wfItems, ...credItems];
});

watch(results, () => {
  active.value = 0;
});

function go(path: string) {
  ui.closePalette();
  void router.push(path);
}

async function createWorkflow() {
  ui.closePalette();
  const wf = await api.workflows.create({ name: 'My workflow', nodes: [], connections: {} });
  void router.push(`/workflow/${wf.id}`);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    active.value = Math.min(active.value + 1, results.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = Math.max(active.value - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    results.value[active.value]?.run();
  } else if (e.key === 'Escape') {
    ui.closePalette();
  }
}
</script>

<template>
  <div v-if="ui.paletteOpen" class="palette-overlay" data-test="command-palette" @click.self="ui.closePalette()">
    <div class="palette">
      <div class="palette-search">
        <span class="search-icon">🔍</span>
        <input
          ref="inputEl"
          v-model="query"
          data-test="palette-input"
          placeholder="Search workflows, credentials, or run an action…"
          @keydown="onKey"
        />
        <span class="kbd">esc</span>
      </div>
      <div class="palette-list">
        <button
          v-for="(item, i) in results"
          :key="item.kind + item.label + i"
          class="palette-item"
          :class="{ active: i === active }"
          :data-test-palette-item="item.label"
          @mouseenter="active = i"
          @click="item.run()"
        >
          <span class="pi-icon">{{ item.icon }}</span>
          <span class="pi-body">
            <span class="pi-label">{{ item.label }}</span>
            <span class="pi-sub">{{ item.sub }}</span>
          </span>
        </button>
        <p v-if="results.length === 0" class="dim" style="padding: 20px; text-align: center">No results</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette-overlay {
  position: fixed; inset: 0; z-index: 80;
  background: rgba(0, 0, 0, 0.5);
  display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh;
}
.palette {
  width: 560px; max-width: 92vw;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 12px;
  overflow: hidden; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
.palette-search { position: relative; display: flex; align-items: center; border-bottom: 1px solid var(--border); }
.palette-search .search-icon { position: absolute; left: 14px; font-size: 13px; opacity: 0.6; }
.palette-search input {
  flex: 1; background: none; border: none; border-radius: 0;
  padding: 14px 14px 14px 38px; font-size: 15px;
}
.palette-search input:focus { outline: none; }
.kbd {
  margin-right: 12px; font-size: 11px; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px;
}
.palette-list { max-height: 380px; overflow-y: auto; padding: 6px; }
.palette-item {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
  padding: 9px 10px; border: none; background: none; border-radius: 8px;
}
.palette-item.active { background: var(--bg-hover); }
.pi-icon {
  width: 30px; height: 30px; flex-shrink: 0; border-radius: 7px;
  background: var(--bg-input); display: flex; align-items: center; justify-content: center; font-size: 14px;
}
.pi-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pi-label { font-size: 13.5px; color: var(--text); }
.pi-sub { font-size: 11.5px; color: var(--text-dim); margin-top: 1px; }
</style>
