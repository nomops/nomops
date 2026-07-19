<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { IConnections, INode, IRunExecutionData } from '@nomops/workflow';
import { api, type ExecutionRow, type TagRow } from '../api/client.js';
import { useEditorStore } from '../stores/editor.js';
import { useNodeTypesStore } from '../stores/node-types.js';
import { useExecutionStore } from '../stores/execution.js';
import { useProjectsStore } from '../stores/projects.js';
import WorkflowCanvas from '../components/canvas/WorkflowCanvas.vue';
import ReadOnlyCanvas from '../components/canvas/ReadOnlyCanvas.vue';
import ParamInput from '../components/node-view/ParamInput.vue';
import { useUiStore, type PaletteCommand } from '../stores/ui.js';
import NodePanel from '../components/canvas/NodePanel.vue';
import NdvModal from '../components/ndv/NdvModal.vue';
import DataPane from '../components/ndv/DataPane.vue';
import { inputItemsFor, lastRunOf, outputPorts } from '../lib/run-data.js';

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

/* Workflow settings 弹窗（对标 n8n：Error Workflow + 执行保存策略，均真实生效） */
const wfSettingsOpen = ref(false);
const wfErrorWorkflow = ref(''); // '' = - No Workflow -
const wfSaveFailed = ref(true);
const wfSaveSuccess = ref(true);
const wfSaveManual = ref(true);
// n8n Workflow settings 补齐字段
const wfExecutionOrder = ref('v1'); // Execution Logic
const wfTimezone = ref(''); // '' = Default - America/New York
const wfSaveProgress = ref(false); // Save execution progress:默认 Do not save
const TIMEZONES: string[] = (() => {
  try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []; } catch { return []; }
})();
const wfSettingsSaving = ref(false);
const wfSettingsError = ref('');
const wfOtherWorkflows = ref<Array<{ id: string; name: string }>>([]);

async function openWfSettings() {
  menuOpen.value = false;
  wfSettingsError.value = '';
  wfSettingsOpen.value = true;
  try {
    const [wf, all] = await Promise.all([api.workflows.get(editor.id!), api.workflows.list()]);
    const s = (wf.settings ?? {}) as Record<string, unknown>;
    wfErrorWorkflow.value = typeof s['errorWorkflow'] === 'string' ? (s['errorWorkflow'] as string) : '';
    wfSaveFailed.value = s['saveFailedExecutions'] !== false;
    wfSaveSuccess.value = s['saveSuccessfulExecutions'] !== false;
    wfSaveManual.value = s['saveManualExecutions'] !== false;
    wfExecutionOrder.value = typeof s['executionOrder'] === 'string' ? (s['executionOrder'] as string) : 'v1';
    wfTimezone.value = typeof s['timezone'] === 'string' ? (s['timezone'] as string) : '';
    wfSaveProgress.value = s['saveExecutionProgress'] === true;
    wfOtherWorkflows.value = all.filter((w) => w.id !== editor.id).map((w) => ({ id: w.id, name: w.name }));
  } catch (e) {
    wfSettingsError.value = (e as Error).message;
  }
}

async function saveWfSettings() {
  wfSettingsError.value = '';
  wfSettingsSaving.value = true;
  try {
    const settings: Record<string, unknown> = {};
    if (wfErrorWorkflow.value) settings['errorWorkflow'] = wfErrorWorkflow.value;
    if (!wfSaveFailed.value) settings['saveFailedExecutions'] = false;
    if (!wfSaveSuccess.value) settings['saveSuccessfulExecutions'] = false;
    if (!wfSaveManual.value) settings['saveManualExecutions'] = false;
    if (wfExecutionOrder.value !== 'v1') settings['executionOrder'] = wfExecutionOrder.value;
    if (wfTimezone.value) settings['timezone'] = wfTimezone.value;
    if (wfSaveProgress.value) settings['saveExecutionProgress'] = true;
    await api.workflows.update(editor.id!, { settings } as never);
    wfSettingsOpen.value = false;
  } catch (e) {
    wfSettingsError.value = (e as Error).message;
  } finally {
    wfSettingsSaving.value = false;
  }
}
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

/* ── C3 对标 n8n：顶栏内联 tag 编辑器（+ Add tag / 胶囊 / Choose or create a tag） ── */
const wfTags = ref<TagRow[]>([]);
const allTags = ref<TagRow[]>([]);
const tagEditorOpen = ref(false);
const tagSearch = ref('');
const tagDraftIds = ref<Set<string>>(new Set());
const tagBoxRef = ref<HTMLElement | null>(null);

async function loadWfTags() {
  if (!editor.id) return;
  const meta = await api.workflowsMeta().catch(() => []);
  wfTags.value = meta.find((m) => m.workflowId === editor.id)?.tags ?? [];
}

async function openTagEditor() {
  allTags.value = (await api.tags.list().catch(() => [])).sort((a, b) => a.name.localeCompare(b.name));
  tagDraftIds.value = new Set(wfTags.value.map((t) => t.id));
  tagSearch.value = '';
  tagEditorOpen.value = true;
}

const filteredTagOptions = computed(() => {
  const q = tagSearch.value.trim().toLowerCase();
  return q ? allTags.value.filter((t) => t.name.toLowerCase().includes(q)) : allTags.value;
});
/** 输入了不存在的名字 → 显示 Create tag 'x' 首项（同 n8n）。 */
const canCreateTag = computed(() => {
  const q = tagSearch.value.trim();
  return q.length > 0 && !allTags.value.some((t) => t.name.toLowerCase() === q.toLowerCase());
});

function toggleTagDraft(id: string) {
  const next = new Set(tagDraftIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  tagDraftIds.value = next;
}

async function createAndSelectTag() {
  const name = tagSearch.value.trim();
  if (!name) return;
  try {
    const created = await api.tags.create(name);
    allTags.value = [...allTags.value, created].sort((a, b) => a.name.localeCompare(b.name));
    toggleTagDraft(created.id);
    tagSearch.value = '';
  } catch (e) {
    activateError.value = (e as Error).message;
  }
}

/** 点击编辑器外部 → 保存并收起（同 n8n 失焦提交）。 */
async function closeTagEditor() {
  if (!tagEditorOpen.value) return;
  tagEditorOpen.value = false;
  if (!editor.id) return;
  const ids = [...tagDraftIds.value];
  const before = wfTags.value.map((t) => t.id).sort().join(',');
  if (ids.slice().sort().join(',') === before) return; // 没变不打请求
  await api.tags.setForWorkflow(editor.id, ids).catch((e: Error) => (activateError.value = e.message));
  await loadWfTags();
}
function onTagDocClick(e: MouseEvent) {
  if (tagEditorOpen.value && tagBoxRef.value && !tagBoxRef.value.contains(e.target as Node)) {
    void closeTagEditor();
  }
}
onMounted(() => {
  window.addEventListener('mousedown', onTagDocClick);
  void loadWfTags();
});
onUnmounted(() => window.removeEventListener('mousedown', onTagDocClick));

/* ── C5 对标 n8n 画布 ⋯ 菜单 ── */

/* Edit description：真实落库（workflows.description），Overview 卡片副行展示 */
const descModalOpen = ref(false);
const descDraft = ref('');
const descSaving = ref(false);
async function openEditDescription() {
  closeMenu();
  if (!editor.id) return;
  const wf = await api.workflows.get(editor.id).catch(() => null);
  descDraft.value = wf?.description ?? '';
  descModalOpen.value = true;
}
async function saveDescription() {
  if (!editor.id) return;
  descSaving.value = true;
  try {
    await api.workflows.update(editor.id, { description: descDraft.value.trim() || null });
    descModalOpen.value = false;
  } finally {
    descSaving.value = false;
  }
}

/* Rename：聚焦顶栏名称输入框（名称本就内联可编，菜单项对齐 n8n 入口） */
function renameWorkflow() {
  closeMenu();
  const input = document.querySelector<HTMLInputElement>('[data-test="workflow-name"]');
  input?.focus();
  input?.select();
}

/* Favorite（复用 B2 端点） */
async function toggleFavoriteCanvas() {
  closeMenu();
  if (!editor.id) return;
  const updated = await api.workflows.setFavorite(editor.id, !editor.favorite).catch(() => null);
  if (updated) editor.favorite = Boolean(updated.favorite);
}

/* Import from URL…：拉取 JSON 定义导入画布（跨域站点需允许 CORS，失败原样提示） */
async function importFromUrl() {
  closeMenu();
  const url = window.prompt('Workflow JSON URL');
  if (!url) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = (await res.json()) as { name?: string; nodes?: INode[]; connections?: IConnections };
    if (!Array.isArray(parsed.nodes)) throw new Error('missing nodes');
    if (parsed.name) editor.name = parsed.name;
    editor.nodes = parsed.nodes;
    editor.connections = parsed.connections ?? {};
    editor.selectedNodeName = null;
    editor.dirty = true;
    activateError.value = '';
  } catch (e) {
    activateError.value = `Import from URL failed — ${(e as Error).message}`;
  }
}

