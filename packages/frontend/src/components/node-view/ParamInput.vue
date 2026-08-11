<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { INodeExecutionData, INodeProperties, INodePropertyOption, IResourceLocatorValue } from '@nomops/workflow';
import { resolveParameterValue } from '@nomops/workflow';
import ExpressionInput from './ExpressionInput.vue';
import { useEditorStore } from '../../stores/editor.js';
import { t } from '../../lib/i18n.js';
import { LINKS } from '../../lib/links.js';
import { api } from '../../api/client.js';
import { isPropertyVisible } from '../../lib/display-options.js';

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
  /** 所属节点名（NDV 传入;有值时工具条显示 panel-right → 钉进 Focus Panel）。 */
  nodeName?: string;
  /** 所属节点是 AI 工具（输出 ai_tool）→ 参数支持 $fromAI「让模型填」（#19 D096）。 */
  aiTool?: boolean;
  nodeType?: string;
  nodeTypeVersion?: number;
  credentials?: Record<string, { id: string; name: string }>;
}>();
const emit = defineEmits<{ change: [value: unknown] }>();

/* panel-right → Focus Panel 联动（P1-CC 单列待办清偿;Focus 面板上下文不传 nodeName 不显示） */
const editorStore = useEditorStore();
const paramPinned = computed(() =>
  props.nodeName ? editorStore.isParamPinned(props.nodeName, props.prop.name) : false,
);

const current = computed(() => props.value ?? props.prop.default);

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((part, key) => {
    if (part === null || typeof part !== 'object' || Array.isArray(part)) return undefined;
    return (part as Record<string, unknown>)[key];
  }, value);
}

const dynamicOptions = ref<INodePropertyOption[] | null>(null);
const dynamicLoading = ref(false);
const dynamicError = ref('');
const effectiveOptions = computed(() => dynamicOptions.value ?? props.prop.options ?? []);
let dynamicSequence = 0;
async function loadDynamicOptions() {
  if (!props.nodeType || (!props.prop.typeOptions?.loadOptionsMethod && !props.prop.typeOptions?.loadOptions)) return;
  const sequence = ++dynamicSequence;
  dynamicLoading.value = true;
  dynamicError.value = '';
  try {
    const options = await api.dynamicNodeParameters.options({
      nodeType: props.nodeType,
      ...(props.nodeTypeVersion ? { nodeVersion: props.nodeTypeVersion } : {}),
      propertyName: props.prop.name,
      currentNodeParameters: props.nodeParameters ?? {},
      credentials: Object.fromEntries(Object.entries(props.credentials ?? {}).map(([key, value]) => [key, { id: value.id }])),
    });
    if (sequence === dynamicSequence) dynamicOptions.value = options;
  } catch (error) {
    if (sequence === dynamicSequence) dynamicError.value = (error as Error).message;
  } finally {
    if (sequence === dynamicSequence) dynamicLoading.value = false;
  }
}
watch(
  () => [
    props.nodeType,
    props.nodeTypeVersion,
    ...Object.values(props.credentials ?? {}).map((credential) => credential.id),
    ...(props.prop.typeOptions?.loadOptionsDependsOn ?? []).map((path) => valueAtPath(props.nodeParameters, path)),
  ],
  () => void loadDynamicOptions(),
  { immediate: true, deep: true },
);

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

/* D114:options 自定义下拉(替代原生 select;点击外关闭/键盘导航/选项带描述副行) */
const optOpen = ref(false);
const optHover = ref(0);
const currentOptionName = computed(() => {
  const found = effectiveOptions.value.find((o) => o.value === current.value);
  return found?.name ?? String(current.value ?? '');
});
function pickOption(value: unknown) {
  optOpen.value = false;
  emit('change', value);
}
function toggleOptOpen() {
  optOpen.value = !optOpen.value;
  if (optOpen.value) {
    const idx = effectiveOptions.value.findIndex((o) => o.value === current.value);
    optHover.value = idx >= 0 ? idx : 0;
  }
}
function onOptKeydown(event: KeyboardEvent) {
  if (!optOpen.value) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      toggleOptOpen();
    }
    return;
  }
  const count = effectiveOptions.value.length;
  if (count === 0) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    optHover.value = (optHover.value + 1) % count;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    optHover.value = (optHover.value - 1 + count) % count;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const opt = effectiveOptions.value[optHover.value];
    if (opt) pickOption(opt.value);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    optOpen.value = false;
  }
}
/* 点击外关闭（options 下拉与 ⋮ 菜单共用一个全局监听） */
const rootEl = ref<HTMLElement | null>(null);
function onDocClick(event: MouseEvent) {
  if (!rootEl.value?.contains(event.target as Node)) {
    optOpen.value = false;
    menuOpen.value = false;
    collectionOpen.value = false;
  }
}
onMounted(() => document.addEventListener('click', onDocClick, true));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick, true));
function toggleExpression() {
  if (isExpression.value) emit('change', String(current.value).slice(1));
  else emit('change', `=${String(current.value ?? '')}`);
}

