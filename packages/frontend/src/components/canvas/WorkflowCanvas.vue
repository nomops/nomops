<script setup lang="ts">
import { computed, nextTick } from 'vue';
import {
  VueFlow,
  useVueFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeDragEvent,
} from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { useEditorStore } from '../../stores/editor.js';
import { useNodeTypesStore } from '../../stores/node-types.js';
import { parseHandle, toFlowEdges, toFlowNodes } from '../../lib/workflow-convert.js';
import CanvasNode from './CanvasNode.vue';

const editor = useEditorStore();
const nodeTypesStore = useNodeTypesStore();
const { screenToFlowCoordinate, zoomIn, zoomOut, zoomTo, fitView } = useVueFlow();

/** C8 对标 n8n Tidy up：自动分层布局后适配视口。 */
function onTidyUp() {
  editor.tidyUp();
  void nextTick(() => fitView({ padding: 0.2 }));
}

const flowNodes = computed(() => toFlowNodes(editor.nodes));
const flowEdges = computed(() => toFlowEdges(editor.connections));

function onConnect(connection: Connection) {
  if (!connection.source || !connection.target) return;
  const from = parseHandle(connection.sourceHandle);
  const to = parseHandle(connection.targetHandle);
  // 类型必须匹配：main 只接 main，能力口只接同类能力口（如 ai_tool→ai_tool）
  if (from.type !== to.type) return;
  editor.connect({
    source: connection.source,
    sourceIndex: from.index,
    target: connection.target,
    targetIndex: to.index,
    type: from.type,
  });
}

function onNodeDragStop(event: NodeDragEvent) {
  editor.moveNode(event.node.id, [event.node.position.x, event.node.position.y]);
}

function onNodesDelete(nodes: Node[]) {
  for (const n of nodes) editor.removeNode(n.id);
}

function onEdgesDelete(edges: Edge[]) {
  for (const edge of edges) {
    const from = parseHandle(edge.sourceHandle);
    const to = parseHandle(edge.targetHandle);
    editor.disconnect({
      source: edge.source,
      sourceIndex: from.index,
      target: edge.target,
      targetIndex: to.index,
      type: from.type,
    });
  }
}

/** 面板拖入画布：按落点坐标建节点。 */
function onDrop(event: DragEvent) {
  const type = event.dataTransfer?.getData('application/nomops-node');
  if (!type) return;
  const desc = nodeTypesStore.byType.get(type);
  if (!desc) return;
  const pos = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  editor.addNode(desc, [pos.x, pos.y]);
}
</script>

<template>
  <div class="canvas-wrap" data-test="canvas" @drop="onDrop" @dragover.prevent>
    <VueFlow
      :nodes="flowNodes"
      :edges="flowEdges"
      :apply-default="true"
      fit-view-on-init
      :delete-key-code="['Backspace', 'Delete']"
      @connect="onConnect"
      @node-drag-stop="onNodeDragStop"
      @node-click="(e) => editor.select(e.node.id)"
      @node-double-click="(e) => editor.openNdv(e.node.id)"
      @pane-click="editor.select(null)"
      @nodes-delete="onNodesDelete"
      @edges-delete="onEdgesDelete"
    >
      <!-- 自定义节点渲染（Vue Flow 官方插槽方式，type: 'nomops'） -->
      <template #node-nomops="nodeProps">
        <CanvasNode :data="nodeProps.data" :selected="nodeProps.selected" />
      </template>
      <Background :gap="18" />
    </VueFlow>

    <!-- 左下缩放控件 -->
    <div class="zoom-controls" data-test="zoom-controls">
      <button title="Zoom to fit" data-test="zoom-fit" @click="fitView({ padding: 0.2 })">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="zc-i"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
      </button>
      <button title="Zoom in" data-test="zoom-in" @click="zoomIn()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" class="zc-i"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></svg>
      </button>
      <button title="Zoom out" data-test="zoom-out" @click="zoomOut()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" class="zc-i"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6" /></svg>
      </button>
      <button title="Reset zoom" data-test="zoom-reset" @click="zoomTo(1)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="zc-i"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
      </button>
      <button title="Tidy up (Shift+Alt+T)" data-test="tidy-up" @click="onTidyUp">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="zc-i"><path d="M15 4V2m0 4v-2m4 0h2m-4 0h2M6.5 20.5L19 8l-3-3L3.5 17.5l3 3zM13 8l3 3" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* n8n 实测：画布底 --canvas--color--background(dark neutral-950)、
   点阵 --canvas--dot--color(neutral-700)、主连线 oklch(0.627 0 0) 2px */
.canvas-wrap { flex: 1; min-height: 0; position: relative; background: var(--canvas--color--background); }
.canvas-wrap :deep(.vue-flow__background circle) { fill: var(--canvas--dot--color); }
.canvas-wrap :deep(.vue-flow__edge-path) { stroke: oklch(0.42 0 0); stroke-width: 2px; } /* n8n 实测默认边线 */
/* AI 能力连接：灰色虚线（n8n 同为虚线） */
.canvas-wrap :deep(.vue-flow__edge.edge-ai path.vue-flow__edge-path) {
  stroke-dasharray: 6 4;
  stroke: oklch(0.42 0 0);
}
.zoom-controls {
  position: absolute; left: 14px; bottom: 14px; z-index: 10;
  display: flex; gap: 6px;
}
.zc-i { width: 15px; height: 15px; }
.zoom-controls button {
  width: 32px; height: 32px; padding: 0; font-size: 15px;
  background: var(--color--background--light-3); border: var(--border-width) var(--border-style) var(--border-color); border-radius: var(--radius);
  display: flex; align-items: center; justify-content: center;
}
.zoom-controls button:hover { border-color: var(--border-color--strong); }
</style>
