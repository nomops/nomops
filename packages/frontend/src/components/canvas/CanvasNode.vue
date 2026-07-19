<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
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

/* ── 悬停工具条（对标 n8n 2.30.4 canvas-node-toolbar）──
   实测按钮集分流:
   - 普通/触发器/Agent/Tool 子节点 → ▶ Execute step · ⏻ Deactivate · 🗑 Delete · ⋯ More
   - 能力子节点(仅 ai_languageModel/ai_memory 输出,不能单独跑)→ 去掉 ▶,余 3 键
   - 便签 → 🗑 Delete · 🎨 颜色 · ⋯ More(见便签分支) */
const isDisabled = computed(() => Boolean(props.data.node.disabled));
const canExecute = computed(() => {
  if (isSticky.value) return false;
  if (isSubNode.value && aiOutputs.value.every((t) => t === 'ai_languageModel' || t === 'ai_memory')) return false;
  return true;
});
const overflowOpen = ref(false);
const stickyColorOpen = ref(false);
function closeOverflow() {
  overflowOpen.value = false;
}

/* 弹层(⋯ 菜单 / 便签色板)= 点击外部才关(popover 标准模式)。
   之前用 @mouseleave 关会误触:弹层在工具条下方,而工具条容器 pointer-events:none,
   鼠标从触发按钮移向弹层时会“穿透”到画布 → 触发节点 mouseleave → 没点到就关了。 */
const toolbarRef = ref<HTMLElement>();
let outsideHandler: ((e: PointerEvent) => void) | null = null;
function detachOutside() {
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler, true);
    outsideHandler = null;
  }
}
watch(
  () => overflowOpen.value || stickyColorOpen.value,
  (open) => {
    if (open && !outsideHandler) {
      // 打开动作本身是 click(pointerdown 已过),故同步挂载不会自关
      outsideHandler = (e: PointerEvent) => {
        if (!toolbarRef.value?.contains(e.target as Node)) {
          overflowOpen.value = false;
          stickyColorOpen.value = false;
        }
      };
      document.addEventListener('pointerdown', outsideHandler, true);
    } else if (!open) {
      detachOutside();
    }
  },
);
onBeforeUnmount(detachOutside);

async function onExecute() {
  closeOverflow();
  if (!editor.id || execution.running) return;
  await editor.save();
  await execution.run(editor.id, { destinationNode: props.data.node.name });
}
function onToggleDisable() {
  closeOverflow();
  editor.toggleDisabled(props.data.node.name);
}
function onDelete() {
  closeOverflow();
  editor.removeNode(props.data.node.name);
}
function onDuplicate() {
  closeOverflow();
  editor.duplicateNode(props.data.node.name);
}
function onOpen() {
  closeOverflow();
  editor.openNdv(props.data.node.name);
}

/** 便签颜色(对标 n8n change-sticky-color;nomops 便签色模型=parameters.color)。
    stickyColorOpen 已在上方(watch 之前)声明,避免 watch getter 同步取值时命中 TDZ。 */
