<script setup lang="ts">
import { computed, ref } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import type { INode } from '@nomops/workflow';
import { useNodeTypesStore } from '../../stores/node-types.js';
import { useExecutionStore } from '../../stores/execution.js';
import { useEditorStore } from '../../stores/editor.js';
import { nodeIcon } from '../../lib/icons.js';
import IconSvg from '../IconSvg.vue';

const props = defineProps<{ data: { node: INode }; selected?: boolean }>();

const nodeTypes = useNodeTypesStore();
const execution = useExecutionStore();

const desc = computed(() => nodeTypes.byType.get(props.data.node.type));
const inputs = computed(() => desc.value?.inputs ?? ['main']);
const outputs = computed(() => desc.value?.outputs ?? ['main']);
const status = computed(() => execution.statusByNode[props.data.node.name]);

/** 端口按连接类型分组：main 走左右，ai_* 能力口走上下。 */
const mainInputs = computed(() => inputs.value.filter((t) => t === 'main'));
const aiInputs = computed(() => inputs.value.filter((t) => t !== 'main'));
const mainOutputs = computed(() => outputs.value.filter((t) => t === 'main'));
const aiOutputs = computed(() => outputs.value.filter((t) => t !== 'main'));

const isTrigger = computed(() => inputs.value.length === 0 && aiOutputs.value.length === 0);
/** 纯能力子节点（模型/工具/记忆）：只有 ai_* 输出——画成小圆，顶部出线上挂宿主。 */
const isSubNode = computed(() => mainOutputs.value.length === 0 && aiOutputs.value.length > 0);
/** 便签：画布注释，特殊渲染（彩色便签纸 + 行内编辑，无端口）。 */
const isSticky = computed(() => props.data.node.type === 'nomops.stickyNote');
const stickyColor = computed(() => String(props.data.node.parameters['color'] ?? 'yellow'));
const stickyEditing = ref(false);

const editor = useEditorStore();
function commitSticky(event: Event) {
  editor.setParam(props.data.node.name, 'content', (event.target as HTMLTextAreaElement).value);
  stickyEditing.value = false;
}

/** 每个节点类型的 SVG 图标与主色（core 图标着色，品牌图标自带配色）。 */
const visual = computed(() => nodeIcon(props.data.node.type));

/** ai 连接类型的短标签（Agent 底部能力口下方显示）。 */
const AI_LABELS: Record<string, string> = {
  ai_languageModel: 'Model',
  ai_tool: 'Tool',
  ai_memory: 'Memory',
};

/** IF 双输出的端口标注。 */
function outputLabel(index: number): string | null {
  if (mainOutputs.value.length < 2) return null;
  if (props.data.node.type === 'nomops.if') return index === 0 ? 'true' : 'false';
  return String(index);
}

const sideStyle = (i: number, count: number) => ({
  top: `${((i + 1) / (count + 1)) * 100}%`,
});
const bottomStyle = (i: number, count: number) => ({
  left: `${((i + 1) / (count + 1)) * 100}%`,
});
</script>

