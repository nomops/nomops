<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import {
  VueFlow,
  useVueFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeDragEvent,
  type NodeMouseEvent,
} from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { useEditorStore } from '../../stores/editor.js';
import { useNodeTypesStore } from '../../stores/node-types.js';
import { useExecutionStore } from '../../stores/execution.js';
import { parseHandle, toFlowEdges, toFlowNodes } from '../../lib/workflow-convert.js';
import CanvasNode from './CanvasNode.vue';
import CanvasEdge from './CanvasEdge.vue';

const editor = useEditorStore();
const nodeTypesStore = useNodeTypesStore();
const execution = useExecutionStore();
const { screenToFlowCoordinate, zoomIn, zoomOut, zoomTo, fitView, addSelectedNodes, removeSelectedNodes, getNodes } =
  useVueFlow();

/* ── D076:连线中点工具条 —— 由 edge id 反解出连接四元组 ── */
function parseEdgeId(id: string) {
  // 形如 "<source>:<connType>:<outIdx>-><target>:<inIdx>"
  const [left, right] = id.split('->');
  if (!left || !right) return null;
  const lastColon = left.lastIndexOf(':');
  const typeColon = left.lastIndexOf(':', lastColon - 1);
  const source = left.slice(0, typeColon);
  const type = left.slice(typeColon + 1, lastColon);
  const sourceIndex = Number(left.slice(lastColon + 1));
  const rColon = right.lastIndexOf(':');
  const target = right.slice(0, rColon);
  const targetIndex = Number(right.slice(rColon + 1));
  if (!source || !target || Number.isNaN(sourceIndex) || Number.isNaN(targetIndex)) return null;
  return { source, sourceIndex, target, targetIndex, type };
}
function onEdgeInsert(id: string) {
  const conn = parseEdgeId(id);
  if (!conn) return;
  editor.pendingInsert = conn;
  editor.nodePickerOpen = true;
}
function onEdgeRemove(id: string) {
  const conn = parseEdgeId(id);
  if (conn) editor.disconnect(conn);
}

/* ── D082 对标基线:多选(Shift 框选 / ⌘·Ctrl 点选)── */
function onSelectionChange({ nodes }: { nodes: Node[] }) {
  editor.setSelection(nodes.map((n) => n.id));
}
function selectAllNodes() {
  addSelectedNodes(getNodes.value);
  editor.selectAll();
}
function clearSelection() {
  removeSelectedNodes(getNodes.value);
  editor.select(null);
}

/** C8 对标基线 Tidy up：自动分层布局后适配视口。 */
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

/* ── D068 空白画布右键菜单(对标基线:Add node / Add sticky note / Tidy up workflow / Select all / Clear selection)── */
const paneCtx = ref<{ x: number; y: number } | null>(null);
function onPaneContextMenu(event: MouseEvent) {
  event.preventDefault();
  paneCtx.value = { x: event.clientX, y: event.clientY };
}
function closePaneCtx() {
  paneCtx.value = null;
}
function paneAddNode() {
  closePaneCtx();
  editor.nodePickerOpen = true;
}
function paneAddSticky() {
  const pos = screenToFlowCoordinate({ x: paneCtx.value?.x ?? 200, y: paneCtx.value?.y ?? 200 });
  closePaneCtx();
  const desc = nodeTypesStore.byType.get('nomops.stickyNote');
  if (desc) editor.addNode(desc, [pos.x, pos.y]);
}
function paneTidy() {
  closePaneCtx();
  editor.tidyUp();
  void nextTick(() => fitView({ padding: 0.2 }));
}
function paneClearSelection() {
  closePaneCtx();
  editor.select(null);
}

