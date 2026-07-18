<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { INodeExecutionData, INodeProperties } from '@nomops/workflow';
import { resolveParameterValue } from '@nomops/workflow';
import ExpressionInput from './ExpressionInput.vue';

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

/* ── 表达式实时预览（沙箱与引擎同一实现；$node/$vars 前端没有则留空） ── */
const preview = computed<{ ok: boolean; text: string } | null>(() => {
  if (!isExpression.value) return null;
  const items = props.previewItems ?? [];
  try {
    const resolved = resolveParameterValue(String(current.value), {
      json: items[0]?.json ?? {},
      itemIndex: 0,
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
function toggleExpression() {
  if (isExpression.value) emit('change', String(current.value).slice(1));
  else emit('change', `=${String(current.value ?? '')}`);
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
</script>

<template>
  <div class="param" :data-test-param="prop.name">
    <template v-if="prop.type === 'notice'">
      <p class="dim" style="font-size: 12px">{{ prop.description ?? prop.displayName }}</p>
    </template>

    <template v-else>
      <label>
        {{ prop.displayName }}
        <span v-if="prop.required" style="color: var(--err)">*</span>
        <button
          v-if="prop.type === 'string' && !prop.noDataExpression"
          class="fx"
          :class="{ active: isExpression }"
          type="button"
          title="Toggle expression mode"
          @click="toggleExpression"
        >
          ƒx
        </button>
      </label>

      <!-- string：普通 / 表达式；可接收数据窗格拖来的字段映射 -->
      <template v-if="prop.type === 'string'">
        <div
          class="drop-wrap"
          :class="{ over: dragOver }"
          @drop="onDropExpr"
          @dragover="onDragOverExpr"
          @dragleave="dragOver = false"
        >
          <div v-if="isExpression" class="expr-row">
            <span class="expr-gutter" title="Expression">=</span>
            <ExpressionInput
              class="expr-cm"
              :model-value="String(current ?? '')"
              @update:model-value="emit('change', $event)"
            />
          </div>
          <input
            v-else
            :value="String(current ?? '')"
            :placeholder="prop.placeholder"
            @input="emit('change', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <!-- 表达式实时预览（按上游输入首 item 求值） -->
        <p v-if="preview" class="expr-preview" :class="{ err: !preview.ok }" data-test="expr-preview">
          <span class="pv-label">{{ preview.ok ? 'Preview' : 'Error' }}</span>
          <span class="pv-value">{{ preview.text }}</span>
        </p>
      </template>

      <input
        v-else-if="prop.type === 'number'"
        type="number"
        :value="Number(current ?? 0)"
        @input="emit('change', Number(($event.target as HTMLInputElement).value))"
      />

      <!-- n8n 实测开关：轨 32×16 圆胶囊 / off=light-2+1px neutral-700 边 / knob 12 白 / on=green-500 -->
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

      <template v-else-if="prop.type === 'json' || prop.type === 'collection'">
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
/* n8n 实测（NDV 参数区）：行距 10；label 12px/400 白、下距 8；
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
/* n8n 实测：表达式态左侧 = gutter 块，与编辑框拼合(编辑框圆角 0 4 4 0) */
.expr-row { display: flex; align-items: stretch; }
.expr-gutter {
  flex-shrink: 0; width: 20px; display: flex; align-items: center; justify-content: center;
  background: var(--color--background--light-3);
  border: var(--border-width) var(--border-style) var(--border-color); border-right: none;
  border-radius: var(--radius) 0 0 var(--radius);
  color: var(--color--text--tint-1); font-size: var(--font-size--2xs); font-family: var(--font-family--monospace);
}
.expr-cm { flex: 1; min-width: 0; }
.fx {
  padding: 0 6px; margin-left: 6px; font-size: 11px; border-radius: 4px;
  background: transparent; border: 1px solid var(--border);
}
.fx.active { color: var(--accent); border-color: var(--accent); }
textarea { font-family: ui-monospace, monospace; }
/* 拖拽映射落点高亮 */
.drop-wrap { border-radius: var(--radius); }
.drop-wrap.over { outline: 2px dashed var(--accent); outline-offset: 1px; }
/* 表达式实时预览条 */
.expr-preview {
  display: flex; gap: 8px; align-items: baseline; margin: 4px 0 0;
  padding: 5px 8px; border-radius: 6px; background: var(--bg-input);
  font-size: 11.5px; overflow: hidden;
}
.expr-preview .pv-label { flex-shrink: 0; font-size: 10px; text-transform: uppercase; color: var(--text-faint); }
.expr-preview .pv-value {
  color: var(--ok); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.expr-preview.err .pv-value { color: var(--err); }
</style>
