<script setup lang="ts">
import { computed } from 'vue';
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
import { handleIndex, toFlowEdges, toFlowNodes } from '../../lib/workflow-convert.js';
import CanvasNode from './CanvasNode.vue';

const editor = useEditorStore();
const nodeTypesStore = useNodeTypesStore();
const { screenToFlowCoordinate, zoomIn, zoomOut, fitView } = useVueFlow();

const flowNodes = computed(() => toFlowNodes(editor.nodes));
const flowEdges = computed(() => toFlowEdges(editor.connections));

function onConnect(connection: Connection) {
  if (!connection.source || !connection.target) return;
  editor.connect({
    source: connection.source,
    sourceIndex: handleIndex(connection.sourceHandle),
    target: connection.target,
    targetIndex: handleIndex(connection.targetHandle),
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
    editor.disconnect({
      source: edge.source,
      sourceIndex: handleIndex(edge.sourceHandle),
      target: edge.target,
      targetIndex: handleIndex(edge.targetHandle),
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
      <button title="Fit view" @click="fitView({ padding: 0.2 })">⤢</button>
      <button title="Zoom in" @click="zoomIn()">＋</button>
      <button title="Zoom out" @click="zoomOut()">－</button>
    </div>
  </div>
</template>

<style scoped>
.canvas-wrap { flex: 1; height: 100%; position: relative; }
.zoom-controls {
  position: absolute; left: 14px; bottom: 14px; z-index: 10;
  display: flex; gap: 6px;
}
.zoom-controls button {
  width: 32px; height: 32px; padding: 0; font-size: 15px;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.zoom-controls button:hover { border-color: var(--accent); }
</style>