<template>
  <!-- 便签：彩色注释纸，双击行内编辑（无端口/无执行） -->
  <div
    v-if="isSticky"
    class="sticky-note"
    :class="[`sticky-${stickyColor}`, { selected }]"
    :data-test-node="data.node.name"
    @dblclick.stop="stickyEditing = true"
  >
    <textarea
      v-if="stickyEditing"
      class="sticky-edit"
      :value="String(data.node.parameters['content'] ?? '')"
      autofocus
      @blur="commitSticky"
      @keydown.escape="stickyEditing = false"
      @mousedown.stop
    />
    <div v-else class="sticky-content">{{ data.node.parameters['content'] || 'Double-click to edit' }}</div>
  </div>

  <div v-else class="node-wrap" :data-test-node="data.node.name">
    <!-- 触发器左侧闪电旗标 -->
    <span v-if="isTrigger" class="trigger-flag">⚡</span>

    <div
      class="nomops-node"
      :class="[{ selected, trigger: isTrigger, subnode: isSubNode }, status ? `status-${status}` : '']"
    >
      <!-- main 输入：左侧 -->
      <Handle
        v-for="(_, i) in mainInputs"
        :id="`in-main-${i}`"
        :key="`in-main-${i}`"
        type="target"
        :position="Position.Left"
        :style="sideStyle(i, mainInputs.length)"
      />

      <!-- ai 能力输入：底部（标签两行错开防重叠） -->
      <template v-for="(t, i) in aiInputs" :key="`in-${t}-${i}`">
        <Handle
          :id="`in-${t}-0`"
          type="target"
          :position="Position.Bottom"
          class="ai-handle"
          :style="bottomStyle(i, aiInputs.length)"
        />
        <span
          class="ai-port-label"
          :class="{ staggered: i % 2 === 1 }"
          :style="bottomStyle(i, aiInputs.length)"
        >{{ AI_LABELS[t] ?? t }}</span>
      </template>

      <IconSvg class="node-icon" :svg="visual.svg" :color="visual.color" :size="isSubNode ? 28 : 38" />

      <!-- main 输出：右侧 -->
      <template v-for="(_, i) in mainOutputs" :key="`out-main-${i}`">
        <Handle
          :id="`out-main-${i}`"
          type="source"
          :position="Position.Right"
          :style="sideStyle(i, mainOutputs.length)"
        />
        <span v-if="outputLabel(i)" class="port-label" :style="sideStyle(i, mainOutputs.length)">
          {{ outputLabel(i) }}
        </span>
      </template>

      <!-- ai 能力输出（子节点）：顶部，上挂宿主 -->
      <Handle
        v-for="(t, i) in aiOutputs"
        :id="`out-${t}-0`"
        :key="`out-${t}-${i}`"
        type="source"
        :position="Position.Top"
        class="ai-handle"
        :style="bottomStyle(i, aiOutputs.length)"
      />
    </div>

    <!-- 名称在卡片下方 -->
    <div class="node-label">{{ data.node.name }}</div>
  </div>
</template>

<style scoped>
.node-wrap { position: relative; display: flex; flex-direction: column; align-items: center; }
.trigger-flag {
  position: absolute; left: -20px; top: 50%; transform: translateY(-50%);
  font-size: 14px; filter: saturate(1.4);
}
.nomops-node {
  position: relative;
  width: 96px; height: 96px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  display: flex; align-items: center; justify-content: center;
}
.nomops-node.trigger { border-top-left-radius: 48px; border-bottom-left-radius: 48px; }
/* 能力子节点：小圆（对齐 n8n AI 子节点形态） */
.nomops-node.subnode { width: 68px; height: 68px; border-radius: 50%; }
.nomops-node.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.nomops-node.status-running { border-color: var(--running); box-shadow: 0 0 14px rgba(245, 166, 35, 0.45); }
.nomops-node.status-success { border-color: var(--ok); }
.nomops-node.status-error { border-color: var(--err); box-shadow: 0 0 14px rgba(239, 111, 108, 0.45); }
.node-icon { line-height: 0; }
.node-label {
  margin-top: 10px; font-size: 13px; font-weight: 500; color: var(--text);
  max-width: 150px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.port-label {
  position: absolute; right: -6px; transform: translateX(100%);
  font-size: 10px; color: var(--text-dim);
}
/* ai 能力口：菱形观感 + 类型标签在卡片下方 */
:deep(.ai-handle) {
  width: 9px; height: 9px; border-radius: 2px; transform: translate(-50%, 0) rotate(45deg);
  background: var(--bg-panel); border: 1.5px solid var(--text-dim);
}
.ai-port-label {
  position: absolute; bottom: -16px; transform: translateX(-50%);
  font-size: 9px; color: var(--text-faint); white-space: nowrap;
}
.ai-port-label.staggered { bottom: -27px; }

/* 便签（画布注释） */
.sticky-note {
  width: 220px; min-height: 120px; border-radius: 8px; padding: 12px;
  font-size: 12.5px; line-height: 1.5; cursor: default;
  border: 1px solid rgba(0, 0, 0, 0.25);
}
.sticky-note.selected { box-shadow: 0 0 0 2px var(--accent); }
.sticky-yellow { background: #f3d34a; color: #4a3f10; }
.sticky-blue { background: #7db9e8; color: #10304a; }
.sticky-green { background: #8fd6a3; color: #12401f; }
.sticky-purple { background: #c9a6ee; color: #331a4d; }
.sticky-content { white-space: pre-wrap; word-break: break-word; }
.sticky-edit {
  width: 100%; min-height: 96px; background: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(0, 0, 0, 0.2); border-radius: 6px; padding: 6px;
  font: inherit; color: inherit; resize: vertical;
}
.sticky-edit:focus { outline: none; }
</style>
