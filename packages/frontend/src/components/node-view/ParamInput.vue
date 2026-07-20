<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { INodeExecutionData, INodeProperties } from '@nomops/workflow';
import { resolveParameterValue } from '@nomops/workflow';
import ExpressionInput from './ExpressionInput.vue';
import { t } from '../../lib/i18n.js';
import { LINKS } from '../../lib/links.js';

/**
 * schema 驱动的单参数控件：按 INodeProperties.type 分发。
 * string 支持 fx 切换为表达式模式（值以 '=' 开头即表达式，对齐引擎约定）。
 * json / collection 用 JSON 文本编辑 + 解析校验。
 * 拖拽映射：从 NDV 数据窗格拖字段进来 → 生成/追加 {{ $json.path }}；
 * 表达式模式下按 previewItems（上游输入首 item）实时求值预览。
 */
const props = defineProps<{
  prop: INodeProperties;
  value: unknown;
  /** 表达式预览与拖拽映射的上下文（NDV 传入上游输入 items）。 */
  previewItems?: INodeExecutionData[];
  nodeParameters?: Record<string, unknown>;
}>();
const emit = defineEmits<{ change: [value: unknown] }>();

const current = computed(() => props.value ?? props.prop.default);

/* 字面量 "{{ }}"(不能直接写进模板插值,会被 Vue 当嵌套 mustache)。 */
const CURLY = '{{ }}';

/* D115:Result 预览面板可翻页浏览各输入 item。 */
const previewIndex = ref(0);
const previewCount = computed(() => (props.previewItems ?? []).length);

/* ── 表达式实时预览（沙箱与引擎同一实现；$node/$vars 前端没有则留空） ── */
const preview = computed<{ ok: boolean; text: string } | null>(() => {
  if (!isExpression.value) return null;
  const items = props.previewItems ?? [];
  const idx = Math.min(previewIndex.value, Math.max(0, items.length - 1));
  try {
    const resolved = resolveParameterValue(String(current.value), {
      json: items[idx]?.json ?? {},
      itemIndex: idx,
      items,
      runData: {},
      workflow: {},
      vars: {},
      parameters: props.nodeParameters ?? {},
    });
    const text = typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
    return { ok: true, text: text === undefined ? 'undefined' : text };
  } catch (error) {
    return { ok: false, text: (error as Error).message };
  }
});

/* ── 拖拽映射：接收数据窗格拖来的 {{ $json.path }} ── */
const dragOver = ref(false);
function onDropExpr(event: DragEvent) {
  dragOver.value = false;
  const expr = event.dataTransfer?.getData('application/nomops-expr');
  if (!expr) return;
  event.preventDefault();
  const cur = current.value;
  if (typeof cur === 'string' && cur.startsWith('=')) {
    emit('change', `${cur}${expr}`); // 已是表达式：追加
  } else {
    const base = cur === undefined || cur === null || cur === props.prop.default ? '' : String(cur);
    emit('change', `=${base}${expr}`); // 切表达式模式
  }
}
function onDragOverExpr(event: DragEvent) {
  if (event.dataTransfer?.types.includes('application/nomops-expr')) {
    event.preventDefault();
    dragOver.value = true;
  }
}

/* string / expression */
const isExpression = computed(() => typeof current.value === 'string' && (current.value as string).startsWith('='));
/* D116:字段 ⋮ 菜单(基线实测仅一项 "Reset Value") */
const menuOpen = ref(false);
function resetValue() {
  menuOpen.value = false;
  emit('change', props.prop.default);
}
function toggleExpression() {
  if (isExpression.value) emit('change', String(current.value).slice(1));
  else emit('change', `=${String(current.value ?? '')}`);
}

/* D109 对标基线:几乎所有标量字段都可切 Fixed|Expression(原仅 string)。 */
const EXPRESSIONABLE = ['string', 'number', 'options', 'multiOptions', 'dateTime', 'color'];
const canExpression = computed(() => EXPRESSIONABLE.includes(props.prop.type) && !props.prop.noDataExpression);

/* D111 对标基线:string 带 typeOptions.rows 渲染多行 textarea(如 System Message)。 */
const textRows = computed(() => {
  const rows = props.prop.typeOptions?.rows;
  return typeof rows === 'number' && rows > 1 ? rows : 0;
});
const isMultiline = computed(() => props.prop.type === 'string' && textRows.value > 0);

