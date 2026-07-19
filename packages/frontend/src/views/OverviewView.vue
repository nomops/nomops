<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { IRunExecutionData } from '@nomops/workflow';
import {
  api,
  type CredentialView,
  type DataTableView,
  type ExecutionRow,
  type MemberRow,
  type VariableView,
  type WorkflowRow,
  type WorkflowDependency,
  type FolderRow,
  type TagRow,
  type WorkflowMetaRow,
} from '../api/client.js';
import { useProjectsStore } from '../stores/projects.js';
import CredentialModal from '../components/credentials/CredentialModal.vue';
import StatsBar from '../components/shell/StatsBar.vue';
import IconSvg from '../components/IconSvg.vue';
import { credentialTypeMeta } from '../lib/credential-types.js';
import { credentialIcon } from '../lib/icons.js';
import { locale, t } from '../lib/i18n.js';

/** Overview：五 Tab（Workflows/Credentials/Executions/Variables/Data tables）+ 搜索/排序/筛选 + 分页。 */
type Tab = 'workflows' | 'credentials' | 'executions' | 'variables' | 'data-tables' | 'project-settings';
type SortKey = 'updated' | 'created' | 'name-asc' | 'name-desc';
type StatusFilter = 'all' | 'published' | 'unpublished';

const route = useRoute();
const router = useRouter();
const projects = useProjectsStore();

const tab = ref<Tab>((route.query['tab'] as Tab) ?? 'workflows');
const search = ref('');
const error = ref('');

const workflows = ref<WorkflowRow[]>([]);
const folders = ref<FolderRow[]>([]);
const currentFolderId = ref<string | null>(null); // null = 项目根
const credentials = ref<CredentialView[]>([]);
const executions = ref<ExecutionRow[]>([]);

/* 凭证：弹窗（选类型 → 填字段）；editingCred 非空 = 编辑模式（对标 n8n 卡片 Open） */
const showCredModal = ref(false);
const editingCred = ref<CredentialView | null>(null);
function openCredential(row: CredentialView) {
  closeMenus();
  editingCred.value = row;
  showCredModal.value = true;
}
function closeCredModal() {
  showCredModal.value = false;
  editingCred.value = null;
}
async function onCredUpdated() {
  credentials.value = await api.credentials.list().catch(() => credentials.value);
}
/** 凭证被哪些工作流引用（B3 依赖图反查；对标 n8n 凭证卡片依赖胶囊）。 */
function credUsedBy(credId: string): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  for (const [wfId, deps] of Object.entries(wfDeps.value)) {
    if (deps.some((d) => d.type === 'credential' && d.id === credId)) {
      const wf = workflows.value.find((w) => w.id === wfId);
      out.push({ id: wfId, name: wf?.name ?? wfId });
    }
  }
  return out;
}

/* 项目设置（团队项目 tab）：成员管理 */
const members = ref<MemberRow[]>([]);
const memberEmail = ref('');
const memberRole = ref('project:editor');
const memberError = ref('');

/* Variables（项目维度键值对，$vars.KEY） */
const variables = ref<VariableView[]>([]);
const editingVar = ref<{ id: string | 'new'; key: string; value: string } | null>(null);
const varError = ref('');

async function loadVariables() {
  varError.value = '';
  variables.value = await api.variables.list().catch(() => []);
}
function startNewVariable() {
  editingVar.value = { id: 'new', key: '', value: '' };
}

/* B1 对标 n8n：右上创建按钮随 tab 切换（split：主按钮 + caret 列其余创建项） */
type CreateKey = 'workflow' | 'credential' | 'variable' | 'data-table';
const CREATE_ACTIONS: Record<CreateKey, { label: string; run: () => void }> = {
  workflow: { label: 'Create workflow', run: () => createWorkflow() },
  credential: { label: 'Create credential', run: () => { editingCred.value = null; showCredModal.value = true; } },
  variable: {
    label: 'Create variable',
    run: () => {
      if (tab.value !== 'variables') switchTab('variables'); // 行内新建行只在该 tab 可见
      startNewVariable();
    },
  },
  'data-table': { label: 'Create data table', run: () => openCreateDataTable() },
};
/* Executions 无创建动作 → 同 n8n 回退 Create workflow */
const primaryCreate = computed<CreateKey>(() => {
  if (tab.value === 'credentials') return 'credential';
  if (tab.value === 'variables') return 'variable';
  if (tab.value === 'data-tables') return 'data-table';
  return 'workflow';
});
const secondaryCreates = computed<CreateKey[]>(() =>
  (Object.keys(CREATE_ACTIONS) as CreateKey[]).filter((k) => k !== primaryCreate.value),
);
function runCreate(key: CreateKey) {
  closeMenus();
  CREATE_ACTIONS[key].run();
}
function editVariable(v: VariableView) {
  editingVar.value = { id: v.id, key: v.key, value: v.value };
}
async function saveVariable() {
  const e = editingVar.value;
  if (!e || !e.key.trim()) return;
  varError.value = '';
  try {
    if (e.id === 'new') await api.variables.create({ key: e.key.trim(), value: e.value });
    else await api.variables.update(e.id, { key: e.key.trim(), value: e.value });
    editingVar.value = null;
    await loadVariables();
  } catch (err) {
    varError.value = (err as Error).message;
  }
}
async function deleteVariable(id: string) {
  await api.variables.remove(id).catch((err) => (varError.value = (err as Error).message));
  await loadVariables();
}
/** 表达式引用写法（模板里不能直接写字面 {{ }}，用方法返回）。 */
const varUsage = (key: string): string => `{{ $vars.${key} }}`;

/* Data tables（项目维度结构化表） */
const dataTables = ref<DataTableView[]>([]);
const dtError = ref('');
const showDataTableModal = ref(false);
const newTableName = ref('');
const creatingTable = ref(false);

async function loadDataTables() {
  dtError.value = '';
  dataTables.value = await api.dataTables.list().catch(() => []);
}
function openCreateDataTable() {
  newTableName.value = '';
  dtError.value = '';
  showDataTableModal.value = true;
}
async function createDataTable() {
  const name = newTableName.value.trim();
  if (!name || creatingTable.value) return;
  creatingTable.value = true;
  dtError.value = '';
  try {
    const created = await api.dataTables.create({ name });
    showDataTableModal.value = false;
    void router.push({ name: 'datatable', params: { id: created.id } });
  } catch (err) {
    dtError.value = (err as Error).message;
  } finally {
    creatingTable.value = false;
  }
}
function openDataTable(id: string) {
  closeMenus();
  void router.push({ name: 'datatable', params: { id } });
}
async function deleteDataTable(id: string) {
  closeMenus();
  await api.dataTables.remove(id).catch((err) => (dtError.value = (err as Error).message));
  await loadDataTables();
}

/* 弹层：create 下拉 / 排序 / 某行的 ⋮ 菜单 */
const openMenu = ref<string | null>(null);
function toggleMenu(id: string) {
  openMenu.value = openMenu.value === id ? null : id;
}
function closeMenus() {
  openMenu.value = null;
}

/* 筛选 / 排序 / 分页 */
const sortKey = ref<SortKey>('updated');
// D037 对标 n8n:Status 三态(All/Published/Unpublished),取代原 activeOnly 布尔
const statusFilter = ref<StatusFilter>('all');
const showFilter = ref(false);
const page = ref(1);
const pageSize = ref(50);

/* ── Tags + 运行统计（阶段五） ── */
const allTags = ref<TagRow[]>([]);
const metaByWorkflow = ref<Record<string, WorkflowMetaRow>>({});
const tagFilterId = ref<string | null>(null);
const managingTagsFor = ref<WorkflowRow | null>(null);
const managedTagIds = ref<Set<string>>(new Set());
const newTagName = ref('');
const tagError = ref('');

async function loadTagsMeta() {
  const [tags, meta] = await Promise.all([api.tags.list().catch(() => []), api.workflowsMeta().catch(() => [])]);
  allTags.value = tags.sort((a, b) => a.name.localeCompare(b.name));
  const map: Record<string, WorkflowMetaRow> = {};
  for (const m of meta) map[m.workflowId] = m;
  metaByWorkflow.value = map;
}
const tagsOf = (workflowId: string): TagRow[] => metaByWorkflow.value[workflowId]?.tags ?? [];
/** 卡片元信息里的生产运行数摘要；无统计返回空串不占位。 */
const statsLabel = (workflowId: string): string => {
  const s = metaByWorkflow.value[workflowId]?.statistics;
  if (!s) return '';
  const prod = s.productionSuccess + s.productionError;
  return prod > 0 ? t(prod > 1 ? '{n} prod runs' : '{n} prod run', { n: prod }) : '';
};

