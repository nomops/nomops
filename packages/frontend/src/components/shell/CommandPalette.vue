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
  kind: 'action' | 'workflow' | 'credential' | 'context';
  icon: string;
  label: string;
  sub: string;
  shortcut?: string;
  run: () => void;
}

/** 分组结构对齐 n8n 命令面板：Workflows(建/开) / Credentials(建/开) 各成组，
    上下文命令(画布注入)按其组名单独成组置顶。 */
interface Group {
  label: string;
  items: Item[];
}

const groups = computed<Group[]>(() => {
  const q = query.value.trim().toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);

  const ctxItems: Item[] = ui.paletteContext
    .filter((c) => match(c.label))
    .map((c) => ({
      kind: 'context',
      icon: '⌁',
      label: c.label,
      sub: c.group,
      shortcut: c.shortcut,
      run: () => {
        ui.closePalette();
        c.run();
      },
    }));

  const wfGroup: Item[] = [
    ...(match('Create workflow') ? [{ kind: 'action' as const, icon: '＋', label: 'Create workflow', sub: '', run: createWorkflow }] : []),
    ...workflows.value.filter((w) => match(w.name)).map((w) => ({
      kind: 'workflow' as const,
      icon: '🔀',
      label: w.name,
      sub: `${w.nodes.length} nodes`,
      run: () => go(`/workflow/${w.id}`),
    })),
  ];

  const credGroup: Item[] = [
    ...(match('Create credential') ? [{ kind: 'action' as const, icon: '＋', label: 'Create credential', sub: '', run: () => go('/?tab=credentials') }] : []),
    ...credentials.value.filter((c) => match(c.name)).map((c) => ({
      kind: 'credential' as const,
      icon: '🔑',
      label: c.name,
      sub: c.type,
      run: () => go('/?tab=credentials'),
    })),
  ];

  const execGroup: Item[] = match('View executions')
    ? [{ kind: 'action', icon: '📋', label: 'View executions', sub: '', run: () => go('/?tab=executions') }]
    : [];

  const out: Group[] = [];
  if (ctxItems.length) out.push({ label: ui.paletteContext[0]?.group ?? 'Commands', items: ctxItems });
  if (wfGroup.length) out.push({ label: 'Workflows', items: wfGroup });
  if (credGroup.length) out.push({ label: 'Credentials', items: credGroup });
  if (execGroup.length) out.push({ label: 'Executions', items: execGroup });
  return out;
});

const results = computed<Item[]>(() => groups.value.flatMap((g) => g.items));

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
        <input
          ref="inputEl"
          v-model="query"
          data-test="palette-input"
          placeholder="Type a command or search..."
          @keydown="onKey"
        />
        <span class="kbd">esc</span>
      </div>
      <div class="palette-list">
        <template v-for="g in groups" :key="g.label">
          <div class="palette-group-label">{{ g.label }}</div>
          <button
            v-for="item in g.items"
            :key="item.kind + item.label"
            class="palette-item"
            :class="{ active: results.indexOf(item) === active }"
            :data-test-palette-item="item.label"
            @mouseenter="active = results.indexOf(item)"
            @click="item.run()"
          >
            <span class="pi-icon">{{ item.icon }}</span>
            <span class="pi-body">
              <span class="pi-label">{{ item.label }}</span>
              <span v-if="item.sub" class="pi-sub">{{ item.sub }}</span>
            </span>
            <span v-if="item.shortcut" class="pi-shortcut dim">{{ item.shortcut }}</span>
          </button>
        </template>
        <p v-if="results.length === 0" class="dim" style="padding: 20px; text-align: center">No results</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pi-shortcut { margin-left: auto; font-size: 11.5px; white-space: nowrap; }
/* n8n 实测（命令面板 _commandBar_）：面板 700px/bg light-3/1px border/4px 圆角/
   --command-bar--shadow 阴影；**无遮罩变暗**；输入行 48px(衬 0 32px 0 16px, 14px)；
   列表区衬 8px；分组标 12px neutral-400 衬 12px 8px；条目高 40px */
.palette-overlay {
  position: fixed; inset: 0; z-index: var(--command-bar--z);
  background: transparent;
  display: flex; justify-content: center; align-items: flex-start; padding-top: 20vh;
}
.palette {
  width: 700px; max-width: 92vw;
  background: var(--color--background--light-3);
  border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius);
  overflow: hidden; box-shadow: var(--command-bar--shadow);
}
.palette-search { position: relative; display: flex; align-items: center; border-bottom: var(--border-width) var(--border-style) var(--border-color); }
.palette-search .search-icon { display: none; }
.palette-search input {
  flex: 1; background: none; border: none; border-radius: 0; box-shadow: none;
  height: 48px; padding: 0 32px 0 var(--spacing--sm); font-size: var(--font-size--sm);
  color: var(--color--text);
}
.palette-search input:focus { outline: none; box-shadow: none; }
.kbd {
  margin-right: var(--spacing--xs); font-size: 11px; color: var(--color--text--tint-1);
  border: var(--border-width) var(--border-style) var(--border-color); border-radius: var(--radius); padding: 1px 6px;
}
.palette-list { max-height: 352px; overflow-y: auto; padding: var(--spacing--2xs); }
.palette-group-label {
  font-size: var(--font-size--2xs); color: var(--color--text--tint-1);
  padding: var(--spacing--xs) var(--spacing--2xs);
}
.palette-item {
  display: flex; align-items: center; gap: var(--spacing--xs); width: 100%; text-align: left;
  height: 40px; padding: 0 var(--spacing--2xs); border: none; background: none; border-radius: var(--radius);
}
.palette-item.active { background: var(--command-bar-item--color--background--hover); }
.pi-icon {
  width: 24px; height: 24px; flex-shrink: 0; border-radius: var(--radius);
  background: none; display: flex; align-items: center; justify-content: center; font-size: 14px;
  color: var(--color--text--shade-1);
}
.pi-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pi-label { font-size: var(--font-size--sm); color: var(--color--text--shade-1); }
.pi-sub { font-size: var(--font-size--2xs); color: var(--color--text--tint-1); margin-top: 1px; }
</style>
