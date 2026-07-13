<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { IConnections, INode } from '@nomops/workflow';
import { api } from '../api/client.js';
import { useEditorStore } from '../stores/editor.js';
import { useNodeTypesStore } from '../stores/node-types.js';
import { useExecutionStore } from '../stores/execution.js';
import { useProjectsStore } from '../stores/projects.js';
import WorkflowCanvas from '../components/canvas/WorkflowCanvas.vue';
import NodePanel from '../components/canvas/NodePanel.vue';
import NdvModal from '../components/ndv/NdvModal.vue';

const route = useRoute();
const router = useRouter();
const editor = useEditorStore();
const nodeTypes = useNodeTypesStore();
const execution = useExecutionStore();
const projects = useProjectsStore();
const activateError = ref('');
const logsOpen = ref(false);

/* 顶栏「⋯」菜单：Download / Duplicate / Import / Delete */
const menuOpen = ref(false);
const fileInput = ref<HTMLInputElement>();
const closeMenu = () => (menuOpen.value = false);

function downloadWorkflow() {
  closeMenu();
  const data = JSON.stringify({ name: editor.name, nodes: editor.nodes, connections: editor.connections }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(editor.name || 'workflow').replace(/[^\w.-]+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function duplicateWorkflow() {
  closeMenu();
  const wf = await api.workflows.create({
    name: `${editor.name} copy`,
    nodes: editor.nodes,
    connections: editor.connections,
  });
  void router.push({ name: 'canvas', params: { id: wf.id } });
}

function triggerImport() {
  closeMenu();
  fileInput.value?.click();
}
async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as { name?: string; nodes?: INode[]; connections?: IConnections };
    if (!Array.isArray(parsed.nodes)) throw new Error('missing nodes');
    if (parsed.name) editor.name = parsed.name;
    editor.nodes = parsed.nodes;
    editor.connections = parsed.connections ?? {};
    editor.selectedNodeName = null;
    editor.dirty = true;
    activateError.value = '';
  } catch {
    activateError.value = 'Import failed — not a valid workflow JSON file';
  }
}

async function removeWorkflow() {
  closeMenu();
  if (!editor.id) return;
  await api.workflows.remove(editor.id);
  void router.push({ name: 'overview' });
}

const isEmpty = computed(() => editor.nodes.length === 0);

onMounted(async () => {
  await Promise.all([nodeTypes.fetch(), projects.fetch().catch(() => undefined)]);
  execution.connectWs();
  execution.reset();
  await editor.load(String(route.params['id']));
  window.addEventListener('click', closeMenu);
});
onUnmounted(() => window.removeEventListener('click', closeMenu));

watch(
  () => route.params['id'],
  async (id) => {
    if (route.name === 'canvas' && id) {
      execution.reset();
      await editor.load(String(id));
    }
  },
);

/** 最近一次执行的逐节点日志（名称 / 状态 / 耗时 / 错误）。 */
const logRows = computed(() => {
  const runData = execution.lastRunData?.resultData.runData ?? {};
  return Object.entries(runData).map(([name, runs]) => {
    const last = runs[runs.length - 1];
    return {
      name,
      time: last?.executionTime ?? 0,
      error: last?.error?.message,
      status: execution.statusByNode[name] ?? (last?.error ? 'error' : 'success'),
    };
  });
});

// 运行结束自动展开日志
watch(
  () => execution.lastExecutionId,
  () => {
    if (execution.lastExecutionId) logsOpen.value = true;
  },
);

async function saveAndRun() {
  if (!editor.id) return;
  await editor.save();
  await execution.run(editor.id);
}

async function toggleActive() {
  activateError.value = '';
  try {
    await editor.toggleActive();
  } catch (e) {
    activateError.value = (e as Error).message;
  }
}

const statusColor: Record<string, string> = {
  running: 'var(--running)',
  success: 'var(--ok)',
  error: 'var(--err)',
};
</script>

<template>
  <div class="canvas-view">
    <!-- n8n 式画布顶栏：面包屑（项目 / 名称）+ Active 开关 + 保存 -->
    <div class="toolbar">
      <div class="breadcrumb">
        <span class="crumb-project">{{ projects.currentName }}</span>
        <span class="crumb-sep">/</span>
        <input v-model="editor.name" data-test="workflow-name" class="name-input" @input="editor.dirty = true" />
      </div>
      <span v-if="editor.dirty" class="dim" style="font-size: 12px">Unsaved</span>
      <span class="spacer" style="flex: 1" />
      <span v-if="activateError" class="error-text" data-test="activate-error">{{ activateError }}</span>
      <button data-test="add-node-btn" @click="editor.nodePickerOpen = true">＋ Add node</button>
      <label style="display: flex; align-items: center; gap: 8px; margin: 0; font-size: 12.5px; color: var(--text-dim)">
        {{ editor.active ? 'Active' : 'Inactive' }}
        <span class="switch" data-test="canvas-activate">
          <input type="checkbox" :checked="editor.active" @change="toggleActive" />
          <span class="slider" />
        </span>
      </label>
      <div class="menu-anchor" @click.stop>
        <button class="wf-menu-btn" data-test="wf-menu" title="More actions" @click="menuOpen = !menuOpen">⋯</button>
        <div v-if="menuOpen" class="wf-menu" data-test="wf-menu-pop">
          <button class="wf-menu-item" data-test="wf-download" @click="downloadWorkflow">Download</button>
          <button class="wf-menu-item" data-test="wf-duplicate" @click="duplicateWorkflow">Duplicate</button>
          <button class="wf-menu-item" data-test="wf-import" @click="triggerImport">Import from file…</button>
          <div class="wf-menu-sep" />
          <button class="wf-menu-item danger" data-test="wf-delete" @click="removeWorkflow">Delete</button>
        </div>
      </div>
      <button class="primary" data-test="save" :disabled="editor.saving" @click="editor.save()">
        {{ editor.saving ? 'Saving…' : 'Save' }}
      </button>
    </div>
    <input ref="fileInput" type="file" accept="application/json,.json" style="display: none" @change="onImportFile" />

    <p v-if="editor.loadError" class="error-text" style="padding: 16px">{{ editor.loadError }}</p>

    <div v-else class="body">
      <div class="center">
        <WorkflowCanvas />

        <!-- 空态：n8n 式「添加第一步」入口 -->
        <button v-if="isEmpty" class="add-first-step" data-test="add-first-step" @click="editor.nodePickerOpen = true">
          <span class="plus">＋</span>
          <span>Add first step…</span>
        </button>

        <!-- 底部居中：执行工作流（n8n 主运行入口） -->
        <button
          v-if="!isEmpty"
          class="execute-workflow"
          data-test="run"
          :disabled="execution.running || !editor.id"
          @click="saveAndRun"
        >
          <span v-if="execution.running">⏳ Running…</span>
          <span v-else>▶ Execute workflow</span>
        </button>

        <span v-if="execution.runError" class="run-error-toast" data-test="run-error">{{ execution.runError }}</span>

        <NodePanel />

        <!-- 底部可折叠运行日志条 -->
        <div class="logs-bar" :class="{ open: logsOpen }" data-test="logs-bar">
          <button class="logs-head" @click="logsOpen = !logsOpen">
            <span>Logs</span>
            <span v-if="logRows.length" class="dim" style="font-size: 11px; margin-left: 8px">
              {{ logRows.length }} nodes
            </span>
            <span style="flex: 1" />
            <span class="dim">{{ logsOpen ? '▾' : '▴' }}</span>
          </button>
          <div v-if="logsOpen" class="logs-body">
            <p v-if="logRows.length === 0" class="dim" style="font-size: 12px">No run data yet — click Execute workflow.</p>
            <div v-for="row in logRows" :key="row.name" class="log-row">
              <span :style="{ color: statusColor[row.status] ?? 'inherit' }">●</span>
              <span class="log-name">{{ row.name }}</span>
              <span class="dim" style="font-size: 11px">{{ row.time }}ms</span>
              <span v-if="row.error" class="error-text" style="font-size: 11px; margin-left: 8px">{{ row.error }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <NdvModal />
  </div>
</template>

<style scoped>
.canvas-view { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 16px; background: var(--bg-panel); border-bottom: 1px solid var(--border);
}
.breadcrumb { display: flex; align-items: center; gap: 8px; }
.crumb-project { color: var(--text-dim); font-size: 13px; }
.crumb-sep { color: var(--text-dim); }
.name-input { width: 220px; background: transparent; border-color: transparent; font-size: 15px; font-weight: 600; }
.name-input:hover, .name-input:focus { border-color: var(--border); background: var(--bg-input); }
.menu-anchor { position: relative; }
.wf-menu-btn {
  width: 32px; height: 32px; padding: 0; font-size: 18px; line-height: 1;
  background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
  color: var(--text); display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.wf-menu-btn:hover { border-color: var(--border-strong); }
.wf-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 40; min-width: 190px;
  background: var(--bg-panel); border: 1px solid var(--border-strong); border-radius: 10px;
  padding: 6px; box-shadow: 0 12px 34px rgba(0, 0, 0, 0.5);
}
.wf-menu-item {
  display: block; width: 100%; text-align: left; padding: 8px 10px; border: none;
  background: none; border-radius: 6px; color: var(--text); font-size: 13.5px; cursor: pointer;
}
.wf-menu-item:hover { background: var(--bg-hover); }
.wf-menu-item.danger { color: var(--err); }
.wf-menu-sep { height: 1px; background: var(--border); margin: 5px 4px; }
.body { flex: 1; display: flex; min-height: 0; }
.center { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
.add-first-step {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  width: 150px; height: 150px; border: 2px dashed var(--border); border-radius: 14px;
  background: transparent; color: var(--text-dim); font-size: 14px;
}
.add-first-step:hover { border-color: var(--accent); color: var(--text); }
.add-first-step .plus { font-size: 34px; }
.execute-workflow {
  position: absolute; bottom: 56px; left: 50%; transform: translateX(-50%); z-index: 8;
  background: var(--accent); border: none; color: #fff; font-weight: 600;
  padding: 10px 26px; font-size: 14px; border-radius: 22px;
  box-shadow: 0 4px 16px rgba(255, 105, 0, 0.35);
}
.execute-workflow:hover { background: var(--accent-dim); }
.run-error-toast {
  position: absolute; bottom: 100px; left: 50%; transform: translateX(-50%); z-index: 8;
  color: var(--err); font-size: 12px; background: var(--bg-panel);
  padding: 6px 12px; border-radius: 6px; border: 1px solid var(--err); max-width: 60%;
}
.logs-bar {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 9;
  background: var(--bg-panel); border-top: 1px solid var(--border);
}
.logs-head {
  display: flex; align-items: center; width: 100%; text-align: left;
  padding: 8px 16px; background: none; border: none; border-radius: 0;
  font-size: 12.5px; color: var(--text-dim);
}
.logs-body { max-height: 180px; overflow-y: auto; padding: 4px 16px 12px; }
.log-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 13px; }
.log-name { flex: 1; }
</style>
