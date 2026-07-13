<script setup lang="ts">
import { computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import type { INode } from '@nomops/workflow';
import { useNodeTypesStore } from '../../stores/node-types.js';
import { useExecutionStore } from '../../stores/execution.js';

const props = defineProps<{ data: { node: INode }; selected?: boolean }>();

const nodeTypes = useNodeTypesStore();
const execution = useExecutionStore();

const desc = computed(() => nodeTypes.byType.get(props.data.node.type));
const inputs = computed(() => desc.value?.inputs ?? ['main']);
const outputs = computed(() => desc.value?.outputs ?? ['main']);
const status = computed(() => execution.statusByNode[props.data.node.name]);
const isTrigger = computed(() => inputs.value.length === 0);

/** 每个节点类型的图标（emoji）与主色（n8n 风：图标居中）。 */
const ICONS: Record<string, { icon: string; color: string }> = {
  'nomops.manualTrigger': { icon: '🖱', color: '#b0b0bb' },
  'nomops.webhook': { icon: '🔗', color: '#8b5cf6' },
  'nomops.schedule': { icon: '⏰', color: '#f5a623' },
  'nomops.set': { icon: '✎', color: '#4c9df0' },
  'nomops.noOp': { icon: '○', color: '#9a9aa6' },
  'nomops.if': { icon: '⋔', color: '#4cc38a' },
  'nomops.merge': { icon: '⛙', color: '#4cc38a' },
  'nomops.code': { icon: '{ }', color: '#e4e4ea' },
  'nomops.httpRequest': { icon: '🌐', color: '#4c9df0' },
  'nomops.executeWorkflow': { icon: '⧉', color: '#8b5cf6' },
  'nomops.aiAgent': { icon: '✦', color: '#ff6900' },
};
const visual = computed(() => ICONS[props.data.node.type] ?? { icon: '●', color: '#9a9aa6' });

/** IF 双输出的端口标注。 */
function outputLabel(index: number): string | null {
  if (outputs.value.length < 2) return null;
  if (props.data.node.type === 'nomops.if') return index === 0 ? 'true' : 'false';
  return String(index);
}

const handleStyle = (i: number, count: number) => ({
  top: `${((i + 1) / (count + 1)) * 100}%`,
});
</script>

<template>
  <div class="node-wrap" :data-test-node="data.node.name">
    <!-- 触发器左侧闪电旗标 -->
    <span v-if="isTrigger" class="trigger-flag">⚡</span>

    <div
      class="nomops-node"
      :class="[{ selected, trigger: isTrigger }, status ? `status-${status}` : '']"
      :style="{ color: visual.color }"
    >
      <Handle
        v-for="(_, i) in inputs"
        :id="`in-${i}`"
        :key="`in-${i}`"
        type="target"
        :position="Position.Left"
        :style="handleStyle(i, inputs.length)"
      />
      <span class="node-icon">{{ visual.icon }}</span>
      <template v-for="(_, i) in outputs" :key="`out-${i}`">
        <Handle
          :id="`out-${i}`"
          type="source"
          :position="Position.Right"
          :style="handleStyle(i, outputs.length)"
        />
        <span v-if="outputLabel(i)" class="port-label" :style="handleStyle(i, outputs.length)">
          {{ outputLabel(i) }}
        </span>
      </template>
    </div>

    <!-- 名称在卡片下方（n8n 风） -->
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
.nomops-node.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.nomops-node.status-running { border-color: var(--running); box-shadow: 0 0 14px rgba(245, 166, 35, 0.45); }
.nomops-node.status-success { border-color: var(--ok); }
.nomops-node.status-error { border-color: var(--err); box-shadow: 0 0 14px rgba(239, 111, 108, 0.45); }
.node-icon { font-size: 30px; line-height: 1; }
.node-label {
  margin-top: 10px; font-size: 13px; font-weight: 500; color: var(--text);
  max-width: 150px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.port-label {
  position: absolute; right: -6px; transform: translateX(100%);
  font-size: 10px; color: var(--text-dim);
}
</style>