/* #19 D096:AI 工具参数「让模型填」——插入 $fromAI 模板到当前光标位置（追加到末尾）。
   仅可切表达式的字段显示;点击后进入表达式模式并追加 ={{ $fromAI('field','desc','string') }}。 */
const canFromAI = computed(() => Boolean(props.aiTool) && canExpression.value);
function insertFromAI() {
  const key = props.prop.name.replace(/[^a-zA-Z0-9_]/g, '_');
  const snippet = `${CURLY.slice(0, 2)} $fromAI('${key}', '${props.prop.displayName}', 'string') ${CURLY.slice(-2)}`;
  const cur = current.value;
  if (typeof cur === 'string' && cur.startsWith('=')) emit('change', `${cur}${snippet}`);
  else {
    const base = cur === undefined || cur === null || cur === props.prop.default ? '' : String(cur);
    emit('change', `=${base}${snippet}`);
  }
}

/* D109 对标基线:几乎所有标量字段都可切 Fixed|Expression(原仅 string)。 */
const EXPRESSIONABLE = ['string', 'number', 'boolean', 'options', 'multiOptions', 'dateTime', 'color'];
const canExpression = computed(() => EXPRESSIONABLE.includes(props.prop.type) && !props.prop.noDataExpression);

/* D111 对标基线:string 带 typeOptions.rows 渲染多行 textarea(如 System Message)。 */
const textRows = computed(() => {
  const rows = props.prop.typeOptions?.rows;
  return typeof rows === 'number' && rows > 1 ? rows : 0;
});
const isMultiline = computed(() => props.prop.type === 'string' && textRows.value > 0);
const codeLineNumbers = computed(() => Array.from({ length: Math.max(1, String(current.value ?? '').split('\n').length) }, (_value, index) => index + 1));

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

const fixedValue = computed<Record<string, unknown>>(() =>
  current.value !== null && typeof current.value === 'object' && !Array.isArray(current.value)
    ? current.value as Record<string, unknown>
    : {},
);
function fixedRows(group: INodePropertyOption): Record<string, unknown>[] {
  const raw = fixedValue.value[group.name];
  if (props.prop.typeOptions?.multipleValues) return Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
  return [raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}];
}
function visibleFixedFields(group: INodePropertyOption, row: Record<string, unknown>) {
  return (group.values ?? []).filter((property) => isPropertyVisible(property, row, group.values ?? []));
}
function setFixedRows(group: INodePropertyOption, rows: Record<string, unknown>[]) {
  emit('change', { ...fixedValue.value, [group.name]: props.prop.typeOptions?.multipleValues ? rows : (rows[0] ?? {}) });
}
function addFixedRow(group: INodePropertyOption) {
  const row = Object.fromEntries((group.values ?? []).map((property) => [property.name, property.default]));
  setFixedRows(group, [...fixedRows(group), row]);
}
function updateFixedRow(group: INodePropertyOption, index: number, name: string, value: unknown) {
  setFixedRows(group, fixedRows(group).map((row, rowIndex) => rowIndex === index ? { ...row, [name]: value } : row));
}
function removeFixedRow(group: INodePropertyOption, index: number) {
  setFixedRows(group, fixedRows(group).filter((_row, rowIndex) => rowIndex !== index));
}