/* D117 对标基线:上游输入首 item 的 $json 成员路径,喂给表达式编辑器做 `$json.` 变量树补全。 */
const jsonFields = computed<string[]>(() => {
  const first = props.previewItems?.[0]?.json;
  if (!first || typeof first !== 'object') return [];
  const out: string[] = [];
  const walk = (val: unknown, prefix: string, depth: number) => {
    if (depth > 3 || val === null || typeof val !== 'object' || Array.isArray(val)) return;
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      out.push(path);
      walk(v, path, depth + 1);
    }
  };
  walk(first, '', 0);
  return out;
});

/* D108 对标基线:multiOptions 多选(值为数组)。 */
const selectedMulti = computed<unknown[]>(() => (Array.isArray(current.value) ? (current.value as unknown[]) : []));
function toggleMulti(optValue: unknown) {
  const set = selectedMulti.value.slice();
  const idx = set.findIndex((v) => v === optValue);
  if (idx >= 0) set.splice(idx, 1);
  else set.push(optValue);
  emit('change', set);
}

/* json / collection：本地草稿 + 失焦解析 */
const jsonDraft = ref(JSON.stringify(current.value ?? props.prop.default ?? {}, null, 2));
const jsonError = ref('');
watch(current, (v) => {
  // 外部值变化（如切换节点）时刷新草稿
  jsonDraft.value = JSON.stringify(v ?? {}, null, 2);
  jsonError.value = '';
});
function commitJson() {
  try {
    emit('change', JSON.parse(jsonDraft.value));
    jsonError.value = '';
  } catch {
    jsonError.value = 'Invalid JSON — not saved';
  }
}

/* ── collection 富控件 ──
   nomops 的 IF/Set 都用 type:'collection',但形态不同:
   - IF conditions = 数组 [{left,op,right}] → 条件行编辑器(对标基线 filter)
   - Set fields = 键值对象 {k:v} → 名/值行编辑器(对标基线 Set assignments)
   据 name/值形态分流,替代原来退化的 JSON 文本框。 */