/* Push to git（复用 Environments 的源码同步；无 license 灰色禁用） */
const canPushToGit = computed(() => projects.hasFeature('sourceControl'));
async function pushToGit() {
  closeMenu();
  activateError.value = '';
  try {
    if (editor.dirty) await editor.save();
    const r = await api.sourceControl.push(`Update ${editor.name}`);
    activateError.value = r.committed ? `Pushed ${r.files.length} file(s) to git` : 'Nothing to push — up to date';
  } catch (e) {
    activateError.value = (e as Error).message; // 未连接仓库 / 非 admin 等
  }
}

/* Archive（对标 n8n：画布里没有 Delete；归档自动下线触发器，删除去归档列表） */
async function archiveFromCanvas() {
  closeMenu();
  if (!editor.id) return;
  await api.workflows.archive(editor.id).catch((e) => (activateError.value = (e as Error).message));
  void router.push({ name: 'overview' });
}

/* 版本历史:对标 n8n 跳转整页 /workflow/:id/history(只读斜纹画布 + 版本面板) */
function openHistory() {
  closeMenu();
  if (!editor.id) return;
  void router.push(`/workflow/${editor.id}/history`);
}

const isEmpty = computed(() => editor.nodes.length === 0);


/* C9 右侧浮动工具条：打开节点面板 / 命令面板 / 加便签 / Focus panel（对标 n8n canvas buttons） */
function addStickyNote() {
  const desc = nodeTypes.byType.get('nomops.stickyNote');
  if (!desc) return;
  editor.addNode(desc);
}

/* ── Command bar（⌘K）：注入既有全局命令面板（与 n8n 一致——侧栏搜索与画布按钮同一面板），
   画布上下文命令全部映射到真实动作；离开画布时清空 ── */
const ui = useUiStore();
const canvasCommands: PaletteCommand[] = [
  { id: 'add-node', group: 'Workflow', label: 'Add node', shortcut: 'N', run: () => (editor.nodePickerOpen = true) },
  { id: 'add-sticky', group: 'Workflow', label: 'Add sticky note', shortcut: '⇧S', run: () => addStickyNote() },
  { id: 'execute', group: 'Workflow', label: 'Execute workflow', shortcut: '⌘↵', run: () => void saveAndRun() },
  { id: 'publish', group: 'Workflow', label: 'Publish workflow', run: () => void handlePublish() },
  { id: 'tidy-up', group: 'Workflow', label: 'Tidy up workflow', shortcut: '⇧⌥T', run: () => editor.tidyUp() },
  { id: 'rename', group: 'Workflow', label: 'Rename workflow', run: () => renameWorkflow() },
  { id: 'add-tag', group: 'Workflow', label: 'Add tag', run: () => void openTagEditor() },
  { id: 'edit-desc', group: 'Workflow', label: 'Edit description', run: () => void openEditDescription() },
  { id: 'wf-settings', group: 'Workflow', label: 'Open workflow settings', run: () => void openWfSettings() },
  { id: 'duplicate', group: 'Workflow', label: 'Duplicate workflow', run: () => void duplicateWorkflow() },
  { id: 'download', group: 'Workflow', label: 'Download workflow', run: () => downloadWorkflow() },
  { id: 'import-url', group: 'Workflow', label: 'Import workflow from URL', run: () => void importFromUrl() },
  { id: 'import-file', group: 'Workflow', label: 'Import workflow from file', run: () => triggerImport() },
  { id: 'focus-panel', group: 'Workflow', label: 'Toggle focus panel', run: () => (editor.focusPanelOpen = !editor.focusPanelOpen) },
  { id: 'archive', group: 'Workflow', label: 'Archive workflow', run: () => void archiveFromCanvas() },
];

/* ── Focus panel（对标 n8n）：钉住的参数持续可见可编辑 ── */
const pinnedEntries = computed(() =>
  editor.pinnedParams
    .map((p) => {
      const node = editor.nodes.find((n) => n.name === p.nodeName);
      const prop = node ? nodeTypes.byType.get(node.type)?.properties.find((pr) => pr.name === p.paramName) : undefined;
      return node && prop ? { ...p, node, prop } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null),
);

/** undo/redo 快捷键（Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z）；输入框聚焦时不劫持（保留原生文本撤销）。 */
function onKeydown(event: KeyboardEvent) {
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === 's') {
    event.preventDefault(); // 习惯性 Cmd+S：立即落盘（平时自动保存）
    void editor.save();
    return;
  }
  // Tidy up（Shift+Alt+T，同 n8n）
  if (event.shiftKey && event.altKey && event.code === 'KeyT') {
    const el = event.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    event.preventDefault();
    editor.tidyUp();
    return;
  }
  // Execute workflow（⌘Enter，同 n8n）
  if (meta && event.key === 'Enter') {
    event.preventDefault();
    void saveAndRun();
    return;
  }
  {
    const el = event.target as HTMLElement | null;
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    if (!typing && !meta && !event.altKey && !ui.paletteOpen) {
      // Add node（N）/ Add sticky（⇧S），同 n8n
      if (!event.shiftKey && event.code === 'KeyN') {
        event.preventDefault();
        editor.nodePickerOpen = true;
        return;
      }
      if (event.shiftKey && event.code === 'KeyS') {
        event.preventDefault();
        addStickyNote();
        return;
      }
    }
  }
  if (!meta || event.key.toLowerCase() !== 'z') return;
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  event.preventDefault();
  if (event.shiftKey) editor.redo();
  else editor.undo();
}

onMounted(async () => {
  await Promise.all([nodeTypes.fetch(), projects.fetch().catch(() => undefined)]);
  execution.connectWs();
  execution.reset();
  await editor.load(String(route.params['id']));
  window.addEventListener('click', closeMenu);
  window.addEventListener('click', closePublishMenu);
  window.addEventListener('keydown', onKeydown);
  ui.setPaletteContext(canvasCommands); // 画布上下文命令入全局 ⌘K 面板
});
onUnmounted(() => {
  window.removeEventListener('click', closeMenu);
  window.removeEventListener('click', closePublishMenu);
  window.removeEventListener('keydown', onKeydown);
  ui.clearPaletteContext();
});

// 文档标题跟随工作流名(对标 n8n "▶️ <名> - n8n"):编辑器页覆盖 router 的兜底标题
watch(
  () => editor.name,
  (name) => {
    if (name) document.title = `${name} - nomops`;
  },
  { immediate: true },
);

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

/* D123 对标 n8n:底部 Logs = 左树(摘要 + 逐节点行,可选中高亮)+ 右详情(选中节点 Input|Output + DataPane)。 */
const logSummary = computed(() => {
  const total = logRows.value.reduce((s, r) => s + r.time, 0);
  const failed = logRows.value.some((r) => r.status === 'error');
  return { status: failed ? 'error' : 'success', label: failed ? 'Error' : 'Success', total };
});
const selectedLogNode = ref<string | null>(null);
/* 运行结束/切换执行时,默认选中最后执行的节点(有错则选出错节点)。 */
watch(logRows, (rows) => {
  if (!rows.length) { selectedLogNode.value = null; return; }
  if (!selectedLogNode.value || !rows.some((r) => r.name === selectedLogNode.value)) {
    selectedLogNode.value = (rows.find((r) => r.status === 'error') ?? rows[rows.length - 1])?.name ?? null;
  }
});
const logDetailTab = ref<'input' | 'output'>('output');
const selectedLogRow = computed(() => logRows.value.find((r) => r.name === selectedLogNode.value) ?? null);
const logRunData = computed(() => execution.lastRunData?.resultData.runData ?? {});
const selectedLogOutput = computed(() =>
  selectedLogNode.value ? outputPorts(lastRunOf(logRunData.value, selectedLogNode.value)).flat() : [],
);
const selectedLogInput = computed(() =>
  selectedLogNode.value ? inputItemsFor(editor.connections, logRunData.value, selectedLogNode.value) : [],
);

// 运行结束自动展开日志
watch(
  () => execution.lastExecutionId,
  () => {
    if (execution.lastExecutionId) logsOpen.value = true;
  },
);

/* ── C10 对标 n8n：画布 Chat 面板（Chat Trigger 存在时底部 Chat | Logs 双栏 + Open chat 按钮） ── */
const hasChatTrigger = computed(() => editor.nodes.some((n) => n.type === 'nomops.chatTrigger' && !n.disabled));
const chatMessages = ref<Array<{ role: 'user' | 'bot'; text: string; error?: boolean }>>([]);
const chatDraft = ref('');
const chatSending = ref(false);
const chatSessionId = ref(crypto.randomUUID().slice(0, 8));
const chatInputRef = ref<HTMLInputElement | null>(null);

