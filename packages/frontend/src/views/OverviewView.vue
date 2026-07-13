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
} from '../api/client.js';
import { useProjectsStore } from '../stores/projects.js';
import CredentialModal from '../components/credentials/CredentialModal.vue';
import StatsBar from '../components/shell/StatsBar.vue';
import { credentialTypeMeta } from '../lib/credential-types.js';

/** n8n Cloud 式 Overview：五 Tab（Workflows/Credentials/Executions/Variables/Data tables）+ 搜索/排序/筛选 + 分页。 */
type Tab = 'workflows' | 'credentials' | 'executions' | 'variables' | 'data-tables' | 'project-settings';
type SortKey = 'updated' | 'name-asc' | 'name-desc';

const route = useRoute();
const router = useRouter();
const projects = useProjectsStore();

const tab = ref<Tab>((route.query['tab'] as Tab) ?? 'workflows');
const search = ref('');
const error = ref('');

const workflows = ref<WorkflowRow[]>([]);
const credentials = ref<CredentialView[]>([]);
const executions = ref<ExecutionRow[]>([]);
const executionDetail = ref<{ id: string; data: IRunExecutionData | null } | null>(null);

/* 凭证：n8n 式弹窗（选类型 → 填字段） */
const showCredModal = ref(false);

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
const activeOnly = ref(false);
const showFilter = ref(false);
const page = ref(1);
const pageSize = ref(50);

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