/* ── 节点右键菜单(对标基线 13 项)── */
const ctxMenu = ref<{ x: number; y: number; node: string } | null>(null);
function onNodeContextMenu({ event, node }: NodeMouseEvent) {
  const e = event as MouseEvent;
  e.preventDefault();
  editor.select(node.id);
  ctxMenu.value = { x: e.clientX, y: e.clientY, node: node.id };
}
function closeCtx() {
  ctxMenu.value = null;
  ctxColorOpen.value = false;
}
const ctxNode = computed(() => editor.nodes.find((n) => n.name === ctxMenu.value?.node));
/* ── D080 对标基线:便签右键菜单(与普通节点 13 项不同)── */
const ctxIsSticky = computed(() => ctxNode.value?.type === 'nomops.stickyNote');
const STICKY_COLORS = ['yellow', 'gold', 'red', 'green', 'blue', 'purple', 'neutral'] as const;
const ctxColorOpen = ref(false);
function ctxStickyEdit() {
  const n = ctxMenu.value?.node;
  closeCtx();
  if (n) editor.editingSticky = n;
}
function ctxStickyColor(color: string) {
  const n = ctxMenu.value?.node;
  closeCtx();
  ctxColorOpen.value = false;
  if (n) editor.setParam(n, 'color', color);
}
const ctxDisabled = computed(() => Boolean(ctxNode.value?.disabled));
async function ctxExecute() {
  const name = ctxMenu.value?.node;
  closeCtx();
  if (!name || !editor.id || execution.running) return;
  await editor.save();
  await execution.run(editor.id, { destinationNode: name });
}
function ctxOpen() { const n = ctxMenu.value?.node; closeCtx(); if (n) editor.openNdv(n); }
function ctxRename() {
  const n = ctxMenu.value?.node; closeCtx();
  if (!n) return;
  const next = window.prompt('Rename node', n);
  if (next) editor.renameNode(n, next);
}
function ctxDeactivate() { const n = ctxMenu.value?.node; closeCtx(); if (n) editor.toggleDisabled(n); }
function ctxDuplicate() { const n = ctxMenu.value?.node; closeCtx(); if (n) editor.duplicateNode(n); }
async function ctxCopy() {
  const node = ctxNode.value; closeCtx();
  if (node) await navigator.clipboard?.writeText(JSON.stringify(node, null, 2)).catch(() => undefined);
}
function ctxTidy() { closeCtx(); editor.tidyUp(); void nextTick(() => fitView({ padding: 0.2 })); }
function ctxClearSelection() { closeCtx(); editor.select(null); }
function ctxDelete() { const n = ctxMenu.value?.node; closeCtx(); if (n) editor.removeNode(n); }
</script>