function openChat() {
  logsOpen.value = true;
  void nextTick(() => chatInputRef.value?.focus());
}
function resetChatSession() {
  chatSessionId.value = crypto.randomUUID().slice(0, 8);
  chatMessages.value = [];
}
async function sendChat() {
  const message = chatDraft.value.trim();
  if (!message || chatSending.value || !editor.id) return;
  chatDraft.value = '';
  chatMessages.value.push({ role: 'user', text: message });
  chatSending.value = true;
  try {
    if (editor.dirty) await editor.save(); // 聊的是画布上的最新草稿
    const res = await api.workflows.chat(editor.id, message, chatSessionId.value);
    chatMessages.value.push({ role: 'bot', text: res.error ?? res.reply, error: Boolean(res.error) });
    await execution.fetchRunData(res.executionId).catch(() => undefined); // 该次执行进 Logs
  } catch (e) {
    chatMessages.value.push({ role: 'bot', text: (e as Error).message, error: true });
  } finally {
    chatSending.value = false;
    void nextTick(() => {
      const list = document.querySelector('[data-test="chat-messages"]');
      list?.scrollTo({ top: list.scrollHeight });
    });
  }
}

/* C7 对标 n8n：多触发器时 Execute workflow 为 split（主按钮 from X + caret 选 trigger） */
const triggerNodes = computed(() =>
  editor.nodes
    .filter((n) => nodeTypes.byType.get(n.type)?.group?.includes('trigger') && !n.disabled)
    .map((n) => n.name),
);
const selectedTrigger = ref<string | null>(null);
watch(triggerNodes, (list) => {
  if (selectedTrigger.value && !list.includes(selectedTrigger.value)) selectedTrigger.value = null;
  if (!selectedTrigger.value && list.length > 0) selectedTrigger.value = list[0]!;
}, { immediate: true });
const execMenuOpen = ref(false);

async function saveAndRun() {
  if (!editor.id) return;
  execMenuOpen.value = false;
  await editor.save();
  // 单触发器/无触发器：引擎自选起点；多触发器：从选中的 trigger 起跑
  const startNode = triggerNodes.value.length > 1 && selectedTrigger.value ? selectedTrigger.value : undefined;
  await execution.run(editor.id, startNode ? { startNode } : {});
}

async function toggleActive() {
  activateError.value = '';
  try {
    await editor.toggleActive();
  } catch (e) {
    activateError.value = (e as Error).message;
  }
}

/* ── C1/C4 对标 n8n：自动保存 + Publish 合并激活语义 ── */

/** 触发器节点数（webhook/schedule/polling…按 description.group 判定）——顶栏 n/m 指示 + 发布是否顺带激活。 */
const triggerCount = computed(
  () => editor.nodes.filter((n) => nodeTypes.byType.get(n.type)?.group?.includes('trigger')).length,
);

/* 自动保存：编辑落定 1.5s 后静默保存（n8n 无 Save 按钮）；保存后短暂显示 Saved */
const savedFlash = ref(false);
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => editor.dirty,
  (dirty) => {
    if (!dirty || !editor.id) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void editor.save().then(() => {
        savedFlash.value = true;
        setTimeout(() => (savedFlash.value = false), 1600);
      });
    }, 1500);
  },
);
onUnmounted(() => {
  if (autosaveTimer) clearTimeout(autosaveTimer);
});

/* Publish 分裂按钮：主钮 = 保存草稿 → 发布 →（有触发器且未激活则激活）；下拉 = Activate/Deactivate */
const publishMenuOpen = ref(false);
const closePublishMenu = () => (publishMenuOpen.value = false);
async function handlePublish() {
  activateError.value = '';
  try {
    await editor.publish();
    if (!editor.active && triggerCount.value > 0) await editor.toggleActive();
  } catch (e) {
    activateError.value = (e as Error).message;
  }
}

const statusColor: Record<string, string> = {
  running: 'var(--running)',
  success: 'var(--ok)',
  error: 'var(--err)',
};

/* ── C2 对标 n8n：画布内 Editor / Executions tabs ── */
const canvasTab = ref<'editor' | 'executions' | 'evaluations'>('editor');
const execList = ref<ExecutionRow[]>([]);
const execAutoRefresh = ref(true);
const selectedExecId = ref<string | null>(null);
const execDetail = ref<{ execution: ExecutionRow; data: IRunExecutionData | null } | null>(null);
const expandedNode = ref<string | null>(null);
let execTimer: ReturnType<typeof setInterval> | null = null;

