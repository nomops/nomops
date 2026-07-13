<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { INodeProperties } from '@nomops/workflow';
import ExpressionInput from './ExpressionInput.vue';

/**
 * schema 驱动的单参数控件：按 INodeProperties.type 分发。
 * string 支持 fx 切换为表达式模式（值以 '=' 开头即表达式，对齐引擎约定）。
 * json / collection 用 JSON 文本编辑 + 解析校验。
 */
const props = defineProps<{ prop: INodeProperties; value: unknown }>();
const emit = defineEmits<{ change: [value: unknown] }>();

const current = computed(() => props.value ?? props.prop.default);

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

      <!-- string：普通 / 表达式 -->
      <template v-if="prop.type === 'string'">
        <ExpressionInput
          v-if="isExpression"
          :model-value="String(current ?? '')"
          @update:model-value="emit('change', $event)"
        />
        <input
          v-else
          :value="String(current ?? '')"
          :placeholder="prop.placeholder"
          @input="emit('change', ($event.target as HTMLInputElement).value)"
        />
      </template>

      <input
        v-else-if="prop.type === 'number'"
        type="number"
        :value="Number(current ?? 0)"
        @input="emit('change', Number(($event.target as HTMLInputElement).value))"
      />

      <input
        v-else-if="prop.type === 'boolean'"
        type="checkbox"
        style="width: auto"
        :checked="Boolean(current)"
        @change="emit('change', ($event.target as HTMLInputElement).checked)"
      />

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
.param { margin-bottom: 4px; }
.desc { font-size: 11px; margin: 4px 0 0; }
.fx {
  padding: 0 6px; margin-left: 6px; font-size: 11px; border-radius: 4px;
  background: transparent; border: 1px solid var(--border);
}
.fx.active { color: var(--accent); border-color: var(--accent); }
textarea { font-family: ui-monospace, monospace; }
</style>
