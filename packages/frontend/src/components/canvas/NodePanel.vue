<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { NodeTypeInfo } from '../../api/client.js';
import { useNodeTypesStore } from '../../stores/node-types.js';
import { useEditorStore } from '../../stores/editor.js';
import { nodeIcon } from '../../lib/icons.js';
import IconSvg from '../IconSvg.vue';

/**
 * 节点创建面板(对标 n8n):
 * - 空画布 → "What triggers this workflow?" + 8 张策展触发器卡(D070)
 * - 有触发器 → "What happens next?" + 7 张语义分类卡(D069),点卡下钻该类节点列表
 * - 输入搜索 → 回退平铺过滤列表(跨所有节点)
 * 说明:分类/触发器标题与描述均为 n8n live 逐字取证(2026-07-19 经 N 键打开节点创建器读取),
 *       其中 "in n8n" 品牌名按 nomops 替换。
 */
const nodeTypes = useNodeTypesStore();
const editor = useEditorStore();

const search = ref('');
const drill = ref<string | null>(null); // 下钻中的分类/触发器 key

const isTriggerRoot = computed(() => editor.nodes.length === 0);
const searching = computed(() => search.value.trim().length > 0);

/** 8 张策展触发器(D070)。addType 有值=直接加该节点;否则下钻触发器全表。 */
const CURATED_TRIGGERS: Array<{ key: string; title: string; desc: string; addType?: string }> = [
  { key: 'manual', title: 'Trigger manually', desc: 'Runs the flow on clicking a button in nomops. Good for getting started quickly', addType: 'nomops.manualTrigger' },
  { key: 'app', title: 'On app event', desc: 'Runs the flow when something happens in an app like Telegram, Notion or Airtable', addType: 'nomops.pollingTrigger' },
  { key: 'schedule', title: 'On a schedule', desc: 'Runs the flow every day, hour, or custom interval', addType: 'nomops.schedule' },
  { key: 'webhook', title: 'On webhook call', desc: 'Runs the flow on receiving an HTTP request', addType: 'nomops.webhook' },
  { key: 'form', title: 'On form submission', desc: 'Generate webforms in nomops and pass their responses to the workflow', addType: 'nomops.webhook' },
  { key: 'subflow', title: 'When executed by another workflow', desc: 'Runs the flow when called by the Execute Workflow node from a different workflow', addType: 'nomops.executeWorkflow' },
  { key: 'chat', title: 'On chat message', desc: 'Runs the flow when a user sends a chat message. For use with AI nodes', addType: 'nomops.chatTrigger' },
  { key: 'other', title: 'Other ways...', desc: 'Runs the flow on workflow errors, file changes, etc.' },
];

/** 7 张语义分类(D069)。match 决定该类包含哪些 nomops 节点。 */
const APP_TYPES = ['nomops.slack', 'nomops.github', 'nomops.sendGrid', 'nomops.stripe', 'nomops.notion', 'nomops.hackerNews'];
const CATEGORIES: Array<{ key: string; title: string; desc: string; match: (d: NodeTypeInfo) => boolean }> = [
  { key: 'ai', title: 'AI', desc: 'Build autonomous agents, summarize or search documents, etc.', match: (d) => (d.group ?? []).includes('ai') },
  { key: 'app', title: 'Action in an app', desc: 'Do something in an app or service like Google Sheets, Telegram or Notion', match: (d) => APP_TYPES.includes(d.type) },
  { key: 'transform', title: 'Data transformation', desc: 'Manipulate, filter or convert data', match: (d) => ['nomops.set', 'nomops.code', 'nomops.noOp'].includes(d.type) },
  { key: 'flow', title: 'Flow', desc: 'Branch, merge or loop the flow, etc.', match: (d) => ['nomops.if', 'nomops.merge', 'nomops.executeWorkflow'].includes(d.type) },
  { key: 'core', title: 'Core', desc: 'Run code, make HTTP requests, set webhooks, etc.', match: (d) => d.type === 'nomops.httpRequest' },
  { key: 'human', title: 'Human review', desc: 'Request approval via services like Slack and Telegram before making tool calls', match: (d) => d.type === 'nomops.wait' },
  { key: 'trigger', title: 'Add another trigger', desc: 'Triggers start your workflow. Workflows can have multiple triggers.', match: (d) => (d.group ?? []).includes('trigger') },
];

