<script setup lang="ts">
import { computed } from 'vue';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import type { IConnections, INode } from '@nomops/workflow';
import { toFlowEdges, toFlowNodes } from '../../lib/workflow-convert.js';
import CanvasNode from './CanvasNode.vue';

/**
 * 只读画布快照（对标 n8n 版本历史 / 执行详情的斜纹只读画布）。
 * 不绑 editor store：节点/连线全部由 props 传入，禁用一切编辑交互，
 * 仅保留平移/缩放；叠一层对角斜纹以示「快照·不可编辑」。
 */
const props = defineProps<{
  nodes: INode[];
  connections: IConnections;
  /** 每个节点的执行态（执行详情用）：ok / error / disabled。 */
  status?: Record<string, 'ok' | 'error' | 'disabled'>;
}>();

// 显式 id：与主编辑器画布隔离，避免共享 Vue Flow 实例状态。
const flowId = 'ro-canvas';
const { zoomIn, zoomOut, fitView } = useVueFlow(flowId);

const flowNodes = computed(() => toFlowNodes(props.nodes));
const flowEdges = computed(() => toFlowEdges(props.connections));
</script>

<template>
  <div class="ro-wrap" data-test="readonly-canvas">
    <VueFlow
      :id="flowId"
      :nodes="flowNodes"
      :edges="flowEdges"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="false"
      :edges-updatable="false"
      :zoom-on-double-click="false"
      :delete-key-code="null"
      fit-view-on-init
      class="ro-flow"
    >
      <template #node-nomops="nodeProps">
        <CanvasNode :data="nodeProps.data" :selected="false" :readonly="true" :run-status="props.status?.[nodeProps.data.node.name]" />
      </template>
      <Background :gap="18" />
    </VueFlow>

    <!-- 斜纹只读叠层（对标 n8n：快照不可编辑视觉信号） -->
    <div class="ro-stripes" aria-hidden="true" />

    <!-- 只读缩放控件（对标 n8n：Zoom to Fit / Zoom In / Zoom Out） -->
    <div class="ro-zoom" data-test="readonly-zoom">
      <button title="Zoom to fit" data-test="ro-zoom-fit" @click="fitView({ padding: 0.2 })">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="zc-i"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
      </button>
      <button title="Zoom in" data-test="ro-zoom-in" @click="zoomIn()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" class="zc-i"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></svg>
      </button>
      <button title="Zoom out" data-test="ro-zoom-out" @click="zoomOut()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" class="zc-i"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ro-wrap { flex: 1; min-height: 0; position: relative; background: var(--canvas--color--background); overflow: hidden; }
.ro-flow { width: 100%; height: 100%; }
.ro-wrap :deep(.vue-flow__background circle) { fill: var(--canvas--dot--color); }
.ro-wrap :deep(.vue-flow__edge-path) { stroke: oklch(0.42 0 0); stroke-width: 2px; }
.ro-wrap :deep(.vue-flow__edge.edge-ai path.vue-flow__edge-path) { stroke-dasharray: 6 4; stroke: oklch(0.42 0 0); }
/* 只读：禁用节点指针交互（除画布平移/缩放外） */
.ro-wrap :deep(.vue-flow__node) { cursor: default; }

/* 对角斜纹叠层：低透明度，pointer-events:none 不挡平移/缩放 */
.ro-stripes {
  position: absolute; inset: 0; z-index: 4; pointer-events: none;
  background: repeating-linear-gradient(
    -45deg,
    transparent 0,
    transparent 9px,
    var(--color--foreground--tint-2, rgba(255, 255, 255, 0.028)) 9px,
    var(--color--foreground--tint-2, rgba(255, 255, 255, 0.028)) 10px
  );
  opacity: 0.5;
}

.ro-zoom { position: absolute; left: 14px; bottom: 14px; z-index: 10; display: flex; gap: 6px; }
.ro-zoom button {
  width: 32px; height: 32px; padding: 0;
  background: var(--color--background--light-3); border: var(--border-width) var(--border-style) var(--border-color); border-radius: var(--radius);
  display: flex; align-items: center; justify-content: center;
}
.ro-zoom button:hover { border-color: var(--border-color--strong); }
.zc-i { width: 15px; height: 15px; }
</style>
