<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { IConnections, INode } from '@nomops/workflow';
import { api, type WorkflowVersionMeta } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';
import ReadOnlyCanvas from '../components/canvas/ReadOnlyCanvas.vue';

/**
 * 工作流版本历史整页（对标基线 `/workflow/:id/history/:versionId`）。
 * 左：选中版本的只读斜纹画布快照;右:Versions | Publish Timeline 双 tab +
 * 版本时间轴列表 + 升级脚注;画布右上浮动 Actions 下拉(4 项)。
 */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const workflowId = computed(() => String(route.params['id'] ?? ''));

interface Entry {
  id: string | null; // null = 当前工作副本(Current changes)
  label: string;
  author: string;
  date: string;
}

const wfName = ref('');
const current = ref<{ nodes: INode[]; connections: IConnections }>({ nodes: [], connections: {} });
const versions = ref<WorkflowVersionMeta[]>([]);
const loading = ref(true);
const loadError = ref('');

const snapshot = ref<{ nodes: INode[]; connections: IConnections }>({ nodes: [], connections: {} });
const selectedId = ref<string | null>(null); // 与路由 :versionId 同步;null=Current changes
const tab = ref<'versions' | 'timeline'>('versions');
const actionsOpen = ref(false);
const busy = ref('');

// Current changes = 当前工作副本(始终置顶,独立于「N versions」分组);其下为已保存版本
const currentEntry = computed<Entry>(() => ({ id: null, label: 'Current changes', author: auth.email ?? 'You', date: '' }));
const savedEntries = computed<Entry[]>(() =>
  versions.value.map((v) => ({
    id: v.id,
    label: v.name || `Version ${v.versionNumber}`,
    author: v.createdBy ?? (auth.email ?? ''),
    date: v.createdAt,
  })),
);

function fmtVersionDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const mon = d.toLocaleString('en-US', { month: 'short' });
  return `${mon} ${d.getDate()} at ${d.toLocaleTimeString('en-GB', { hour12: false })}`;
}

async function loadSnapshot(versionId: string | null) {
  selectedId.value = versionId;
  if (!versionId) {
    snapshot.value = { nodes: current.value.nodes, connections: current.value.connections };
    return;
  }
  try {
    const v = await api.workflows.version(workflowId.value, versionId);
    snapshot.value = { nodes: v.nodes, connections: v.connections };
  } catch (e) {
    loadError.value = (e as Error).message;
  }
}

function selectEntry(e: Entry) {
  const seg = e.id ?? '';
  void router.replace(`/workflow/${workflowId.value}/history${seg ? '/' + seg : ''}`);
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const [wf, vs] = await Promise.all([
      api.workflows.get(workflowId.value),
      api.workflows.versions(workflowId.value).catch(() => [] as WorkflowVersionMeta[]),
    ]);
    wfName.value = wf.name;
    current.value = { nodes: wf.nodes, connections: wf.connections };
    versions.value = vs;
    const routeVer = route.params['versionId'] ? String(route.params['versionId']) : null;
    await loadSnapshot(routeVer);
  } catch (e) {
    loadError.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => route.params['versionId'], (v) => {
  void loadSnapshot(v ? String(v) : null);
});

function closeHistory() {
  void router.push(`/workflow/${workflowId.value}`);
}