<template>
  <div class="canvas-wrap" data-test="canvas" @drop="onDrop" @dragover.prevent>
    <VueFlow
      :nodes="flowNodes"
      :edges="flowEdges"
      :apply-default="true"
      fit-view-on-init
      :delete-key-code="['Backspace', 'Delete']"
      :selection-key-code="'Shift'"
      :multi-selection-key-code="['Meta', 'Control']"
      @selection-change="onSelectionChange"
      @connect="onConnect"
      @node-drag-stop="onNodeDragStop"
      @node-click="(e) => editor.select(e.node.id)"
      @node-double-click="(e) => editor.openNdv(e.node.id)"
      @node-context-menu="onNodeContextMenu"
      @pane-context-menu="onPaneContextMenu"
      @pane-click="editor.select(null); closeCtx(); closePaneCtx()"
      @nodes-delete="onNodesDelete"
      @edges-delete="onEdgesDelete"
    >
      <!-- 自定义节点渲染（Vue Flow 官方插槽方式，type: 'nomops'） -->
      <template #node-nomops="nodeProps">
        <CanvasNode :data="nodeProps.data" :selected="nodeProps.selected" />
      </template>
      <!-- D076 自定义连线：中点悬浮工具条(+ 插入 / ✕ 删除) -->
      <template #edge-nomops="edgeProps">
        <CanvasEdge v-bind="edgeProps" @insert="onEdgeInsert" @remove="onEdgeRemove" />
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

    <!-- D068 空白画布右键菜单(对标基线) -->
    <template v-if="paneCtx">
      <div class="ctx-backdrop" @click="closePaneCtx" @contextmenu.prevent="closePaneCtx" />
      <div class="ctx-menu" data-test="pane-context-menu" :style="{ left: paneCtx.x + 'px', top: paneCtx.y + 'px' }">
        <button class="ctx-item" data-test="pane-add-node" @click="paneAddNode">Add node<span class="ctx-sc">N</span></button>
        <button class="ctx-item" data-test="pane-add-sticky" @click="paneAddSticky">Add sticky note<span class="ctx-sc">⇧S</span></button>
        <button class="ctx-item" data-test="pane-tidy" @click="paneTidy">Tidy up workflow<span class="ctx-sc">⇧⌥T</span></button>
        <button class="ctx-item" data-test="pane-select-all" @click="closePaneCtx(); selectAllNodes()">Select all<span class="ctx-sc">⌘A</span></button>
        <button class="ctx-item" data-test="pane-clear" @click="closePaneCtx(); clearSelection()">Clear selection</button>
      </div>
    </template>

    <!-- 节点右键菜单(对标基线 13 项);暂无对应能力的项置灰(Replace/Pin/Convert/Select all) -->
    <template v-if="ctxMenu">
      <div class="ctx-backdrop" @click="closeCtx" @contextmenu.prevent="closeCtx" />
      <!-- D080 便签右键菜单(对标基线:与普通节点不同的 8 项) -->
      <div
        v-if="ctxIsSticky"
        class="ctx-menu"
        data-test="sticky-context-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      >
        <button class="ctx-item" data-test="sticky-edit" @click="ctxStickyEdit">Edit<span class="ctx-sc">↵</span></button>
        <button class="ctx-item" data-test="sticky-color" @click.stop="ctxColorOpen = !ctxColorOpen">
          Change color<span class="ctx-sc">›</span>
        </button>
        <div v-if="ctxColorOpen" class="ctx-swatches" @click.stop>
          <button
            v-for="c in STICKY_COLORS"
            :key="c"
            class="ctx-swatch"
            :class="`sw-${c}`"
            :title="c"
            :data-test-sticky-color="c"
            @click="ctxStickyColor(c)"
          />
        </div>
        <button class="ctx-item" data-test="sticky-copy" @click="ctxCopy">Copy<span class="ctx-sc">⌘C</span></button>
        <button class="ctx-item" data-test="sticky-duplicate" @click="ctxDuplicate">Duplicate<span class="ctx-sc">⌘D</span></button>
        <div class="ctx-sep" />
        <button class="ctx-item" data-test="sticky-tidy" @click="ctxTidy">Tidy up workflow<span class="ctx-sc">⇧⌥T</span></button>
        <button class="ctx-item" data-test="sticky-select-all" @click="closeCtx(); selectAllNodes()">Select all<span class="ctx-sc">⌘A</span></button>
        <button class="ctx-item" data-test="sticky-clear" @click="closeCtx(); clearSelection()">Clear selection</button>
        <button class="ctx-item danger" data-test="sticky-delete" @click="ctxDelete">Delete<span class="ctx-sc">Del</span></button>
      </div>

      <div v-else class="ctx-menu" data-test="node-context-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
        <button class="ctx-item" data-test="ctx-open" @click="ctxOpen">Open<span class="ctx-sc">↵</span></button>
        <button class="ctx-item" data-test="ctx-execute" @click="ctxExecute">Execute step</button>
        <button class="ctx-item" data-test="ctx-rename" @click="ctxRename">Rename<span class="ctx-sc">Space</span></button>
        <button class="ctx-item" disabled>Replace<span class="ctx-sc">R</span></button>
        <button class="ctx-item" data-test="ctx-deactivate" @click="ctxDeactivate">{{ ctxDisabled ? 'Activate' : 'Deactivate' }}<span class="ctx-sc">D</span></button>
        <button class="ctx-item" disabled>Pin<span class="ctx-sc">P</span></button>
        <button class="ctx-item" data-test="ctx-copy" @click="ctxCopy">Copy<span class="ctx-sc">⌘C</span></button>
        <button class="ctx-item" data-test="ctx-duplicate" @click="ctxDuplicate">Duplicate<span class="ctx-sc">⌘D</span></button>
        <div class="ctx-sep" />
        <button class="ctx-item" data-test="ctx-tidy" @click="ctxTidy">Tidy up workflow<span class="ctx-sc">⇧⌥T</span></button>
        <button class="ctx-item" disabled>Convert node to sub-workflow<span class="ctx-sc">⌥X</span></button>
        <div class="ctx-sep" />
        <button class="ctx-item" data-test="ctx-select-all" @click="closeCtx(); selectAllNodes()">Select all<span class="ctx-sc">⌘A</span></button>
        <button class="ctx-item" data-test="ctx-clear" @click="closeCtx(); clearSelection()">Clear selection</button>
        <button class="ctx-item danger" data-test="ctx-delete" @click="ctxDelete">Delete<span class="ctx-sc">Del</span></button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 基线实测：画布底 --canvas--color--background(dark neutral-950)、
   点阵 --canvas--dot--color(neutral-700)、主连线 oklch(0.627 0 0) 2px */
