<script setup lang="ts">
/**
 * 凭证专属表达式控件（backlog #33）。
 *
 * 与节点参数的 Fixed/Expression 控件**刻意不复用**：凭证表达式在注入前由
 * secrets-service 物化，**只支持 `{{ $secrets.KEY }}`**，没有 $json/item 上下文。
 * 复用节点控件会误导用户以为支持 item 表达式（见 gap-list P2-4 收回记录）。
 * 本控件只提供 $secrets 键补全，并明确标注作用域受限。
 */
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  modelValue: string;
  type: 'text' | 'password';
  placeholder?: string;
  /** 可用的外部密钥键名（externalSecrets 未启用时为空）。 */
  secrets: string[];
  secretsEnabled: boolean;
  fieldId: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

/** 值是否已是 $secrets 表达式（决定初始进表达式模式）。 */
const SECRET_EXPR = /\{\{\s*\$secrets\./;
const isExpr = ref(SECRET_EXPR.test(props.modelValue));
watch(
  () => props.modelValue,
  (v) => {
    if (SECRET_EXPR.test(v) && !isExpr.value) isExpr.value = true;
  },
);

const inputEl = ref<HTMLInputElement>();
const focused = ref(false);

/** 模板里直接写 `{{ … }}` 会被 Vue 当插值，用常量绕开。 */
const SAMPLE_REF = '{{ $secrets.KEY }}';
const EXPR_GLYPH = '{{ }}';
const exprTitle = computed(() =>
  isExpr.value ? 'Switch to fixed value' : 'Use an external secret ({{ $secrets }})',
);

function setValue(v: string) {
  emit('update:modelValue', v);
}

function toggleMode() {
  isExpr.value = !isExpr.value;
}

/** 键补全：聚焦时展示；按输入里 `$secrets.` 后的片段过滤。 */
const keyFilter = computed(() => {
  const m = /\$secrets\.([A-Za-z0-9_]*)$/.exec(props.modelValue);
  return m ? (m[1] ?? '').toLowerCase() : '';
});
const suggestions = computed(() =>
  props.secrets.filter((k) => k.toLowerCase().includes(keyFilter.value)).slice(0, 8),
);

/** 插入 `{{ $secrets.KEY }}`：末尾若有未闭合的 $secrets 补全片段则替换它，否则追加。 */
function insertKey(key: string) {
  const secretRef = `{{ $secrets.${key} }}`;
  const v = props.modelValue;
  const partial = /\{\{\s*\$secrets\.[A-Za-z0-9_]*\s*\}?\}?$/.exec(v);
  setValue(partial ? v.slice(0, partial.index) + secretRef : v ? v + secretRef : secretRef);
  inputEl.value?.focus();
}
</script>

<template>
  <div class="cred-expr" :class="{ expr: isExpr }">
    <div class="cred-expr-row">
      <input
        :id="fieldId"
        ref="inputEl"
        :value="modelValue"
        :type="isExpr ? 'text' : type"
        :class="{ mono: isExpr }"
        :placeholder="placeholder"
        :data-test-cred-field="fieldId.replace(/^fld-/, '')"
        autocomplete="off"
        spellcheck="false"
        @input="setValue(($event.target as HTMLInputElement).value)"
        @focus="focused = true"
        @blur="focused = false"
      />
      <button
        type="button"
        class="expr-toggle"
        :class="{ on: isExpr }"
        :title="exprTitle"
        data-test="cred-expr-toggle"
        @click="toggleMode"
      >
        {{ isExpr ? 'ABC' : EXPR_GLYPH }}
      </button>
    </div>

    <template v-if="isExpr">
      <p class="expr-scope" data-test="cred-expr-scope">
        Only external secrets are available here — <code>{{ SAMPLE_REF }}</code>. Resolved when the credential is used;
        workflow/item data (<code>$json</code>) is not available.
      </p>
      <p v-if="!secretsEnabled" class="expr-note" data-test="cred-expr-disabled">
        External Secrets is not enabled on this instance. The reference will only resolve once a provider is configured.
      </p>
      <div v-else-if="focused && suggestions.length" class="expr-keys" data-test="cred-expr-keys">
        <button
          v-for="k in suggestions"
          :key="k"
          type="button"
          class="expr-key"
          data-test="cred-expr-key"
          @mousedown.prevent="insertKey(k)"
        >
          $secrets.{{ k }}
        </button>
      </div>
      <p v-else-if="secretsEnabled && !secrets.length" class="expr-note">No external secrets found in the provider.</p>
    </template>
  </div>
</template>

<style scoped>
.cred-expr-row { display: flex; align-items: stretch; gap: 6px; }
.cred-expr-row input { flex: 1; min-width: 0; }
.cred-expr-row input.mono { font-family: var(--font-family--monospace, ui-monospace, monospace); font-size: 12.5px; }
.cred-expr.expr .cred-expr-row input { border-color: var(--accent); }
.expr-toggle {
  flex-shrink: 0; padding: 0 10px; border: 1px solid var(--border-color, var(--border));
  border-radius: 6px; background: var(--color--background--light-1, transparent);
  color: var(--color--text--shade-1); font-size: 11px; font-family: var(--font-family--monospace, monospace); cursor: pointer;
}
.expr-toggle.on { border-color: var(--accent); color: var(--accent); }
.expr-scope { margin: 6px 0 0; font-size: 11.5px; color: var(--text-dim, var(--color--text--tint-1)); }
.expr-scope code { font-size: 11px; background: var(--color--background--light-1, rgba(127,127,127,0.12)); padding: 1px 4px; border-radius: 4px; }
.expr-note { margin: 4px 0 0; font-size: 11.5px; color: var(--color--warning, #b7791f); }
.expr-keys { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.expr-key {
  padding: 3px 8px; border: 1px solid var(--border-color, var(--border)); border-radius: 12px;
  background: var(--color--background--light-1, transparent); color: var(--accent);
  font-family: var(--font-family--monospace, monospace); font-size: 11.5px; cursor: pointer;
}
.expr-key:hover { border-color: var(--accent); }
</style>