async function loadExecList() {
  if (!editor.id) return;
  const all = await api.executions.list().catch(() => [] as ExecutionRow[]);
  execList.value = all
    .filter((e) => e.workflowId === editor.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function selectExec(id: string) {
  selectedExecId.value = id;
  expandedNode.value = null;
  execDetail.value = await api.executions.get(id).catch(() => null);
}

/* B5 深链：Overview executions 行点击 → ?tab=executions&exec=<id> 直达该执行详情 */
onMounted(() => {
  if (route.query['tab'] === 'executions') {
    canvasTab.value = 'executions';
    const execId = route.query['exec'];
    if (typeof execId === 'string') void selectExec(execId);
  }
});

watch(canvasTab, (t) => {
  if (t === 'executions') {
    void loadExecList();
    void loadSavePolicy();
    execTimer = setInterval(() => {
      if (execAutoRefresh.value) void loadExecList();
    }, 5000);
  } else if (execTimer) {
    clearInterval(execTimer);
    execTimer = null;
  }
});
onUnmounted(() => {
  if (execTimer) clearInterval(execTimer);
});

const fmtWhen = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '—');
const fmtRunTime = (e: ExecutionRow): string =>
  e.startedAt && e.stoppedAt ? `${new Date(e.stoppedAt).getTime() - new Date(e.startedAt).getTime()}ms` : '—';

/** 选中执行的逐节点结果（名称/耗时/错误/输出 items）。 */
const execNodeRows = computed(() => {
  const runData = execDetail.value?.data?.resultData?.runData ?? {};
  return Object.entries(runData).map(([name, runs]) => {
    const last = runs[runs.length - 1];
    return {
      name,
      time: last?.executionTime ?? 0,
      error: last?.error?.message as string | undefined,
      output: (last?.data?.['main']?.[0] ?? []) as unknown[],
    };
  });
});

/* 只读画布的每节点执行态：run 里有报错→error,否则→ok;未跑到的节点无态。
   注:执行 API 不返回执行时的工作流快照,只读画布用「当前工作流」定义近似渲染。 */
const execRunStatus = computed<Record<string, 'ok' | 'error'>>(() => {
  const runData = execDetail.value?.data?.resultData?.runData ?? {};
  const map: Record<string, 'ok' | 'error'> = {};
  for (const [name, runs] of Object.entries(runData)) {
    const last = runs[runs.length - 1];
    map[name] = last?.error ? 'error' : 'ok';
  }
  return map;
});

/* 执行详情底部「Execution data」折叠(保留逐节点 JSON 检视,默认收起) */
const execDataOpen = ref(false);

/* Copy to editor(对标 n8n):切回 Editor tab 从当前工作流继续编辑。
   n8n 是把执行时快照拷进编辑器;nomops 执行 API 无快照,退化为切到编辑器。 */
function copyExecToEditor() {
  canvasTab.value = 'editor';
}

/* 删除该执行(垃圾桶):移除后刷新列表并清空详情 */
const execDeleting = ref(false);
async function deleteExecution() {
  const id = selectedExecId.value;
  if (!id || execDeleting.value) return;
  execDeleting.value = true;
  try {
    await api.executions.remove(id);
    execDetail.value = null;
    selectedExecId.value = null;
    await loadExecList();
  } catch {
    /* 忽略:列表刷新失败不阻塞 */
  } finally {
    execDeleting.value = false;
  }
}

/* 底部折叠：该工作流的执行保存策略（联动 Workflow settings） */
const savePolicyOpen = ref(false);
const savePolicy = ref({ failed: true, success: true, manual: true });
async function loadSavePolicy() {
  if (!editor.id) return;
  const wf = await api.workflows.get(editor.id).catch(() => null);
  const st = (wf?.settings ?? {}) as Record<string, unknown>;
  savePolicy.value = {
    failed: st['saveFailedExecutions'] !== false,
    success: st['saveSuccessfulExecutions'] !== false,
    manual: st['saveManualExecutions'] !== false,
  };
}
</script>

<template>
  <div class="canvas-view">
    <!-- 画布顶栏：面包屑（项目 / 名称）+ Active 开关 + 保存 -->
    <div class="toolbar">
      <div class="breadcrumb">
        <span class="crumb-project">{{ projects.currentName }}</span>
        <span class="crumb-sep">/</span>
        <input v-model="editor.name" data-test="workflow-name" class="name-input" @input="editor.dirty = true" />
      </div>

      <!-- C3：内联 tag 区（对标 n8n："+ Add tag" / 胶囊；点击展开 Choose or create a tag） -->
      <div ref="tagBoxRef" class="wf-tagbox" @click.stop>
        <template v-if="!tagEditorOpen">
          <button v-if="wfTags.length === 0" class="add-tag" data-test="add-tag" @click="openTagEditor">+ Add tag</button>
          <button v-else class="tag-chips" data-test="wf-tag-chips" title="Edit tags" @click="openTagEditor">
            <span v-for="tg in wfTags" :key="tg.id" class="tag-chip-sm">{{ tg.name }}</span>
          </button>
        </template>
        <div v-else class="tag-editor" data-test="tag-editor">
          <input
            v-model="tagSearch"
            class="tag-input"
            data-test="tag-search"
            placeholder="Choose or create a tag"
            autocomplete="off"
            @keydown.esc="closeTagEditor"
            @keydown.enter="canCreateTag ? createAndSelectTag() : undefined"
          />
          <div class="tag-menu">
            <button v-if="canCreateTag" class="tag-option create" data-test="tag-create-option" @click="createAndSelectTag">
              Create tag “{{ tagSearch.trim() }}”
            </button>
            <button
              v-for="tg in filteredTagOptions"
              :key="tg.id"
              class="tag-option"
              :class="{ sel: tagDraftIds.has(tg.id) }"
              :data-test-tag-option="tg.id"
              @click="toggleTagDraft(tg.id)"
            >
              <span class="tag-check">{{ tagDraftIds.has(tg.id) ? '✓' : '' }}</span>
              {{ tg.name }}
            </button>
            <p v-if="!canCreateTag && filteredTagOptions.length === 0" class="tag-empty dim">No tags</p>
          </div>
        </div>
      </div>
      <!-- 自动保存指示（n8n 无 Save 按钮）：Saving… → Saved 短暂闪现；从不阻塞编辑 -->
      <span v-if="editor.saving" class="dim save-hint" data-test="autosave-saving">Saving…</span>
      <span v-else-if="savedFlash" class="dim save-hint" data-test="autosave-saved">Saved</span>
      <span v-else-if="editor.dirty" class="dim save-hint">Unsaved</span>
      <span class="spacer" style="flex: 1" />

      <!-- 画布内 tabs（对标 n8n Editor | Executions） -->
      <div class="canvas-tabs" data-test="canvas-tabs">
        <button class="canvas-tab" :class="{ active: canvasTab === 'editor' }" data-test="tab-editor" @click="canvasTab = 'editor'">Editor</button>
        <button class="canvas-tab" :class="{ active: canvasTab === 'executions' }" data-test="tab-executions" @click="canvasTab = 'executions'">Executions</button>
        <button class="canvas-tab" :class="{ active: canvasTab === 'evaluations' }" data-test="tab-evaluations" @click="canvasTab = 'evaluations'">Evaluations</button>
      </div>
      <span class="spacer" style="flex: 1" />
      <span v-if="activateError" class="error-text" data-test="activate-error">{{ activateError }}</span>

      <!-- 触发器激活指示（对标 n8n 的 0/1）：已激活触发器数 / 触发器总数 -->
      <span v-if="triggerCount > 0" class="pub-count" data-test="trigger-count" :title="editor.active ? 'Triggers are live' : 'Triggers are not active'">
        {{ editor.active ? triggerCount : 0 }} / {{ triggerCount }}
      </span>

      <!-- Publish 分裂按钮：发布草稿并激活触发器；下拉切换激活态 -->
      <div class="publish-split" @click.stop>
        <button
          class="primary publish-btn"
          data-test="publish"
          :disabled="editor.publishing || (!editor.publishedDirty && !editor.dirty && editor.active)"
          :title="editor.publishedDirty || editor.dirty ? 'Save, publish and activate this workflow' : 'Production is up to date'"
          @click="handlePublish"
        >
          {{ editor.publishing ? 'Publishing…' : editor.publishedDirty || editor.dirty || !editor.active ? 'Publish' : 'Published' }}
        </button>
        <button class="primary publish-caret" data-test="publish-caret" @click="publishMenuOpen = !publishMenuOpen">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <div v-if="publishMenuOpen" class="wf-menu publish-menu" data-test="publish-menu">
          <button class="wf-menu-item" data-test="publish-toggle-active" @click="publishMenuOpen = false; toggleActive()">
            {{ editor.active ? 'Deactivate' : 'Activate' }}
          </button>
        </div>
      </div>

      <!-- 版本历史（对标 n8n 顶栏时钟图标） -->
      <button class="wf-menu-btn" data-test="wf-history" title="Version history" @click.stop="openHistory">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.3L3 8" /><path d="M3 4v4h4M12 7v5l3.5 2" /></svg>
      </button>

      <div class="menu-anchor" @click.stop>
        <button class="wf-menu-btn" data-test="wf-menu" title="More actions" @click="menuOpen = !menuOpen">⋯</button>
        <div v-if="menuOpen" class="wf-menu" data-test="wf-menu-pop">
          <button class="wf-menu-item" data-test="wf-edit-desc" @click="openEditDescription">Edit description</button>
          <button class="wf-menu-item" data-test="wf-duplicate" @click="duplicateWorkflow">Duplicate</button>
          <button class="wf-menu-item" data-test="wf-download" @click="downloadWorkflow">Download</button>
          <button class="wf-menu-item" data-test="wf-rename" @click="renameWorkflow">Rename</button>
          <button class="wf-menu-item" data-test="wf-favorite" @click="toggleFavoriteCanvas">
            {{ editor.favorite ? 'Unfavorite' : 'Favorite' }}
          </button>
          <button class="wf-menu-item" data-test="wf-import-url" @click="importFromUrl">Import from URL…</button>
          <button class="wf-menu-item" data-test="wf-import" @click="triggerImport">Import from file…</button>
          <button
            class="wf-menu-item"
            :class="{ disabled: !canPushToGit }"
            :disabled="!canPushToGit"
            data-test="wf-push-git"
            :title="canPushToGit ? 'Commit and push all project workflows to the connected repository' : 'Requires an Enterprise license (Environments)'"
            @click="canPushToGit && pushToGit()"
          >
            Push to git
          </button>
          <button class="wf-menu-item" data-test="wf-settings" @click="openWfSettings">Settings</button>
          <div class="wf-menu-sep" />
          <button class="wf-menu-item danger" data-test="wf-archive" @click="archiveFromCanvas">Archive</button>
        </div>
      </div>
    </div>
    <input ref="fileInput" type="file" accept="application/json,.json" style="display: none" @change="onImportFile" />

    <p v-if="editor.loadError" class="error-text" style="padding: 16px">{{ editor.loadError }}</p>

    <!-- Executions 视图（对标 n8n：左执行列表 + 右详情） -->
    <div v-else-if="canvasTab === 'executions'" class="exec-body" data-test="exec-view">
      <aside class="exec-list">
        <div class="exec-list-head">
          <h3>Executions</h3>
          <label class="exec-autorefresh">
            <input v-model="execAutoRefresh" type="checkbox" />
            Auto refresh
          </label>
        </div>
        <p v-if="!execList.length" class="dim" style="padding: 14px 16px; font-size: 13px">No executions found</p>
        <button
          v-for="e in execList"
          :key="e.id"
          class="exec-item"
          :class="{ selected: selectedExecId === e.id, iserr: e.status === 'error' }"
          :data-test-exec="e.id"
          @click="selectExec(e.id)"
        >
          <span class="exec-dot" :style="{ background: statusColor[e.status] ?? 'var(--text-dim)' }" />
          <span class="exec-item-main">
            <b>{{ fmtWhen(e.startedAt ?? e.createdAt) }}</b>
            <span class="dim">{{ e.mode }} · {{ e.status }} · {{ fmtRunTime(e) }}</span>
          </span>
        </button>

        <!-- 保存策略折叠（联动 Workflow settings） -->
        <div class="exec-policy">
          <button class="exec-policy-toggle" data-test="exec-policy" @click="savePolicyOpen = !savePolicyOpen">
            Which executions is this workflow saving?
            <span>{{ savePolicyOpen ? '▴' : '▾' }}</span>
          </button>
          <div v-if="savePolicyOpen" class="exec-policy-body">
            <div><span class="dim">Failed production:</span> {{ savePolicy.failed ? 'Saved' : 'Not saved' }}</div>
            <div><span class="dim">Successful production:</span> {{ savePolicy.success ? 'Saved' : 'Not saved' }}</div>
            <div><span class="dim">Manual:</span> {{ savePolicy.manual ? 'Saved' : 'Not saved' }}</div>
            <a href="#" class="accent-link" @click.prevent="openWfSettings">Change in workflow settings</a>
          </div>
        </div>
      </aside>

      <section class="exec-detail">
        <div v-if="!execDetail" class="exec-empty">
          <h2>Nothing here yet</h2>
          <p class="dim">Select an execution on the left, or run the workflow to see executions.</p>
        </div>
        <template v-else>
          <!-- 顶条:执行时间/状态标题 + Copy to editor + 垃圾桶(对标 n8n 执行详情) -->
          <div class="exec-detail-head" data-test="exec-detail-head">
            <span class="exec-dot" :style="{ background: statusColor[execDetail.execution.status] ?? 'var(--text-dim)' }" />
            <b style="text-transform: capitalize">{{ execDetail.execution.status }}</b>
            <span class="dim">{{ execDetail.execution.mode }} · started {{ fmtWhen(execDetail.execution.startedAt) }} · {{ fmtRunTime(execDetail.execution) }}</span>
            <span class="spacer" style="flex: 1" />
            <button class="exec-copy-btn" data-test="exec-copy-editor" title="Copy this execution's workflow to the editor" @click="copyExecToEditor">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
              Copy to editor
            </button>
            <button class="exec-trash-btn" data-test="exec-delete" title="Delete execution" :disabled="execDeleting" @click="deleteExecution">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
            </button>
          </div>

          <!-- 只读斜纹画布快照(节点带执行态);执行 API 无快照,用当前工作流定义近似 -->
          <ReadOnlyCanvas
            class="exec-ro-canvas"
            data-test="exec-readonly-canvas"
            :nodes="editor.nodes"
            :connections="editor.connections"
            :status="execRunStatus"
          />

          <!-- 底部折叠:逐节点执行数据(JSON 检视,默认收起) -->
          <div class="exec-data-panel">
            <button class="exec-data-toggle" data-test="exec-data-toggle" @click="execDataOpen = !execDataOpen">
              Execution data
              <span>{{ execDataOpen ? '▾' : '▸' }}</span>
            </button>
            <div v-if="execDataOpen" class="exec-nodes">
              <div v-for="r in execNodeRows" :key="r.name" class="exec-node">
                <button class="exec-node-row" @click="expandedNode = expandedNode === r.name ? null : r.name">
                  <span class="exec-dot" :style="{ background: r.error ? 'var(--err)' : 'var(--ok)' }" />
                  <b>{{ r.name }}</b>
                  <span class="dim" style="margin-left: auto">{{ r.time }}ms · {{ r.output.length }} item{{ r.output.length === 1 ? '' : 's' }}</span>
                </button>
                <p v-if="r.error" class="error-text" style="margin: 4px 0 8px 22px">{{ r.error }}</p>
                <pre v-if="expandedNode === r.name" class="exec-json">{{ JSON.stringify(r.output, null, 2) }}</pre>
              </div>
              <p v-if="!execNodeRows.length" class="dim" style="font-size: 13px">No node data recorded for this execution.</p>
            </div>
          </div>
        </template>
      </section>
    </div>

    <!-- Evaluations Tab：Community 未注册锁态(对标 n8n) -->
    <div v-else-if="canvasTab === 'evaluations'" class="eval-view" data-test="eval-view">
      <div class="eval-left">
        <h2 class="eval-h">Test your AI workflow over multiple inputs</h2>
        <p class="eval-desc">Evaluations measure performance against a test dataset. <a class="link" href="/docs" @click.prevent>More info</a></p>
        <div class="eval-video" />
      </div>
      <div class="eval-right" data-test="eval-register">
        <h3 class="eval-reg-title">Register to enable evaluation</h3>
        <p class="eval-reg-desc">Register your Community instance to unlock the evaluation feature</p>
        <button class="btn primary" data-test="eval-register-btn">Register instance</button>
      </div>
    </div>

    <div v-else class="body">
      <div class="center">
        <div class="canvas-stage">
        <WorkflowCanvas />

        <!-- 空态：「添加第一步」入口 -->
        <button v-if="isEmpty" class="add-first-step" data-test="add-first-step" @click="editor.nodePickerOpen = true">
          <span class="plus">＋</span>
          <span>Add first step…</span>
        </button>

        <!-- 底部居中：执行工作流（主运行入口；多触发器时 split 选择起点 trigger，对标 n8n） -->
        <div v-if="!isEmpty" class="execute-split" @click.stop>
          <button
            class="execute-workflow"
            :class="{ 'has-caret': triggerNodes.length > 1 }"
            data-test="run"
            :disabled="execution.running || !editor.id"
            @click="saveAndRun"
          >
            <span v-if="execution.running">⏳ Executing workflow</span>
            <span v-else-if="triggerNodes.length > 1">▶ Execute workflow from {{ selectedTrigger }}</span>
            <span v-else>▶ Execute workflow</span>
          </button>
          <button
            v-if="triggerNodes.length > 1"
            class="execute-caret"
            data-test="run-trigger-toggle"
            :disabled="execution.running"
            @click="execMenuOpen = !execMenuOpen"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" class="i14"><path d="M18 15l-6-6-6 6" /></svg>
          </button>
          <div v-if="execMenuOpen" class="execute-menu" data-test="run-trigger-menu">
            <div class="menu-label-sm dim">Start from trigger</div>
            <button
              v-for="name in triggerNodes"
              :key="name"
              class="exec-trigger-option"
              :class="{ sel: name === selectedTrigger }"
              :data-test-trigger-option="name"
              @click="selectedTrigger = name; execMenuOpen = false"
            >
              <span class="tag-check">{{ name === selectedTrigger ? '✓' : '' }}</span>
              {{ name }}
            </button>
          </div>
        </div>

        <!-- Open chat（C7/C10：Chat Trigger 存在时，对标 n8n） -->
        <button v-if="!isEmpty && hasChatTrigger" class="open-chat-btn" data-test="open-chat" @click="openChat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="i15"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.8 8.8 0 0 1-3.5-.7L3 21l1.8-5.5A8.4 8.4 0 1 1 21 11.5z" /></svg>
          Open chat
        </button>

        <span v-if="execution.runError" class="run-error-toast" data-test="run-error">{{ execution.runError }}</span>

        <!-- C9 右侧浮动工具条（对标 n8n：Open nodes panel / Add sticky note）；节点抽屉打开时让位 -->
        <div v-show="!editor.nodePickerOpen" class="canvas-side-toolbar" data-test="canvas-side-toolbar">
          <button title="Open nodes panel" data-test="side-add-node" @click="editor.nodePickerOpen = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="i16"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button title="Command bar (⌘K)" data-test="side-command-bar" @click="ui.openPalette()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="i16"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          </button>
          <button title="Add sticky note" data-test="side-add-sticky" @click="addStickyNote">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i16"><path d="M5 4h14a1 1 0 0 1 1 1v9l-6 6H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M14 20v-5a1 1 0 0 1 1-1h5" /></svg>
          </button>
          <button
            title="Open focus panel"
            data-test="side-focus-panel"
            :class="{ on: editor.focusPanelOpen }"
            @click="editor.focusPanelOpen = !editor.focusPanelOpen"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i16"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" /></svg>
          </button>
        </div>

        <!-- Focus panel（对标 n8n：钉住参数持续可见，可直接编辑） -->
        <aside v-if="editor.focusPanelOpen" class="focus-panel" data-test="focus-panel">
          <div class="focus-head">
            <span>Focus panel</span>
            <button class="focus-x" data-test="focus-close" @click="editor.focusPanelOpen = false">×</button>
          </div>
          <div v-if="pinnedEntries.length === 0" class="focus-empty dim" data-test="focus-empty">
            <p><strong>Show a node parameter here, to iterate easily</strong></p>
            <p>For example, keep your prompt always visible so you can run the workflow while tweaking it.</p>
            <p>Pin a parameter from the node editor (double-click a node, then click the pin icon next to a field).</p>
          </div>
          <div v-for="entry in pinnedEntries" :key="`${entry.nodeName}:${entry.paramName}`" class="focus-item">
            <div class="focus-item-head">
              <span class="focus-item-title">{{ entry.nodeName }} · {{ entry.prop.displayName }}</span>
              <button class="focus-x" title="Unpin" @click="editor.togglePinParam(entry.nodeName, entry.paramName)">×</button>
            </div>
            <ParamInput
              :prop="entry.prop"
              :value="entry.node.parameters[entry.paramName]"
              :node-parameters="entry.node.parameters"
              @change="editor.setParam(entry.nodeName, entry.paramName, $event)"
            />
          </div>
        </aside>

        <NodePanel />
        </div>

        <!-- 底部条（C10 对标 n8n：有 Chat Trigger 时 Chat | Logs 双栏，否则 Logs 全宽） -->
        <div class="logs-bar" :class="{ open: logsOpen }" data-test="logs-bar">
          <div class="bottombar-heads">
            <button v-if="hasChatTrigger" class="logs-head chat-head" data-test="chat-head" @click="logsOpen = !logsOpen">
              <span>Chat</span>
              <span class="dim" style="font-size: 11px; margin-left: 10px">Session: {{ chatSessionId }}</span>
              <button class="chat-reset" title="New session" data-test="chat-reset" @click.stop="resetChatSession">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
              </button>
            </button>
            <button class="logs-head" data-test="logs-head" @click="logsOpen = !logsOpen">
              <span>Logs</span>
              <span v-if="logRows.length" class="dim" style="font-size: 11px; margin-left: 8px">
                {{ logRows.length }} nodes
              </span>
              <span style="flex: 1" />
              <span class="dim">{{ logsOpen ? '▾' : '▴' }}</span>
            </button>
          </div>
          <div v-if="logsOpen" class="bottombar-bodies">
            <!-- Chat 面板 -->
            <div v-if="hasChatTrigger" class="chat-panel" data-test="chat-panel">
              <div class="chat-messages" data-test="chat-messages">
                <p v-if="chatMessages.length === 0" class="dim chat-empty">
                  Send a message to run the workflow from its Chat Trigger.
                </p>
                <div v-for="(m, i) in chatMessages" :key="i" class="chat-msg" :class="[m.role, { err: m.error }]">
                  {{ m.text }}
                </div>
                <p v-if="chatSending" class="dim chat-empty">…</p>
              </div>
              <div class="chat-inputrow">
                <input
                  ref="chatInputRef"
                  v-model="chatDraft"
                  class="chat-input"
                  data-test="chat-input"
                  placeholder="Type message, or press 'up' for previous one"
                  :disabled="chatSending"
                  @keydown.enter="sendChat"
                />
                <button class="chat-send" data-test="chat-send" :disabled="chatSending || !chatDraft.trim()" @click="sendChat">
                  Send
                </button>
              </div>
            </div>
            <!-- Logs 面板(对标 n8n:左树 + 右详情) -->
            <div class="logs-body" :class="{ half: hasChatTrigger }">
              <p v-if="logRows.length === 0" class="dim" style="font-size: 12px; text-align: center; padding: 14px 0">
                Nothing to display yet. Execute the workflow to see execution logs.
              </p>
              <div v-else class="logs-split" data-test="logs-tree">
                <!-- 左:执行树(摘要行 + 逐节点行) -->
                <div class="logs-tree-col">
                  <div class="log-summary" :class="logSummary.status">
                    <span class="log-dot" :style="{ background: statusColor[logSummary.status] ?? 'var(--text-dim)' }" />
                    <b>{{ logSummary.label }} in {{ logSummary.total }}ms</b>
                  </div>
                  <button
                    v-for="row in logRows"
                    :key="row.name"
                    class="log-node-row"
                    :class="{ sel: selectedLogNode === row.name, iserr: row.status === 'error' }"
                    :data-test-log-node="row.name"
                    @click="selectedLogNode = row.name"
                  >
                    <span class="log-dot" :style="{ background: statusColor[row.status] ?? 'var(--text-dim)' }" />
                    <span class="log-name">{{ row.name }}</span>
                    <span class="dim log-time">{{ row.time }}ms</span>
                  </button>
                </div>
                <!-- 右:选中节点详情(状态 + Input|Output + DataPane) -->
                <div class="logs-detail-col">
                  <div v-if="selectedLogRow" class="log-detail-head">
                    <span class="log-dot" :style="{ background: statusColor[selectedLogRow.status] ?? 'var(--text-dim)' }" />
                    <b style="text-transform: capitalize">{{ selectedLogRow.status }}</b>
                    <span class="dim">in {{ selectedLogRow.time }}ms</span>
                    <span class="spacer" style="flex: 1" />
                    <div class="log-io-tabs">
                      <button :class="{ on: logDetailTab === 'input' }" data-test="log-tab-input" @click="logDetailTab = 'input'">Input</button>
                      <button :class="{ on: logDetailTab === 'output' }" data-test="log-tab-output" @click="logDetailTab = 'output'">Output</button>
                    </div>
                  </div>
                  <p v-if="selectedLogRow?.error" class="error-text" style="font-size: 11px; padding: 0 12px 6px">{{ selectedLogRow.error }}</p>
                  <div class="log-detail-data">
                    <DataPane
                      :key="selectedLogNode + logDetailTab"
                      :title="logDetailTab === 'input' ? 'Input' : 'Output'"
                      :items="logDetailTab === 'input' ? selectedLogInput : selectedLogOutput"
                      :draggable="false"
                      empty-hint="No data for this node"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit description 弹窗（对标 n8n） -->
    <div v-if="descModalOpen" class="wfs-mask" data-test="desc-modal" @click.self="descModalOpen = false">
      <div class="wfs-card" style="width: 560px">
        <div style="display: flex; align-items: flex-start; justify-content: space-between">
          <h2 class="wfs-title">Edit description</h2>
          <button class="wfs-x" @click="descModalOpen = false">×</button>
        </div>
        <textarea
          v-model="descDraft"
          data-test="desc-input"
          rows="5"
          placeholder="What does this workflow do?"
          style="width: 100%; resize: vertical"
        />
        <div style="margin-top: 18px">
          <button class="primary" data-test="desc-save" :disabled="descSaving" @click="saveDescription">
            {{ descSaving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Workflow settings 弹窗（对标 n8n：左标签右控件，左下 Save） -->
    <div v-if="wfSettingsOpen" class="wfs-mask" data-test="wf-settings-modal" @click.self="wfSettingsOpen = false">
      <div class="wfs-card">
        <div style="display: flex; align-items: flex-start; justify-content: space-between">
          <h2 class="wfs-title">Workflow settings for {{ editor.name }} <span class="wfs-id">#{{ editor.id }}</span></h2>
          <button class="wfs-x" @click="wfSettingsOpen = false">×</button>
        </div>

        <div class="wfs-row">
          <label>Execution Logic</label>
          <select v-model="wfExecutionOrder" data-test="wfs-execution-order">
            <option value="v1">v1 (recommended)</option>
            <option value="v0">v0 (legacy)</option>
          </select>
        </div>

        <div class="wfs-row">
          <label>Error Workflow (to notify when this one errors)</label>
          <select v-model="wfErrorWorkflow" data-test="wfs-error-workflow">
            <option value="">- No Workflow -</option>
            <option v-for="w in wfOtherWorkflows" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
        </div>

        <div class="wfs-row">
          <label>Timezone</label>
          <select v-model="wfTimezone" data-test="wfs-timezone">
            <option value="">Default - America/New York</option>
            <option v-for="tz in TIMEZONES" :key="tz" :value="tz">{{ tz }}</option>
          </select>
        </div>

        <div class="wfs-row">
          <label>Save failed production executions</label>
          <select v-model="wfSaveFailed" data-test="wfs-save-failed">
            <option :value="true">Default - Save</option>
            <option :value="false">Do not save</option>
          </select>
        </div>

        <div class="wfs-row">
          <label>Save successful production executions</label>
          <select v-model="wfSaveSuccess" data-test="wfs-save-success">
            <option :value="true">Default - Save</option>
            <option :value="false">Do not save</option>
          </select>
        </div>

        <div class="wfs-row">
          <label>Save manual executions</label>
          <select v-model="wfSaveManual" data-test="wfs-save-manual">
            <option :value="true">Default - Save</option>
            <option :value="false">Do not save</option>
          </select>
        </div>

        <div class="wfs-row">
          <label>Save execution progress</label>
          <select v-model="wfSaveProgress" data-test="wfs-save-progress">
            <option :value="false">Default - Do not save</option>
            <option :value="true">Save</option>
          </select>
        </div>

        <!-- Redact:Enterprise 锁(对标 n8n:灰置 + Upgrade 徽章) -->
        <div class="wfs-row">
          <label>Redact production execution data <span class="wfs-upgrade">Upgrade</span></label>
          <select disabled data-test="wfs-redact-prod"><option>Default - Do not redact</option></select>
        </div>
        <div class="wfs-row">
          <label>Redact manual execution data <span class="wfs-upgrade">Upgrade</span></label>
          <select disabled data-test="wfs-redact-manual"><option>Default - Do not redact</option></select>
        </div>

        <p v-if="wfSettingsError" class="error-text" data-test="wfs-error">{{ wfSettingsError }}</p>
        <div style="margin-top: 22px">
          <button class="primary" data-test="wfs-save" :disabled="wfSettingsSaving" @click="saveWfSettings">
            {{ wfSettingsSaving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
    </div>

    <NdvModal />
  </div>
</template>

<style scoped>
.canvas-view { flex: 1; display: flex; flex-direction: column; min-height: 0;  position: relative;
}

.wf-menu-item.disabled { opacity: 0.45; cursor: not-allowed; }

/* C10 底部 Chat | Logs 双栏 */
.bottombar-heads { display: flex; align-items: stretch; }
.bottombar-heads .logs-head { flex: 1; }
.chat-head { border-right: 1px solid var(--border); max-width: 50%; }
.chat-reset { background: none; border: none; padding: 2px 6px; margin-left: 8px; color: var(--text-dim); cursor: pointer; display: inline-flex; }
.chat-reset:hover { color: var(--text); }
.bottombar-bodies { display: flex; align-items: stretch; }
.chat-panel { flex: 1; max-width: 50%; border-right: 1px solid var(--border); display: flex; flex-direction: column; max-height: 220px; }
.chat-messages { flex: 1; overflow-y: auto; padding: 8px 14px; display: flex; flex-direction: column; gap: 6px; }
.chat-empty { font-size: 12px; margin: 10px 0; text-align: center; }
.chat-msg { max-width: 85%; padding: 6px 11px; border-radius: 10px; font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.chat-msg.user { align-self: flex-end; background: var(--accent); color: #fff; }
.chat-msg.bot { align-self: flex-start; background: var(--hover, rgba(255, 255, 255, 0.07)); color: var(--text); }
.chat-msg.err { background: color-mix(in srgb, var(--err) 22%, transparent); color: var(--err); }
.chat-inputrow { display: flex; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border); }
.chat-input { flex: 1; padding: 7px 11px; font-size: 12.5px; background: transparent; border: 1px solid var(--border); border-radius: 8px; color: var(--text); outline: none; }
.chat-input:focus { border-color: var(--accent); }
.chat-send { padding: 6px 16px; font-size: 12.5px; background: var(--accent); color: #fff; border: none; border-radius: 8px; cursor: pointer; }
.chat-send:disabled { opacity: 0.55; cursor: default; }
.logs-body.half { flex: 1; max-width: 50%; }
.open-chat-btn {
  position: absolute; bottom: 20px; left: calc(50% + 120px);
  display: inline-flex; align-items: center; gap: 7px; z-index: 30;
  padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 22px;
  background: var(--panel, #2a2a33); color: var(--text); border: 1px solid var(--border); cursor: pointer;
}
.open-chat-btn:hover { border-color: var(--accent); }

/* C9 Focus panel */
.focus-panel {
  position: absolute; top: 0; right: 0; bottom: 0; width: 340px; z-index: 25;
  background: var(--panel, #232329); border-left: 1px solid var(--border);
  display: flex; flex-direction: column; overflow-y: auto;
}
.focus-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 10px; font-weight: 600; font-size: 14px; }
.focus-x { background: none; border: none; padding: 0 4px; color: var(--text-dim); font-size: 16px; cursor: pointer; }
.focus-x:hover { color: var(--text); }
.focus-empty { padding: 18px 20px; font-size: 12.5px; line-height: 1.55; }
.focus-empty strong { color: var(--text); }
.focus-item { padding: 10px 16px 4px; border-top: 1px solid var(--border); }
.focus-item-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.focus-item-title { font-size: 12px; font-weight: 600; color: var(--text-dim); }
.canvas-side-toolbar button.on { border-color: var(--accent); color: var(--accent); }

/* C9 右侧浮动工具条 */
.canvas-side-toolbar {
  position: absolute; top: 16px; right: 16px; z-index: 30;
  display: flex; flex-direction: column; gap: 8px;
}
.canvas-side-toolbar button {
  width: 36px; height: 36px; padding: 0; display: flex; align-items: center; justify-content: center;
  background: var(--panel, #2a2a33); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); cursor: pointer;
}
.canvas-side-toolbar button:hover { border-color: var(--accent); color: var(--accent); }

/* C7 执行 split（多触发器起点选择） */
.execute-split {
  position: absolute; bottom: 20px;
  left: 50%; transform: translateX(-50%);
  display: flex; align-items: stretch; z-index: 30;
}
.execute-split .execute-workflow { position: static; transform: none; }
.execute-workflow.has-caret { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.execute-caret {
  padding: 0 12px; border: none; border-left: 1px solid rgba(255, 255, 255, 0.25);
  background: var(--accent); color: #fff; cursor: pointer;
  border-radius: 0 22px 22px 0; display: flex; align-items: center;
}
.execute-caret:hover { background: var(--accent-dim); }
.execute-caret:disabled { opacity: 0.6; cursor: default; }
.execute-menu {
  position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
  min-width: 260px; background: var(--panel, #2a2a33); border: 1px solid var(--border);
  border-radius: 8px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45); padding: 4px; z-index: 40;
}
.menu-label-sm { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; padding: 5px 10px 3px; }
.exec-trigger-option { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: none; border: none; padding: 7px 10px; font-size: 13px; color: var(--text); cursor: pointer; border-radius: 6px; }
.exec-trigger-option:hover { background: var(--hover, rgba(255, 255, 255, 0.06)); }

/* C3 顶栏 tag 编辑器 */
.wf-tagbox { position: relative; margin-left: 10px; display: flex; align-items: center; }
.add-tag { background: none; border: none; padding: 2px 6px; font-size: 12.5px; color: var(--text-dim); cursor: pointer; white-space: nowrap; }
.add-tag:hover { color: var(--text); }
.tag-chips { display: inline-flex; gap: 6px; background: none; border: none; padding: 2px 4px; cursor: pointer; }
.tag-chip-sm { font-size: 11.5px; padding: 1px 9px; border-radius: 9px; border: 1px solid var(--border); color: var(--text-dim); white-space: nowrap; }
.tag-chips:hover .tag-chip-sm { color: var(--text); border-color: var(--text-faint); }
.tag-editor { position: relative; }
.tag-input { width: 220px; padding: 5px 10px; font-size: 12.5px; background: var(--bg-input, transparent); border: 1px solid var(--accent); border-radius: 6px; color: var(--text); outline: none; }
.tag-menu {
  position: absolute; top: calc(100% + 6px); left: 0; min-width: 220px; max-height: 260px; overflow-y: auto;
  background: var(--panel, #2a2a33); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45); z-index: 70; padding: 4px;
}
.tag-option { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: none; border: none; padding: 7px 10px; font-size: 13px; color: var(--text); cursor: pointer; border-radius: 6px; }
.tag-option:hover { background: var(--hover, rgba(255, 255, 255, 0.06)); }
.tag-option.create { color: var(--accent); }
.tag-check { width: 14px; color: var(--accent); flex: none; }
.tag-empty { margin: 0; padding: 8px 10px; font-size: 12px; }

/* 画布内 tabs — n8n 实测：pill 外层 bg neutral-800/圆角 4/衬 2、
   浮动居中在头带下缘(y48,压过 65px 头带);格 26px/12px-500,激活 bg light-2 */
.canvas-tabs {
  position: absolute; left: 50%; top: 48px; transform: translateX(-50%); z-index: 12;
  display: flex; background: var(--color--neutral-800);
  border-radius: var(--radius); padding: 2px;
}
.canvas-tab {
  border: none; background: none; height: 26px; padding: 0 var(--spacing--xs); border-radius: var(--radius);
  font-size: var(--font-size--2xs); font-weight: var(--font-weight--medium);
  color: var(--color--text); cursor: pointer;
}
.canvas-tab.active { background: var(--color--background--light-2); color: var(--color--text--shade-1); }

/* Executions 视图 */
.exec-body { flex: 1; display: flex; min-height: 0; }

/* Evaluations 注册锁态(对标 n8n Community):左说明+视频位 / 右虚线框 Register */
.eval-view { flex: 1; display: flex; gap: 40px; padding: 56px 64px; align-items: center; justify-content: center; min-height: 0; }
.eval-left { flex: 1; max-width: 440px; }
.eval-h { margin: 0; font-size: 22px; font-weight: var(--font-weight--bold); color: var(--color--text--shade-1); }
.eval-desc { margin: 12px 0 0; font-size: var(--font-size--sm); color: var(--text-dim); }
.eval-video { margin-top: 20px; aspect-ratio: 16/9; border-radius: 8px; background: var(--bg-panel); border: 1px solid var(--border); }
.eval-right {
  flex: 1; max-width: 380px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px;
  border: 2px dashed var(--border-strong); border-radius: 12px; padding: 48px 28px;
}
.eval-reg-title { margin: 0; font-size: var(--font-size--md); font-weight: var(--font-weight--bold); color: var(--color--text--shade-1); }
.eval-reg-desc { margin: 0; font-size: var(--font-size--sm); color: var(--text-dim); }
.eval-view .link { color: var(--accent); text-decoration: none; }
.eval-view .link:hover { text-decoration: underline; }
.exec-list {
  width: 340px; flex-shrink: 0; border-right: 1px solid var(--border);
  display: flex; flex-direction: column; overflow-y: auto; background: var(--bg);
}
.exec-list-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 10px; }
.exec-list-head h3 { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-hi); }
.exec-autorefresh { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 12.5px; color: var(--text-dim); cursor: pointer; }
.exec-autorefresh input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); }
.exec-item {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  padding: 10px 16px; background: none; border: none; border-top: 1px solid var(--border);
  cursor: pointer; color: var(--text-hi);
}
.exec-item:hover { background: var(--bg-input); }
.exec-item.selected { background: var(--bg-panel); box-shadow: inset 3px 0 0 var(--accent); }
.exec-item.iserr { background: rgba(229, 72, 77, 0.06); }
.exec-item.iserr:hover, .exec-item.iserr.selected { background: rgba(229, 72, 77, 0.12); }
.exec-item-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 13px; }
.exec-item-main .dim { font-size: 12px; }
.exec-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.exec-policy { margin-top: auto; border-top: 1px solid var(--border); }
.exec-policy-toggle {
  display: flex; align-items: center; justify-content: space-between; width: 100%;
  padding: 12px 16px; background: none; border: none; font-size: 12.5px;
  color: var(--text-dim); cursor: pointer; text-align: left;
}
.exec-policy-body { padding: 0 16px 14px; font-size: 12.5px; display: flex; flex-direction: column; gap: 5px; }
.exec-detail { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.exec-empty { text-align: center; margin-top: 16vh; padding: 0 28px; }
.exec-empty h2 { font-size: 20px; font-weight: 500; color: var(--text-hi); margin: 0 0 10px; }
.exec-detail-head { display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 14px 20px; border-bottom: var(--border-width) var(--border-style) var(--border-color); }
.exec-copy-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  background: var(--color--background--light-3); border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); color: var(--color--text--shade-1); font-size: var(--font-size--2xs); cursor: pointer;
}
.exec-copy-btn:hover { border-color: var(--border-color--strong); }
.exec-trash-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px;
  background: var(--color--background--light-3); border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); color: var(--color--text--shade-1); cursor: pointer;
}
.exec-trash-btn:hover:not(:disabled) { border-color: var(--color--danger); color: var(--color--danger); }
.exec-trash-btn:disabled { opacity: 0.5; cursor: default; }
.exec-ro-canvas { flex: 1; min-height: 0; }
.exec-data-panel { border-top: var(--border-width) var(--border-style) var(--border-color); flex-shrink: 0; max-height: 45%; display: flex; flex-direction: column; }
.exec-data-toggle {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;
  padding: 10px 20px; background: var(--color--background--light-3); border: none;
  color: var(--color--text--shade-1); font-size: var(--font-size--2xs); font-weight: 600; text-align: left; cursor: pointer;
}
.exec-nodes { overflow-y: auto; padding: 6px 20px 16px; }
.exec-node { border-bottom: 1px solid var(--border); }
.exec-node-row {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 2px;
  background: none; border: none; cursor: pointer; color: var(--text-hi); font-size: 13.5px; text-align: left;
}
.exec-node-row:hover { background: var(--bg-input); }
.exec-json {
  margin: 0 0 12px 22px; padding: 12px; background: var(--bg); border: 1px solid var(--border);
  border-radius: 8px; font-size: 12px; max-height: 320px; overflow: auto;
  font-family: 'SF Mono', ui-monospace, Menlo, monospace; color: var(--text);
}
.accent-link { color: var(--accent); text-decoration: none; font-size: 12.5px; }
.accent-link:hover { text-decoration: underline; }

/* 自动保存指示 / 触发器计数 / Publish 分裂按钮 */
.save-hint { font-size: 12px; }
.pub-count {
  font-size: 12.5px; color: var(--text-dim); padding: 4px 10px;
  background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
}
.publish-split { display: inline-flex; position: relative; }
.publish-split .publish-btn { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.publish-caret {
  display: inline-flex; align-items: center; justify-content: center; width: 26px; padding: 0;
  border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: 1px;
}
.publish-menu { right: 0; top: calc(100% + 6px); left: auto; }

/* Workflow settings 弹窗 */
.wfs-mask {
  position: fixed; inset: 0; z-index: 100; background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: flex-start; justify-content: center; padding-top: 9vh;
}
.wfs-card {
  width: 720px; max-width: 94vw; max-height: 80vh; overflow-y: auto;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 10px;
  padding: 24px 28px 26px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.wfs-title { margin: 0 0 20px; font-size: 19px; font-weight: 500; color: var(--text-hi); }
.wfs-id { color: var(--text-faint); font-weight: 400; font-size: 14px; }
.wfs-upgrade { font-size: 11px; font-weight: 400; padding: 1px 8px; margin-left: 6px; border: 1px solid var(--border); border-radius: 6px; color: var(--text-dim); }
.wfs-x { background: none; border: none; color: var(--text-dim); font-size: 20px; cursor: pointer; padding: 0 6px; line-height: 1; }
.wfs-x:hover { color: var(--text-hi); }
.wfs-row { display: flex; align-items: center; gap: 20px; margin-bottom: 14px; }
.wfs-row label { flex: 0 0 300px; margin: 0; font-size: 13.5px; color: var(--text-hi); line-height: 1.4; }
.wfs-row select { flex: 1; }
/* n8n 实测：头带 65px 高 / bg light-3 / 无下边线(pill 悬浮压过下缘) */
.toolbar {
  display: flex; align-items: center; gap: 12px; height: 65px; flex-shrink: 0;
  padding: 0 var(--spacing--sm); background: var(--color--background--light-3);
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
/* n8n 实测：Execute workflow = 36px 高 / 圆角 6 / 衬 0 16 / 14px-500 /
   primary + inset 橙环 + 0 1px 3px -1px 投影（非胶囊、无橙色泛光） */
.execute-workflow {
  position: absolute; bottom: 56px; left: 50%; transform: translateX(-50%); z-index: 8;
  height: 36px; background: var(--button--color--background--primary); border: none;
  color: var(--button--color--text--primary); font-weight: var(--font-weight--medium);
  padding: 0 var(--spacing--sm); font-size: var(--font-size--sm); border-radius: var(--radius--2xs);
  box-shadow: inset 0 0 0 1px var(--button--border-color--primary), 0 1px 3px -1px var(--color--black-alpha-100);
}
.execute-workflow:hover { background: var(--button--color--background--primary--hover-active-focus); }
.run-error-toast {
  position: absolute; bottom: 100px; left: 50%; transform: translateX(-50%); z-index: 8;
  color: var(--err); font-size: 12px; background: var(--bg-panel);
  padding: 6px 12px; border-radius: 6px; border: 1px solid var(--err); max-width: 60%;
}
/* Logs 条入文档流：展开/收起自然压缩画布区，浮动控件始终保持间距 */
.canvas-stage { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* n8n 实测：Logs 条 33px(衬 8px 8px 8px 16px)/ bg light-2 / 文案 12px-500 白 */
.logs-bar {
  flex: none; z-index: 9;
  background: var(--color--background--light-2); border-top: var(--border-width) var(--border-style) var(--border-color);
}
.logs-head {
  display: flex; align-items: center; width: 100%; text-align: left;
  padding: 8px 8px 8px 16px; background: none; border: none; border-radius: 0; height: auto;
  font-size: var(--font-size--2xs); font-weight: var(--font-weight--medium); color: var(--color--text--shade-1);
}
.logs-body { max-height: 300px; overflow: hidden; padding: 0; display: flex; flex-direction: column; }
.log-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* D123 Logs 执行树:左树 + 右详情 */
.logs-split { flex: 1; min-height: 0; display: flex; }
.logs-tree-col {
  width: 300px; flex-shrink: 0; overflow-y: auto; padding: 8px;
  border-right: var(--border-width) var(--border-style) var(--border-color);
}
.log-summary { display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: 13px; }
.log-summary.error b { color: var(--color--danger); }
.log-dot { width: 8px; height: 8px; flex-shrink: 0; border-radius: 50%; }
.log-node-row {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  padding: 7px 10px 7px 22px; background: none; border: none; border-radius: var(--radius);
  color: var(--color--text--shade-1); font-size: 13px; cursor: pointer;
}
.log-node-row:hover { background: var(--color--background--light-1); }
.log-node-row.sel { background: var(--color--background--light-1); }
.log-node-row.iserr .log-name { color: var(--color--danger); }
.log-time { font-size: 11px; }
.logs-detail-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.log-detail-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; font-size: 13px; border-bottom: var(--border-width) var(--border-style) var(--border-color); }
.log-io-tabs { display: flex; gap: 2px; background: var(--bg-input); border-radius: 6px; padding: 2px; }
.log-io-tabs button {
  padding: 3px 12px; font-size: 11px; border: none; background: none; border-radius: 5px;
  color: var(--text-dim); cursor: pointer;
}
.log-io-tabs button.on { background: var(--bg-panel); color: var(--text); }
.log-detail-data { flex: 1; min-height: 0; overflow: hidden; }
</style>