function openManageTags(row: WorkflowRow) {
  closeMenus();
  managingTagsFor.value = row;
  managedTagIds.value = new Set(tagsOf(row.id).map((t) => t.id));
  newTagName.value = '';
  tagError.value = '';
}
function toggleManagedTag(id: string) {
  const next = new Set(managedTagIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  managedTagIds.value = next;
}
async function createTag() {
  const name = newTagName.value.trim();
  if (!name) return;
  tagError.value = '';
  try {
    const created = await api.tags.create(name);
    allTags.value = [...allTags.value, created].sort((a, b) => a.name.localeCompare(b.name));
    managedTagIds.value = new Set([...managedTagIds.value, created.id]); // 新建即勾选
    newTagName.value = '';
  } catch (err) {
    tagError.value = (err as Error).message;
  }
}
async function deleteTag(id: string) {
  tagError.value = '';
  try {
    await api.tags.remove(id);
    if (tagFilterId.value === id) tagFilterId.value = null;
    const next = new Set(managedTagIds.value);
    next.delete(id);
    managedTagIds.value = next;
    await loadTagsMeta();
  } catch (err) {
    tagError.value = (err as Error).message;
  }
}
async function saveWorkflowTags() {
  const wf = managingTagsFor.value;
  if (!wf) return;
  tagError.value = '';
  try {
    await api.tags.setForWorkflow(wf.id, [...managedTagIds.value]);
    managingTagsFor.value = null;
    await loadTagsMeta();
  } catch (err) {
    tagError.value = (err as Error).message;
  }
}

onMounted(async () => {
  await projects.fetch();
  await reload();
  window.addEventListener('click', closeMenus);
});

/** 侧栏「New credential」带 ?new=cred 进入 → 切到 Credentials 并自动开弹窗。 */
watch(
  () => route.query['new'],
  (v) => {
    if (v === 'cred') {
      tab.value = 'credentials';
      showCredModal.value = true;
    }
  },
  { immediate: true },
);

/** 切到 Project settings / Variables tab 时拉数据。 */
watch(
  () => tab.value,
  (t) => {
    if (t === 'project-settings') void loadMembers();
    else if (t === 'variables') void loadVariables();
    else if (t === 'data-tables') void loadDataTables();
  },
  { immediate: true },
);
onUnmounted(() => window.removeEventListener('click', closeMenus));

/* B3 依赖胶囊（对标 n8n DependencyPill）：workflowId → 依赖列表；分组展示可跳转 */
const wfDeps = ref<Record<string, WorkflowDependency[]>>({});
const DEP_GROUPS: Array<{ type: WorkflowDependency['type']; label: string; icon: string }> = [
  { type: 'credential', label: 'Credentials', icon: 'M21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3M11.4 11.6a4.6 4.6 0 1 0-6.5 6.5 4.6 4.6 0 0 0 6.5-6.5z' },
  { type: 'subWorkflow', label: 'Sub-workflows', icon: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' },
  { type: 'parentWorkflow', label: 'Used by workflows', icon: 'M9 21H3v-6M14 10L3 21M6 11V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-6' },
  { type: 'errorWorkflow', label: 'Error workflow', icon: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' },
  { type: 'errorWorkflowParent', label: 'Error handler for', icon: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' },
];
function depGroups(wfId: string) {
  const deps = wfDeps.value[wfId] ?? [];
  return DEP_GROUPS.map((g) => ({ ...g, deps: deps.filter((d) => d.type === g.type) })).filter((g) => g.deps.length > 0);
}
function openDependency(dep: WorkflowDependency) {
  closeMenus();
  if (dep.type === 'credential') {
    switchTab('credentials');
    search.value = dep.name; // 凭证无独立详情页：切 tab 并按名过滤定位
  } else {
    window.open(router.resolve({ name: 'canvas', params: { id: dep.id } }).href, '_blank'); // 同 n8n：新标签打开
  }
}

async function reload() {
  error.value = '';
  try {
    const [wf, cred, exec, fld] = await Promise.all([
      api.workflows.list(currentFolderId.value, showArchived.value), // 按当前文件夹过滤；归档视图切换
      api.credentials.list(),
      api.executions.list(),
      api.folders.list(),
    ]);
    workflows.value = wf;
    credentials.value = cred;
    executions.value = exec.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    folders.value = fld;
    void loadTagsMeta(); // 标签/统计非关键路径，异步补齐
    void api.workflows.dependencies().then((d) => (wfDeps.value = d)).catch(() => {}); // 胶囊非关键路径
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function switchTab(next: Tab) {
  tab.value = next;
  page.value = 1;
  // 保留 project 上下文（切 tab 不要丢 ?project=），并清掉一次性的 new 标记
  const { new: _drop, ...rest } = route.query;
  void router.replace({ query: { ...rest, tab: next } });
}

const q = computed(() => search.value.trim().toLowerCase());

/** workflows：搜索 → 仅激活 → 排序 */
const sortedWorkflows = computed(() => {
  let rows = workflows.value.slice();
  if (q.value) rows = rows.filter((w) => w.name.toLowerCase().includes(q.value));
  if (statusFilter.value === 'published') rows = rows.filter((w) => w.active);
  else if (statusFilter.value === 'unpublished') rows = rows.filter((w) => !w.active);
  if (tagFilterId.value) rows = rows.filter((w) => tagsOf(w.id).some((t) => t.id === tagFilterId.value));
  rows.sort((a, b) => {
    // 收藏置顶（同组内再按所选键排）
    if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
    if (sortKey.value === 'name-asc') return a.name.localeCompare(b.name);
    if (sortKey.value === 'name-desc') return b.name.localeCompare(a.name);
    if (sortKey.value === 'created') return b.createdAt.localeCompare(a.createdAt);
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return rows;
});
const pagedWorkflows = computed(() =>
  sortedWorkflows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);
const totalPages = computed(() => Math.max(1, Math.ceil(sortedWorkflows.value.length / pageSize.value)));

/* ── 文件夹 ── */
const subfolders = computed(() =>
  folders.value
    .filter((f) => f.parentFolderId === currentFolderId.value)
    .sort((a, b) => a.name.localeCompare(b.name)),
);
/** 当前文件夹的祖先链（面包屑，根→当前）。 */
const breadcrumb = computed(() => {
  const byId = new Map(folders.value.map((f) => [f.id, f]));
  const path: FolderRow[] = [];
  let id = currentFolderId.value;
  while (id) {
    const f = byId.get(id);
    if (!f) break;
    path.unshift(f);
    id = f.parentFolderId;
  }
  return path;
});

async function enterFolder(id: string | null) {
  closeMenus();
  currentFolderId.value = id;
  page.value = 1;
  await reload();
}
/* B7 对标 n8n：Add folder 图标按钮 → 命名弹窗（Create / Cancel） */
const folderModalOpen = ref(false);
const folderNameDraft = ref('');
const folderModalError = ref('');
const currentFolderName = computed(() => folders.value.find((f) => f.id === currentFolderId.value)?.name ?? null);
function openCreateFolder() {
  folderNameDraft.value = '';
  folderModalError.value = '';
  folderModalOpen.value = true;
}
async function confirmCreateFolder() {
  const name = folderNameDraft.value.trim();
  if (!name) return;
  try {
    await api.folders.create(name, currentFolderId.value);
    folderModalOpen.value = false;
    await reload();
  } catch (e) {
    folderModalError.value = (e as Error).message;
  }
}
async function deleteFolder(id: string) {
  if (!window.confirm(t('Delete this folder? It must be empty.'))) return;
  try {
    await api.folders.remove(id);
    await reload();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function moveWorkflowToFolder(wfId: string, folderId: string | null) {
  closeMenus();
  try {
    await api.workflows.move(wfId, folderId);
    await reload(); // 移出当前文件夹后列表刷新
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const filteredCredentials = computed(() => {
  const list = q.value ? credentials.value.filter((c) => c.name.toLowerCase().includes(q.value)) : credentials.value;
  return [...list].sort((a, b) => {
    if (sortKey.value === 'name-asc') return a.name.localeCompare(b.name);
    if (sortKey.value === 'name-desc') return b.name.localeCompare(a.name);
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  });
});

async function createWorkflow() {
  closeMenus();
  const wf = await api.workflows.create({ name: 'My workflow', nodes: [], connections: {}, folderId: currentFolderId.value });
  void router.push({ name: 'canvas', params: { id: wf.id } });
}

async function toggleActive(row: WorkflowRow) {
  closeMenus();
  error.value = '';
  try {
    const result = await api.workflows.activate(row.id, !row.active);
    row.active = result.active;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function removeWorkflow(id: string) {
  closeMenus();
  await api.workflows.remove(id);
  workflows.value = workflows.value.filter((w) => w.id !== id);
}

/* ── B2 对标 n8n 卡片菜单：Open / Share... / Favorite / Duplicate / Archive / Enable MCP access ── */
const showArchived = ref(false); // 归档视图切换（默认列表隐藏 archived）
watch(showArchived, () => void reload());

/* D039:Share... = Enterprise 锁(Community 不能共享工作流,对标 n8n)。 */
const shareLockOpen = ref(false);
function openShareLock() {
  closeMenus();
  shareLockOpen.value = true;
}

async function toggleFavorite(row: WorkflowRow) {
  closeMenus();
  const updated = await api.workflows.setFavorite(row.id, !row.favorite).catch(() => null);
  if (updated) Object.assign(row, { favorite: updated.favorite });
}

async function duplicateWorkflow(row: WorkflowRow) {
  closeMenus();
  const full = await api.workflows.get(row.id);
  const copy = await api.workflows.create({
    name: `${full.name} copy`,
    nodes: full.nodes,
    connections: full.connections,
    folderId: full.folderId,
  });
  void router.push({ name: 'canvas', params: { id: copy.id } });
}

async function archiveWorkflow(row: WorkflowRow) {
  closeMenus();
  await api.workflows.archive(row.id).catch((e) => (error.value = (e as Error).message));
  await reload();
}

async function unarchiveWorkflow(row: WorkflowRow) {
  closeMenus();
  await api.workflows.unarchive(row.id).catch((e) => (error.value = (e as Error).message));
  await reload();
}

/** 加入实例 MCP 白名单（需要 admin + 工作流已发布，失败原样提示）。 */
async function enableMcpAccess(row: WorkflowRow) {
  closeMenus();
  error.value = '';
  try {
    const status = await api.mcp.status();
    if (status.workflowIds.includes(row.id)) {
      error.value = `“${row.name}” already has MCP access`;
      return;
    }
    await api.mcp.setWorkflows([...status.workflowIds, row.id]);
  } catch (e) {
    error.value = (e as Error).message; // 非 admin 403 / 未发布 400 / MCP 未启用
  }
}

function openWorkflow(id: string) {
  closeMenus();
  void router.push({ name: 'canvas', params: { id } });
}

function onCredCreated(created: CredentialView) {
  credentials.value.push(created);
}

const credLabel = (type: string) => credentialTypeMeta(type)?.displayName ?? type;

async function removeCredential(id: string) {
  await api.credentials.remove(id);
  credentials.value = credentials.value.filter((c) => c.id !== id);
}

/* ── B5 对标 n8n Executions 表：行点击进画布执行视图；多选/重试/删除/自动刷新 ── */

function openExecution(row: ExecutionRow) {
  void router.push({ name: 'canvas', params: { id: row.workflowId }, query: { tab: 'executions', exec: row.id } });
}

/* Auto refresh（同 n8n 默认开，5s；仅 executions tab 时轮询） */
const execAutoRefresh = ref(true);
let execPollTimer: ReturnType<typeof setInterval> | null = null;
watch(
  tab,
  (t2) => {
    if (t2 === 'executions' && !execPollTimer) {
      execPollTimer = setInterval(() => {
        if (execAutoRefresh.value) {
          void api.executions.list().then((exec) => {
            executions.value = exec.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          }).catch(() => {});
        }
      }, 5000);
    } else if (t2 !== 'executions' && execPollTimer) {
      clearInterval(execPollTimer);
      execPollTimer = null;
    }
  },
  { immediate: true },
);
onUnmounted(() => {
  if (execPollTimer) clearInterval(execPollTimer);
});

/* 多选（底部浮条：N selected | Delete | Clear selection） */
const selectedExecIds = ref<Set<string>>(new Set());
const allExecSelected = computed(
  () => executions.value.length > 0 && executions.value.every((e) => selectedExecIds.value.has(e.id)),
);
function toggleExecSelect(id: string) {
  const next = new Set(selectedExecIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedExecIds.value = next;
}
function toggleExecSelectAll() {
  selectedExecIds.value = allExecSelected.value ? new Set() : new Set(executions.value.map((e) => e.id));
}
async function deleteSelectedExecs() {
  const ids = [...selectedExecIds.value];
  await Promise.all(ids.map((id) => api.executions.remove(id).catch(() => {})));
  selectedExecIds.value = new Set();
  executions.value = executions.value.filter((e) => !ids.includes(e.id));
}

/* 行 ⋮：Retry ×2 / Delete */
const retryingId = ref<string | null>(null);
async function retryExec(row: ExecutionRow, useOriginal: boolean) {
  closeMenus();
  retryingId.value = row.id;
  error.value = '';
  try {
    await api.executions.retry(row.id, useOriginal);
    executions.value = (await api.executions.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    retryingId.value = null;
  }
}
async function deleteExec(row: ExecutionRow) {
  closeMenus();
  await api.executions.remove(row.id).catch((e) => (error.value = (e as Error).message));
  executions.value = executions.value.filter((e) => e.id !== row.id);
}

const sortLabel = computed(
  () =>
    t(
      { updated: 'Sort by last updated', created: 'Sort by last created', 'name-asc': 'Sort by name (A-Z)', 'name-desc': 'Sort by name (Z-A)' }[
        sortKey.value
      ],
    ),
);

const ownerName = computed(() => {
  const c = projects.current;
  return !c || c.type === 'personal' ? t('Personal') : c.name;
});

/** Overview = 聚合视图；点侧栏项目（?project=）= 该项目视图，标题用项目名。 */
const inProjectView = computed(() => Boolean(route.query['project']));
const pageTitle = computed(() => (inProjectView.value ? projects.currentName : t('Overview')));
const pageSub = computed(() => {
  if (!inProjectView.value) return t('All the workflows, credentials and data tables you have access to');
  return projects.current?.type === 'personal'
    ? t('Workflows, credentials and data tables owned by you')
    : t('Workflows, credentials and data tables in {name}', { name: projects.currentName });
});

/** Project settings tab 只在团队项目视图显示（Personal 没有）。 */
const showProjectSettings = computed(() => inProjectView.value && projects.current?.type !== 'personal');

async function loadMembers() {
  memberError.value = '';
  if (!showProjectSettings.value || !projects.current) return;
  members.value = await api.projects.members(projects.current.id).catch((e) => {
    memberError.value = (e as Error).message;
    return [];
  });
}
async function addMember() {
  if (!projects.current) return;
  memberError.value = '';
  try {
    await api.projects.addMember(projects.current.id, memberEmail.value, memberRole.value);
    memberEmail.value = '';
    await loadMembers();
  } catch (e) {
    memberError.value = (e as Error).message;
  }
}
async function changeMemberRole(userId: string, event: Event) {
  if (!projects.current) return;
  await api.projects
    .updateMember(projects.current.id, userId, (event.target as HTMLSelectElement).value)
    .catch((e) => (memberError.value = (e as Error).message));
  await loadMembers();
}
async function removeMember(userId: string) {
  if (!projects.current) return;
  await api.projects.removeMember(projects.current.id, userId).catch((e) => (memberError.value = (e as Error).message));
  await loadMembers();
}
const projectRoleLabel: Record<string, string> = {
  'project:owner': 'Owner',
  'project:editor': 'Editor',
  'project:viewer': 'Viewer',
};

/** "11 July" 式创建日期（中文界面用 zh-CN 本地化）。 */
const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-GB', { day: 'numeric', month: 'long' });

const timeAgo = (iso: string | null): string => {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return t('just now');
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return t(m > 1 ? '{n} minutes ago' : '{n} minute ago', { n: m });
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return t(h > 1 ? '{n} hours ago' : '{n} hour ago', { n: h });
  }
  return new Date(iso).toLocaleDateString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', { month: 'long', day: 'numeric' });
};

const showFilterRow = computed(() => tab.value === 'workflows' || tab.value === 'credentials');

/* ── Executions ── */
const workflowNameById = computed(() => {
  const map: Record<string, string> = {};
  for (const w of workflows.value) map[w.id] = w.name;
  return map;
});

const execStatus: Record<string, { label: string; cls: string }> = {
  success: { label: 'Success', cls: 'ok' },
  error: { label: 'Error', cls: 'err' },
  running: { label: 'Running', cls: 'run' },
  canceled: { label: 'Canceled', cls: 'muted' },
  queued: { label: 'Queued', cls: 'muted' },
  new: { label: 'New', cls: 'muted' },
};
const statusMeta = (s: string) => execStatus[s] ?? { label: s, cls: 'muted' };

const fmtStarted = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '-';

const fmtRunTime = (row: ExecutionRow): string => {
  if (!row.startedAt || !row.stoppedAt) return row.status === 'running' ? '—' : '-';
  const ms = new Date(row.stoppedAt).getTime() - new Date(row.startedAt).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
};


</script>

<template>
  <div class="ov">
    <!-- ── Header ── -->
    <div class="ov-head">
      <div class="ov-title">
        <h1>{{ pageTitle }}</h1>
        <p class="ov-sub">{{ pageSub }}</p>
      </div>
      <div class="ov-actions">
        <!-- 右上创建按钮随 tab 切换（对标 n8n：split 主按钮 + caret 列其余创建项） -->
        <template v-if="tab !== 'project-settings'">
          <!-- Run live demo 已按裁决移入侧栏 Help 菜单 -->
          <div class="split" @click.stop>
            <button class="btn primary split-main" data-test="create-primary" @click="runCreate(primaryCreate)">
              {{ t(CREATE_ACTIONS[primaryCreate].label) }}
            </button>
            <button class="split-caret" data-test="create-menu-toggle" @click="toggleMenu('create')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" class="i14"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <div v-if="openMenu === 'create'" class="menu create-menu" data-test="create-menu">
              <button v-for="k in secondaryCreates" :key="k" class="menu-item" :data-test="`create-${k}`" @click="runCreate(k)">
                {{ t(CREATE_ACTIONS[k].label) }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 统计卡只在聚合 Overview 显示；项目视图（Personal）不显示 -->
    <StatsBar v-if="!inProjectView" />

    <!-- ── Tabs ── -->
    <div class="tabs-row" data-test="overview-tabs">
      <button class="tab" :class="{ active: tab === 'workflows' }" data-test="tab-workflows" @click="switchTab('workflows')">{{ t('Workflows') }}</button>
      <button class="tab" :class="{ active: tab === 'credentials' }" data-test="tab-credentials" @click="switchTab('credentials')">{{ t('Credentials') }}</button>
      <button class="tab" :class="{ active: tab === 'executions' }" data-test="tab-executions" @click="switchTab('executions')">{{ t('Executions') }}</button>
      <button class="tab" :class="{ active: tab === 'variables' }" data-test="tab-variables" @click="switchTab('variables')">{{ t('Variables') }}</button>
      <button class="tab" :class="{ active: tab === 'data-tables' }" data-test="tab-data-tables" @click="switchTab('data-tables')">{{ t('Data tables') }}</button>
      <button v-if="showProjectSettings" class="tab" :class="{ active: tab === 'project-settings' }" data-test="tab-project-settings" @click="switchTab('project-settings')">{{ t('Project settings') }}</button>
    </div>

    <p v-if="error" class="error-text" data-test="overview-error">{{ error }}</p>

    <!-- ── Filter / sort / funnel row ── -->
    <div v-if="showFilterRow" class="filter-row">
      <!-- 项目视图：左侧项目上下文 "👤 Personal ⋮" -->
      <div v-if="inProjectView" class="proj-context" data-test="proj-context">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i15"><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20c0-3.4 3-5.2 6.5-5.2s6.5 1.8 6.5 5.2" /></svg>
        <span>{{ projects.currentName }}</span>
        <button class="proj-menu" :title="t('Project settings')" @click="router.push({ name: 'projects' })">
          <svg viewBox="0 0 24 24" fill="currentColor" class="i18"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
        </button>
      </div>
      <div class="search" :class="{ focus: false }">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="i15"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input
          v-model="search"
          data-test="overview-search"
          :placeholder="tab === 'credentials' ? t('Search credentials...') : t('Search')"
        />
      </div>
      <!-- n8n 结构：Search + Sort(两 tab)+ 漏斗弹层(Tags/Status/Show archived)+ Add folder(仅 workflows) -->
      <div class="dropdown" @click.stop>
        <button class="sortby" data-test="sort-toggle" @click="toggleMenu('sort')">
          {{ sortLabel }}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="i14"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <div v-if="openMenu === 'sort'" class="menu sort-menu" data-test="sort-menu">
          <button class="menu-item" @click="sortKey = 'updated'; closeMenus()">{{ t('Sort by last updated') }}</button>
          <button class="menu-item" @click="sortKey = 'created'; closeMenus()">{{ t('Sort by last created') }}</button>
          <button class="menu-item" @click="sortKey = 'name-asc'; closeMenus()">{{ t('Sort by name (A-Z)') }}</button>
          <button class="menu-item" @click="sortKey = 'name-desc'; closeMenus()">{{ t('Sort by name (Z-A)') }}</button>
        </div>
      </div>
      <div class="dropdown" @click.stop>
        <button
          class="filter-btn"
          :class="{ on: statusFilter !== 'all' || showArchived || tagFilterId }"
          data-test="filters-toggle"
          :title="t('Filters')"
          @click="toggleMenu('filters')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i16"><path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" /></svg>
        </button>
        <div v-if="openMenu === 'filters'" class="menu filter-pop" data-test="filters-menu">
          <template v-if="tab === 'workflows'">
            <div class="fp-label">{{ t('Tags') }}</div>
            <select class="fp-select" :value="tagFilterId ?? ''" data-test="filter-tags" @change="tagFilterId = ($event.target as HTMLSelectElement).value || null">
              <option value="">{{ t('Filter by tags') }}</option>
              <option v-for="tg in allTags" :key="tg.id" :value="tg.id">{{ tg.name }}</option>
            </select>
            <div class="fp-label">{{ t('Status') }}</div>
            <select class="fp-select" :value="statusFilter" data-test="filter-status" @change="statusFilter = ($event.target as HTMLSelectElement).value as StatusFilter">
              <option value="all">{{ t('All') }}</option>
              <option value="published">{{ t('Published') }}</option>
              <option value="unpublished">{{ t('Unpublished') }}</option>
            </select>
            <label class="fp-check">
              <input v-model="showArchived" type="checkbox" data-test="filter-archived" />
              {{ t('Show archived workflows') }}
            </label>
          </template>
          <p v-else class="dim" style="font-size: 12px; padding: 4px 2px">{{ t('No filters available') }}</p>
        </div>
      </div>
      <button v-if="tab === 'workflows'" class="filter-btn" data-test="new-folder" :title="t('Add folder')" @click="openCreateFolder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i16"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /><path d="M12 11v5M9.5 13.5h5" /></svg>
      </button>
    </div>

    <!-- ── Workflows ── -->
    <template v-if="tab === 'workflows'">
      <!-- 面包屑 + 新建文件夹（对齐 n8n:根目录无文件夹时不占位） -->
      <div v-if="currentFolderId !== null || folders.length > 0" class="folder-bar">
        <div class="breadcrumb" data-test="breadcrumb">
          <button class="crumb" :class="{ cur: currentFolderId === null }" data-test="crumb-root" @click="enterFolder(null)">{{ t('All workflows') }}</button>
          <template v-for="f in breadcrumb" :key="f.id">
            <span class="crumb-sep">/</span>
            <button class="crumb" :class="{ cur: f.id === currentFolderId }" @click="enterFolder(f.id)">{{ f.name }}</button>
          </template>
        </div>
      </div>

      <!-- 子文件夹 -->
      <div v-if="subfolders.length" class="folder-grid" data-test="folder-list">
        <div v-for="f in subfolders" :key="f.id" class="folder-card" :data-test-folder="f.id" @click="enterFolder(f.id)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" class="folder-ico"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>
          <span class="folder-name">{{ f.name }}</span>
          <button class="folder-del" :title="t('Delete folder')" :data-test-folder-del="f.id" @click.stop="deleteFolder(f.id)">×</button>
        </div>
      </div>

      <div v-if="sortedWorkflows.length === 0 && subfolders.length === 0" class="empty-state" data-test="workflow-empty">
        <button class="scratch-card" data-test="start-from-scratch" @click="createWorkflow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="scratch-icon"><path d="M12 5v14M5 12h14" stroke-linecap="round" /></svg>
          <span>{{ t('Start from scratch') }}</span>
        </button>
      </div>

      <div v-else-if="sortedWorkflows.length === 0" class="dim" data-test="folder-empty" style="padding: 24px; text-align: center">
        {{ t('This folder has no workflows.') }}
      </div>

      <div v-else class="wf-list" data-test="workflow-list">
        <div v-for="row in pagedWorkflows" :key="row.id" class="wf-card">
          <div class="wf-main">
            <RouterLink class="wf-name" :to="{ name: 'canvas', params: { id: row.id } }">
              <span v-if="row.favorite" class="fav-star" :title="t('Favorite')">★</span>{{ row.name }}
            </RouterLink>
            <p v-if="row.description" class="wf-desc">{{ row.description }}</p>
            <div class="wf-meta">
              <span>{{ t('Last updated {time}', { time: timeAgo(row.updatedAt) }) }}</span>
              <span class="sep">|</span>
              <span>{{ t('Created {date}', { date: fmtDate(row.createdAt) }) }}</span>
              <template v-if="statsLabel(row.id)">
                <span class="sep">|</span>
                <span data-test="wf-stats">{{ statsLabel(row.id) }}</span>
              </template>
              <span v-if="row.active" class="active-dot" :title="t('Active')">{{ t('Active') }}</span>
              <span v-if="row.archived" class="badge" style="margin-left: 4px">{{ t('Archived') }}</span>
            </div>
            <div v-if="tagsOf(row.id).length" class="wf-tags" data-test="wf-tags">
              <button v-for="tg in tagsOf(row.id)" :key="tg.id" class="tag-chip" :title="t('Filter by {name}', { name: tg.name })" @click="tagFilterId = tg.id">
                {{ tg.name }}
              </button>
            </div>
          </div>
          <div v-if="(wfDeps[row.id] ?? []).length" class="dropdown" @click.stop>
            <button
              class="dep-pill"
              :data-test-deps="row.id"
              :title="t('Click to view resources referenced by this workflow')"
              @click="toggleMenu(`dep-${row.id}`)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="i13"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
              {{ (wfDeps[row.id] ?? []).length }}
            </button>
            <div v-if="openMenu === `dep-${row.id}`" class="menu dep-menu" :data-test-dep-menu="row.id">
              <template v-for="(g, gi) in depGroups(row.id)" :key="g.type">
                <div v-if="gi > 0" class="menu-sep" />
                <div class="menu-label dep-group-label">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i13"><path :d="g.icon" /></svg>
                  {{ t(g.label) }}
                </div>
                <button v-for="d in g.deps" :key="`${d.type}:${d.id}`" class="menu-item" @click="openDependency(d)">
                  {{ d.name }}
                </button>
              </template>
            </div>
          </div>
          <span class="chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i13"><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20c0-3.4 3-5.2 6.5-5.2s6.5 1.8 6.5 5.2" /></svg>
            {{ ownerName }}
          </span>
          <div class="dropdown" @click.stop>
            <button class="row-menu" :data-test-menu="row.id" @click="toggleMenu(row.id)">
              <svg viewBox="0 0 24 24" fill="currentColor" class="i18"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
            </button>
            <!-- D039 对标 n8n 卡菜单 6 项:Open / Share... / Favorite / Duplicate / Archive / Enable MCP access。
                 移除自有 Activate/Manage tags/Move to(方法保留可回退);Share... = Enterprise 锁。 -->
            <div v-if="openMenu === row.id" class="menu row-menu-pop" :data-test-menu-pop="row.id">
              <button class="menu-item" @click="openWorkflow(row.id)">{{ t('Open') }}</button>
              <template v-if="!row.archived">
                <button class="menu-item" :data-test-share="row.id" @click="openShareLock()">{{ t('Share...') }}</button>
                <button class="menu-item" :data-test-favorite="row.id" @click="toggleFavorite(row)">
                  {{ row.favorite ? t('Unfavorite') : t('Favorite') }}
                </button>
                <button class="menu-item" :data-test-duplicate="row.id" @click="duplicateWorkflow(row)">{{ t('Duplicate') }}</button>
                <button class="menu-item danger" :data-test-archive="row.id" @click="archiveWorkflow(row)">{{ t('Archive') }}</button>
                <button class="menu-item" :data-test-mcp-access="row.id" @click="enableMcpAccess(row)">{{ t('Enable MCP access') }}</button>
              </template>
              <template v-else>
                <button class="menu-item" :data-test-unarchive="row.id" @click="unarchiveWorkflow(row)">{{ t('Unarchive') }}</button>
                <div class="menu-sep" />
                <button class="menu-item danger" :data-test-delete="row.id" @click="removeWorkflow(row.id)">{{ t('Delete') }}</button>
              </template>
            </div>
          </div>
        </div>

        <!-- 分页 -->
        <div class="pager" data-test="pager">
          <span class="pg-total">{{ t('Total {n}', { n: sortedWorkflows.length }) }}</span>
          <button class="pg-arrow" :disabled="page <= 1" @click="page--">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="i15"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <button
            v-for="n in totalPages"
            :key="n"
            class="pg-num"
            :class="{ active: n === page }"
            @click="page = n"
          >
            {{ n }}
          </button>
          <button class="pg-arrow" :disabled="page >= totalPages" @click="page++">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="i15"><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <select v-model.number="pageSize" class="pg-size" @change="page = 1">
            <option :value="10">{{ t('10/page') }}</option>
            <option :value="25">{{ t('25/page') }}</option>
            <option :value="50">{{ t('50/page') }}</option>
          </select>
        </div>
      </div>
    </template>

    <!-- ── Credentials ── -->
    <template v-else-if="tab === 'credentials'">
      <div v-if="credentials.length === 0" class="cred-empty" data-test="credential-empty">
        <div class="lock">🔒</div>
        <h3>{{ t('Create your first credential') }}</h3>
        <p class="dim">{{ t('Credentials let your workflows securely connect to your apps and services') }}</p>
        <button class="btn primary" data-test="new-credential" style="margin-top: 8px" @click="showCredModal = true">
          {{ t('Add first credential') }}
        </button>
      </div>

      <template v-else>
        <div class="wf-list">
          <p v-if="filteredCredentials.length === 0" class="dim" style="padding: 24px; text-align: center">{{ t('No matching credentials.') }}</p>
          <div v-for="row in filteredCredentials" :key="row.id" class="wf-card" :data-test-cred-card="row.id">
            <span class="cred-row-icon"><IconSvg v-bind="credentialIcon(row.type)" :size="22" /></span>
            <div class="wf-main">
              <a class="wf-name" href="#" @click.prevent="openCredential(row)">{{ row.name }}</a>
              <div class="wf-meta">
                <span>{{ credLabel(row.type) }}</span>
                <span class="sep">|</span>
                <span>{{ t('Last updated {time}', { time: timeAgo(row.updatedAt ?? row.createdAt) }) }}</span>
                <span class="sep">|</span>
                <span>{{ t('Created {date}', { date: fmtDate(row.createdAt) }) }}</span>
              </div>
            </div>
            <div v-if="credUsedBy(row.id).length" class="dropdown" @click.stop>
              <button
                class="dep-pill"
                :data-test-cred-deps="row.id"
                :title="t('Click to view resources referencing this credential')"
                @click="toggleMenu(`cred-dep-${row.id}`)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="i13"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
                {{ credUsedBy(row.id).length }}
              </button>
              <div v-if="openMenu === `cred-dep-${row.id}`" class="menu dep-menu">
                <div class="menu-label dep-group-label">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i13"><path d="M9 21H3v-6M14 10L3 21M6 11V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-6" /></svg>
                  {{ t('Used by workflows') }}
                </div>
                <button
                  v-for="w in credUsedBy(row.id)"
                  :key="w.id"
                  class="menu-item"
                  @click="closeMenus(); openDependency({ type: 'parentWorkflow', id: w.id, name: w.name })"
                >
                  {{ w.name }}
                </button>
              </div>
            </div>
            <span class="chip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i13"><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20c0-3.4 3-5.2 6.5-5.2s6.5 1.8 6.5 5.2" /></svg>
              {{ ownerName }}
            </span>
            <div class="dropdown" @click.stop>
              <button class="row-menu" :data-test-cred-menu="row.id" @click="toggleMenu(`cred-${row.id}`)">
                <svg viewBox="0 0 24 24" fill="currentColor" class="i18"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
              </button>
              <div v-if="openMenu === `cred-${row.id}`" class="menu row-menu-pop" :data-test-cred-menu-pop="row.id">
                <button class="menu-item" :data-test-cred-open="row.id" @click="openCredential(row)">{{ t('Open') }}</button>
                <div class="menu-sep" />
                <button class="menu-item danger" :data-test-cred-delete="row.id" @click="closeMenus(); removeCredential(row.id)">{{ t('Delete') }}</button>
              </div>
            </div>
          </div>
        </div>
      </template>

    </template>

    <!-- ── Executions（B5 对标 n8n：Auto refresh / 多选 / 红色错误行 / Retry） ── -->
    <template v-else-if="tab === 'executions'">
      <div class="exec-tools">
        <label class="exec-autorefresh">
          <input v-model="execAutoRefresh" type="checkbox" data-test="exec-autorefresh" />
          {{ t('Auto refresh') }}
        </label>
        <span style="flex: 1" />
        <span class="exec-sublabel dim">
          {{ t(executions.length === 1 ? '{n} execution' : '{n} executions', { n: executions.length }) }}
        </span>
      </div>

      <div class="card" style="padding: 0; overflow: visible" data-test="executions-list">
        <table class="exec-table">
          <thead>
            <tr>
              <th class="exec-check-col">
                <input type="checkbox" :checked="allExecSelected" data-test="exec-select-all" @change="toggleExecSelectAll" />
              </th>
              <th>{{ t('Workflow') }}</th>
              <th>{{ t('Status') }}</th>
              <th>{{ t('Started') }}</th>
              <th>{{ t('Run time') }}</th>
              <th>{{ t('Exec. ID') }}</th>
              <th class="exec-flask-col" />
              <th class="exec-actions-col" />
            </tr>
          </thead>
          <tbody>
            <tr v-if="executions.length === 0">
              <td colspan="8" class="exec-empty">{{ t('No executions') }}</td>
            </tr>
            <tr
              v-for="row in executions"
              :key="row.id"
              class="exec-row"
              :class="{ 'exec-error': row.status === 'error' }"
              :data-test-exec="row.id"
            >
              <td class="exec-check-col" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedExecIds.has(row.id)"
                  :data-test-exec-check="row.id"
                  @change="toggleExecSelect(row.id)"
                />
              </td>
              <td class="exec-wf" @click="openExecution(row)">
                {{ workflowNameById[row.workflowId] ?? t('(deleted workflow)') }}
              </td>
              <td @click="openExecution(row)">
                <span class="exec-status" :class="statusMeta(row.status).cls">
                  <svg v-if="row.status === 'success'" viewBox="0 0 24 24" fill="currentColor" class="i15"><circle cx="12" cy="12" r="10" /><path d="M8.5 12.5l2.5 2.5 4.5-5" fill="none" stroke="var(--bg, #1a1a22)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  <svg v-else-if="row.status === 'error'" viewBox="0 0 24 24" fill="currentColor" class="i15"><circle cx="12" cy="12" r="10" /><path d="M9 9l6 6M15 9l-6 6" fill="none" stroke="var(--bg, #1a1a22)" stroke-width="2" stroke-linecap="round" /></svg>
                  <svg v-else viewBox="0 0 24 24" fill="currentColor" class="i15"><circle cx="12" cy="12" r="10" /></svg>
                  {{ t(statusMeta(row.status).label) }}
                </span>
              </td>
              <td class="dim" @click="openExecution(row)">{{ fmtStarted(row.startedAt) }}</td>
              <td class="dim tnum" @click="openExecution(row)">{{ fmtRunTime(row) }}</td>
              <td class="dim exec-id" @click="openExecution(row)">{{ row.id.slice(0, 8) }}</td>
              <td class="exec-flask-col" :title="row.mode === 'manual' ? t('Manual execution') : ''" @click="openExecution(row)">
                <svg v-if="row.mode === 'manual'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i15 flask-i"><path d="M10 2v6.5L4.6 18a2 2 0 0 0 1.8 3h11.2a2 2 0 0 0 1.8-3L14 8.5V2M8.5 2h7M7 15h10" /></svg>
              </td>
              <td class="exec-actions-col" @click.stop>
                <div class="dropdown">
                  <button class="row-menu" :data-test-exec-menu="row.id" @click="toggleMenu(`exec-${row.id}`)">
                    <svg viewBox="0 0 24 24" fill="currentColor" class="i18"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
                  </button>
                  <div v-if="openMenu === `exec-${row.id}`" class="menu row-menu-pop exec-menu-pop" :data-test-exec-menu-pop="row.id">
                    <!-- n8n 真值(错误行 ⋮ 实测):两个 Retry 项带 “(from node with error)” 后缀,仅错误执行可重试 -->
                    <template v-if="row.status === 'error'">
                      <button class="menu-item" :disabled="retryingId === row.id" @click="retryExec(row, false)">
                        {{ retryingId === row.id ? t('Retrying…') : t('Retry with currently saved workflow (from node with error)') }}
                      </button>
                      <button class="menu-item" :disabled="retryingId === row.id" @click="retryExec(row, true)">
                        {{ t('Retry with original workflow (from node with error)') }}
                      </button>
                      <div class="menu-sep" />
                    </template>
                    <button class="menu-item danger" :data-test-exec-delete="row.id" @click="deleteExec(row)">{{ t('Delete') }}</button>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 多选浮条（对标 n8n） -->
      <div v-if="selectedExecIds.size > 0" class="exec-bulkbar" data-test="exec-bulkbar">
        <span>{{ t(selectedExecIds.size === 1 ? '{n} row selected' : '{n} rows selected', { n: selectedExecIds.size }) }}</span>
        <button class="btn danger-solid" data-test="exec-bulk-delete" @click="deleteSelectedExecs">{{ t('Delete') }}</button>
        <button class="btn neutral" data-test="exec-bulk-clear" @click="selectedExecIds = new Set()">{{ t('Clear selection') }}</button>
      </div>
    </template>

    <!-- ── Project settings（团队项目：成员管理） ── -->
    <template v-else-if="tab === 'project-settings'">
      <div class="proj-settings" data-test="project-settings">
        <div class="ps-section">
          <h3 class="ps-title">{{ t('Project name') }}</h3>
          <input class="ps-name" :value="projects.currentName" readonly />
        </div>
        <div class="ps-section">
          <h3 class="ps-title">{{ t('Members') }}</h3>
          <p v-if="memberError" class="error-text" data-test="ps-error">{{ memberError }}</p>
          <div class="card" style="padding: 0">
            <table>
              <thead>
                <tr><th>{{ t('Email') }}</th><th>{{ t('Role') }}</th><th /></tr>
              </thead>
              <tbody>
                <tr v-for="m in members" :key="m.userId">
                  <td>{{ m.email }}</td>
                  <td style="width: 160px">
                    <select :value="m.role" @change="changeMemberRole(m.userId, $event)">
                      <option value="project:owner">{{ t('Owner') }}</option>
                      <option value="project:editor">{{ t('Editor') }}</option>
                      <option value="project:viewer">{{ t('Viewer') }}</option>
                    </select>
                  </td>
                  <td style="width: 90px; text-align: right"><button @click="removeMember(m.userId)">{{ t('Remove') }}</button></td>
                </tr>
                <tr v-if="members.length === 0">
                  <td colspan="3" class="dim" style="text-align: center; padding: 18px">{{ t('Only you have access to this project.') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="ps-add">
            <input v-model="memberEmail" :placeholder="t('Member email')" data-test="ps-member-email" />
            <select v-model="memberRole" style="width: 150px">
              <option value="project:editor">{{ t('Editor') }}</option>
              <option value="project:viewer">{{ t('Viewer') }}</option>
              <option value="project:owner">{{ t('Owner') }}</option>
            </select>
            <button class="btn primary" data-test="ps-add-member" :disabled="!memberEmail" @click="addMember">{{ t('Add member') }}</button>
          </div>
        </div>
        <div class="ps-hint dim">{{ t(projectRoleLabel[projects.current?.role ?? ''] ?? 'Member') }} · {{ t('manage this project’s members and their roles.') }}</div>
      </div>
    </template>

    <!-- ── Variables:对标 n8n Community 锁态(升级墙)。后端 /api/variables 保留,仅前端呈锁态 ── -->
    <template v-else-if="tab === 'variables'">
      <div class="var-lock" data-test="variables-lock">
        <h3 class="vl-title">{{ t('Upgrade to unlock variables') }}</h3>
        <p class="vl-desc">
          {{ t('Variables can be used to store and access data across workflows. Reference them in nomops using the prefix') }}
          <code>$vars</code> {{ t('(e.g.') }} <code>$vars.myVariable</code>{{ t('). Variables are immutable and cannot be modified within your workflows.') }}
          <a class="vl-link" href="/docs" @click.prevent>{{ t('Learn more in the docs.') }}</a>
        </p>
        <button class="btn-viewplans" data-test="variables-viewplans" @click="router.push({ name: 'settings', query: { section: 'usage' } })">{{ t('View plans') }}</button>
      </div>
    </template>

    <!-- ── Data tables（项目维度结构化表） ── -->
    <template v-else>
      <p v-if="dtError" class="error-text" data-test="dt-error">{{ dtError }}</p>

      <div v-if="dataTables.length === 0" class="cred-empty" data-test="data-table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" class="soon-icon">
          <ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
        </svg>
        <h3>{{ t("You don't have any data tables yet") }}</h3>
        <p class="dim">{{ t('Use data tables to persist execution results, share data between workflows, and track metrics for evaluation.') }}</p>
        <button class="btn primary" data-test="create-first-data-table" style="margin-top: 8px" @click="openCreateDataTable">{{ t('Create data table') }}</button>
      </div>

      <div v-else class="dt-grid" data-test="data-tables-list">
        <div
          v-for="dt in dataTables"
          :key="dt.id"
          class="dt-card"
          :data-test-data-table="dt.id"
          @click="openDataTable(dt.id)"
        >
          <div class="dt-card-head">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" class="dt-card-icon">
              <ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
            </svg>
            <span class="dt-card-name">{{ dt.name }}</span>
            <div class="dropdown" @click.stop>
              <button class="row-menu" :data-test-dt-menu="dt.id" @click="toggleMenu('dt-' + dt.id)">
                <svg viewBox="0 0 24 24" fill="currentColor" class="i18"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
              </button>
              <div v-if="openMenu === 'dt-' + dt.id" class="menu row-menu-pop">
                <button class="menu-item" @click="openDataTable(dt.id)">{{ t('Open') }}</button>
                <button class="menu-item danger" @click="deleteDataTable(dt.id)">{{ t('Delete') }}</button>
              </div>
            </div>
          </div>
          <div class="dt-card-meta">
            <span>{{ t(dt.columns.length === 1 ? '{n} column' : '{n} columns', { n: dt.columns.length }) }}</span>
            <span class="dt-dot">·</span>
            <span>{{ t(dt.rowCount === 1 ? '{n} row' : '{n} rows', { n: dt.rowCount }) }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- Add folder 命名弹窗（B7 对标 n8n message.prompt） -->
    <div v-if="folderModalOpen" class="modal-mask" data-test="folder-modal" @click.self="folderModalOpen = false">
      <div class="modal-card">
        <h2 class="modal-title">
          {{ currentFolderName ? t("Create folder in '{parent}'", { parent: currentFolderName }) : t('Create a new folder here') }}
        </h2>
        <input
          v-model="folderNameDraft"
          class="modal-input"
          data-test="folder-name-input"
          :placeholder="t('Folder name')"
          @keydown.enter="confirmCreateFolder"
        />
        <p v-if="folderModalError" class="error-text">{{ folderModalError }}</p>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px">
          <button class="btn neutral" @click="folderModalOpen = false">{{ t('Cancel') }}</button>
          <button class="btn primary" data-test="folder-create" :disabled="!folderNameDraft.trim()" @click="confirmCreateFolder">
            {{ t('Create') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 凭证弹窗（根级：任何 tab 经 caret 下拉均可创建；edit 非空 = 编辑） -->
    <CredentialModal
      v-if="showCredModal"
      :edit="editingCred ?? undefined"
      @close="closeCredModal"
      @created="onCredCreated"
      @updated="onCredUpdated"
    />

    <!-- ── Create data table 弹窗 ── -->
    <div v-if="showDataTableModal" class="modal-mask" data-test="data-table-modal" @click.self="showDataTableModal = false">
      <div class="modal-card">
        <h2 class="modal-title">{{ t('Create new data table') }}</h2>
        <label class="modal-label">{{ t('Name') }}</label>
        <input
          v-model="newTableName"
          class="modal-input"
          data-test="data-table-name"
          :placeholder="t('e.g. customers')"
          @keyup.enter="createDataTable"
        />
        <p v-if="dtError" class="error-text">{{ dtError }}</p>
        <div class="modal-actions">
          <button class="btn secondary" @click="showDataTableModal = false">{{ t('Cancel') }}</button>
          <button class="btn primary" data-test="data-table-create" :disabled="!newTableName.trim() || creatingTable" @click="createDataTable">{{ t('Create') }}</button>
        </div>
      </div>
    </div>

    <!-- 弹窗：管理某工作流的标签（覆盖式保存） -->
    <div v-if="managingTagsFor" class="modal-mask" data-test="manage-tags-modal" @click.self="managingTagsFor = null">
      <div class="modal-card">
        <h2 class="modal-title">{{ t('Manage tags') }}</h2>
        <p class="tag-modal-sub">{{ managingTagsFor.name }}</p>
        <div class="tag-new-row">
          <input
            v-model="newTagName"
            class="modal-input"
            data-test="new-tag-name"
            :placeholder="t('Create new tag')"
            @keyup.enter="createTag"
          />
          <button class="btn secondary btn-xs" data-test="new-tag-create" :disabled="!newTagName.trim()" @click="createTag">{{ t('Add') }}</button>
        </div>
        <div v-if="allTags.length" class="tag-check-list">
          <label v-for="tg in allTags" :key="tg.id" class="tag-check-row">
            <input type="checkbox" :checked="managedTagIds.has(tg.id)" :data-test-tag-check="tg.id" @change="toggleManagedTag(tg.id)" />
            <span class="tag-check-name">{{ tg.name }}</span>
            <button class="tag-del" :title="t('Delete tag {name} (removes it from all workflows)', { name: tg.name })" :data-test-tag-del="tg.id" @click.prevent="deleteTag(tg.id)">×</button>
          </label>
        </div>
        <p v-else class="dim" style="font-size: 13px">{{ t('No tags yet — create one above.') }}</p>
        <p v-if="tagError" class="error-text">{{ tagError }}</p>
        <div class="modal-actions">
          <button class="btn secondary" @click="managingTagsFor = null">{{ t('Cancel') }}</button>
          <button class="btn primary" data-test="save-workflow-tags" @click="saveWorkflowTags">{{ t('Save') }}</button>
        </div>
      </div>
    </div>

    <!-- D039 Share... Enterprise 锁(对标 n8n Community:工作流共享需升级) -->
    <div v-if="shareLockOpen" class="modal-mask" data-test="share-lock-modal" @click.self="shareLockOpen = false">
      <div class="modal-card" style="max-width: 460px; text-align: center">
        <h2 style="margin: 0 0 10px">{{ t('Available on the Enterprise plan') }}</h2>
        <p class="dim" style="margin: 0 0 20px; font-size: 14px">
          {{ t('Share workflows with other users and projects to collaborate.') }}
        </p>
        <div style="display: flex; gap: 10px; justify-content: center">
          <button class="btn secondary" @click="shareLockOpen = false">{{ t('Close') }}</button>
          <a class="btn primary" href="https://n8n.io/pricing" target="_blank" rel="noopener">{{ t('See plans') }}</a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* n8n 实测@1440: 内容列 x248..1392(左右 48 gutter)、标题区高≈101 至 KPI */
.ov { padding: 28px 48px 40px 28px; width: 100%; }

/* Header */
.ov-head { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 34px; }
.ov-title h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.2px; color: var(--text-hi); }
.ov-sub { margin: 4px 0 0; color: var(--text-dim); font-size: 14px; }
.ov-actions { margin-left: auto; display: flex; align-items: stretch; gap: 10px; }

/* n8n 实测：页头按钮 32px/衬 0 12/圆角 4 */
.btn {
  display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 var(--spacing--xs);
  border-radius: var(--radius); border: none; font-size: var(--font-size--sm); font-weight: var(--font-weight--medium);
  cursor: pointer; white-space: nowrap; font-family: inherit; color: var(--color--text--shade-1);
}
.btn.secondary { background: var(--color--background--light-3); box-shadow: inset 0 0 0 1px var(--border-color); }
.btn.secondary:hover { background: var(--color--background--light-1); }
.btn.primary {
  background: var(--button--color--background--primary); color: var(--button--color--text--primary);
  box-shadow: inset 0 0 0 1px var(--button--border-color--primary), 0 1px 3px -1px var(--color--black-alpha-100);
}
.btn.primary:hover { background: var(--button--color--background--primary--hover-active-focus); }

.split { position: relative; display: inline-flex; align-items: stretch; }
.split .split-main { border-radius: var(--radius) 0 0 var(--radius); }
.split-caret {
  background: var(--accent); color: #fff; border: none; cursor: pointer;
  border-radius: 0 var(--radius) var(--radius) 0; padding: 0 8px; display: flex; align-items: center;
  border-left: 1px solid rgba(0, 0, 0, 0.22);
}
.split-caret:hover { background: var(--accent-dim); }

/* Filter row */
.filter-row { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin: 18px 0 12px; }
.proj-context { display: flex; align-items: center; gap: 8px; margin-right: auto; color: var(--text); font-size: 14px; }
.proj-context .i15 { color: var(--text-dim); }
.proj-menu {
  width: 28px; height: 28px; border: none; background: none; color: var(--text-dim);
  border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.proj-menu:hover { background: var(--bg-hover); color: var(--text); }
/* n8n 实测（搜索框）：高 32、圆角 4、bg light-2、1px white-alpha-100 内嵌环、
   内衬 0 12px、内部 gap 12、文字 14px 白 */
.search {
  display: flex; align-items: center; gap: var(--spacing--xs); background: var(--color--background--light-2);
  border: none; box-shadow: inset 0 0 0 1px var(--border-color);
  border-radius: var(--radius); height: 32px; padding: 0 var(--spacing--xs);
  width: 196px; color: var(--color--text--tint-1);
}
.search:focus-within { box-shadow: inset 0 0 0 1px var(--border-color--strong); }
.search input {
  border: none; background: none; outline: none; color: var(--color--text--shade-1); font-size: var(--font-size--sm);
  font-family: inherit; width: 100%; padding: 0; box-shadow: none;
}
.search input::placeholder { color: var(--color--text--tint-1); }
/* n8n 实测:排序控件 196×32(与搜索同宽)/12px 字/衬 0 12 0 8 */
.sortby {
  display: flex; align-items: center; justify-content: space-between; width: 196px;
  background: var(--color--background--light-2);
  border: none; box-shadow: inset 0 0 0 1px var(--border-color);
  border-radius: var(--radius); height: 32px; padding: 0 var(--spacing--xs) 0 var(--spacing--2xs);
  color: var(--color--text--shade-1); font-size: var(--font-size--2xs); cursor: pointer;
}
.sortby:hover { box-shadow: inset 0 0 0 1px var(--border-color--strong); }
.filter-btn {
  width: 32px; height: 32px; background: var(--color--background--light-2);
  border: none; box-shadow: inset 0 0 0 1px var(--border-color);
  border-radius: var(--radius); display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--color--text--shade-1);
}
.filter-btn:hover { box-shadow: inset 0 0 0 1px var(--border-color--strong); }
.filter-btn.on { box-shadow: inset 0 0 0 1px var(--color--primary); color: var(--color--primary); }

/* Dropdown menus */
.dropdown { position: relative; }
.menu {
  position: absolute; z-index: 40; min-width: 190px; background: var(--bg-panel);
  border: 1px solid var(--border-strong); border-radius: 10px; padding: 6px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.5);
}
.create-menu, .sort-menu { top: calc(100% + 6px); right: 0; }
.row-menu-pop { top: calc(100% + 4px); right: 0; }
.menu-item {
  display: block; width: 100%; text-align: left; padding: 8px 10px; border: none;
  background: none; border-radius: 6px; color: var(--text); font-size: 13.5px; cursor: pointer; font-family: inherit;
}
.menu-item:hover { background: var(--bg-hover); }
.menu-item.danger { color: var(--err); }
.menu-sep { height: 1px; background: var(--border); margin: 5px 4px; }
.menu-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-dim, #9a9aa6); padding: 4px 12px 2px; }

/* ── 文件夹 ── */
.folder-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.breadcrumb { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13.5px; }
.breadcrumb .crumb { background: none; border: none; color: var(--text-dim, #9a9aa6); cursor: pointer; padding: 2px 4px; border-radius: 6px; }
.breadcrumb .crumb:hover { color: var(--text, #e8e8ee); }
.breadcrumb .crumb.cur { color: var(--text, #e8e8ee); font-weight: 600; }
.breadcrumb .crumb-sep { color: var(--text-dim, #6a6a76); }
.btn-xs { padding: 5px 11px; font-size: 12.5px; }
.folder-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin-bottom: 14px; }
.folder-card {
  display: flex; align-items: center; gap: 10px; padding: 12px 14px; cursor: pointer;
  background: var(--panel, #16161a); border: 1px solid var(--border); border-radius: 10px; position: relative;
}
.folder-card:hover { border-color: var(--accent, #ff6900); }
.folder-ico { width: 20px; height: 20px; color: var(--accent, #ff6900); flex-shrink: 0; }
.folder-name { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder-del {
  margin-left: auto; background: none; border: none; color: var(--text-dim, #9a9aa6); cursor: pointer;
  font-size: 18px; line-height: 1; width: 22px; height: 22px; border-radius: 5px; flex-shrink: 0;
}
.folder-del:hover { color: var(--err, #ef5f5f); background: rgba(239, 95, 95, 0.12); }

/* Workflow cards — n8n 实测：bg light-3、1px border-color、圆角 8(--radius--lg)、
   卡间距 8(--spacing--2xs)、内衬 16(--spacing--sm)、标题 14px/500 白/行高 1.35、meta 12px tint-1 */
.wf-list { display: flex; flex-direction: column; gap: var(--spacing--2xs); }
.wf-card {
  background: var(--color--background--light-3); border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius--lg);
  display: flex; align-items: center; gap: var(--spacing--sm); padding: var(--spacing--sm);
}
.wf-card:hover { border-color: var(--border-color--strong); }
.wf-main { flex: 1; min-width: 0; }
.wf-name {
  font-size: var(--font-size--sm); font-weight: var(--font-weight--medium);
  color: var(--color--text--shade-1); line-height: var(--line-height--lg); text-decoration: none;
}
.wf-name:hover { color: var(--color--primary); }
.wf-meta {
  font-size: var(--font-size--2xs); color: var(--color--text--tint-1);
  margin-top: 5px; display: flex; align-items: center; gap: 10px;
}
.wf-meta .sep { color: var(--color--text--tint-1); }
.wf-meta .active-dot { color: var(--ok); font-size: 12px; }
.wf-meta .active-dot::before { content: '● '; }
/* n8n 实测：Personal 徽章 25px 高 / bg light-3 / 1px border / 圆角 4 / 文字 12px */
.chip {
  display: inline-flex; align-items: center; gap: var(--spacing--3xs); background: var(--color--background--light-3);
  border: var(--border-width) var(--border-style) var(--border-color); border-radius: var(--radius);
  height: 25px; padding: 0 var(--spacing--2xs); box-sizing: border-box;
  font-size: var(--font-size--2xs); color: var(--color--text); white-space: nowrap;
}
.chip svg { color: var(--color--text--tint-1); }
/* n8n 实测：行内 ⋮ 28×28 / 圆角 4 / 透明底 */
.row-menu {
  width: 28px; height: 28px; border-radius: var(--radius); background: none; border: none;
  color: var(--color--text--shade-1); cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.row-menu:hover { background: var(--background--hover); }

/* Pagination — n8n 实测：Total 12px 白；页号 30×28、当前页 1px primary 描边 + 12px/600 primary、透明底 */
.pager { display: flex; align-items: center; justify-content: flex-end; gap: var(--spacing--2xs); margin-top: 10px; color: var(--color--text--shade-1); font-size: var(--font-size--2xs); }
.pg-total { margin-right: 6px; }
.pg-arrow {
  width: 28px; height: 28px; border-radius: var(--radius); background: none; border: none;
  color: var(--color--text--tint-1); display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.pg-arrow:hover { background: var(--background--hover); }
.pg-arrow:disabled { opacity: 0.4; cursor: not-allowed; }
.pg-num {
  min-width: 30px; height: 28px; padding: 0 4px; border-radius: var(--radius); border: var(--border-width) var(--border-style) transparent;
  background: none; color: var(--color--text); font-size: var(--font-size--2xs); cursor: pointer;
}
.pg-num.active { border-color: var(--color--primary); color: var(--color--primary); font-weight: var(--font-weight--bold); }
.pg-size {
  height: 28px; padding: 0 var(--spacing--2xs); border-radius: var(--radius); background: none;
  border: none; box-shadow: inset 0 0 0 1px var(--border-color);
  color: var(--color--text); font-size: var(--font-size--2xs); cursor: pointer; width: auto;
}

/* Empty states */
.empty-state { display: flex; justify-content: center; padding: 48px 24px; }
.scratch-card {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  width: 220px; height: 200px; border: 2px dashed var(--border-strong); border-radius: 14px;
  background: transparent; color: var(--text-dim); font-size: 15px; cursor: pointer;
}
.scratch-card:hover { border-color: var(--accent); color: var(--text-hi); }
.scratch-icon { width: 34px; height: 34px; opacity: 0.7; }
.cred-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  border: 2px dashed var(--border-strong); border-radius: 14px; padding: 48px 24px; text-align: center; margin-top: 8px;
}
.cred-empty .lock { font-size: 40px; opacity: 0.8; }
.cred-empty h3 { margin: 8px 0 0; font-weight: 600; color: var(--text-hi); }
/* Variables 升级锁态(对标 n8n Community):虚线大框 + 标题 + 说明(含 $vars)+ View plans */
.var-lock {
  display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;
  border: 2px dashed var(--border-strong); border-radius: 14px; padding: 56px 32px; margin-top: 8px;
}
.vl-title { margin: 0; font-size: var(--font-size--lg); font-weight: var(--font-weight--bold); color: var(--text-hi); }
.vl-desc { margin: 0; max-width: 560px; font-size: var(--font-size--sm); line-height: 1.6; color: var(--text-dim); }
.vl-desc code { font-family: var(--font-family--monospace); font-size: 0.9em; background: var(--bg-input); padding: 1px 5px; border-radius: 4px; color: var(--text); }
.vl-link { color: var(--accent); text-decoration: none; }
.vl-link:hover { text-decoration: underline; }
.btn-viewplans {
  margin-top: 6px; height: 36px; padding: 0 16px; border: none; border-radius: 6px;
  background: var(--button--color--background--primary); color: var(--button--color--text--primary);
  font-size: var(--font-size--sm); font-weight: var(--font-weight--medium); cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--button--border-color--primary), 0 1px 3px -1px var(--color--black-alpha-100);
}
.btn-viewplans:hover { background: var(--button--color--background--primary--hover-active-focus); }
/* n8n 实测：凭证品牌图标 26×26 裸图，无底框无圆角 */
.cred-row-icon {
  width: 26px; height: 26px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 15px;
}
.soon {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  border: 1px solid var(--border); border-radius: 12px; padding: 60px 24px; text-align: center; margin-top: 8px;
  background: var(--bg-panel);
}
.soon-icon { width: 44px; height: 44px; color: var(--text-faint); }
.soon h3 { margin: 6px 0 0; font-weight: 600; color: var(--text-hi); }

/* Project settings */
.proj-settings { max-width: 720px; margin-top: 18px; }
.ps-section { margin-bottom: 26px; }
.ps-title { margin: 0 0 10px; font-size: 15px; font-weight: 600; color: var(--text-hi); }
.ps-name { max-width: 420px; }
.ps-add { display: flex; gap: 8px; margin-top: 12px; }
.ps-add input { flex: 1; }
.ps-add .btn { height: 34px; padding: 0 16px; border-radius: var(--radius); border: none; font-size: 14px; font-weight: 500; cursor: pointer; }
.ps-add .btn.primary { background: var(--accent); color: #fff; }
.ps-add .btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.ps-hint { font-size: 12px; }

/* Variables */
.var-table { width: 100%; border-collapse: collapse; }
.var-table thead th {
  text-align: left; font-size: 12px; font-weight: 500; color: var(--text-dim);
  padding: 11px 16px; background: var(--bg-hover); border-bottom: 1px solid var(--border);
}
.var-table td { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.var-table tr:last-child td { border-bottom: none; }
.var-key { color: var(--text-hi); font-weight: 500; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.var-val { color: var(--text); word-break: break-all; }
.var-usage { background: var(--bg-input); padding: 3px 8px; border-radius: 6px; font-size: 12px; color: var(--text-dim); white-space: nowrap; }
.var-actions { text-align: right; white-space: nowrap; }
.var-actions button { margin-left: 6px; }
.var-actions .btn.primary { height: 30px; padding: 0 14px; border-radius: var(--radius); border: none; font-size: 13px; font-weight: 500; cursor: pointer; background: var(--accent); color: #fff; }
.var-actions .btn.primary:hover { background: var(--accent-dim); }
.var-actions .danger { color: var(--err); }
.var-edit-row input { width: 100%; }

/* Executions */
.exec-tools { display: flex; align-items: center; margin: 18px 0 14px; padding-left: 24px; }
.exec-sublabel { font-size: 13px; }
.exec-table { width: 100%; border-collapse: collapse; }
/* n8n 实测：表头 36px 高 / bg light-1 / 12px-600 neutral-200 / 衬 0 8px 0 16px /
   底边 1px neutral-800(--color--foreground) */
.exec-table thead th {
  text-align: left; font-size: var(--font-size--2xs); font-weight: var(--font-weight--bold); color: var(--color--text);
  height: 36px; padding: 0 var(--spacing--2xs) 0 var(--spacing--sm);
  background: var(--color--background--light-1);
  border-bottom: var(--border-width) var(--border-style) var(--color--foreground); white-space: nowrap;
}
/* n8n 实测列宽@1440:check 50 / Status 153 / Started 187 / Run time 110 / Exec.ID 98 / 尾 56 */
.exec-check-col { width: 50px; padding-right: 0 !important; text-align: center; }
.exec-table th:nth-child(2), .exec-table td:nth-child(2) { width: 371px; }
.exec-table th:nth-child(3), .exec-table td:nth-child(3) { width: 153px; }
.exec-table th:nth-child(4), .exec-table td:nth-child(4) { width: 187px; }
.exec-table th:nth-child(5), .exec-table td:nth-child(5) { width: 110px; }
.exec-table th:nth-child(6), .exec-table td:nth-child(6) { width: 98px; }
.exec-check-col input { accent-color: var(--accent); cursor: pointer; }
.exec-actions-col { width: 48px; text-align: right; }
/* n8n 实测:manual 试管图标列 47px */
.exec-flask-col { width: 47px; text-align: center; }
.flask-i { color: var(--color--text--tint-1); }
/* n8n 实测：错误行整行 rgba(215,56,58,.1)(实例专有值,无对应全局令牌) */
.exec-row.exec-error > td { background: rgba(215, 56, 58, 0.1); }
.exec-autorefresh { display: inline-flex; align-items: center; gap: 8px; font-size: var(--font-size--sm); color: var(--color--text--shade-1); cursor: pointer; white-space: nowrap; }
/* n8n 实测：状态列 14px 白字 + 彩色图标 */
.exec-status { display: inline-flex; align-items: center; gap: 7px; font-size: var(--font-size--sm); color: var(--color--text--shade-1); }
.exec-status svg { color: var(--color--text--tint-1); }
.exec-status.ok svg { color: var(--color--success); }
.exec-status.err svg { color: var(--color--danger); }
.exec-status.run svg { color: var(--color--primary); }
.exec-status.muted { color: var(--color--text--tint-1); }
.exec-status svg { flex: none; }
.exec-autorefresh input { accent-color: var(--accent); cursor: pointer; }
.exec-menu-pop { right: 8px; min-width: 280px; }
/* n8n Filters 弹层：Tags/Status 下拉 + Show archived 复选 */
.filter-pop { top: calc(100% + 6px); right: 0; min-width: 300px; padding: 12px; }
.fp-label { font-size: var(--font-size--2xs); color: var(--color--text--shade-1); font-weight: var(--font-weight--medium); margin: 8px 0 6px; }
.fp-label:first-child { margin-top: 0; }
.fp-select {
  width: 100%; height: 32px; background: var(--color--background--light-2);
  border: var(--border-width) var(--border-style) var(--border-color); border-radius: var(--radius);
  color: var(--color--text--shade-1); font-size: var(--font-size--sm); padding: 0 var(--spacing--2xs);
}
.fp-check { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: var(--font-size--sm); color: var(--color--text--shade-1); cursor: pointer; }
.fp-check input { width: auto; accent-color: var(--color--primary); }
.exec-bulkbar {
  position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 12px;
  background: var(--panel, #2a2a33); border: 1px solid var(--border);
  border-radius: 10px; padding: 10px 16px; font-size: 13px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45); z-index: 60;
}
.btn.danger-solid { background: var(--err); color: #fff; border: none; }
.exec-caret-col { width: 34px; padding-right: 0 !important; }
.exec-row { cursor: pointer; }
/* n8n 实测：行高 48 / 单元格衬 0 8px 0 16px / 14px / 底边 1px neutral-800 */
.exec-row td {
  height: 48px; padding: 0 var(--spacing--2xs) 0 var(--spacing--sm);
  font-size: var(--font-size--sm);
  border-bottom: var(--border-width) var(--border-style) var(--color--foreground);
}
.exec-row:hover td { background: var(--background--hover); }
.exec-wf { color: var(--text-hi); font-weight: 500; }
.exec-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.tnum { font-variant-numeric: tabular-nums; }
.expand-caret { display: inline-block; color: var(--text-faint); font-size: 15px; transition: transform 0.15s; }
.expand-caret.open { transform: rotate(90deg); color: var(--text); }
.exec-empty { text-align: center; padding: 34px; color: var(--text-dim); }
.exec-pill {
  display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500;
  padding: 3px 10px 3px 8px; border-radius: 12px; white-space: nowrap;
}
.exec-pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.exec-pill.ok { color: var(--ok); background: rgba(76, 195, 138, 0.13); }
.exec-pill.err { color: var(--err); background: rgba(239, 111, 108, 0.13); }
.exec-pill.run { color: var(--running); background: rgba(245, 166, 35, 0.13); }
.exec-pill.muted { color: var(--text-dim); background: var(--bg-hover); }
.exec-detail-row td { padding: 0; background: var(--bg); border-bottom: 1px solid var(--border); }
.exec-detail-panel { padding: 10px 16px 12px 44px; }
.exec-node-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 13px; }
.exec-node-name { flex-shrink: 0; color: var(--text); }

.i13, .i14, .i15, .i16, .i18 { flex-shrink: 0; }
.i13 { width: 13px; height: 13px; }
.i14 { width: 14px; height: 14px; }
.i15 { width: 15px; height: 15px; }
.i16 { width: 16px; height: 16px; }
.i18 { width: 18px; height: 18px; }

/* Data tables */
.dt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin-top: 8px; }
.dt-card {
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 16px 18px; cursor: pointer; display: flex; flex-direction: column; gap: 12px;
}
.dt-card:hover { border-color: var(--border-strong); }
.dt-card-head { display: flex; align-items: center; gap: 10px; }
.dt-card-icon { width: 20px; height: 20px; color: var(--text-dim); flex-shrink: 0; }
.dt-card-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 500; color: var(--text-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-card-meta { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-dim); }
.dt-dot { color: var(--text-faint); }

/* Modal (Create data table) */
.modal-mask {
  position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.modal-card {
  width: 480px; max-width: 100%; background: var(--bg-panel); border: 1px solid var(--border-strong);
  border-radius: 12px; padding: 24px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.modal-title { margin: 0 0 18px; font-size: 18px; font-weight: 600; color: var(--text-hi); }
.modal-label { display: block; font-size: 13px; color: var(--text-dim); margin-bottom: 6px; }
.modal-input {
  width: 100%; height: 36px; padding: 0 12px; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text); font-size: 14px; font-family: inherit;
}
.modal-input:focus { outline: none; border-color: var(--accent); }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
.modal-actions .btn:disabled { opacity: 0.5; cursor: not-allowed; }

.wf-desc { margin: 3px 0 0; font-size: 12.5px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 720px; }

/* 收藏星标 + 归档徽章 */
.fav-star { color: var(--accent); margin-right: 5px; font-size: 13px; }
.dep-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 9px; font-size: 12px; border-radius: 10px;
  border: 1px solid var(--border); background: transparent; color: var(--text-dim);
  cursor: pointer;
}
.dep-pill:hover { color: var(--text); border-color: var(--text-faint); }
.dep-menu { min-width: 220px; max-height: 320px; overflow-y: auto; }
.dep-group-label { display: flex; align-items: center; gap: 7px; text-transform: none; letter-spacing: 0; font-size: 12px; }
.badge { font-size: 11.5px; padding: 1px 8px; border-radius: 8px; border: 1px solid var(--border); color: var(--text-dim); }

/* Tags：卡片 chips + 筛选 + 管理弹窗 */
.wf-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.tag-chip {
  border: 1px solid var(--border); background: var(--bg-subtle, rgba(125, 125, 125, 0.08));
  color: var(--text-dim); font-size: 11.5px; line-height: 1; padding: 4px 9px;
  border-radius: 999px; cursor: pointer;
}
.tag-chip:hover { border-color: var(--accent); color: var(--accent); }
.tag-filter-on { border-color: var(--accent); color: var(--accent); }
.tag-modal-sub { margin: -12px 0 14px; font-size: 13px; color: var(--text-dim); }
.tag-new-row { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
.tag-new-row .modal-input { flex: 1; margin: 0; }
.tag-check-list { max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.tag-check-row {
  display: flex; align-items: center; gap: 9px; padding: 7px 8px;
  border-radius: 6px; cursor: pointer; font-size: 13.5px; color: var(--text-hi);
}
.tag-check-row:hover { background: var(--bg-subtle, rgba(125, 125, 125, 0.08)); }
/* 全局 input 有 width:100%，这里必须收回复选框固有尺寸 */
.tag-check-row input[type='checkbox'] { accent-color: var(--accent); width: 15px; height: 15px; flex: 0 0 auto; margin: 0; }
.tag-check-name { flex: 1; }
.tag-del {
  border: none; background: none; color: var(--text-dim); font-size: 15px;
  cursor: pointer; padding: 0 4px; border-radius: 4px; visibility: hidden;
}
.tag-check-row:hover .tag-del { visibility: visible; }
.tag-del:hover { color: var(--danger, #e5484d); }
.dt-source { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
.dt-source-opt {
  display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; cursor: pointer;
  border: 1px solid var(--border); border-radius: 8px;
}
.dt-source-opt.sel { border-color: var(--accent); background: rgba(255, 105, 0, 0.06); }
.dt-source-opt.disabled { opacity: 0.6; cursor: not-allowed; }
.dt-source-opt input { margin-top: 3px; accent-color: var(--accent); }
.dt-source-title { font-size: 14px; font-weight: 500; color: var(--text-hi); }
.dt-source-sub { font-size: 12.5px; color: var(--text-dim); margin-top: 3px; }
.soon-badge {
  display: inline-block; margin-left: 6px; font-size: 10.5px; font-weight: 500; color: var(--text-faint);
  background: var(--bg-hover); border-radius: 5px; padding: 1px 6px; vertical-align: middle;
}
</style>
