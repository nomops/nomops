<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { NodeTypeInfo } from '../../api/client.js';
import { useNodeTypesStore } from '../../stores/node-types.js';
import { useEditorStore } from '../../stores/editor.js';

/** n8n 式节点选择器：右侧滑入抽屉，搜索在顶，分组节点带图标 + 描述。 */
const nodeTypes = useNodeTypesStore();
const editor = useEditorStore();

const search = ref('');

/** 每个节点类型的图标 emoji（与画布节点一致）。 */
const ICONS: Record<string, string> = {
  manualTrigger: '🖱',
  webhook: '🔗',
  schedule: '⏰',
  set: '✎',
  noOp: '○',
  if: '⋔',
  merge: '⛙',
  code: '{ }',
  httpRequest: '🌐',
  executeWorkflow: '⧉',
  aiAgent: '✦',
};

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
            <span class="node-item-icon">{{ ICONS[desc.name] ?? '●' }}</span>
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
.picker-drawer {
  position: absolute; top: 0; right: 0; bottom: 0; width: 380px; z-index: 20;
  background: var(--bg-panel); border-left: 1px solid var(--border);
  display: flex; flex-direction: column;
  box-shadow: -12px 0 32px rgba(0, 0, 0, 0.35);
}
.picker-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 18px 18px 14px;
}
.picker-title { font-size: 17px; font-weight: 600; }
.picker-sub { font-size: 12.5px; color: var(--text-dim); margin-top: 3px; }
.picker-close { padding: 4px 8px; }
.picker-search { position: relative; padding: 0 18px 12px; }
.picker-search .search-icon {
  position: absolute; left: 30px; top: 9px; font-size: 12px; opacity: 0.6;
}
.picker-search input { padding-left: 34px; }
.picker-list { flex: 1; overflow-y: auto; padding: 0 10px 16px; }
.group-label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--text-dim); padding: 12px 8px 4px;
}
.node-item {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
  padding: 10px 10px; border: none; background: none; border-radius: 8px; cursor: pointer;
}
.node-item:hover { background: var(--bg-hover); }
.node-item-icon {
  width: 34px; height: 34px; flex-shrink: 0; border-radius: 8px;
  background: var(--bg-input); display: flex; align-items: center; justify-content: center;
  font-size: 16px;
}
.node-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.node-item-name { font-size: 13.5px; color: var(--text); }
.node-item-desc {
  font-size: 11.5px; color: var(--text-dim); margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.node-item-arrow { color: var(--text-dim); opacity: 0; transition: opacity 0.12s; }
.node-item:hover .node-item-arrow { opacity: 1; }

.drawer-enter-active, .drawer-leave-active { transition: transform 0.18s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }
</style>