/* ── Actions 下拉(对标基线:Publish version / Clone to new workflow / Open version in new tab / Download)── */
async function publishVersion() {
  actionsOpen.value = false;
  if (!selectedId.value) return; // Current changes 无需发布
  busy.value = 'publish';
  try {
    await api.workflows.restore(workflowId.value, selectedId.value);
    void router.push(`/workflow/${workflowId.value}`);
  } catch (e) {
    loadError.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function cloneToNew() {
  actionsOpen.value = false;
  busy.value = 'clone';
  try {
    const created = await api.workflows.create({
      name: `${wfName.value} (copy)`,
      nodes: snapshot.value.nodes,
      connections: snapshot.value.connections,
    });
    void router.push(`/workflow/${created.id}`);
  } catch (e) {
    loadError.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

function openInNewTab() {
  actionsOpen.value = false;
  const seg = selectedId.value ? '/' + selectedId.value : '';
  window.open(`/workflow/${workflowId.value}/history${seg}`, '_blank');
}

function download() {
  actionsOpen.value = false;
  const blob = new Blob([JSON.stringify({ name: wfName.value, nodes: snapshot.value.nodes, connections: snapshot.value.connections }, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${wfName.value || 'workflow'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="wh-page" data-test="workflow-history-page">
    <header class="wh-header">
      <button class="wh-back" data-test="wh-back" title="Back to editor" @click="closeHistory">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <span class="wh-title">{{ wfName }}</span>
      <span class="wh-crumb dim">Version history</span>
    </header>

    <div class="wh-body">
      <!-- 只读斜纹画布快照 -->
      <div class="wh-canvas">
        <ReadOnlyCanvas :nodes="snapshot.nodes" :connections="snapshot.connections" />
        <!-- 画布右上浮动 Actions 下拉 -->
        <div class="wh-actions" data-test="workflow-history-content-actions" @click.stop>
          <button class="wh-actions-btn" data-test="wh-actions-toggle" @click="actionsOpen = !actionsOpen">
            Actions
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <div v-if="actionsOpen" class="wh-actions-menu" data-test="wh-actions-menu">
            <button class="wh-menu-item" :disabled="!selectedId || busy === 'publish'" data-test="wh-publish" @click="publishVersion">Publish version</button>
            <button class="wh-menu-item" :disabled="busy === 'clone'" data-test="wh-clone" @click="cloneToNew">Clone to new workflow</button>
            <button class="wh-menu-item" data-test="wh-open-tab" @click="openInNewTab">Open version in new tab</button>
            <button class="wh-menu-item" data-test="wh-download" @click="download">Download</button>
          </div>
        </div>
      </div>

      <!-- 右侧版本面板 -->
      <aside class="wh-panel" data-test="workflow-history-panel">
        <div class="wh-tabs" data-test="workflow-history-tabs">
          <button class="wh-tab" :class="{ active: tab === 'versions' }" data-test="tab-history" @click="tab = 'versions'">Versions</button>
          <button class="wh-tab" :class="{ active: tab === 'timeline' }" @click="tab = 'timeline'">Publish Timeline</button>
        </div>

        <template v-if="tab === 'versions'">
          <p v-if="loadError" class="wh-error">{{ loadError }}</p>
          <div class="wh-list-scroll" data-test="workflow-history-list">
            <!-- Current changes:当前工作副本,始终置顶(对标基线) -->
            <ul class="wh-list">
              <li
                class="wh-item"
                :class="{ selected: selectedId === null }"
                data-test-id="workflow-history-list-item"
                role="button"
                @click="selectEntry(currentEntry)"
              >
                <span class="wh-timeline"><span class="wh-dot latest" /></span>
                <div class="wh-item-body">
                  <div class="wh-main">{{ currentEntry.label }}</div>
                  <div class="wh-meta"><span class="wh-author">{{ currentEntry.author }}</span></div>
                </div>
              </li>
            </ul>
            <div class="wh-group-header" data-test="workflow-history-group-header">{{ savedEntries.length }} versions</div>
            <ul class="wh-list">
              <li
                v-for="e in savedEntries"
                :key="e.id ?? 'current'"
                class="wh-item"
                :class="{ selected: selectedId === e.id }"
                data-test-id="workflow-history-list-item"
                role="button"
                @click="selectEntry(e)"
              >
                <span class="wh-timeline"><span class="wh-dot" /></span>
                <div class="wh-item-body">
                  <div class="wh-main">{{ e.label }}</div>
                  <div class="wh-meta">
                    <span class="wh-author">{{ e.author }}<template v-if="e.date">, </template></span>
                    <time v-if="e.date">{{ fmtVersionDate(e.date) }}</time>
                  </div>
                </div>
              </li>
            </ul>
          </div>
          <div class="wh-footnote" data-test="workflow-history-limit">
            <span>Version history is limited to 1 day</span>
            <a class="wh-upgrade" href="/settings/usage" @click.prevent>Upgrade plan to activate full history</a>
          </div>
        </template>

        <div v-else class="wh-timeline-tab dim">Publish Timeline shows when each version was published to production.</div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.wh-page { display: flex; flex-direction: column; height: 100%; background: var(--color--background); }
.wh-header {
  display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 14px;
  border-bottom: var(--border-width) var(--border-style) var(--border-color);
}
.wh-back { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: none; border: none; border-radius: var(--radius); color: var(--color--text--shade-1); }
.wh-back:hover { background: var(--color--background--light-2); }
.wh-title { font-size: var(--font-size--s); font-weight: 600; color: var(--color--text--shade-1); }
.wh-crumb { font-size: var(--font-size--2xs); }

.wh-body { flex: 1; min-height: 0; display: flex; }
.wh-canvas { flex: 1; min-width: 0; position: relative; display: flex; }

.wh-actions { position: absolute; top: 12px; right: 12px; z-index: 12; }
.wh-actions-btn {
  display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px;
  background: var(--color--background--light-3); border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); color: var(--color--text--shade-1); font-size: var(--font-size--2xs); cursor: pointer;
}
.wh-actions-btn:hover { border-color: var(--border-color--strong); }
.wh-actions-menu {
  position: absolute; right: 0; top: 38px; min-width: 210px; padding: 4px;
  background: var(--color--background--light-3); border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); box-shadow: 0 6px 24px var(--color--black-alpha-100); display: flex; flex-direction: column;
}
.wh-menu-item {
  height: 32px; padding: 0 10px; background: none; border: none; border-radius: var(--radius);
  color: var(--color--text--shade-1); font-size: var(--font-size--2xs); text-align: left; cursor: pointer; white-space: nowrap;
}
.wh-menu-item:hover:not(:disabled) { background: var(--color--background--light-1); }
.wh-menu-item:disabled { opacity: 0.4; cursor: default; }

.wh-panel {
  width: 320px; flex-shrink: 0; display: flex; flex-direction: column;
  border-left: var(--border-width) var(--border-style) var(--border-color); background: var(--color--background--light-3);
}
.wh-tabs { display: flex; gap: 2px; padding: 8px 12px 0; border-bottom: var(--border-width) var(--border-style) var(--border-color); }
.wh-tab {
  padding: 6px 10px 10px; background: none; border: none; border-bottom: 2px solid transparent;
  color: var(--color--text--tint-1); font-size: var(--font-size--2xs); cursor: pointer;
}
.wh-tab.active { color: var(--color--text--shade-1); border-bottom-color: var(--color--primary); }

.wh-list-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.wh-group-header { padding: 12px 16px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color--text--tint-1); }
.wh-list { list-style: none; margin: 0; padding: 0; }
.wh-item { display: flex; gap: 0; padding: 0 12px; cursor: pointer; }
.wh-item:hover { background: var(--color--background--light-1); }
.wh-item.selected { background: var(--color--background--light-1); }
.wh-timeline { position: relative; width: 20px; flex-shrink: 0; display: flex; justify-content: center; }
.wh-timeline::before { content: ''; position: absolute; top: 0; bottom: 0; width: 2px; background: var(--border-color); }
.wh-dot { position: relative; z-index: 1; width: 9px; height: 9px; margin-top: 16px; border-radius: 50%; background: var(--color--text--tint-1); border: 2px solid var(--color--background--light-3); }
.wh-dot.latest { background: var(--color--warning, #ff9500); }
.wh-item-body { flex: 1; min-width: 0; padding: 12px 4px; }
.wh-main { font-size: var(--font-size--2xs); font-weight: 600; color: var(--color--text--shade-1); }
.wh-meta { margin-top: 2px; font-size: 11px; color: var(--color--text--tint-1); }

.wh-footnote { padding: 12px 16px; border-top: var(--border-width) var(--border-style) var(--border-color); display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--color--text--tint-1); }
.wh-upgrade { color: var(--color--primary); text-decoration: none; }
.wh-upgrade:hover { text-decoration: underline; }
.wh-error { padding: 8px 16px; color: var(--color--danger); font-size: 12px; }
.wh-timeline-tab { padding: 16px; font-size: var(--font-size--2xs); line-height: 1.5; }
</style>