// n8n 便签调色板 7 色(按 --sticky--*--variant-1..7 顺序:黄/金/红/绿/蓝/紫/灰)
const STICKY_COLORS = ['yellow', 'gold', 'red', 'green', 'blue', 'purple', 'neutral'] as const;
function setStickyColor(c: string) {
  editor.setParam(props.data.node.name, 'color', c);
  stickyColorOpen.value = false;
}

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
    <!-- 便签悬停工具条(对标 n8n:🗑 Delete · 🎨 颜色 · ⋯ More;无执行/无禁用) -->
    <div ref="toolbarRef" class="node-toolbar sticky-toolbar" :class="{ pinned: overflowOpen || stickyColorOpen }" @mousedown.stop @dblclick.stop>
      <div class="node-toolbar-items" data-test="canvas-node-toolbar">
        <button class="tb-btn" title="Delete" data-test-node-tb="delete" @click.stop="onDelete">
          <svg viewBox="0 0 24 24" class="tb-i"><path fill="currentColor" d="M21 6a1 1 0 1 1 0 2h-1v12.125c0 .817-.424 1.534-.941 2.019-.522.488-1.256.856-2.059.856H7c-.803 0-1.537-.368-2.059-.856C4.424 21.659 4 20.943 4 20.125V8H3a1 1 0 0 1 0-2zm-7-5a3 3 0 0 1 3 3H7a3 3 0 0 1 3-3z" /></svg>
        </button>
        <button class="tb-btn" title="Change color" data-test-node-tb="sticky-color" @click.stop="stickyColorOpen = !stickyColorOpen; overflowOpen = false">
          <svg viewBox="0 0 24 24" class="tb-i"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 22a1 1 0 0 1 0-20a10 9 0 0 1 10 9a5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /></g></svg>
        </button>
        <button class="tb-btn" title="More actions" data-test-node-tb="overflow" @click.stop="overflowOpen = !overflowOpen; stickyColorOpen = false">
          <svg viewBox="0 0 24 24" class="tb-i"><path fill="currentColor" d="M4.5 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5m7.5 0a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5m7.5 0a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5" /></svg>
        </button>
      </div>
      <!-- 颜色板:nomops 便签四色 -->
      <div v-if="stickyColorOpen" class="sticky-swatches" @click.stop>
        <button
          v-for="c in STICKY_COLORS"
          :key="c"
          class="swatch"
          :class="[`sw-${c}`, { on: stickyColor === c }]"
          :title="c"
          @click.stop="setStickyColor(c)"
        />
      </div>
      <div v-if="overflowOpen" class="node-menu" data-test="node-overflow-menu" @click.stop>
        <button class="nm-item" @click="onDuplicate">Duplicate</button>
        <div class="nm-sep" />
        <button class="nm-item danger" @click="onDelete">Delete</button>
      </div>
    </div>
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
      :class="[{ selected, trigger: isTrigger, subnode: isSubNode, disabled: isDisabled }, status ? `status-${status}` : '']"
    >
      <!-- 悬停工具条(对标 n8n canvas-node-toolbar):默认 opacity 0,悬停/聚焦/菜单打开时浮出 -->
      <div ref="toolbarRef" class="node-toolbar" :class="{ pinned: overflowOpen }" @mousedown.stop @dblclick.stop>
        <div class="node-toolbar-items" data-test="canvas-node-toolbar">
          <button
            v-if="canExecute"
            class="tb-btn"
            title="Execute step"
            data-test-node-tb="execute"
            :disabled="execution.running"
            @click.stop="onExecute"
          >
            <svg viewBox="0 0 24 24" class="tb-i"><path fill="currentColor" d="M5.52 2.122c.322-.175.713-.16 1.021.037l14 9a1 1 0 0 1 0 1.682l-14 9A1.001 1.001 0 0 1 5 21V3a1 1 0 0 1 .52-.878" /></svg>
          </button>
          <button
            class="tb-btn"
            :title="isDisabled ? 'Activate' : 'Deactivate'"
            data-test-node-tb="disable"
            @click.stop="onToggleDisable"
          >
            <svg viewBox="0 0 24 24" class="tb-i"><path fill="currentColor" d="M16.645 5.907a1.5 1.5 0 0 1 2.122.028 9.77 9.77 0 0 1 2.585 4.953 9.9 9.9 0 0 1-.53 5.579 9.66 9.66 0 0 1-3.476 4.357 9.36 9.36 0 0 1-5.28 1.657 9.36 9.36 0 0 1-5.292-1.623 9.66 9.66 0 0 1-3.504-4.335 9.9 9.9 0 0 1-.564-5.576 9.77 9.77 0 0 1 2.556-4.97l.11-.105a1.501 1.501 0 0 1 2.05 2.187l-.166.178a6.8 6.8 0 0 0-1.602 3.266 6.9 6.9 0 0 0 .393 3.884 6.66 6.66 0 0 0 2.413 2.989 6.36 6.36 0 0 0 3.595 1.105 6.36 6.36 0 0 0 3.59-1.128 6.66 6.66 0 0 0 2.394-3.005 6.9 6.9 0 0 0 .37-3.887 6.77 6.77 0 0 0-1.79-3.433 1.5 1.5 0 0 1 .026-2.12" /><path fill="currentColor" d="M12.035 1.481a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-3 0v-9a1.5 1.5 0 0 1 1.5-1.5" /></svg>
          </button>
          <button class="tb-btn" title="Delete" data-test-node-tb="delete" @click.stop="onDelete">
            <svg viewBox="0 0 24 24" class="tb-i"><path fill="currentColor" d="M21 6a1 1 0 1 1 0 2h-1v12.125c0 .817-.424 1.534-.941 2.019-.522.488-1.256.856-2.059.856H7c-.803 0-1.537-.368-2.059-.856C4.424 21.659 4 20.943 4 20.125V8H3a1 1 0 0 1 0-2zm-7-5a3 3 0 0 1 3 3H7a3 3 0 0 1 3-3z" /></svg>
          </button>
          <button
            class="tb-btn"
            title="More actions"
            data-test-node-tb="overflow"
            @click.stop="overflowOpen = !overflowOpen"
          >
            <svg viewBox="0 0 24 24" class="tb-i"><path fill="currentColor" d="M4.5 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5m7.5 0a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5m7.5 0a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5" /></svg>
          </button>
        </div>
        <!-- ⋯ 溢出菜单:落地能对应 nomops 真实能力的子集(Open/Execute/Deactivate/Duplicate/Delete);
             n8n 的 Rename/Pin/Replace/Convert-to-subworkflow 暂未实现,不放空项 -->
        <div v-if="overflowOpen" class="node-menu" data-test="node-overflow-menu" @click.stop>
          <button class="nm-item" @click="onOpen">Open…</button>
          <button v-if="canExecute" class="nm-item" @click="onExecute">Execute step</button>
          <button class="nm-item" @click="onToggleDisable">{{ isDisabled ? 'Activate' : 'Deactivate' }}</button>
          <button class="nm-item" @click="onDuplicate">Duplicate</button>
          <div class="nm-sep" />
          <button class="nm-item danger" @click="onDelete">Delete</button>
        </div>
      </div>

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

    <!-- 名称在卡片下方(禁用态 n8n 补 " (Deactivated)") -->
    <div class="node-label">{{ data.node.name }}<span v-if="isDisabled"> (Deactivated)</span></div>
  </div>