/* 基线 collection：一个 Add Option 菜单，选择后把可选字段加入当前参数组。 */
const collectionOpen = ref(false);
const collectionValue = computed<Record<string, unknown>>(() =>
  current.value !== null && typeof current.value === 'object' && !Array.isArray(current.value)
    ? current.value as Record<string, unknown>
    : {},
);
const collectionFields = computed(() =>
  (props.prop.options ?? [])
    .flatMap((option) => option.values ?? [])
    .filter((field) => Object.prototype.hasOwnProperty.call(collectionValue.value, field.name)),
);
const availableCollectionOptions = computed(() =>
  (props.prop.options ?? []).filter((option) =>
    (option.values ?? []).some((field) => !Object.prototype.hasOwnProperty.call(collectionValue.value, field.name)),
  ),
);
function addCollectionOption(option: INodePropertyOption) {
  const patch: Record<string, unknown> = {};
  for (const field of option.values ?? []) {
    if (!Object.prototype.hasOwnProperty.call(collectionValue.value, field.name)) patch[field.name] = field.default;
  }
  emit('change', { ...collectionValue.value, ...patch });
  collectionOpen.value = false;
}
function updateCollectionField(name: string, value: unknown) {
  emit('change', { ...collectionValue.value, [name]: value });
}
function removeCollectionField(name: string) {
  const next = { ...collectionValue.value };
  delete next[name];
  emit('change', next);
}
function moveFixedRow(group: INodePropertyOption, index: number, offset: number) {
  const rows = fixedRows(group).slice();
  const target = index + offset;
  if (target < 0 || target >= rows.length) return;
  [rows[index], rows[target]] = [rows[target]!, rows[index]!];
  setFixedRows(group, rows);
}

const locator = computed<IResourceLocatorValue>(() => {
  const raw = current.value;
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const value = raw as Partial<IResourceLocatorValue>;
    if (value.mode && typeof value.value === 'string') return value as IResourceLocatorValue;
  }
  return { mode: props.prop.modes?.[0]?.name ?? 'id', value: '' };
});
const locatorOptions = ref<INodePropertyOption[]>([]);
const locatorFilter = ref('');
const locatorLoading = ref(false);
const locatorError = ref('');
function setLocator(mode: IResourceLocatorValue['mode'], value = '') {
  emit('change', { mode, value });
}
async function searchLocator() {
  if (!props.nodeType || locator.value.mode !== 'list') return;
  locatorLoading.value = true;
  locatorError.value = '';
  try {
    const response = await api.dynamicNodeParameters.resourceLocatorResults({
      nodeType: props.nodeType,
      ...(props.nodeTypeVersion ? { nodeVersion: props.nodeTypeVersion } : {}),
      propertyName: props.prop.name,
      currentNodeParameters: props.nodeParameters ?? {},
      credentials: Object.fromEntries(Object.entries(props.credentials ?? {}).map(([key, value]) => [key, { id: value.id }])),
      ...(locatorFilter.value ? { filter: locatorFilter.value } : {}),
    });
    locatorOptions.value = response.results;
  } catch (error) {
    locatorError.value = (error as Error).message;
  } finally {
    locatorLoading.value = false;
  }
}
watch(() => locator.value.mode, (mode) => { if (mode === 'list') void searchLocator(); }, { immediate: true });

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

/* ── filter / assignmentCollection 复合控件：只按声明类型分发。 ── */
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