.canvas-wrap { flex: 1; min-height: 0; position: relative; background: var(--canvas--color--background); }
.canvas-wrap :deep(.vue-flow__background circle) { fill: var(--canvas--dot--color); }
.canvas-wrap :deep(.vue-flow__edge-path) { stroke: oklch(0.42 0 0); stroke-width: 2px; } /* 基线实测默认边线 */
/* AI 能力连接：灰色虚线（基线同为虚线） */
.canvas-wrap :deep(.vue-flow__edge.edge-ai path.vue-flow__edge-path) {
  stroke-dasharray: 6 4;
  stroke: oklch(0.42 0 0);
}
.zoom-controls {
  position: absolute; left: 14px; bottom: 14px; z-index: 10;
  display: flex; gap: 6px;
}

/* 节点右键菜单 */
.ctx-backdrop { position: fixed; inset: 0; z-index: 999; }
.ctx-menu {
  position: fixed; z-index: 1000; min-width: 220px; padding: 4px;
  background: var(--color--background--light-3);
  border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); box-shadow: 0 6px 24px var(--color--black-alpha-100);
  display: flex; flex-direction: column;
}
.ctx-item {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  height: 30px; padding: 0 10px; background: none; border: none; border-radius: var(--radius);
  color: var(--color--text--shade-1); font-size: var(--font-size--2xs); text-align: left; cursor: pointer; white-space: nowrap;
}
.ctx-item:hover:not(:disabled) { background: var(--color--background--light-1); }
.ctx-item:disabled { opacity: 0.4; cursor: default; }
.ctx-item.danger { color: var(--color--danger); }
.ctx-sc { color: var(--color--text--tint-1); font-size: 11px; }
.ctx-sep { height: 1px; background: var(--border-color); margin: 4px 2px; }
/* D080 便签「Change color」7 色板(与便签 hover 工具条同色令牌) */
.ctx-swatches { display: flex; gap: 6px; padding: 6px 10px 8px; }
.ctx-swatch {
  width: 16px; height: 16px; padding: 0; border-radius: 50%; cursor: pointer;
  border: var(--border-width) var(--border-style) var(--sticky--border-color);
}
.ctx-swatch:hover { outline: 2px solid var(--color--primary); outline-offset: 1px; }
.ctx-swatch.sw-yellow { background: var(--sticky--color--background--variant-1); }
.ctx-swatch.sw-gold { background: var(--sticky--color--background--variant-2); }
.ctx-swatch.sw-red { background: var(--sticky--color--background--variant-3); }
.ctx-swatch.sw-green { background: var(--sticky--color--background--variant-4); }
.ctx-swatch.sw-blue { background: var(--sticky--color--background--variant-5); }
.ctx-swatch.sw-purple { background: var(--sticky--color--background--variant-6); }
.ctx-swatch.sw-neutral { background: var(--sticky--color--background--variant-7); }
.zc-i { width: 15px; height: 15px; }
.zoom-controls button {
  width: 32px; height: 32px; padding: 0; font-size: 15px;
  background: var(--color--background--light-3); border: var(--border-width) var(--border-style) var(--border-color); border-radius: var(--radius);
  display: flex; align-items: center; justify-content: center;
}
.zoom-controls button:hover { border-color: var(--border-color--strong); }
</style>