</template>

<style scoped>
.node-wrap { position: relative; display: flex; flex-direction: column; align-items: center; }
.trigger-flag {
  position: absolute; left: -20px; top: 50%; transform: translateY(-50%);
  font-size: 14px; filter: saturate(1.4);
}
/* n8n 实测（2.30.4 画布 _node_）：96×96、bg --node--color--background(dark #2b2b2b)、
   border 1.5px rgba(255,255,255,.63)（实测 oklch 白/0.632）、圆角 8；图标 48；
   子节点圆 80×80；label 卡下 192px 宽白字 14px */
.nomops-node {
  position: relative;
  width: 96px; height: 96px;
  background: var(--node--color--background);
  border: 1.5px solid var(--color--white-alpha-200); /* n8n 实测默认边 α0.2 */
  border-radius: var(--radius--lg);
  display: flex; align-items: center; justify-content: center;
}
.nomops-node.trigger { border-top-left-radius: 36px; border-bottom-left-radius: 36px; } /* n8n 实测 36 */
.nomops-node.subnode { width: 80px; height: 80px; border-radius: 50%; }
.nomops-node.selected { border-color: var(--canvas--color--selected); box-shadow: 0 0 0 1px var(--canvas--color--selected); }
.nomops-node.disabled { border-color: var(--color--foreground); } /* n8n 实测:禁用态边框 → foreground 中灰 */
.nomops-node.status-running { border-color: var(--node--border-color--running); }
.nomops-node.status-success { border-color: var(--color--success); }
.nomops-node.status-error { border-color: var(--color--danger); }
.node-icon { line-height: 0; }
.node-label {
  margin-top: 6px; font-size: var(--font-size--md); font-weight: var(--font-weight--regular); /* n8n 实测 16px */
  color: var(--color--text--shade-1); line-height: var(--line-height--lg);
  width: 192px; max-width: 192px; text-align: center;
  white-space: normal; overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.port-label {
  position: absolute; right: -6px; transform: translateX(100%);
  font-size: 10px; color: var(--text-dim);
}

/* ── 悬停工具条 — n8n 2.30.4 实测 ──
   外层:absolute/bottom:100%/居中/衬底 --spacing--xs(离节点间距)/pointer-events:none;
   药丸:--canvas--color--background 底、圆角 --radius、按钮 28×28、图标 12、字色 tint-1;
   默认 opacity 0,:hover / :focus-within / .pinned → 1(过渡 .1s)。 */
.node-toolbar {
  position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
  padding-bottom: var(--spacing--xs);
  display: flex; justify-content: center;
  pointer-events: none; z-index: 5;
}
.node-toolbar-items {
  display: flex; align-items: center;
  background: var(--canvas--color--background);
  border-radius: var(--radius);
  pointer-events: auto;
  opacity: 0; transition: opacity 0.1s ease-in;
}
.nomops-node:hover .node-toolbar-items,
.nomops-node:focus-within .node-toolbar-items,
.sticky-note:hover .node-toolbar-items,
.node-toolbar.pinned .node-toolbar-items { opacity: 1; }
.tb-btn {
  width: 28px; height: 28px; padding: 0;
  display: grid; place-items: center;
  background: none; border: none; border-radius: var(--radius);
  color: var(--color--text--tint-1); cursor: pointer;
}
.tb-btn:hover:not(:disabled) { background: var(--color--background--light-1); color: var(--color--text--shade-1); }
.tb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tb-i { width: 12px; height: 12px; display: block; }

/* ⋯ 溢出菜单 / 便签色板 */
.node-menu {
  position: absolute; top: 100%; right: 0; margin-top: 4px;
  display: flex; flex-direction: column; min-width: 168px;
  background: var(--color--background--light-3);
  border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); padding: 4px;
  box-shadow: 0 4px 16px var(--color--black-alpha-100);
  pointer-events: auto; z-index: 10;
}
.nm-item {
  text-align: left; padding: 6px 10px; font-size: var(--font-size--2xs);
  color: var(--color--text); background: none; border: none; border-radius: var(--radius);
  cursor: pointer; white-space: nowrap; font-family: inherit;
}
.nm-item:hover { background: var(--color--background--light-1); color: var(--color--text--shade-1); }
.nm-item.danger { color: var(--color--danger); }
.nm-sep { height: 1px; background: var(--border-color); margin: 4px 2px; }

