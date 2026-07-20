<script setup lang="ts">
import { computed, ref } from 'vue';
import type { INodeExecutionData } from '@nomops/workflow';
import { tableOf } from '../../lib/run-data.js';

/**
 * NDV 数据窗格：Schema / Table / JSON 三视图（输入与输出两侧共用）。
 * Schema 视图的字段行与 Table 表头可拖拽——拖进参数输入框生成 `{{ $json.path }}` 映射。
 */
// 注意：Vue 会把未传的 Boolean prop 铸成 false，因此 draggable 要显式默认 true
const props = withDefaults(
  defineProps<{
    title: string;
    items: INodeExecutionData[];
    emptyHint?: string;
    draggable?: boolean;
    /** 基线式空态：标题 + 主按钮文案（如 Execute previous nodes / Execute step） */
    emptyTitle?: string;
    emptyAction?: string;
    emptyCaption?: string;
  }>(),
  { draggable: true, emptyHint: undefined, emptyTitle: undefined, emptyAction: undefined, emptyCaption: undefined },
);

type ViewMode = 'schema' | 'table' | 'json';
// D098 对标基线:数据窗格默认 Schema 视图
const view = ref<ViewMode>('schema');

defineEmits<{ 'empty-action': [] }>();


const table = computed(() => tableOf(props.items));

