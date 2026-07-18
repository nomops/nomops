<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { NodeTypeInfo } from '../../api/client.js';
import { useNodeTypesStore } from '../../stores/node-types.js';
import { useEditorStore } from '../../stores/editor.js';
import { nodeIcon } from '../../lib/icons.js';
import IconSvg from '../IconSvg.vue';

/** 节点选择器：右侧滑入抽屉，搜索在顶，分组节点带图标 + 描述。 */
const nodeTypes = useNodeTypesStore();
const editor = useEditorStore();

const search = ref('');

const groups = computed(() => {
  const q = search.value.trim().toLowerCase();
  const filterItems = (items: NodeTypeInfo[]) =>
    q
      ? items.filter(
          (d) => d.displayName.toLowerCase().includes(q) || d.name.toLowerCase().includes(q),
        )
      : items;
  return nodeTypes.grouped
    .map(({ group, items }) => ({ group, items: filterItems(items) }))
    .filter((g) => g.items.length > 0);
});

const isTriggerHeading = computed(() => editor.nodes.length === 0);

const groupLabel: Record<string, string> = {
  trigger: 'Triggers',
  transform: 'Transform',
  output: 'Output',
  ai: 'AI',
  organize: 'Organize',
};

function pick(desc: NodeTypeInfo) {
  editor.addNode(desc);
  editor.nodePickerOpen = false;
  search.value = '';
}

function onDragStart(event: DragEvent, desc: NodeTypeInfo) {
  event.dataTransfer?.setData('application/nomops-node', desc.type);
  event.dataTransfer!.effectAllowed = 'move';
}

// 打开时自动聚焦搜索
const searchInput = ref<HTMLInputElement>();
watch(
  () => editor.nodePickerOpen,
  (open) => {
    if (open) setTimeout(() => searchInput.value?.focus(), 50);
  },
);
</script>

<template>
  <transition name="drawer">
    <aside v-if="editor.nodePickerOpen" class="picker-drawer" data-test="node-picker">
      <div class="picker-head">
        <div>
          <div class="picker-title">{{ isTriggerHeading ? 'What triggers this workflow?' : 'What happens next?' }}</div>
          <div class="picker-sub">
            {{ isTriggerHeading ? 'A trigger is the starting point of your workflow' : 'Add a node to transform data or call a service' }}
          </div>
        </div>
        <button class="picker-close" data-test="picker-close" @click="editor.nodePickerOpen = false">✕</button>
      </div>

      <div class="picker-search">
        <span class="search-icon">🔍</span>
        <input ref="searchInput" v-model="search" data-test="node-search" placeholder="Search nodes…" />
      </div>

      <div class="picker-list">
        <template v-for="{ group, items } in groups" :key="group">
          <div class="group-label">{{ groupLabel[group] ?? group }}</div>
          <button
            v-for="desc in items"
            :key="desc.name"
            class="node-item"
            draggable="true"
            :data-test-add-node="desc.name"
            @click="pick(desc)"
            @dragstart="onDragStart($event, desc)"
          >
            <span class="node-item-icon">
              <IconSvg v-bind="nodeIcon(desc.name)" :size="20" />
            </span>
            <span class="node-item-body">
              <span class="node-item-name">{{ desc.displayName }}</span>
              <span class="node-item-desc">{{ desc.description }}</span>
            </span>
            <span class="node-item-arrow">→</span>
          </button>
        </template>
        <p v-if="groups.length === 0" class="dim" style="padding: 20px; text-align: center">No matching nodes</p>
      </div>
    </aside>
  </transition>
</template>

<style scoped>
/* n8n 实测（节点创建抽屉）：宽 ~385 / bg light-3；标题 18px-600 白；
   条目：衬 12px 8px 12px 0 + 外距 0 12 0 16、题 14px-500 白、
   描述 12px --color--text(非弱化色)可换行、右缘 ›  */
.picker-drawer {
  position: absolute; top: 0; right: 0; bottom: 0; width: 385px; z-index: var(--node-creator--z);
  background: var(--color--background--light-3); border-left: var(--border-width) var(--border-style) var(--border-color);
  display: flex; flex-direction: column;
}
.picker-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 18px 16px 14px;
}
.picker-title { font-size: var(--font-size--lg); font-weight: var(--font-weight--bold); color: var(--color--text--shade-1); }
.picker-sub { font-size: var(--font-size--2xs); color: var(--color--text); margin-top: 3px; }
.picker-close { padding: 4px 8px; }
.picker-search { position: relative; padding: 0 16px 12px; }
.picker-search .search-icon {
  position: absolute; left: 28px; top: 9px; font-size: 12px; opacity: 0.6;
}
.picker-search input {
  padding-left: 34px; height: 40px;
  background: var(--color--background--light-3);
  border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); color: var(--color--text--shade-1); font-size: var(--font-size--sm);
}
.picker-search input:focus { border-color: var(--color--primary); }
.picker-list { flex: 1; overflow-y: auto; padding: 0 0 16px; }
.group-label {
  font-size: var(--font-size--3xs); text-transform: uppercase; letter-spacing: var(--letter-spacing--wider);
  color: var(--color--text--tint-1); padding: 12px 16px 4px;
}
.node-item {
  display: flex; align-items: center; gap: var(--spacing--xs); width: calc(100% - 28px); text-align: left;
  margin: 0 12px 0 16px; padding: 12px 8px 12px 0;
  border: none; background: none; border-radius: var(--radius); cursor: pointer;
}
.node-item:hover { background: var(--color--background--light-1); }
.node-item-icon {
  width: 34px; height: 34px; flex-shrink: 0; border-radius: var(--radius);
  background: none; display: flex; align-items: center; justify-content: center;
  font-size: 16px; color: var(--color--text--shade-1);
}
.node-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.node-item-name { font-size: var(--font-size--sm); font-weight: var(--font-weight--medium); color: var(--color--text--shade-1); }
.node-item-desc {
  font-size: var(--font-size--2xs); color: var(--color--text); margin-top: 2px;
  line-height: var(--line-height--md);
}
.node-item-arrow { color: var(--text-dim); opacity: 0; transition: opacity 0.12s; }
.node-item:hover .node-item-arrow { opacity: 1; }

.drawer-enter-active, .drawer-leave-active { transition: transform 0.18s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }
</style>