.sticky-swatches {
  position: absolute; top: 100%; left: 50%; transform: translateX(-50%); margin-top: 4px;
  display: flex; gap: 6px; padding: 6px;
  background: var(--color--background--light-3);
  border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); box-shadow: 0 4px 16px var(--color--black-alpha-100);
  pointer-events: auto; z-index: 10;
}
.swatch { width: 18px; height: 18px; border-radius: var(--radius); border: 1px solid var(--border-color); cursor: pointer; }
.swatch.on { box-shadow: 0 0 0 2px var(--canvas--color--selected); }
.sw-yellow { background: var(--sticky--color--background--variant-1); }
.sw-gold { background: var(--sticky--color--background--variant-2); }
.sw-red { background: var(--sticky--color--background--variant-3); }
.sw-green { background: var(--sticky--color--background--variant-4); }
.sw-blue { background: var(--sticky--color--background--variant-5); }
.sw-purple { background: var(--sticky--color--background--variant-6); }
.sw-neutral { background: var(--sticky--color--background--variant-7); }
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

/* 便签 — n8n 实测：--sticky--* 令牌（dark: 变体1 黄=yellow-900底/800边;
   蓝=blue-900/800; 绿=green-950/900; 紫=purple-950/800）、圆角 4、1px 边 */
.sticky-note {
  position: relative;
  width: 240px; min-height: 160px; border-radius: var(--radius); padding: 12px;
  font-size: var(--font-size--xs); line-height: 1.5; cursor: default;
  border: var(--border-width) var(--border-style) var(--sticky--border-color);
  background: var(--sticky--color--background); color: var(--sticky--color--text);
}
.sticky-note.selected { box-shadow: 0 0 0 2px var(--canvas--color--selected); }
.sticky-yellow { background: var(--sticky--color--background--variant-1); border-color: var(--sticky--border-color--variant-1); }
.sticky-gold { background: var(--sticky--color--background--variant-2); border-color: var(--sticky--border-color--variant-2); }
.sticky-red { background: var(--sticky--color--background--variant-3); border-color: var(--sticky--border-color--variant-3); }
.sticky-green { background: var(--sticky--color--background--variant-4); border-color: var(--sticky--border-color--variant-4); }
.sticky-blue { background: var(--sticky--color--background--variant-5); border-color: var(--sticky--border-color--variant-5); }
.sticky-purple { background: var(--sticky--color--background--variant-6); border-color: var(--sticky--border-color--variant-6); }
.sticky-neutral { background: var(--sticky--color--background--variant-7); border-color: var(--sticky--border-color--variant-7); }
.sticky-content { white-space: pre-wrap; word-break: break-word; }
.sticky-edit {
  width: 100%; min-height: 96px; background: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(0, 0, 0, 0.2); border-radius: 6px; padding: 6px;
  font: inherit; color: inherit; resize: vertical;
}
.sticky-edit:focus { outline: none; }
</style>