async function reload() {
  error.value = '';
  try {
    const [wf, cred, exec] = await Promise.all([
      api.workflows.list(),
      api.credentials.list(),
      api.executions.list(),
    ]);
    workflows.value = wf;
    credentials.value = cred;
    executions.value = exec.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
  if (activeOnly.value) rows = rows.filter((w) => w.active);
  rows.sort((a, b) => {
    if (sortKey.value === 'name-asc') return a.name.localeCompare(b.name);
    if (sortKey.value === 'name-desc') return b.name.localeCompare(a.name);
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return rows;
});
const pagedWorkflows = computed(() =>
  sortedWorkflows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);
const totalPages = computed(() => Math.max(1, Math.ceil(sortedWorkflows.value.length / pageSize.value)));

const filteredCredentials = computed(() =>
  q.value ? credentials.value.filter((c) => c.name.toLowerCase().includes(q.value)) : credentials.value,
);

async function createWorkflow() {
  closeMenus();
  const wf = await api.workflows.create({ name: 'My workflow', nodes: [], connections: {} });
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

function openWorkflow(id: string) {
  closeMenus();
  void router.push({ name: 'canvas', params: { id } });
}

function onCredCreated(created: CredentialView) {
  credentials.value.push(created);
}

const credIcon = (type: string) => credentialTypeMeta(type)?.icon ?? '🔑';
const credLabel = (type: string) => credentialTypeMeta(type)?.displayName ?? type;

async function removeCredential(id: string) {
  await api.credentials.remove(id);
  credentials.value = credentials.value.filter((c) => c.id !== id);
}

async function openExecution(id: string) {
  if (executionDetail.value?.id === id) {
    executionDetail.value = null;
    return;
  }
  const result = await api.executions.get(id);
  executionDetail.value = { id, data: result.data };
}

const sortLabel = computed(
  () =>
    ({ updated: 'Sort by last updated', 'name-asc': 'Sort by name (A-Z)', 'name-desc': 'Sort by name (Z-A)' })[
      sortKey.value
    ],
);

const ownerName = computed(() => {
  const c = projects.current;
  return !c || c.type === 'personal' ? 'Personal' : c.name;
});

/** n8n：Overview = 聚合视图；点侧栏项目（?project=）= 该项目视图，标题用项目名。 */
const inProjectView = computed(() => Boolean(route.query['project']));
const pageTitle = computed(() => (inProjectView.value ? projects.currentName : 'Overview'));
const pageSub = computed(() => {
  if (!inProjectView.value) return 'All the workflows, credentials and data tables you have access to';
  return projects.current?.type === 'personal'
    ? 'Workflows, credentials and data tables owned by you'
    : `Workflows, credentials and data tables in ${projects.currentName}`;
});

/** Project settings tab 只在团队项目视图显示（Personal 没有，对齐 n8n）。 */
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

/** "11 July" 式创建日期（对齐 n8n）。 */
const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

const timeAgo = (iso: string | null): string => {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return `${m} minute${m > 1 ? 's' : ''} ago`;
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return `${h} hour${h > 1 ? 's' : ''} ago`;
  }
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
};

const showFilterRow = computed(() => tab.value === 'workflows' || tab.value === 'credentials');

/* ── Executions（n8n 式表格） ── */
const workflowNameById = computed(() => {
  const map: Record<string, string> = {};
  for (const w of workflows.value) map[w.id] = w.name;
  return map;
});

const execStatus: Record<string, { label: string; cls: string }> = {
  success: { label: 'Success', cls: 'ok' },
  error: { label: 'Failed', cls: 'err' },
  running: { label: 'Running', cls: 'run' },
  canceled: { label: 'Canceled', cls: 'muted' },
  queued: { label: 'Queued', cls: 'muted' },
  new: { label: 'New', cls: 'muted' },
};
const statusMeta = (s: string) => execStatus[s] ?? { label: s, cls: 'muted' };

const fmtStarted = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '-';

const fmtRunTime = (row: ExecutionRow): string => {
  if (!row.startedAt || !row.stoppedAt) return row.status === 'running' ? '—' : '-';
  const ms = new Date(row.stoppedAt).getTime() - new Date(row.startedAt).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
};

/** 展开的执行详情：逐节点运行摘要（名称 / 状态 / 耗时 / 错误）。 */
const detailRows = computed(() => {
  const runData = executionDetail.value?.data?.resultData.runData ?? {};
  return Object.entries(runData).map(([name, runs]) => {
    const last = runs[runs.length - 1];
    return { name, time: last?.executionTime ?? 0, error: last?.error?.message, ok: !last?.error };
  });
});
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
        <!-- Credentials / Variables tab：主按钮切换（对齐 n8n） -->
        <button
          v-if="tab === 'credentials'"
          class="btn primary"
          data-test="create-credential-top"
          @click="showCredModal = true"
        >
          Create credential
        </button>
        <button
          v-else-if="tab === 'variables'"
          class="btn primary"
          data-test="create-variable-top"
          @click="startNewVariable"
        >
          Create variable
        </button>
        <button
          v-else-if="tab === 'data-tables'"
          class="btn primary"
          data-test="create-data-table-top"
          @click="openCreateDataTable"
        >
          Create data table
        </button>
        <template v-else>
          <button class="btn secondary" data-test="run-demo" @click="router.push({ name: 'templates' })">
            <svg viewBox="0 0 24 24" fill="currentColor" class="i15"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" /></svg>
            Run live demo
          </button>
          <div class="split" @click.stop>
            <button class="btn primary split-main" data-test="create-workflow" @click="createWorkflow">Create workflow</button>
            <button class="split-caret" data-test="create-menu-toggle" @click="toggleMenu('create')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" class="i14"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <div v-if="openMenu === 'create'" class="menu create-menu" data-test="create-menu">
              <button class="menu-item" @click="createWorkflow">Start from scratch</button>
              <button class="menu-item" @click="closeMenus(); router.push({ name: 'templates' })">Browse templates</button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 统计卡只在聚合 Overview 显示；项目视图（Personal）不显示（对齐 n8n） -->
    <StatsBar v-if="!inProjectView" />

    <!-- ── Tabs ── -->
    <div class="tabs-row" data-test="overview-tabs">
      <button class="tab" :class="{ active: tab === 'workflows' }" data-test="tab-workflows" @click="switchTab('workflows')">Workflows</button>
      <button class="tab" :class="{ active: tab === 'credentials' }" data-test="tab-credentials" @click="switchTab('credentials')">Credentials</button>
      <button class="tab" :class="{ active: tab === 'executions' }" data-test="tab-executions" @click="switchTab('executions')">Executions</button>
      <button class="tab" :class="{ active: tab === 'variables' }" data-test="tab-variables" @click="switchTab('variables')">Variables</button>
      <button class="tab" :class="{ active: tab === 'data-tables' }" data-test="tab-data-tables" @click="switchTab('data-tables')">Data tables</button>
      <button v-if="showProjectSettings" class="tab" :class="{ active: tab === 'project-settings' }" data-test="tab-project-settings" @click="switchTab('project-settings')">Project settings</button>
    </div>

    <p v-if="error" class="error-text" data-test="overview-error">{{ error }}</p>

    <!-- ── Filter / sort / funnel row ── -->
    <div v-if="showFilterRow" class="filter-row">
      <!-- 项目视图：左侧项目上下文 "👤 Personal ⋮"（对齐 n8n） -->
      <div v-if="inProjectView" class="proj-context" data-test="proj-context">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i15"><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20c0-3.4 3-5.2 6.5-5.2s6.5 1.8 6.5 5.2" /></svg>
        <span>{{ projects.currentName }}</span>
        <button class="proj-menu" title="Project settings" @click="router.push({ name: 'projects' })">
          <svg viewBox="0 0 24 24" fill="currentColor" class="i18"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
        </button>
      </div>
      <div class="search" :class="{ focus: false }">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="i15"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input v-model="search" data-test="overview-search" placeholder="Search" />
      </div>
      <template v-if="tab === 'workflows'">
        <div class="dropdown" @click.stop>
          <button class="sortby" data-test="sort-toggle" @click="toggleMenu('sort')">
            {{ sortLabel }}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="i14"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <div v-if="openMenu === 'sort'" class="menu sort-menu" data-test="sort-menu">
            <button class="menu-item" @click="sortKey = 'updated'; closeMenus()">Sort by last updated</button>
            <button class="menu-item" @click="sortKey = 'name-asc'; closeMenus()">Sort by name (A-Z)</button>
            <button class="menu-item" @click="sortKey = 'name-desc'; closeMenus()">Sort by name (Z-A)</button>
          </div>
        </div>
        <button
          class="filter-btn"
          :class="{ on: activeOnly }"
          data-test="filter-active"
          title="Show active workflows only"
          @click="activeOnly = !activeOnly"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i16"><path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" /></svg>
        </button>
      </template>
    </div>

    <!-- ── Workflows ── -->
    <template v-if="tab === 'workflows'">
      <div v-if="sortedWorkflows.length === 0" class="empty-state" data-test="workflow-empty">
        <button class="scratch-card" data-test="start-from-scratch" @click="createWorkflow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="scratch-icon"><path d="M12 5v14M5 12h14" stroke-linecap="round" /></svg>
          <span>Start from scratch</span>
        </button>
      </div>

      <div v-else class="wf-list" data-test="workflow-list">
        <div v-for="row in pagedWorkflows" :key="row.id" class="wf-card">
          <div class="wf-main">
            <RouterLink class="wf-name" :to="{ name: 'canvas', params: { id: row.id } }">{{ row.name }}</RouterLink>
            <div class="wf-meta">
              <span>Last updated {{ timeAgo(row.updatedAt) }}</span>
              <span class="sep">|</span>
              <span>Created {{ fmtDate(row.createdAt) }}</span>
              <span v-if="row.active" class="active-dot" title="Active">Active</span>
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
            <div v-if="openMenu === row.id" class="menu row-menu-pop" :data-test-menu-pop="row.id">
              <button class="menu-item" @click="openWorkflow(row.id)">Open</button>
              <button class="menu-item" :data-test-activate="row.id" @click="toggleActive(row)">
                {{ row.active ? 'Deactivate' : 'Activate' }}
              </button>
              <div class="menu-sep" />
              <button class="menu-item danger" :data-test-delete="row.id" @click="removeWorkflow(row.id)">Delete</button>
            </div>
          </div>
        </div>

        <!-- 分页 -->
        <div class="pager" data-test="pager">
          <span class="pg-total">Total {{ sortedWorkflows.length }}</span>
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
            <option :value="10">10/page</option>
            <option :value="25">25/page</option>
            <option :value="50">50/page</option>
          </select>
        </div>
      </div>
    </template>

    <!-- ── Credentials ── -->
    <template v-else-if="tab === 'credentials'">
      <div v-if="credentials.length === 0" class="cred-empty" data-test="credential-empty">
        <div class="lock">🔒</div>
        <h3>Create your first credential</h3>
        <p class="dim">Credentials let your workflows securely connect to your apps and services</p>
        <button class="btn primary" data-test="new-credential" style="margin-top: 8px" @click="showCredModal = true">
          Add first credential
        </button>
      </div>

      <template v-else>
        <div class="card" style="padding: 0">
          <p v-if="filteredCredentials.length === 0" class="dim" style="padding: 24px; text-align: center">No matching credentials.</p>
          <div v-for="row in filteredCredentials" :key="row.id" class="list-row">
            <span class="cred-row-icon">{{ credIcon(row.type) }}</span>
            <div class="row-main">
              <span class="row-title">{{ row.name }}</span>
              <div class="row-sub">{{ credLabel(row.type) }} · Created {{ timeAgo(row.createdAt) }}</div>
            </div>
            <button style="padding: 4px 10px" @click="removeCredential(row.id)">Delete</button>
          </div>
        </div>
        <div style="margin-top: 12px; text-align: right">
          <button class="btn primary" data-test="new-credential" @click="showCredModal = true">Add credential</button>
        </div>
      </template>

      <CredentialModal v-if="showCredModal" @close="showCredModal = false" @created="onCredCreated" />
    </template>

    <!-- ── Executions ── -->
    <template v-else-if="tab === 'executions'">
      <div class="exec-tools">
        <span class="exec-sublabel dim">
          {{ executions.length }} execution{{ executions.length === 1 ? '' : 's' }}
        </span>
        <span style="flex: 1" />
      </div>

      <div class="card" style="padding: 0; overflow: hidden" data-test="executions-list">
        <table class="exec-table">
          <thead>
            <tr>
              <th class="exec-caret-col" />
              <th>Workflow</th>
              <th>Status</th>
              <th>Started</th>
              <th>Run Time</th>
              <th>Exec. ID</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="executions.length === 0">
              <td colspan="6" class="exec-empty">No executions</td>
            </tr>
            <template v-for="row in executions" :key="row.id">
              <tr class="exec-row" :data-test-exec="row.id" @click="openExecution(row.id)">
                <td class="exec-caret-col">
                  <span class="expand-caret" :class="{ open: executionDetail?.id === row.id }">›</span>
                </td>
                <td class="exec-wf">{{ workflowNameById[row.workflowId] ?? '(deleted workflow)' }}</td>
                <td>
                  <span class="exec-pill" :class="statusMeta(row.status).cls">{{ statusMeta(row.status).label }}</span>
                </td>
                <td class="dim">{{ fmtStarted(row.startedAt) }}</td>
                <td class="dim tnum">{{ fmtRunTime(row) }}</td>
                <td class="dim exec-id">{{ row.id.slice(0, 8) }}</td>
              </tr>
              <tr v-if="executionDetail?.id === row.id" class="exec-detail-row">
                <td colspan="6">
                  <div class="exec-detail-panel">
                    <p v-if="detailRows.length === 0" class="dim" style="font-size: 12px">No node run data.</p>
                    <div v-for="d in detailRows" :key="d.name" class="exec-node-row">
                      <span :style="{ color: d.ok ? 'var(--ok)' : 'var(--err)' }">●</span>
                      <span class="exec-node-name">{{ d.name }}</span>
                      <span class="dim tnum" style="font-size: 11px">{{ d.time }}ms</span>
                      <span v-if="d.error" class="error-text" style="font-size: 11px">{{ d.error }}</span>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ── Project settings（团队项目：成员管理，对齐 n8n） ── -->
    <template v-else-if="tab === 'project-settings'">
      <div class="proj-settings" data-test="project-settings">
        <div class="ps-section">
          <h3 class="ps-title">Project name</h3>
          <input class="ps-name" :value="projects.currentName" readonly />
        </div>
        <div class="ps-section">
          <h3 class="ps-title">Members</h3>
          <p v-if="memberError" class="error-text" data-test="ps-error">{{ memberError }}</p>
          <div class="card" style="padding: 0">
            <table>
              <thead>
                <tr><th>Email</th><th>Role</th><th /></tr>
              </thead>
              <tbody>
                <tr v-for="m in members" :key="m.userId">
                  <td>{{ m.email }}</td>
                  <td style="width: 160px">
                    <select :value="m.role" @change="changeMemberRole(m.userId, $event)">
                      <option value="project:owner">Owner</option>
                      <option value="project:editor">Editor</option>
                      <option value="project:viewer">Viewer</option>
                    </select>
                  </td>
                  <td style="width: 90px; text-align: right"><button @click="removeMember(m.userId)">Remove</button></td>
                </tr>
                <tr v-if="members.length === 0">
                  <td colspan="3" class="dim" style="text-align: center; padding: 18px">Only you have access to this project.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="ps-add">
            <input v-model="memberEmail" placeholder="Member email" data-test="ps-member-email" />
            <select v-model="memberRole" style="width: 150px">
              <option value="project:editor">Editor</option>
              <option value="project:viewer">Viewer</option>
              <option value="project:owner">Owner</option>
            </select>
            <button class="btn primary" data-test="ps-add-member" :disabled="!memberEmail" @click="addMember">Add member</button>
          </div>
        </div>
        <div class="ps-hint dim">{{ projectRoleLabel[projects.current?.role ?? ''] ?? 'Member' }} · manage this project’s members and their roles.</div>
      </div>
    </template>

    <!-- ── Variables（项目维度键值对，$vars.KEY） ── -->
    <template v-else-if="tab === 'variables'">
      <p v-if="varError" class="error-text" data-test="var-error">{{ varError }}</p>

      <div v-if="variables.length === 0 && !editingVar" class="cred-empty" data-test="variable-empty">
        <div class="lock">👋</div>
        <h3>{{ ownerName }}, let’s set up a variable</h3>
        <p class="dim">Variables can be used to store data that can be referenced easily across multiple workflows.</p>
        <button class="btn primary" data-test="add-first-variable" style="margin-top: 8px" @click="startNewVariable">Add first variable</button>
      </div>

      <div v-else class="card" style="padding: 0" data-test="variables-list">
        <table class="var-table">
          <thead>
            <tr><th>Name</th><th>Value</th><th>Usage</th><th /></tr>
          </thead>
          <tbody>
            <tr v-if="editingVar && editingVar.id === 'new'" class="var-edit-row">
              <td><input v-model="editingVar.key" data-test="var-key" placeholder="MY_VARIABLE" /></td>
              <td><input v-model="editingVar.value" data-test="var-value" placeholder="value" /></td>
              <td class="dim">—</td>
              <td class="var-actions">
                <button class="btn primary" data-test="var-save" @click="saveVariable">Save</button>
                <button @click="editingVar = null">Cancel</button>
              </td>
            </tr>
            <tr v-for="v in variables" :key="v.id" class="var-row">
              <template v-if="editingVar && editingVar.id === v.id">
                <td><input v-model="editingVar.key" /></td>
                <td><input v-model="editingVar.value" /></td>
                <td class="dim">—</td>
                <td class="var-actions">
                  <button class="btn primary" @click="saveVariable">Save</button>
                  <button @click="editingVar = null">Cancel</button>
                </td>
              </template>
              <template v-else>
                <td class="var-key">{{ v.key }}</td>
                <td class="var-val">{{ v.value || '—' }}</td>
                <td><code class="var-usage">{{ varUsage(v.key) }}</code></td>
                <td class="var-actions">
                  <button :data-test-var-edit="v.id" @click="editVariable(v)">Edit</button>
                  <button class="danger" :data-test-var-delete="v.id" @click="deleteVariable(v.id)">Delete</button>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ── Data tables（项目维度结构化表） ── -->
    <template v-else>
      <p v-if="dtError" class="error-text" data-test="dt-error">{{ dtError }}</p>

      <div v-if="dataTables.length === 0" class="cred-empty" data-test="data-table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" class="soon-icon">
          <ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
        </svg>
        <h3>You don't have any data tables yet</h3>
        <p class="dim">Use data tables to persist execution results, share data between workflows, and track metrics for evaluation.</p>
        <button class="btn primary" data-test="create-first-data-table" style="margin-top: 8px" @click="openCreateDataTable">Create data table</button>
      </div>

      <div v-else class="dt-grid" data-test="data-tables-list">
        <div
          v-for="t in dataTables"
          :key="t.id"
          class="dt-card"
          :data-test-data-table="t.id"
          @click="openDataTable(t.id)"
        >
          <div class="dt-card-head">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" class="dt-card-icon">
              <ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
            </svg>
            <span class="dt-card-name">{{ t.name }}</span>
            <div class="dropdown" @click.stop>
              <button class="row-menu" :data-test-dt-menu="t.id" @click="toggleMenu('dt-' + t.id)">
                <svg viewBox="0 0 24 24" fill="currentColor" class="i18"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
              </button>
              <div v-if="openMenu === 'dt-' + t.id" class="menu row-menu-pop">
                <button class="menu-item" @click="openDataTable(t.id)">Open</button>
                <button class="menu-item danger" @click="deleteDataTable(t.id)">Delete</button>
              </div>
            </div>
          </div>
          <div class="dt-card-meta">
            <span>{{ t.columns.length }} {{ t.columns.length === 1 ? 'column' : 'columns' }}</span>
            <span class="dt-dot">·</span>
            <span>{{ t.rowCount }} {{ t.rowCount === 1 ? 'row' : 'rows' }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- ── Create data table 弹窗 ── -->
    <div v-if="showDataTableModal" class="modal-mask" data-test="data-table-modal" @click.self="showDataTableModal = false">
      <div class="modal-card">
        <h2 class="modal-title">Create new data table</h2>
        <label class="modal-label">Name</label>
        <input
          v-model="newTableName"
          class="modal-input"
          data-test="data-table-name"
          placeholder="e.g. customers"
          @keyup.enter="createDataTable"
        />
        <p v-if="dtError" class="error-text">{{ dtError }}</p>
        <div class="modal-actions">
          <button class="btn secondary" @click="showDataTableModal = false">Cancel</button>
          <button class="btn primary" data-test="data-table-create" :disabled="!newTableName.trim() || creatingTable" @click="createDataTable">Create</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ov { padding: 22px 26px 40px; width: 100%; }

/* Header */
.ov-head { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 22px; }
.ov-title h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.2px; color: var(--text-hi); }
.ov-sub { margin: 4px 0 0; color: var(--text-dim); font-size: 14px; }
.ov-actions { margin-left: auto; display: flex; align-items: stretch; gap: 10px; }

.btn {
  display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px;
  border-radius: var(--radius); border: none; font-size: 14px; font-weight: 500;
  cursor: pointer; white-space: nowrap; font-family: inherit; color: var(--text-hi);
}
.btn.secondary { background: var(--bg-panel); }
.btn.secondary:hover { background: #303030; }
.btn.primary { background: var(--accent); color: #fff; }
.btn.primary:hover { background: var(--accent-dim); }

.split { position: relative; display: inline-flex; align-items: stretch; }
.split .split-main { border-radius: var(--radius) 0 0 var(--radius); }
.split-caret {
  background: var(--accent); color: #fff; border: none; cursor: pointer;
  border-radius: 0 var(--radius) var(--radius) 0; padding: 0 8px; display: flex; align-items: center;
  border-left: 1px solid rgba(0, 0, 0, 0.22);
}
.split-caret:hover { background: var(--accent-dim); }

/* Filter row */
.filter-row { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin: 18px 0 16px; }
.proj-context { display: flex; align-items: center; gap: 8px; margin-right: auto; color: var(--text); font-size: 14px; }
.proj-context .i15 { color: var(--text-dim); }
.proj-menu {
  width: 28px; height: 28px; border: none; background: none; color: var(--text-dim);
  border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.proj-menu:hover { background: var(--bg-hover); color: var(--text); }
.search {
  display: flex; align-items: center; gap: 8px; background: var(--bg-panel);
  border: 1px solid var(--border); border-radius: var(--radius); height: 34px; padding: 0 12px;
  width: 230px; color: var(--text-faint);
}
.search:focus-within { border-color: var(--border-strong); }
.search input {
  border: none; background: none; outline: none; color: var(--text); font-size: 14px;
  font-family: inherit; width: 100%; padding: 0;
}
.search input::placeholder { color: var(--text-faint); }
.sortby {
  display: flex; align-items: center; gap: 22px; background: var(--bg-panel);
  border: 1px solid var(--border); border-radius: var(--radius); height: 34px; padding: 0 12px;
  color: var(--text); font-size: 14px; cursor: pointer;
}
.sortby:hover { border-color: var(--border-strong); }
.filter-btn {
  width: 34px; height: 34px; background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: var(--radius); display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--text);
}
.filter-btn:hover { border-color: var(--border-strong); }
.filter-btn.on { border-color: var(--accent); color: var(--accent); }

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

/* Workflow cards */
.wf-list { display: flex; flex-direction: column; gap: 10px; }
.wf-card {
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px;
  display: flex; align-items: center; gap: 16px; padding: 16px 20px;
}
.wf-card:hover { border-color: var(--border-strong); }
.wf-main { flex: 1; min-width: 0; }
.wf-name { font-size: 14px; font-weight: 500; color: var(--text-hi); text-decoration: none; }
.wf-name:hover { color: var(--accent); }
.wf-meta { font-size: 13px; color: var(--text-dim); margin-top: 5px; display: flex; align-items: center; gap: 10px; }
.wf-meta .sep { color: var(--text-faint); }
.wf-meta .active-dot { color: var(--ok); font-size: 12px; }
.wf-meta .active-dot::before { content: '● '; }
.chip {
  display: inline-flex; align-items: center; gap: 6px; background: var(--bg-hover);
  border: 1px solid var(--border); border-radius: var(--radius); padding: 5px 10px;
  font-size: 12px; color: var(--text); white-space: nowrap;
}
.chip svg { color: var(--text-dim); }
.row-menu {
  width: 30px; height: 30px; border-radius: 6px; background: none; border: none;
  color: var(--text); cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.row-menu:hover { background: var(--bg-hover); }

/* Pagination */
.pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 10px; color: var(--text-dim); font-size: 13px; }
.pg-total { margin-right: 6px; }
.pg-arrow {
  width: 30px; height: 30px; border-radius: 6px; background: var(--bg-panel); border: 1px solid var(--border);
  color: var(--text-faint); display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.pg-arrow:disabled { opacity: 0.4; cursor: not-allowed; }
.pg-num {
  min-width: 30px; height: 30px; padding: 0 6px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--bg-panel); color: var(--text); font-size: 13px; cursor: pointer;
}
.pg-num.active { border-color: var(--accent); color: var(--accent); background: none; }
.pg-size {
  height: 30px; padding: 0 8px; border-radius: 6px; background: var(--bg-panel);
  border: 1px solid var(--border); color: var(--text); font-size: 13px; cursor: pointer; width: auto;
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
.cred-row-icon {
  width: 32px; height: 32px; flex-shrink: 0; border-radius: 8px; background: var(--bg-hover);
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

/* Executions (n8n 式表格) */
.exec-tools { display: flex; align-items: center; margin: 18px 0 12px; }
.exec-sublabel { font-size: 13px; }
.exec-table { width: 100%; border-collapse: collapse; }
.exec-table thead th {
  text-align: left; font-size: 12px; font-weight: 500; color: var(--text-dim);
  padding: 11px 16px; background: var(--bg-hover); border-bottom: 1px solid var(--border); white-space: nowrap;
}
.exec-caret-col { width: 34px; padding-right: 0 !important; }
.exec-row { cursor: pointer; }
.exec-row td { padding: 13px 16px; font-size: 13px; border-bottom: 1px solid var(--border); }
.exec-row:hover td { background: var(--bg-hover); }
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