const allNodes = computed(() => nodeTypes.descriptions.filter((d) => d.type !== 'nomops.stickyNote'));

/** 搜索结果(平铺,跨所有节点)。 */
const searchResults = computed(() => {
  const q = search.value.trim().toLowerCase();
  return allNodes.value.filter((d) => d.displayName.toLowerCase().includes(q) || d.name.toLowerCase().includes(q));
});

/** 下钻列表:分类 → match 命中的节点;触发器 "other" → 全部触发器。 */
const drillNodes = computed<NodeTypeInfo[]>(() => {
  if (!drill.value) return [];
  const cat = CATEGORIES.find((c) => c.key === drill.value);
  if (cat) return allNodes.value.filter(cat.match);
  return allNodes.value.filter((d) => (d.group ?? []).includes('trigger')); // 触发器下钻
});
const drillTitle = computed(() => CATEGORIES.find((c) => c.key === drill.value)?.title ?? 'Triggers');

function addNode(desc: NodeTypeInfo) {
  editor.addNode(desc);
  close();
}
function pickCurated(t: (typeof CURATED_TRIGGERS)[number]) {
  const desc = t.addType ? nodeTypes.byType.get(t.addType) : undefined;
  if (desc) addNode(desc);
  else drill.value = 'other'; // "Other ways" → 下钻触发器全表
}
function openCategory(key: string) {
  drill.value = key;
}
function close() {
  editor.nodePickerOpen = false;
  search.value = '';
  drill.value = null;
}
function onDragStart(event: DragEvent, desc: NodeTypeInfo) {
  event.dataTransfer?.setData('application/nomops-node', desc.type);
  event.dataTransfer!.effectAllowed = 'move';
}

const searchInput = ref<HTMLInputElement>();
watch(
  () => editor.nodePickerOpen,
  (open) => {
    if (open) {
      drill.value = null;
      search.value = '';
      setTimeout(() => searchInput.value?.focus(), 50);
    }
  },
);
</script>

<template>
  <transition name="drawer">
    <aside v-if="editor.nodePickerOpen" class="picker-drawer" data-test="node-picker">
      <div class="picker-head">
        <button v-if="drill" class="picker-back" data-test="picker-back" @click="drill = null">‹</button>
        <div>
          <div class="picker-title">
            {{ drill ? drillTitle : isTriggerRoot ? 'What triggers this workflow?' : 'What happens next?' }}
          </div>
          <div class="picker-sub">
            {{ drill ? 'Select a node to add' : isTriggerRoot ? 'A trigger is a step that starts your workflow' : 'Add a node to transform data or call a service' }}
          </div>
        </div>
        <button class="picker-close" data-test="picker-close" @click="close">✕</button>
      </div>

      <div class="picker-search">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input ref="searchInput" v-model="search" data-test="node-search" placeholder="Search nodes..." />
      </div>

      <div class="picker-list">
        <!-- 搜索态:平铺全部匹配节点 -->
        <template v-if="searching">
          <button
            v-for="desc in searchResults"
            :key="desc.name"
            class="node-item"
            draggable="true"
            :data-test-add-node="desc.name"
            @click="addNode(desc)"
            @dragstart="onDragStart($event, desc)"
          >
            <span class="node-item-icon"><IconSvg v-bind="nodeIcon(desc.name)" :size="20" /></span>
            <span class="node-item-body">
              <span class="node-item-name">{{ desc.displayName }}</span>
              <span class="node-item-desc">{{ desc.description }}</span>
            </span>
            <span class="node-item-arrow">›</span>
          </button>
          <p v-if="searchResults.length === 0" class="dim empty">No matching nodes</p>
        </template>

        <!-- 下钻态:该分类/触发器下的节点 -->
        <template v-else-if="drill">
          <button
            v-for="desc in drillNodes"
            :key="desc.name"
            class="node-item"
            draggable="true"
            :data-test-add-node="desc.name"
            @click="addNode(desc)"
            @dragstart="onDragStart($event, desc)"
          >
            <span class="node-item-icon"><IconSvg v-bind="nodeIcon(desc.name)" :size="20" /></span>
            <span class="node-item-body">
              <span class="node-item-name">{{ desc.displayName }}</span>
              <span class="node-item-desc">{{ desc.description }}</span>
            </span>
            <span class="node-item-arrow">›</span>
          </button>
          <p v-if="drillNodes.length === 0" class="dim empty">No nodes in this category yet</p>
        </template>

        <!-- 根:空画布 → 8 触发器卡 -->
        <template v-else-if="isTriggerRoot">
          <button
            v-for="t in CURATED_TRIGGERS"
            :key="t.key"
            class="cat-item"
            :data-test-trigger="t.key"
            @click="pickCurated(t)"
          >
            <span class="cat-body">
              <span class="cat-name">{{ t.title }}</span>
              <span class="cat-desc">{{ t.desc }}</span>
            </span>
            <span class="cat-arrow">›</span>
          </button>
        </template>

        <!-- 根:有触发器 → 7 分类卡 -->
        <template v-else>
          <button
            v-for="c in CATEGORIES"
            :key="c.key"
            class="cat-item"
            :data-test-category="c.key"
            @click="openCategory(c.key)"
          >
            <span class="cat-body">
              <span class="cat-name">{{ c.title }}</span>
              <span class="cat-desc">{{ c.desc }}</span>
            </span>
            <span class="cat-arrow">›</span>
          </button>
        </template>
      </div>
    </aside>
  </transition>