/** Schema：首个 item 的 json 摊平成 path + 类型 + 示例值。 */
interface ISchemaField {
  path: string; // $json 后的访问路径，如 user.name / tags[0]
  type: string;
  sample: string;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function sampleOf(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === undefined ? '' : s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

function flatten(value: unknown, prefix: string, out: ISchemaField[], depth: number): void {
  if (depth > 4) return; // 防深层对象刷屏
  if (Array.isArray(value)) {
    out.push({ path: prefix, type: 'array', sample: sampleOf(value) });
    if (value.length > 0) flatten(value[0], `${prefix}[0]`, out, depth + 1);
    return;
  }
  if (value !== null && typeof value === 'object') {
    if (prefix) out.push({ path: prefix, type: 'object', sample: sampleOf(value) });
    for (const [k, v] of Object.entries(value)) {
      const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : `["${k}"]`;
      const next = prefix ? (safeKey.startsWith('[') ? `${prefix}${safeKey}` : `${prefix}.${safeKey}`) : safeKey;
      flatten(v, next, out, depth + 1);
    }
    return;
  }
  out.push({ path: prefix, type: typeOf(value), sample: sampleOf(value) });
}

const schema = computed<ISchemaField[]>(() => {
  const first = props.items[0]?.json;
  if (!first) return [];
  const out: ISchemaField[] = [];
  flatten(first, '', out, 0);
  return out;
});

/** 拖出映射表达式：参数框 drop 后变成 ={{ $json.path }}。 */
function onDragField(event: DragEvent, path: string) {
  const expr = `{{ $json.${path} }}`;
  event.dataTransfer?.setData('application/nomops-expr', expr);
  event.dataTransfer?.setData('text/plain', expr);
  event.dataTransfer!.effectAllowed = 'copy';
}
</script>

<template>
  <div class="data-pane">
    <div class="pane-head">
      <span>{{ title }}</span>
      <div class="view-tabs">
        <button :class="{ on: view === 'schema' }" data-test="pane-view-schema" @click="view = 'schema'">Schema</button>
        <button :class="{ on: view === 'table' }" data-test="pane-view-table" @click="view = 'table'">Table</button>
        <button :class="{ on: view === 'json' }" data-test="pane-view-json" @click="view = 'json'">JSON</button>
      </div>
      <span class="dim" style="font-size: 11px">{{ items.length }} {{ items.length === 1 ? 'item' : 'items' }}</span>
    </div>

    <div class="pane-body">
      <!-- 基线实测空态：标题 16px/600 白 + primary 按钮(32px) + 说明行 -->
      <div v-if="items.length === 0" class="pane-empty" data-test="pane-empty">
        <template v-if="emptyTitle">
          <div class="pe-title">{{ emptyTitle }}</div>
          <button v-if="emptyAction" class="pe-action" @click="$emit('empty-action')">{{ emptyAction }}</button>
          <div v-if="emptyCaption" class="pe-caption">{{ emptyCaption }}</div>
        </template>
        <p v-else class="dim" style="font-size: 12px">{{ emptyHint ?? 'No data yet — run once' }}</p>
      </div>

      <!-- Schema：字段行可拖拽进参数框 -->
      <div v-else-if="view === 'schema'" class="schema-list" data-test="pane-schema">
        <div
          v-for="f in schema"
          :key="f.path"
          class="schema-row"
          :draggable="draggable !== false"
          :data-test-schema-field="f.path"
          :title="draggable !== false ? 'Drag into a parameter to map this field' : undefined"
          @dragstart="onDragField($event, f.path)"
        >
          <span class="sf-grip">⋮⋮</span>
          <span class="sf-path">{{ f.path }}</span>
          <span class="sf-type">{{ f.type }}</span>
          <span class="sf-sample">{{ f.sample }}</span>
        </div>
        <p v-if="schema.length === 0" class="dim" style="font-size: 12px">Empty object</p>
      </div>

      <!-- Table：表头可拖拽 -->
      <table v-else-if="view === 'table' && table" class="pane-table">
        <thead>
          <tr>
            <th
              v-for="c in table.columns"
              :key="c"
              :draggable="draggable !== false"
              class="th-draggable"
              @dragstart="onDragField($event, c)"
            >{{ c }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in table.rows" :key="i">
            <td v-for="(cell, j) in row" :key="j">{{ cell === undefined ? '' : JSON.stringify(cell) }}</td>
          </tr>
        </tbody>
      </table>

      <pre v-else>{{ JSON.stringify(items.map((it) => it.json), null, 2) }}</pre>
    </div>
  </div>
</template>

<style scoped>
.data-pane { display: flex; flex-direction: column; min-width: 0; height: 100%; }
/* 基线实测：INPUT/OUTPUT 头 = 12px/600 白色大写、字距放宽、无底边线 */
.pane-head {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 14px var(--spacing--sm) 8px;
  font-size: var(--font-size--2xs); font-weight: var(--font-weight--bold);
  color: var(--color--text--shade-1); text-transform: uppercase; letter-spacing: var(--letter-spacing--widest);
}
.view-tabs { display: flex; gap: 2px; background: var(--bg-input); border-radius: 6px; padding: 2px; }
.view-tabs button {
  padding: 3px 9px; font-size: 11px; border: none; background: none; border-radius: 5px;
  color: var(--text-dim); cursor: pointer; text-transform: none; font-family: inherit;
}
.view-tabs button.on { background: var(--bg-panel); color: var(--text); }
.pane-body { flex: 1; overflow: auto; padding: 8px 12px; }
.pane-empty { display: flex; flex-direction: column; align-items: center; gap: 14px; margin-top: 34%; text-align: center; }
.pe-title { font-size: var(--font-size--md); font-weight: var(--font-weight--bold); color: var(--color--text--shade-1); }
.pe-action {
  height: 32px; padding: 0 var(--spacing--xs); border: none; border-radius: var(--radius);
  background: var(--button--color--background--primary); color: var(--button--color--text--primary);
  font-size: var(--font-size--sm); font-weight: var(--font-weight--medium);
  box-shadow: inset 0 0 0 1px var(--button--border-color--primary), 0 1px 3px -1px var(--color--black-alpha-100);
}
.pe-action:hover { background: var(--button--color--background--primary--hover-active-focus); }
.pe-caption { font-size: var(--font-size--sm); color: var(--color--text); }
.pane-table th, .pane-table td { font-size: 12px; padding: 6px 8px; }
.th-draggable { cursor: grab; }
.th-draggable:hover { color: var(--accent); }
pre { font-size: 12px; background: var(--bg-input); padding: 10px; border-radius: 6px; }

/* Schema 视图 */
.schema-list { display: flex; flex-direction: column; gap: 2px; }
.schema-row {
  display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 6px;
  font-size: 12px; cursor: grab; border: 1px solid transparent;
}
.schema-row:hover { background: var(--bg-hover); border-color: var(--border); }
.schema-row:active { cursor: grabbing; }
.sf-grip { color: var(--text-faint); font-size: 9px; letter-spacing: -2px; }
.sf-path { color: var(--accent); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.sf-type { color: var(--text-faint); font-size: 10.5px; }
.sf-sample { color: var(--text-dim); margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 45%; }
</style>
