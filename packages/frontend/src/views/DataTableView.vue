<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  api,
  type DataTableColumn,
  type DataTableColumnType,
  type DataTableRowView,
  type DataTableView,
} from '../api/client.js';
import { useProjectsStore } from '../stores/projects.js';

/** Data table 明细：面包屑 + 工具栏 + 可编辑网格（系统列 id/createdAt/updatedAt + 用户列）。 */
const route = useRoute();
const router = useRouter();
const projects = useProjectsStore();

const id = computed(() => String(route.params['id']));

const table = ref<DataTableView | null>(null);
const rows = ref<DataTableRowView[]>([]);
const error = ref('');
const search = ref('');
const loading = ref(true);

/* 头部 ⋮ 菜单 / 新增列表单 */
const headMenu = ref(false);
const showAddColumn = ref(false);
const newColName = ref('');
const newColType = ref<DataTableColumnType>('string');

const COLUMN_TYPES: DataTableColumnType[] = ['string', 'number', 'boolean', 'date'];

const projectName = computed(() => projects.currentName);
const userColumns = computed<DataTableColumn[]>(() => table.value?.columns ?? []);

const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((r) =>
    Object.values(r.data).some((v) => String(v ?? '').toLowerCase().includes(q)),
  );
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [t, r] = await Promise.all([api.dataTables.get(id.value), api.dataTables.rows(id.value)]);
    table.value = t;
    rows.value = r;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
  window.addEventListener('click', closeMenus);
});
onUnmounted(() => window.removeEventListener('click', closeMenus));

function closeMenus() {
  headMenu.value = false;
}

function backToList() {
  void router.push({ path: '/', query: { tab: 'data-tables' } });
}