</template>

<style scoped>
.picker-drawer {
  position: absolute; top: 0; right: 0; bottom: 0; width: 385px; z-index: var(--node-creator--z);
  background: var(--color--background--light-3); border-left: var(--border-width) var(--border-style) var(--border-color);
  display: flex; flex-direction: column;
}
.picker-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; padding: 18px 16px 14px; }
.picker-back { background: none; border: none; color: var(--color--text--shade-1); font-size: 20px; line-height: 1; padding: 0 6px 0 0; cursor: pointer; }
.picker-title { font-size: var(--font-size--lg); font-weight: var(--font-weight--bold); color: var(--color--text--shade-1); }
.picker-sub { font-size: var(--font-size--2xs); color: var(--color--text); margin-top: 3px; }
.picker-close { padding: 4px 8px; }
.picker-search { position: relative; padding: 0 16px 12px; }
.picker-search .search-icon { position: absolute; left: 28px; top: 12px; width: 15px; height: 15px; color: var(--color--text--tint-1); }
.picker-search input {
  padding-left: 36px; height: 40px;
  background: var(--color--background--light-3);
  border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); color: var(--color--text--shade-1); font-size: var(--font-size--sm);
}
.picker-search input:focus { border-color: var(--color--primary); }
.picker-list { flex: 1; overflow-y: auto; padding: 0 0 16px; }
.empty { padding: 20px; text-align: center; }

/* 分类/触发器卡(root 层) */
.cat-item {
  display: flex; align-items: center; gap: var(--spacing--xs); width: calc(100% - 28px); text-align: left;
  margin: 0 12px 0 16px; padding: 12px; border: none; background: none; border-radius: var(--radius); cursor: pointer;
}
.cat-item:hover { background: var(--color--background--light-1); }
.cat-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cat-name { font-size: var(--font-size--sm); font-weight: var(--font-weight--medium); color: var(--color--text--shade-1); }
.cat-desc { font-size: var(--font-size--2xs); color: var(--color--text); line-height: var(--line-height--md); }
.cat-arrow { color: var(--color--text--tint-1); flex-shrink: 0; }

/* 节点条目(搜索/下钻层) */
.node-item {
  display: flex; align-items: center; gap: var(--spacing--xs); width: calc(100% - 28px); text-align: left;
  margin: 0 12px 0 16px; padding: 12px 8px 12px 0;
  border: none; background: none; border-radius: var(--radius); cursor: pointer;
}
.node-item:hover { background: var(--color--background--light-1); }
.node-item-icon {
  width: 34px; height: 34px; flex-shrink: 0; border-radius: var(--radius);
  display: flex; align-items: center; justify-content: center; color: var(--color--text--shade-1);
}
.node-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.node-item-name { font-size: var(--font-size--sm); font-weight: var(--font-weight--medium); color: var(--color--text--shade-1); }
.node-item-desc { font-size: var(--font-size--2xs); color: var(--color--text); margin-top: 2px; line-height: var(--line-height--md); }
.node-item-arrow { color: var(--color--text--tint-1); opacity: 0; transition: opacity 0.12s; }
.node-item:hover .node-item-arrow { opacity: 1; }

.drawer-enter-active, .drawer-leave-active { transition: transform 0.18s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }
</style>