interface Cond { left?: unknown; op: string; right?: unknown; outputName?: string }
const conditions = computed<Cond[]>(() => (Array.isArray(current.value) ? (current.value as Cond[]) : []));
function addCondition() {
  const max = props.prop.typeOptions?.filter?.maxConditions;
  if (typeof max === 'number' && conditions.value.length >= max) return;
  emit('change', [...conditions.value, { left: '', op: 'eq', right: '' }]);
}
function updateCondition(i: number, key: 'left' | 'op' | 'right' | 'outputName', v: unknown) {
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
function assignmentType(value: unknown): 'string' | 'number' | 'boolean' | 'object' | 'array' {
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'object';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}
function convertAssignment(value: unknown, type: string): unknown {
  if (type === 'number') return Number(value) || 0;
  if (type === 'boolean') return value === true || value === 'true';
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (type === 'array') return Array.isArray(value) ? value : [];
  return typeof value === 'string' ? value : JSON.stringify(value);
}
</script>

<template>
  <div ref="rootEl" class="param" :data-test-param="prop.name">
    <!-- D112 对标基线:notice 渲染为紫色 Tip 提示条(非灰文本) -->
    <template v-if="prop.type === 'notice'">
      <div class="param-notice" :class="prop.typeOptions?.noticeStyle" data-test="param-notice">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="pn-icon"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
        <span class="pn-text">{{ prop.description ?? prop.displayName }}</span>
      </div>
    </template>

    <template v-else>
      <label v-if="prop.type !== 'boolean'">
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
          <!-- panel-right:在 Focus Panel 中打开此字段(钉住;再点解钉) -->
          <button
            v-if="nodeName"
            type="button"
            class="pt-focus"
            :class="{ on: paramPinned }"
            data-test="param-focus"
            :title="paramPinned ? 'Remove from Focus Panel' : 'Open in Focus Panel'"
            @click.stop="editorStore.togglePinParam(nodeName!, prop.name)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>
          </button>
          <span class="pt-menu-anchor">
            <button class="pt-dots" type="button" data-test="param-menu" :aria-label="t('Parameter options')" @click.stop="menuOpen = !menuOpen">
              <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
            </button>
            <span v-if="menuOpen" class="pt-menu" data-test="param-menu-pop">
              <button type="button" class="pt-menu-item" data-test="param-reset" @click.stop="resetValue">{{ t('Reset Value') }}</button>
            </span>
          </span>
          <!-- #19 D096:AI 工具参数「让模型填」——插入 $fromAI 模板 -->
          <button
            v-if="canFromAI"
            type="button"
            class="pt-fromai"
            data-test="param-from-ai"
            title="Let the AI fill this parameter at run time ($fromAI)"
            @click="insertFromAI"
          >✨ From AI</button>
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
          <div v-if="isMultiline && prop.typeOptions?.editor === 'code'" class="code-editor" data-test="code-editor">
            <div class="code-language">{{ prop.displayName }}</div>
            <div class="code-surface">
              <div class="code-gutter" aria-hidden="true"><span v-for="line in codeLineNumbers" :key="line">{{ line }}</span></div>
              <textarea
                :value="String(current ?? '')"
                :placeholder="prop.placeholder"
                :rows="textRows"
                spellcheck="false"
                data-test="param-textarea"
                @input="emit('change', ($event.target as HTMLTextAreaElement).value)"
              />
            </div>
          </div>
          <textarea
            v-else-if="isMultiline"
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
      <div v-else-if="prop.type === 'boolean'" class="boolean-row">
        <button
          type="button"
          class="pswitch"
          :class="{ on: Boolean(current) }"
          role="switch"
          :aria-checked="Boolean(current)"
          :aria-label="prop.displayName"
          @click="emit('change', !current)"
        >
          <span class="pswitch-knob" />
        </button>
        <span class="boolean-label">{{ prop.displayName }}<span v-if="prop.required" class="boolean-required"> *</span></span>
        <span v-if="canExpression" class="pt-seg boolean-seg" data-test="param-fx">
          <button type="button" class="pt-seg-btn active">{{ t('Fixed') }}</button>
          <button type="button" class="pt-seg-btn" @click="toggleExpression()">{{ t('Expression') }}</button>
        </span>
      </div>

      <!-- D114 对标基线:options 自定义下拉(选项带描述副行;键盘 ↑↓/Enter/Esc;点击外关闭) -->
      <div v-else-if="prop.type === 'options'" class="opt-dd" data-test="options-dropdown" @keydown="onOptKeydown">
        <button type="button" class="opt-dd-btn" :aria-expanded="optOpen" data-test="options-toggle" @click.stop="toggleOptOpen">
          <span class="opt-dd-cur">{{ currentOptionName }}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="opt-dd-chev" :class="{ open: optOpen }"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <div v-if="optOpen" class="opt-dd-pop" role="listbox" data-test="options-pop">
          <button
            v-for="(opt, i) in effectiveOptions"
            :key="String(opt.value)"
            type="button"
            class="opt-dd-item"
            :class="{ sel: opt.value === current, hov: i === optHover }"
            role="option"
            :aria-selected="opt.value === current"
            :data-test-option="String(opt.value)"
            @mouseenter="optHover = i"
            @click.stop="pickOption(opt.value)"
          >
            <span class="opt-dd-name">
              {{ opt.name }}
              <svg v-if="opt.value === current" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="opt-dd-check"><path d="M5 13l4 4 10-10" /></svg>
            </span>
            <span v-if="opt.description" class="opt-dd-desc">{{ opt.description }}</span>
          </button>
        </div>
        <p v-if="dynamicLoading" class="dim dynamic-status" data-test="dynamic-loading">Loading resources…</p>
        <p v-else-if="dynamicError" class="error-text dynamic-status" data-test="dynamic-error">{{ dynamicError }}</p>
      </div>

      <!-- D108 对标基线:multiOptions 多选(勾选芯片),值为数组 -->
      <div v-else-if="prop.type === 'multiOptions'" class="multi-opts" data-test="multi-options">
        <button
          v-for="opt in effectiveOptions"
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
      <div v-else-if="prop.type === 'filter'" class="cond-editor" data-test="conditions-editor">
        <div v-for="(c, i) in conditions" :key="i" class="cond-row" data-test="condition-row">
          <strong v-if="prop.typeOptions?.filter?.itemTitle" class="cond-title">{{ prop.typeOptions.filter.itemTitle }} {{ i + 1 }}</strong>
          <input class="cond-left" :value="String(c.left ?? '')" placeholder="value1" @input="updateCondition(i, 'left', ($event.target as HTMLInputElement).value)" />
          <select class="cond-op" :value="c.op" @change="updateCondition(i, 'op', ($event.target as HTMLSelectElement).value)">
            <option v-for="o in OPERATORS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <input v-if="!UNARY_OPS.includes(c.op)" class="cond-right" :value="String(c.right ?? '')" placeholder="value2" @input="updateCondition(i, 'right', ($event.target as HTMLInputElement).value)" />
          <span v-else class="cond-right-fill" />
          <label v-if="prop.typeOptions?.filter?.showRenameOutput" class="cond-rename">
            <span>Rename Output</span>
            <input :value="c.outputName ?? ''" placeholder="Output name" @input="updateCondition(i, 'outputName', ($event.target as HTMLInputElement).value)" />
          </label>
          <button class="row-del" type="button" title="Remove" @click="removeCondition(i)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M21 6a1 1 0 1 1 0 2h-1v12.1c0 1.6-1.3 2.9-2.9 2.9H7c-1.6 0-2.9-1.3-2.9-2.9V8H3a1 1 0 0 1 0-2zm-7-5a3 3 0 0 1 3 3H7a3 3 0 0 1 3-3z" /></svg>
          </button>
        </div>
        <button
          class="add-btn"
          type="button"
          data-test="add-condition"
          :disabled="typeof prop.typeOptions?.filter?.maxConditions === 'number' && conditions.length >= prop.typeOptions.filter.maxConditions"
          @click="addCondition"
        >+ {{ prop.typeOptions?.filter?.addButtonLabel ?? 'Add condition' }}</button>
      </div>

      <!-- Set 赋值区(对标基线 Set assignments):名/值行 + Add Field -->
      <div v-else-if="prop.type === 'assignmentCollection'" class="kv-editor" data-test="fields-editor">
        <p v-if="fieldRows.length === 0" class="assignment-empty">Drag input fields here<br><span>or</span></p>
        <div v-for="(r, i) in fieldRows" :key="i" class="kv-row" data-test="field-row">
          <select class="kv-type" :value="assignmentType(r.v)" aria-label="Field type" @change="updateField(i, { v: convertAssignment(r.v, ($event.target as HTMLSelectElement).value) })">
            <option value="string">String</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
            <option value="object">Object</option>
            <option value="array">Array</option>
          </select>
          <input class="kv-k" :value="r.k" placeholder="Name" @input="updateField(i, { k: ($event.target as HTMLInputElement).value })" />
          <input class="kv-v" :value="String(r.v ?? '')" placeholder="Value" @input="updateField(i, { v: ($event.target as HTMLInputElement).value })" />
          <button class="row-del" type="button" title="Remove" @click="removeField(i)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M21 6a1 1 0 1 1 0 2h-1v12.1c0 1.6-1.3 2.9-2.9 2.9H7c-1.6 0-2.9-1.3-2.9-2.9V8H3a1 1 0 0 1 0-2zm-7-5a3 3 0 0 1 3 3H7a3 3 0 0 1 3-3z" /></svg>
          </button>
        </div>
        <button class="add-btn" type="button" data-test="add-field" @click="addField">+ Add Field</button>
      </div>

      <div v-else-if="prop.type === 'fixedCollection'" class="fixed-collection" data-test="fixed-collection">
        <section v-for="group in prop.options ?? []" :key="group.name" class="fixed-group" :data-test-fixed-group="group.name">
          <div v-for="(row, rowIndex) in fixedRows(group)" :key="rowIndex" class="fixed-row">
            <div v-if="prop.typeOptions?.multipleValues" class="fixed-row-head">
              <strong>{{ prop.typeOptions.fixedCollection?.itemTitle ?? group.name }} {{ rowIndex + 1 }}</strong>
              <span class="fixed-row-actions">
                <button v-if="prop.typeOptions.sortable" type="button" :aria-label="`Move ${group.name} item ${rowIndex + 1} up`" :disabled="rowIndex === 0" @click="moveFixedRow(group, rowIndex, -1)">↑</button>
                <button v-if="prop.typeOptions.sortable" type="button" :aria-label="`Move ${group.name} item ${rowIndex + 1} down`" :disabled="rowIndex === fixedRows(group).length - 1" @click="moveFixedRow(group, rowIndex, 1)">↓</button>
                <button type="button" :aria-label="`Remove ${group.name} item ${rowIndex + 1}`" @click="removeFixedRow(group, rowIndex)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
              </span>
            </div>
            <div class="fixed-values" :class="prop.typeOptions?.fixedCollection?.layout">
              <ParamInput
                v-for="child in visibleFixedFields(group, row)"
                :key="child.name"
                :prop="child"
                :value="row[child.name]"
                :node-parameters="{ ...nodeParameters, ...row }"
                :node-type="nodeType"
                :node-type-version="nodeTypeVersion"
                :credentials="credentials"
                @change="updateFixedRow(group, rowIndex, child.name, $event)"
              />
            </div>
          </div>
          <button v-if="prop.typeOptions?.multipleValues" class="add-btn" type="button" :data-test-add-fixed="group.name" @click="addFixedRow(group)">
            + {{ prop.typeOptions?.fixedCollection?.addButtonLabel ?? `Add ${group.name}` }}
          </button>
        </section>
      </div>

      <div v-else-if="prop.type === 'resourceLocator'" class="resource-locator" data-test="resource-locator">
        <div class="locator-modes" role="tablist">
          <button
            v-for="mode in prop.modes ?? []"
            :key="mode.name"
            type="button"
            :class="{ active: locator.mode === mode.name }"
            :data-test-locator-mode="mode.name"
            @click="setLocator(mode.name)"
          >{{ mode.displayName }}</button>
        </div>
        <template v-if="locator.mode === 'list'">
          <div class="locator-search">
            <input v-model="locatorFilter" :placeholder="prop.modes?.find((mode) => mode.name === 'list')?.placeholder ?? 'Search resources'" @keydown.enter.prevent="searchLocator" />
            <button type="button" :disabled="locatorLoading" @click="searchLocator">{{ locatorLoading ? '…' : 'Search' }}</button>
          </div>
          <select :value="locator.value" data-test="locator-list" @change="setLocator('list', ($event.target as HTMLSelectElement).value)">
            <option value="">Select a resource</option>
            <option v-for="option in locatorOptions" :key="String(option.value)" :value="String(option.value)">{{ option.name }}</option>
          </select>
        </template>
        <input
          v-else
          :type="locator.mode === 'url' ? 'url' : 'text'"
          :value="locator.value"
          :placeholder="prop.modes?.find((mode) => mode.name === locator.mode)?.placeholder"
          :data-test="`locator-${locator.mode}`"
          @input="setLocator(locator.mode, ($event.target as HTMLInputElement).value)"
        />
        <p v-if="locatorError" class="error-text dynamic-status">{{ locatorError }}</p>
      </div>

      <div v-else-if="prop.type === 'collection'" class="option-collection" data-test="option-collection">
        <div v-for="field in collectionFields" :key="field.name" class="option-collection-field">
          <ParamInput
            :prop="field"
            :value="collectionValue[field.name]"
            :preview-items="previewItems"
            :node-parameters="nodeParameters"
            :node-name="nodeName"
            :ai-tool="aiTool"
            :node-type="nodeType"
            :node-type-version="nodeTypeVersion"
            :credentials="credentials"
            @change="updateCollectionField(field.name, $event)"
          />
          <button type="button" class="option-remove" :aria-label="`Remove ${field.displayName}`" @click="removeCollectionField(field.name)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div v-if="availableCollectionOptions.length" class="option-add-wrap">
          <button type="button" class="add-btn" data-test="add-option" @click.stop="collectionOpen = !collectionOpen">
            + {{ prop.placeholder ?? 'Add Option' }}
          </button>
          <div v-if="collectionOpen" class="option-add-menu" data-test="add-option-menu">
            <button
              v-for="option in availableCollectionOptions"
              :key="String(option.value)"
              type="button"
              @click="addCollectionOption(option)"
            >{{ option.name }}</button>
          </div>
        </div>
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
.boolean-row { display: flex; align-items: center; gap: 10px; min-height: 24px; }
.boolean-seg { margin-left: auto; }
.boolean-label { color: var(--color--text--shade-1); font-size: var(--font-size--2xs); }
.boolean-required { color: var(--color--danger); }
.param :deep(textarea) { padding: 8px var(--spacing--xs); }
.code-editor { overflow: hidden; border: 1px solid var(--border-color); border-radius: var(--radius); background: #151515; }
.code-language { padding: 6px 0; background: var(--color--background--light-1); color: var(--color--text--shade-1); font-size: var(--font-size--2xs); }
.code-surface { display: grid; grid-template-columns: 34px minmax(0, 1fr); }
.code-gutter { display: flex; flex-direction: column; align-items: flex-end; gap: 0; padding: 8px 7px 8px 0; border-right: 1px solid var(--border-color); color: var(--color--text--tint-2); font: 12px/19px ui-monospace, SFMono-Regular, Menlo, monospace; user-select: none; }
.code-editor textarea { width: 100%; resize: vertical; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; background: #151515 !important; color: #e6e6e6 !important; font: 12px/19px ui-monospace, SFMono-Regular, Menlo, monospace !important; tab-size: 2; }
.param :deep(input:focus), .param :deep(textarea:focus) { outline: none; box-shadow: inset 0 0 0 1px var(--color--primary); }

/* collection 富控件:IF 条件行 / Set 键值行 */
.cond-editor, .kv-editor { display: flex; flex-direction: column; gap: 8px; }
.option-collection { display: flex; flex-direction: column; gap: 8px; }
.option-collection-field { position: relative; padding-right: 26px; }
.option-collection-field :deep(.param) { margin-bottom: 0; }
.option-remove {
  position: absolute; top: 0; right: 0; width: 22px; height: 22px; padding: 0;
  border: none; background: transparent; color: var(--color--text--tint-1); font-size: 18px; cursor: pointer;
}
.option-remove:hover { color: var(--color--danger); }
.option-remove svg { width: 13px; height: 13px; }
.option-add-wrap { position: relative; align-self: flex-start; }
.option-add-menu {
  position: absolute; left: 0; bottom: calc(100% + 4px); z-index: 20; min-width: 190px; padding: 4px;
  display: flex; flex-direction: column; background: var(--color--background--light-2);
  border: 1px solid var(--border-color); border-radius: var(--radius); box-shadow: 0 8px 24px rgba(0, 0, 0, .28);
}
.option-add-menu button { justify-content: flex-start; border: none; background: transparent; color: var(--color--text--shade-1); }
.option-add-menu button:hover { background: var(--color--background--light-1); }
.cond-row, .kv-row { display: flex; align-items: center; gap: 6px; }
.cond-row { flex-wrap: wrap; padding: 10px; border: var(--border-width) var(--border-style) var(--border-color); border-radius: var(--radius); background: var(--color--background--light-1); }
.cond-title { flex: 0 0 100%; color: var(--color--text--shade-1); font-size: var(--font-size--2xs); }
.cond-rename { flex: 0 0 100%; display: grid; gap: 4px; font-size: var(--font-size--3xs); color: var(--color--text--tint-1); }
.cond-rename input { width: 100%; }
.assignment-empty { margin: 2px 0; padding: 14px; text-align: center; color: var(--color--text--tint-1); border: 1px dashed var(--border-color); border-radius: var(--radius); font-size: var(--font-size--2xs); line-height: 1.6; }
.assignment-empty span { font-size: var(--font-size--3xs); }
.kv-type { width: 82px; height: 32px; background: var(--color--background--light-2); border: none; box-shadow: inset 0 0 0 1px var(--border-color); border-radius: var(--radius); color: var(--color--text--shade-1); font-size: var(--font-size--2xs); padding: 0 6px; }
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
.dynamic-status { margin: 5px 0 0; font-size: 11px; }
.fixed-collection { display: flex; flex-direction: column; gap: 10px; }
.fixed-group, .fixed-row { display: flex; flex-direction: column; gap: 8px; }
.fixed-row {
  padding: 10px; border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); background: var(--color--background--light-1);
}
.fixed-row-head { display: flex; align-items: center; justify-content: space-between; font-size: var(--font-size--2xs); }
.fixed-row-actions { display: flex; gap: 4px; }
.fixed-row-actions button, .locator-modes button, .locator-search button {
  min-width: 26px; height: 26px; border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); background: var(--color--background--light-2); color: var(--color--text--shade-1); cursor: pointer;
}
.fixed-row-actions button svg { width: 14px; height: 14px; display: block; margin: auto; }
.fixed-values.horizontal { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.fixed-values.horizontal :deep(.param) { margin-bottom: 0; }
.resource-locator { display: flex; flex-direction: column; gap: 8px; }
.locator-modes { display: flex; gap: 4px; }
.locator-modes button { padding: 0 10px; }
.locator-modes button.active { border-color: var(--color--primary); color: var(--color--primary); }
.locator-search { display: flex; gap: 6px; }
.locator-search input { flex: 1; min-width: 0; }
.locator-search button { padding: 0 10px; }
.resource-locator > input, .resource-locator > select { width: 100%; }
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
.pt-focus {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; background: none; border: none; border-radius: 3px;
  color: var(--text-dim); cursor: pointer;
}
.pt-focus svg { width: 13px; height: 13px; }
.pt-focus:hover { color: var(--text); background: var(--color--background--light-1); }
.pt-focus.on { color: var(--accent); }
.pt-fromai {
  height: 15px; padding: 0 6px; background: none; border-radius: 4px;
  border: var(--border-width) var(--border-style) var(--color--primary); color: var(--color--primary);
  font-size: 10px; font-weight: 500; cursor: pointer; white-space: nowrap;
}
.pt-fromai:hover { background: color-mix(in srgb, var(--color--primary) 12%, transparent); }
/* D114 options 自定义下拉 */
.opt-dd { position: relative; }
.opt-dd-btn {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; height: 32px; padding: 0 10px; text-align: left;
  background: var(--bg-input); border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); color: var(--text); font-size: var(--font-size--sm); cursor: pointer;
}
.opt-dd-cur { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.opt-dd-chev { width: 14px; height: 14px; flex: none; color: var(--text-dim); transition: transform 0.12s; }
.opt-dd-chev.open { transform: rotate(180deg); }
.opt-dd-pop {
  position: absolute; left: 0; right: 0; top: 34px; z-index: 40; max-height: 260px; overflow: auto;
  background: var(--color--background--light-3); border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: 6px; padding: 4px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
}
.opt-dd-item {
  display: block; width: 100%; height: auto; padding: 7px 10px; text-align: left;
  background: none; border: none; border-radius: 4px; cursor: pointer; color: var(--text);
}
.opt-dd-item.hov { background: var(--color--background--light-1); }
.opt-dd-name { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: var(--font-size--sm); }
.opt-dd-check { width: 13px; height: 13px; color: var(--accent); flex: none; }
.opt-dd-item.sel .opt-dd-name { color: var(--color--text--shade-1); }
.opt-dd-desc { display: block; margin-top: 2px; font-size: var(--font-size--2xs); color: var(--text-dim); line-height: 1.4; }
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
.param-notice.warning {
  background: rgba(173, 125, 58, 0.13); border-color: rgba(211, 168, 103, 0.65); color: #dfc396;
}
.param-notice.warning .pn-icon { color: #d3a867; }
.param-notice.neutral { background: var(--color--background--light-1); border-color: var(--border-color); }
.param-notice.neutral .pn-icon { color: var(--color--text--tint-1); }
</style>