/* ── 列 ── */
async function addColumn() {
  const name = newColName.value.trim();
  if (!name) return;
  error.value = '';
  try {
    table.value = await api.dataTables.addColumn(id.value, { name, type: newColType.value });
    newColName.value = '';
    newColType.value = 'string';
    showAddColumn.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function removeColumn(name: string) {
  error.value = '';
  try {
    table.value = await api.dataTables.removeColumn(id.value, name);
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/* ── 行 ── */
async function addRow() {
  error.value = '';
  try {
    const created = await api.dataTables.addRow(id.value, {});
    rows.value.push(created);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function removeRow(rowId: string) {
  error.value = '';
  try {
    await api.dataTables.removeRow(id.value, rowId);
    rows.value = rows.value.filter((r) => r.id !== rowId);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/** 单元格编辑：按列类型强转后 PATCH，仅提交该列。 */
async function saveCell(row: DataTableRowView, col: DataTableColumn, raw: string) {
  const coerced = coerce(raw, col.type);
  if (row.data[col.name] === coerced) return;
  error.value = '';
  try {
    const updated = await api.dataTables.updateRow(id.value, row.id, { [col.name]: coerced });
    Object.assign(row, updated);
  } catch (e) {
    error.value = (e as Error).message;
    await load();
  }
}

function coerce(raw: string, type: DataTableColumnType): unknown {
  const s = raw.trim();
  if (s === '') return null;
  if (type === 'number') {
    const n = Number(s);
    return Number.isNaN(n) ? s : n;
  }
  if (type === 'boolean') return s.toLowerCase() === 'true' || s === '1';
  return s;
}

function cellText(row: DataTableRowView, col: DataTableColumn): string {
  const v = row.data[col.name];
  return v === null || v === undefined ? '' : String(v);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

async function renameTable() {
  const t = table.value;
  if (!t) return;
  const next = window.prompt('Rename data table', t.name);
  if (!next || next.trim() === t.name) return;
  error.value = '';
  try {
    table.value = await api.dataTables.rename(id.value, next.trim());
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function deleteTable() {
  if (!window.confirm('Delete this data table and all its rows?')) return;
  await api.dataTables.remove(id.value).catch((e) => (error.value = (e as Error).message));
  backToList();
}
</script>

<template>
  <div class="dtv">
    <!-- 面包屑 -->
    <div class="dtv-crumb">
      <button class="crumb-link" @click="backToList">{{ projectName }}</button>
      <span class="crumb-sep">/</span>
      <button class="crumb-link" @click="backToList">Data tables</button>
      <span class="crumb-sep">/</span>
      <span class="crumb-current">{{ table?.name ?? '…' }}</span>
      <div class="dropdown" @click.stop>
        <button class="crumb-menu-btn" data-test="dtv-menu" @click="headMenu = !headMenu">
          <svg viewBox="0 0 24 24" fill="currentColor" class="i18"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
        </button>
        <div v-if="headMenu" class="menu">
          <button class="menu-item" @click="renameTable(); headMenu = false">Rename</button>
          <button class="menu-item danger" @click="deleteTable">Delete</button>
        </div>
      </div>
    </div>

    <p v-if="error" class="error-text" data-test="dtv-error">{{ error }}</p>

    <!-- 工具栏 -->
    <div class="dtv-tools">
      <div class="dtv-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="i15"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input v-model="search" placeholder="Search" data-test="dtv-search" />
      </div>
      <div class="dtv-tools-right">
        <button class="btn primary" data-test="dtv-add-row" @click="addRow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" class="i14"><path d="M12 5v14M5 12h14" /></svg>
          Add Row
        </button>
        <div class="dropdown" @click.stop>
          <button class="btn secondary" data-test="dtv-add-column" @click="showAddColumn = !showAddColumn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" class="i14"><path d="M12 5v14M5 12h14" /></svg>
            Add Column
          </button>
          <div v-if="showAddColumn" class="menu add-col-menu" @click.stop>
            <label class="acm-label">Column name</label>
            <input v-model="newColName" class="acm-input" placeholder="e.g. email" data-test="dtv-col-name" @keyup.enter="addColumn" />
            <label class="acm-label">Type</label>
            <select v-model="newColType" class="acm-input" data-test="dtv-col-type">
              <option v-for="t in COLUMN_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
            <div class="acm-actions">
              <button @click="showAddColumn = false">Cancel</button>
              <button class="btn primary" data-test="dtv-col-create" :disabled="!newColName.trim()" @click="addColumn">Add</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 网格 -->
    <div class="dtv-grid-wrap">
      <table class="dtv-grid" data-test="dtv-grid">
        <thead>
          <tr>
            <th class="sys-col">id</th>
            <th class="sys-col">createdAt</th>
            <th class="sys-col">updatedAt</th>
            <th v-for="col in userColumns" :key="col.name" class="user-col">
              <span class="col-name">{{ col.name }}</span>
              <span class="col-type">{{ col.type }}</span>
              <button class="col-del" :title="`Delete column ${col.name}`" @click="removeColumn(col.name)">×</button>
            </th>
            <th class="add-col-cell">
              <button class="add-col-plus" title="Add column" @click.stop="showAddColumn = true">+</button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredRows" :key="row.id" class="dtv-row">
            <td class="sys-cell mono">{{ row.id.slice(0, 8) }}</td>
            <td class="sys-cell">{{ fmtDate(row.createdAt) }}</td>
            <td class="sys-cell">{{ fmtDate(row.updatedAt) }}</td>
            <td v-for="col in userColumns" :key="col.name" class="user-cell">
              <input
                class="cell-input"
                :value="cellText(row, col)"
                :placeholder="col.type === 'number' ? '0' : ''"
                @blur="saveCell(row, col, ($event.target as HTMLInputElement).value)"
                @keyup.enter="($event.target as HTMLInputElement).blur()"
              />
            </td>
            <td class="row-actions-cell">
              <button class="row-del" :data-test-row-del="row.id" title="Delete row" @click="removeRow(row.id)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" class="i15"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
              </button>
            </td>
          </tr>
          <tr v-if="!loading && filteredRows.length === 0">
            <td :colspan="userColumns.length + 4" class="dtv-empty">No rows</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 分页信息 -->
    <div class="dtv-foot">
      <span class="dtv-total">Total {{ filteredRows.length }}</span>
    </div>
  </div>
</template>

<style scoped>
.dtv { padding: 22px 26px 40px; width: 100%; }

/* 面包屑 */
.dtv-crumb { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
.crumb-link { background: none; border: none; color: var(--text-dim); font-size: 14px; cursor: pointer; font-family: inherit; padding: 0; }
.crumb-link:hover { color: var(--text-hi); }
.crumb-sep { color: var(--text-faint); }
.crumb-current { color: var(--text-hi); font-size: 14px; font-weight: 600; }
.crumb-menu-btn {
  width: 26px; height: 26px; border-radius: 6px; background: none; border: none; color: var(--text-dim);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.crumb-menu-btn:hover { background: var(--bg-hover); color: var(--text-hi); }
.dropdown { position: relative; }
.menu {
  position: absolute; z-index: 40; top: calc(100% + 6px); left: 0; min-width: 180px; background: var(--bg-panel);
  border: 1px solid var(--border-strong); border-radius: 10px; padding: 6px; box-shadow: 0 12px 34px rgba(0, 0, 0, 0.5);
}
.menu-item {
  display: block; width: 100%; text-align: left; padding: 8px 10px; border: none; background: none;
  border-radius: 6px; color: var(--text); font-size: 13.5px; cursor: pointer; font-family: inherit;
}
.menu-item:hover { background: var(--bg-hover); }
.menu-item.danger { color: var(--err); }

/* 工具栏 */
.dtv-tools { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.dtv-search {
  display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; flex: 1; max-width: 320px;
  background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-faint);
}
.dtv-search input { flex: 1; background: none; border: none; color: var(--text); font-size: 14px; font-family: inherit; }
.dtv-search input:focus { outline: none; }
.dtv-tools-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.btn {
  display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; border-radius: var(--radius);
  border: none; font-size: 14px; font-weight: 500; cursor: pointer; white-space: nowrap; font-family: inherit; color: var(--text-hi);
  background: var(--bg-panel); border: 1px solid var(--border);
}
.btn.secondary:hover { background: var(--bg-hover); }
.btn.primary { background: var(--accent); color: #fff; border-color: transparent; }
.btn.primary:hover { background: var(--accent-dim); }
.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }

/* Add column 弹层 */
.add-col-menu { left: auto; right: 0; min-width: 240px; display: flex; flex-direction: column; gap: 6px; padding: 12px; }
.acm-label { font-size: 12px; color: var(--text-dim); }
.acm-input {
  width: 100%; height: 32px; padding: 0 10px; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text); font-size: 13px; font-family: inherit;
}
.acm-input:focus { outline: none; border-color: var(--accent); }
.acm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.acm-actions button { height: 30px; padding: 0 12px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg-panel); color: var(--text); font-size: 13px; cursor: pointer; font-family: inherit; }
.acm-actions .btn.primary { border-color: transparent; }

/* 网格 */
.dtv-grid-wrap { border: 1px solid var(--border); border-radius: 10px; overflow-x: auto; background: var(--bg-panel); }
.dtv-grid { width: 100%; border-collapse: collapse; font-size: 13px; }
.dtv-grid thead th {
  text-align: left; font-weight: 500; color: var(--text-dim); padding: 10px 14px;
  background: var(--bg-hover); border-bottom: 1px solid var(--border); white-space: nowrap;
}
.sys-col { color: var(--text-faint) !important; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.user-col { position: relative; }
.col-name { color: var(--text-hi); font-weight: 600; }
.col-type { margin-left: 6px; font-size: 11px; color: var(--text-faint); }
.col-del {
  margin-left: 8px; border: none; background: none; color: var(--text-faint); cursor: pointer; font-size: 15px; line-height: 1;
}
.col-del:hover { color: var(--err); }
.add-col-cell { width: 40px; text-align: center; }
.add-col-plus { width: 24px; height: 24px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-panel); color: var(--text-dim); cursor: pointer; }
.add-col-plus:hover { color: var(--text-hi); border-color: var(--border-strong); }

.dtv-row td { padding: 0 14px; border-bottom: 1px solid var(--border); height: 42px; vertical-align: middle; }
.dtv-row:last-child td { border-bottom: none; }
.sys-cell { color: var(--text-dim); white-space: nowrap; }
.sys-cell.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.user-cell { padding: 0 6px !important; }
.cell-input {
  width: 100%; min-width: 120px; height: 40px; padding: 0 8px; background: none; border: 1px solid transparent;
  border-radius: 4px; color: var(--text); font-size: 13px; font-family: inherit;
}
.cell-input:hover { border-color: var(--border); }
.cell-input:focus { outline: none; border-color: var(--accent); background: var(--bg-input); }
.row-actions-cell { width: 44px; text-align: center; }
.row-del { border: none; background: none; color: var(--text-faint); cursor: pointer; display: inline-flex; }
.row-del:hover { color: var(--err); }
.dtv-empty { text-align: center; color: var(--text-dim); padding: 40px !important; height: auto !important; }

.dtv-foot { display: flex; justify-content: flex-end; margin-top: 12px; color: var(--text-dim); font-size: 13px; }

.error-text { color: var(--err); font-size: 13px; margin: 0 0 12px; }
.i14 { width: 14px; height: 14px; flex-shrink: 0; }
.i15 { width: 15px; height: 15px; flex-shrink: 0; }
.i18 { width: 18px; height: 18px; flex-shrink: 0; }
</style>