const OPERATORS = [
  { value: 'eq', label: 'is equal to' },
  { value: 'ne', label: 'is not equal to' },
  { value: 'gt', label: 'is greater than' },
  { value: 'gte', label: 'is greater than or equal to' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is less than or equal to' },
  { value: 'contains', label: 'contains' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
] as const;
const UNARY_OPS = ['isEmpty', 'isNotEmpty'];

interface Cond { left?: unknown; op: string; right?: unknown }
const isConditions = computed(
  () => props.prop.name === 'conditions' || Array.isArray(current.value) || Array.isArray(props.prop.default),
);
const conditions = computed<Cond[]>(() => (Array.isArray(current.value) ? (current.value as Cond[]) : []));
function addCondition() {
  emit('change', [...conditions.value, { left: '', op: 'eq', right: '' }]);
}
function updateCondition(i: number, key: 'left' | 'op' | 'right', v: unknown) {
  emit('change', conditions.value.map((c, idx) => (idx === i ? { ...c, [key]: v } : c)));
}
function removeCondition(i: number) {
  emit('change', conditions.value.filter((_, idx) => idx !== i));
}

interface KV { k: string; v: unknown }
const fieldRows = ref<KV[]>([]);
function localToObj(rows: KV[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const r of rows) if (r.k) o[r.k] = r.v;
  return o;
}
watch(
  current,
  (v) => {
    const incoming = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    // 仅在外部值确实变了(切节点等)时重建行,避免输入空 key 时行被抹掉
    if (JSON.stringify(incoming) !== JSON.stringify(localToObj(fieldRows.value))) {
      fieldRows.value = Object.entries(incoming).map(([k, val]) => ({ k, v: val }));
    }
  },
  { immediate: true },
);
function addField() {
  fieldRows.value = [...fieldRows.value, { k: '', v: '' }];
}
function updateField(i: number, patch: Partial<KV>) {
  fieldRows.value = fieldRows.value.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
  emit('change', localToObj(fieldRows.value));
}
function removeField(i: number) {
  fieldRows.value = fieldRows.value.filter((_, idx) => idx !== i);
  emit('change', localToObj(fieldRows.value));
}
</script>

<template>
  <div class="param" :data-test-param="prop.name">
    <!-- D112 对标基线:notice 渲染为紫色 Tip 提示条(非灰文本) -->
    <template v-if="prop.type === 'notice'">
      <div class="param-notice" data-test="param-notice">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="pn-icon"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
        <span class="pn-text">{{ prop.description ?? prop.displayName }}</span>
      </div>
    </template>

    <template v-else>
      <label>
        {{ prop.displayName }}
        <span v-if="prop.required" style="color: var(--err)">*</span>
        <!-- D116 live 实测基线字段悬浮工具条:ⓘ(circle-help) + ⋮(Reset Value) + Fixed|Expression 分段 -->
        <span class="param-tools">
          <svg
            v-if="prop.description"
            class="pt-help"
            :aria-label="prop.description"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          ><circle cx="12" cy="12" r="10" /><path d="M12 16v-4m0-4h.01" /></svg>
          <span class="pt-menu-anchor">
            <button class="pt-dots" type="button" data-test="param-menu" :aria-label="t('Parameter options')" @click.stop="menuOpen = !menuOpen">
              <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
            </button>
            <span v-if="menuOpen" class="pt-menu" data-test="param-menu-pop">
              <button type="button" class="pt-menu-item" data-test="param-reset" @click.stop="resetValue">{{ t('Reset Value') }}</button>
            </span>
          </span>
          <!-- D110 对标基线:Fixed|Expression 是分段控件(10px/500、高 15),不是内联 ƒx 按钮 -->
          <span v-if="canExpression" class="pt-seg" data-test="param-fx">
            <button type="button" class="pt-seg-btn" :class="{ active: !isExpression }" @click="isExpression && toggleExpression()">{{ t('Fixed') }}</button>
            <button type="button" class="pt-seg-btn" :class="{ active: isExpression }" @click="!isExpression && toggleExpression()">{{ t('Expression') }}</button>
          </span>
        </span>
      </label>

      <!-- D109 表达式态:任意可切字段统一渲染表达式编辑器(接收数据窗格拖来的映射) -->
      <template v-if="isExpression && canExpression">
        <div
          class="drop-wrap"
          :class="{ over: dragOver }"
          @drop="onDropExpr"
          @dragover="onDragOverExpr"
          @dragleave="dragOver = false"
        >
          <div class="expr-row">
            <span class="expr-gutter" title="Expression">=</span>
            <ExpressionInput
              class="expr-cm"
              :model-value="String(current ?? '')"
              :json-fields="jsonFields"
              @update:model-value="emit('change', $event)"
            />
          </div>
        </div>
        <!-- D115 Result 预览面板:标题 + item 翻页 + 值/空态提示 + JS 提示 -->
        <div class="expr-result" data-test="expr-result">
          <div class="er-head">
            <span class="er-label">Result</span>
            <span class="spacer" style="flex: 1" />
            <div v-if="previewCount > 1" class="er-pager" data-test="expr-pager">
              <button type="button" :disabled="previewIndex <= 0" @click="previewIndex = Math.max(0, previewIndex - 1)">‹</button>
              <span class="er-page">Item {{ previewIndex + 1 }} of {{ previewCount }}</span>
              <button type="button" :disabled="previewIndex >= previewCount - 1" @click="previewIndex = Math.min(previewCount - 1, previewIndex + 1)">›</button>
            </div>
          </div>
          <div class="er-body">
            <span v-if="previewCount === 0" class="er-hint">[Execute previous nodes for preview]</span>
            <span v-else class="er-value" :class="{ err: preview && !preview.ok }">{{ preview?.text }}</span>
          </div>
          <div class="er-tip">
            Anything inside <code>{{ CURLY }}</code> is JavaScript. <a class="link" :href="LINKS.docsExpressions" target="_blank" rel="noopener">Learn more</a>
          </div>
        </div>
      </template>

      <!-- string(fixed):D111 带 rows→多行 textarea,否则单行 input;可接收拖拽映射 -->
      <template v-else-if="prop.type === 'string'">
        <div
          class="drop-wrap"
          :class="{ over: dragOver }"
          @drop="onDropExpr"
          @dragover="onDragOverExpr"
          @dragleave="dragOver = false"
        >
          <textarea
            v-if="isMultiline"
            :value="String(current ?? '')"
            :placeholder="prop.placeholder"
            :rows="textRows"
            data-test="param-textarea"
            @input="emit('change', ($event.target as HTMLTextAreaElement).value)"
          />
          <input
            v-else
            :value="String(current ?? '')"
            :placeholder="prop.placeholder"
            @input="emit('change', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </template>

      <input
        v-else-if="prop.type === 'number'"
        type="number"
        :value="Number(current ?? 0)"
        @input="emit('change', Number(($event.target as HTMLInputElement).value))"
      />

      <!-- 基线实测开关：轨 32×16 圆胶囊 / off=light-2+1px neutral-700 边 / knob 12 白 / on=green-500 -->
      <button
        v-else-if="prop.type === 'boolean'"
        type="button"
        class="pswitch"
        :class="{ on: Boolean(current) }"
        role="switch"
        :aria-checked="Boolean(current)"
        @click="emit('change', !current)"
      >
        <span class="pswitch-knob" />
      </button>

      <select
        v-else-if="prop.type === 'options'"
        :value="String(current ?? '')"
        @change="emit('change', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="opt in prop.options ?? []" :key="String(opt.value)" :value="opt.value">
          {{ opt.name }}
        </option>
      </select>

      <!-- D108 对标基线:multiOptions 多选(勾选芯片),值为数组 -->
      <div v-else-if="prop.type === 'multiOptions'" class="multi-opts" data-test="multi-options">
        <button
          v-for="opt in prop.options ?? []"
          :key="String(opt.value)"
          type="button"
          class="multi-chip"
          :class="{ on: selectedMulti.includes(opt.value) }"
          :data-test-multi="String(opt.value)"
          @click="toggleMulti(opt.value)"
        >
          <span class="multi-check">{{ selectedMulti.includes(opt.value) ? '✓' : '' }}</span>
          {{ opt.name }}
        </button>
      </div>

      <!-- IF 条件组(对标基线 filter):左值 + 操作符下拉 + 右值 + Add condition -->
      <div v-else-if="prop.type === 'collection' && isConditions" class="cond-editor" data-test="conditions-editor">
        <div v-for="(c, i) in conditions" :key="i" class="cond-row" data-test="condition-row">
          <input class="cond-left" :value="String(c.left ?? '')" placeholder="value1" @input="updateCondition(i, 'left', ($event.target as HTMLInputElement).value)" />
          <select class="cond-op" :value="c.op" @change="updateCondition(i, 'op', ($event.target as HTMLSelectElement).value)">
            <option v-for="o in OPERATORS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <input v-if="!UNARY_OPS.includes(c.op)" class="cond-right" :value="String(c.right ?? '')" placeholder="value2" @input="updateCondition(i, 'right', ($event.target as HTMLInputElement).value)" />
          <span v-else class="cond-right-fill" />
          <button class="row-del" type="button" title="Remove" @click="removeCondition(i)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M21 6a1 1 0 1 1 0 2h-1v12.1c0 1.6-1.3 2.9-2.9 2.9H7c-1.6 0-2.9-1.3-2.9-2.9V8H3a1 1 0 0 1 0-2zm-7-5a3 3 0 0 1 3 3H7a3 3 0 0 1 3-3z" /></svg>
          </button>
        </div>
        <button class="add-btn" type="button" data-test="add-condition" @click="addCondition">+ Add condition</button>
      </div>

      <!-- Set 赋值区(对标基线 Set assignments):名/值行 + Add Field -->
      <div v-else-if="prop.type === 'collection'" class="kv-editor" data-test="fields-editor">
        <div v-for="(r, i) in fieldRows" :key="i" class="kv-row" data-test="field-row">
          <input class="kv-k" :value="r.k" placeholder="Name" @input="updateField(i, { k: ($event.target as HTMLInputElement).value })" />
          <input class="kv-v" :value="String(r.v ?? '')" placeholder="Value" @input="updateField(i, { v: ($event.target as HTMLInputElement).value })" />
          <button class="row-del" type="button" title="Remove" @click="removeField(i)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M21 6a1 1 0 1 1 0 2h-1v12.1c0 1.6-1.3 2.9-2.9 2.9H7c-1.6 0-2.9-1.3-2.9-2.9V8H3a1 1 0 0 1 0-2zm-7-5a3 3 0 0 1 3 3H7a3 3 0 0 1 3-3z" /></svg>
          </button>
        </div>
        <button class="add-btn" type="button" data-test="add-field" @click="addField">+ Add Field</button>
      </div>

      <template v-else-if="prop.type === 'json'">
        <textarea v-model="jsonDraft" rows="5" spellcheck="false" @blur="commitJson" />
        <p v-if="jsonError" class="error-text">{{ jsonError }}</p>
      </template>

      <input
        v-else-if="prop.type === 'dateTime'"
        type="datetime-local"
        :value="String(current ?? '')"
        @input="emit('change', ($event.target as HTMLInputElement).value)"
      />

      <input
        v-else-if="prop.type === 'color'"
        type="color"
        :value="String(current ?? '#000000')"
        @input="emit('change', ($event.target as HTMLInputElement).value)"
      />

      <p v-if="prop.description" class="dim desc">{{ prop.description }}</p>
    </template>
  </div>
</template>

<style scoped>
/* 基线实测（NDV 参数区）：行距 10；label 12px/400 白、下距 8；
   文本输入 32px/bg light-2/inset 1px 环/圆角 4/14px 白;
   下拉 30px/1px 边/12px;开关 32×16 */
.param { margin-bottom: 10px; }
.param :deep(label), .param > label {
  display: block; margin: 0 0 8px; color: var(--color--text--shade-1);
  font-size: var(--font-size--2xs); font-weight: var(--font-weight--regular);
}
.param :deep(input[type='text']), .param :deep(input:not([type])), .param :deep(input[type='number']),
.param :deep(input[type='datetime-local']), .param :deep(textarea) {
  background: var(--color--background--light-2); border: none;
  box-shadow: inset 0 0 0 1px var(--border-color);
  border-radius: var(--radius); color: var(--color--text--shade-1);
  font-size: var(--font-size--sm); padding: 0 var(--spacing--xs);
}
.param :deep(input[type='text']), .param :deep(input:not([type])), .param :deep(input[type='number']) { height: 32px; }
.param :deep(textarea) { padding: 8px var(--spacing--xs); }
.param :deep(input:focus), .param :deep(textarea:focus) { outline: none; box-shadow: inset 0 0 0 1px var(--color--primary); }

/* collection 富控件:IF 条件行 / Set 键值行 */
.cond-editor, .kv-editor { display: flex; flex-direction: column; gap: 8px; }
.cond-row, .kv-row { display: flex; align-items: center; gap: 6px; }
.cond-left, .cond-right, .kv-k, .kv-v { flex: 1; min-width: 0; height: 32px; }
.cond-op {
  flex: 1.2; min-width: 0; height: 32px; background: var(--color--background--light-2);
  border: none; box-shadow: inset 0 0 0 1px var(--border-color); border-radius: var(--radius);
  color: var(--color--text--shade-1); font-size: var(--font-size--2xs); padding: 0 8px;
}
.cond-op:focus { outline: none; box-shadow: inset 0 0 0 1px var(--color--primary); }
.cond-right-fill { flex: 1; }
.row-del {
  flex-shrink: 0; width: 28px; height: 28px; display: grid; place-items: center;
  background: none; border: none; border-radius: var(--radius); color: var(--color--text--tint-1); cursor: pointer;
}
.row-del:hover { background: var(--color--background--light-1); color: var(--color--danger); }
.add-btn {
  align-self: flex-start; height: 30px; padding: 0 12px; margin-top: 2px;
  background: var(--button--color--background--secondary); color: var(--button--color--text--secondary);
  border: var(--border-width) var(--border-style) var(--button--border-color--secondary);
  border-radius: var(--radius); font-size: var(--font-size--2xs); font-weight: var(--font-weight--medium); cursor: pointer;
}
.add-btn:hover { background: var(--button--color--background--secondary--hover); color: var(--button--color--text--secondary--hover-active-focus); }
.param :deep(select) {
  height: 30px; background: var(--color--background--light-2);
  border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); color: var(--color--text--shade-1);
  font-size: var(--font-size--2xs); padding: 0 var(--spacing--2xs);
}
.pswitch {
  position: relative; width: 32px; height: 16px; padding: 0; flex-shrink: 0;
  border-radius: var(--radius--full); cursor: pointer;
  background: var(--switch--color--background);
  border: var(--border-width) var(--border-style) var(--switch--border-color);
  transition: background 0.15s;
}
.pswitch-knob {
  position: absolute; top: 1px; left: 1px; width: 12px; height: 12px; border-radius: 50%;
  background: var(--switch--toggle--color); box-shadow: 0 1px 2px var(--color--black-alpha-200);
  transition: transform 0.15s;
}
.pswitch.on { background: var(--switch--color--background--active); border-color: transparent; }
.pswitch.on .pswitch-knob { transform: translateX(16px); }
.desc { font-size: 11px; margin: 4px 0 0; }
/* D108 multiOptions 勾选芯片 */
.multi-opts { display: flex; flex-wrap: wrap; gap: 6px; }
.multi-chip {
  display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px;
  background: var(--color--background--light-2); border: none; box-shadow: inset 0 0 0 1px var(--border-color);
  border-radius: var(--radius); color: var(--color--text--shade-1); font-size: var(--font-size--2xs); cursor: pointer;
}
.multi-chip:hover { box-shadow: inset 0 0 0 1px var(--border-color--strong); }
.multi-chip.on { box-shadow: inset 0 0 0 1px var(--color--primary); color: var(--color--primary); }
.multi-check { width: 10px; font-size: 11px; }
/* 基线实测：表达式态左侧 = gutter 块，与编辑框拼合(编辑框圆角 0 4 4 0) */
.expr-row { display: flex; align-items: stretch; }
.expr-gutter {
  flex-shrink: 0; width: 20px; display: flex; align-items: center; justify-content: center;
  background: var(--color--background--light-3);
  border: var(--border-width) var(--border-style) var(--border-color); border-right: none;
  border-radius: var(--radius) 0 0 var(--radius);
  color: var(--color--text--tint-1); font-size: var(--font-size--2xs); font-family: var(--font-family--monospace);
}
.expr-cm { flex: 1; min-width: 0; }
/* D110/D116 live 实测基线:ⓘ 12×12 dim;⋮ 12×12;分段按钮 10px/500、高 15 */
.param-tools { display: inline-flex; align-items: center; gap: 6px; margin-left: 6px; }
.pt-help { width: 12px; height: 12px; color: var(--text-dim); flex: none; }
.pt-menu-anchor { position: relative; display: inline-flex; }
.pt-dots {
  width: 12px; height: 12px; padding: 0; border: none; background: transparent;
  color: var(--text); display: inline-flex; align-items: center; justify-content: center;
}
.pt-dots svg { width: 12px; height: 12px; }
.pt-menu {
  position: absolute; top: 100%; right: 0; z-index: 20; min-width: 132px; padding: 4px;
  background: var(--color--background--light-1); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.pt-menu-item {
  display: block; width: 100%; height: auto; text-align: left; border: none; background: none;
  padding: 5px 8px; font-size: 12px; border-radius: 4px; color: var(--text);
}
.pt-menu-item:hover { background: var(--color--background--light-3); }
.pt-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.pt-seg-btn {
  height: 15px; padding: 0 4px; border: none; background: transparent; border-radius: 0;
  font-size: 10px; font-weight: 500; line-height: 15px; color: var(--text-dim);
}
.pt-seg-btn.active { background: var(--color--background--light-3); color: var(--text-hi); }
textarea { font-family: ui-monospace, monospace; }
/* 拖拽映射落点高亮 */
.drop-wrap { border-radius: var(--radius); }
.drop-wrap.over { outline: 2px dashed var(--accent); outline-offset: 1px; }
/* D115 Result 预览面板 */
.expr-result {
  margin: 6px 0 0; border-radius: var(--radius); background: var(--bg-input);
  border: 1px solid var(--border); overflow: hidden;
}
.er-head { display: flex; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--border); }
.er-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-faint); }
.er-pager { display: flex; align-items: center; gap: 6px; }
.er-pager button {
  width: 20px; height: 20px; padding: 0; background: none; border: none; border-radius: 4px;
  color: var(--text-dim); font-size: 14px; cursor: pointer;
}
.er-pager button:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
.er-pager button:disabled { opacity: 0.4; cursor: default; }
.er-page { font-size: 11px; color: var(--text-dim); }
.er-body { padding: 8px 10px; min-height: 20px; }
.er-value {
  color: var(--ok); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
  word-break: break-word; white-space: pre-wrap;
}
.er-value.err { color: var(--err); }
.er-hint { color: var(--text-faint); font-size: 12px; font-style: italic; }
.er-tip { padding: 6px 10px; border-top: 1px solid var(--border); font-size: 11px; color: var(--text-dim); }
.er-tip code { background: var(--bg-hover); padding: 0 3px; border-radius: 3px; font-size: 10.5px; }
.er-tip .link { color: var(--accent); text-decoration: none; }
.er-tip .link:hover { text-decoration: underline; }

/* D112 notice 紫色 Tip 提示条(对标基线) */
.param-notice {
  display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-radius: var(--radius);
  background: var(--color--purple-100, rgba(124, 58, 237, 0.1));
  border: 1px solid var(--color--purple-300, rgba(124, 58, 237, 0.35));
  color: var(--color--text--shade-1); font-size: 12px; line-height: 1.5;
}
.pn-icon { width: 15px; height: 15px; flex-shrink: 0; margin-top: 1px; color: var(--color--purple-500, #8b5cf6); }
.pn-text :deep(a), .pn-text a { color: var(--color--purple-500, #8b5cf6); }
</style>
