<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  RETRY_MAX_TRIES_DEFAULT,
  RETRY_MAX_TRIES_MAX,
  RETRY_MAX_TRIES_MIN,
  RETRY_WAIT_MS_DEFAULT,
  RETRY_WAIT_MS_MAX,
  RETRY_WAIT_MS_MIN,
} from '@nomops/workflow';
import { api, type CredentialView } from '../../api/client.js';
import { CREDENTIAL_TYPES } from '../../lib/credential-types.js';
import { useEditorStore } from '../../stores/editor.js';
import { useExecutionStore } from '../../stores/execution.js';
import { useNodeTypesStore } from '../../stores/node-types.js';
import { isPropertyVisible } from '../../lib/display-options.js';
import { inputItemsFor, lastRunOf, outputPorts } from '../../lib/run-data.js';
import ParamInput from '../node-view/ParamInput.vue';
import DataPane from './DataPane.vue';
import IconSvg from '../IconSvg.vue';
import { nodeIcon } from '../../lib/icons.js';

/** NDV 模态：输入数据 | 参数（Parameters/Settings tab）| 输出数据 三栏。双击节点打开。 */
const editor = useEditorStore();
const execution = useExecutionStore();
const nodeTypes = useNodeTypesStore();

const node = computed(() => editor.selectedNode);
const desc = computed(() => (node.value ? nodeTypes.byType.get(node.value.type) : undefined));
const tab = ref<'parameters' | 'settings'>('parameters');

/* D091:头带 Docs 外链,指向项目自有的节点文档。 */
const docsUrl = computed(() => 'https://github.com/nomops/nomops/tree/main/docs/03-MODULES.md');

const visibleProps = computed(() => {
  if (!desc.value || !node.value) return [];
  return desc.value.properties.filter((p) =>
    isPropertyVisible(p, node.value!.parameters, desc.value!.properties),
  );
});

/* 基线中栏按节点型定宽(实测 IF/HTTP 640、Set 420);以可见参数数近似 */
const centerWidth = computed(() => (visibleProps.value.length <= 4 ? 420 : 640));

/* D093 对标基线:三栏分隔条可拖拽调中栏宽度(拖柄覆在两侧 4px 边上)。 */
const paramsWidth = ref<number | null>(null);
const effectiveWidth = computed(() => paramsWidth.value ?? centerWidth.value);
let dragStartX = 0;
let dragStartW = 0;
let dragSign = 1;
function onDragMove(e: MouseEvent) {
  // 左柄向左拖变宽(sign -1),右柄向右拖变宽(sign +1)
  const next = dragStartW + dragSign * (e.clientX - dragStartX);
  paramsWidth.value = Math.max(320, Math.min(900, next));
}
function endDrag() {
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', endDrag);
}
function startDrag(side: 'left' | 'right', e: MouseEvent) {
  e.preventDefault();
  dragStartX = e.clientX;
  dragStartW = effectiveWidth.value;
  dragSign = side === 'left' ? -1 : 1;
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', endDrag);
}

/* D092 对标基线:NDV 两侧相邻节点 chip(floating nodes),点击切到该节点。 */
const inputNeighbors = computed<string[]>(() => {
  const name = node.value?.name;
  if (!name) return [];
  const src = new Set<string>();
  for (const [source, byType] of Object.entries(editor.connections)) {
    for (const outputs of Object.values(byType)) {
      for (const eps of outputs ?? []) for (const ep of eps ?? []) if (ep.node === name) src.add(source);
    }
  }
  return [...src];
});
const outputNeighbors = computed<string[]>(() => {
  const name = node.value?.name;
  if (!name) return [];
  const targets = new Set<string>();
  for (const outputs of Object.values(editor.connections[name] ?? {})) {
    for (const eps of outputs ?? []) for (const ep of eps ?? []) targets.add(ep.node);
  }
  return [...targets];
});
function openNeighbor(name: string) {
  editor.openNdv(name);
}

const runData = computed(() => execution.lastRunData?.resultData.runData ?? {});
const lastRun = computed(() => (node.value ? lastRunOf(runData.value, node.value.name) : null));
const outputItems = computed(() => outputPorts(lastRun.value).flat());
const inputItems = computed(() =>
  node.value ? inputItemsFor(editor.connections, runData.value, node.value.name) : [],
);
const hasInputPort = computed(() => (desc.value?.inputs.length ?? 0) > 0);

/* ── 凭证选择器(对标基线:节点声明 credentials 时,NDV 顶部出现凭证下拉) ── */
const router = useRouter();
const allCredentials = ref<CredentialView[]>([]);
watch(
  () => editor.ndvOpen,
  async (open) => {
    if (open && allCredentials.value.length === 0) {
      allCredentials.value = await api.credentials.list().catch(() => []);
    }
  },
  { immediate: true },
);
const nodeCredTypes = computed(() => desc.value?.credentials ?? []);
function credsOfType(type: string): CredentialView[] {
  return allCredentials.value.filter((c) => c.type === type);
}
function currentCred(type: string): string {
  return node.value?.credentials?.[type]?.id ?? '';
}
function selectCred(type: string, id: string) {
  if (!node.value) return;
  if (!id) {
    editor.setNodeCredential(node.value.name, type, null);
    return;
  }
  const c = allCredentials.value.find((x) => x.id === id);
  if (c) editor.setNodeCredential(node.value.name, type, { id: c.id, name: c.name });
}
function credDisplayName(type: string): string {
  return CREDENTIAL_TYPES.find((c) => c.type === type)?.displayName ?? type;
}
function createCred() {
  editor.ndvOpen = false;
  void router.push('/?tab=credentials');
}

function close() {
  editor.ndvOpen = false;
}

/** NDV Settings tab:节点级设置写入(经 editor.setNodeSetting,onError 会同步 continueOnError)。 */
function setg(key: string, value: unknown) {
  if (node.value) editor.setNodeSetting(node.value.name, key as never, value);
}
const latestVersion = computed(() => {
  const v = desc.value?.version;
  return Array.isArray(v) ? Math.max(...v) : typeof v === 'number' ? v : undefined;
});
const showVersionNote = computed(
  () => latestVersion.value !== undefined && !!node.value && node.value.typeVersion < latestVersion.value,
);

/** Execute step = 部分执行到本节点（destinationNode）。 */
async function executeStep() {
  if (!editor.id || !node.value) return;
  await editor.save();
  await execution.run(editor.id, { destinationNode: node.value.name });
}
</script>

<template>
  <div v-if="editor.ndvOpen && node" class="ndv-overlay" data-test="ndv-modal" @click.self="close">
    <div class="ndv">
      <header class="ndv-head">
        <div class="ndv-title">
          <span class="ndv-node-icon"><IconSvg v-bind="nodeIcon(node.type)" :size="20" /></span>
          <span class="ndv-name">{{ node.name }}</span>
          <!-- D094 对标基线 NodeTitle.vue：头带只有节点图标 + 节点名，
               不拼 displayName / typeVersion / 耗时 / 错误(这些在输出面板另有呈现) -->
        </div>
        <!-- 对齐基线:头带右侧 Docs 外链 + X(无 Delete,画布 Delete/Backspace 已覆盖) -->
        <div class="ndv-head-actions">
          <a class="ndv-docs" :href="docsUrl" target="_blank" rel="noopener" data-test="ndv-docs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="ndv-docs-i"><path d="M4 5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M13 3v5h5" /></svg>
            Docs
          </a>
          <button data-test="ndv-close" @click="close">✕</button>
        </div>
      </header>

      <div class="ndv-body">
        <!-- D092 相邻节点 chip:左=输入侧邻居,右=输出侧邻居,点击切到该节点 -->
        <div v-if="inputNeighbors.length" class="floating-nodes left" data-test="ndv-floating-input">
          <button v-for="n in inputNeighbors" :key="n" class="floating-node" :title="n" @click="openNeighbor(n)">
            <IconSvg v-bind="nodeIcon(editor.nodes.find((x) => x.name === n)?.type ?? '')" :size="18" />
          </button>
        </div>
        <div v-if="outputNeighbors.length" class="floating-nodes right" data-test="ndv-floating-output">
          <button v-for="n in outputNeighbors" :key="n" class="floating-node" :title="n" @click="openNeighbor(n)">
            <IconSvg v-bind="nodeIcon(editor.nodes.find((x) => x.name === n)?.type ?? '')" :size="18" />
          </button>
        </div>

        <section v-if="hasInputPort" class="ndv-col side">
          <DataPane
            title="Input"
            :items="inputItems"
            empty-title="No input data"
            empty-action="Execute previous nodes"
            empty-caption="to view input data"
            @empty-action="executeStep"
          />
        </section>

        <section class="ndv-col params" :style="{ flexBasis: effectiveWidth + 'px' }">
          <!-- D093 三栏可拖拽分隔条(覆在中栏两侧边上) -->
          <div v-if="hasInputPort" class="col-drag left" data-test="ndv-drag-left" @mousedown="startDrag('left', $event)" />
          <div class="col-drag right" data-test="ndv-drag-right" @mousedown="startDrag('right', $event)" />
          <!-- Parameters | Settings 双 tab + Execute step -->
          <div class="param-tabs">
            <button class="ptab" :class="{ active: tab === 'parameters' }" data-test="ndv-tab-params" @click="tab = 'parameters'">
              Parameters
            </button>
            <button class="ptab" :class="{ active: tab === 'settings' }" data-test="ndv-tab-settings" @click="tab = 'settings'">
              Settings
            </button>
            <span style="flex: 1" />
            <button
              class="execute-step"
              data-test="ndv-execute-step"
              :disabled="execution.running"
              @click="executeStep"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i15">
                <path d="M10 2v6.5L4.6 18a2 2 0 0 0 1.8 3h11.2a2 2 0 0 0 1.8-3L14 8.5V2M8.5 2h7M7 15h10" />
              </svg>
              Execute step
            </button>
          </div>

          <div v-show="tab === 'parameters'" class="params-body" data-test="ndv-params">
            <!-- 凭证选择器(节点声明 credentials 时) -->
            <div v-if="nodeCredTypes.length" class="cred-section" data-test="ndv-credentials">
              <div v-for="ct in nodeCredTypes" :key="ct.name" class="cred-field">
                <label class="cred-label">
                  {{ credDisplayName(ct.name) }} <span v-if="ct.required" class="cred-req">*</span>
                </label>
                <select class="cred-select" :value="currentCred(ct.name)" :data-test-cred="ct.name" @change="selectCred(ct.name, ($event.target as HTMLSelectElement).value)">
                  <option value="">- No credential -</option>
                  <option v-for="c in credsOfType(ct.name)" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
                <button class="cred-create" type="button" data-test="cred-create" @click="createCred">+ Create new credential</button>
              </div>
            </div>

            <p v-if="visibleProps.length === 0 && !nodeCredTypes.length" class="dim">This node has no parameters to configure.</p>
            <div v-for="prop in visibleProps" :key="prop.name" class="param-pin-row">
              <button
                class="param-pin"
                :class="{ pinned: editor.isParamPinned(node.name, prop.name) }"
                :title="editor.isParamPinned(node.name, prop.name) ? 'Unpin from focus panel' : 'Pin to focus panel'"
                :data-test-pin="prop.name"
                @click="editor.togglePinParam(node.name, prop.name)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 13px; height: 13px"><path d="M12 17v5M9 3h6l1 7 3 2H5l3-2 1-7z" /></svg>
              </button>
              <ParamInput
                :prop="prop"
                :value="node.parameters[prop.name]"
                :preview-items="inputItems"
                :node-parameters="node.parameters"
                @change="editor.setParam(node.name, prop.name, $event)"
              />
            </div>

            <!-- D095 对标基线:参数区底部居中反馈链 "I wish this node would..." -->
            <div class="ndv-wish-row">
              <span class="ndv-wish" data-test="ndv-wish">I wish this node would...</span>
            </div>
          </div>

          <!-- NDV Settings tab(对标基线:3 开关 + On Error 下拉 + Notes + Display note 开关 + 版本注记) -->
          <div v-show="tab === 'settings'" class="params-body ndv-set" data-test="ndv-settings">
            <div class="set-row">
              <span class="set-label">Always Output Data</span>
              <button class="pswitch" :class="{ on: node.alwaysOutputData }" type="button" role="switch" :aria-checked="Boolean(node.alwaysOutputData)" data-test="ndv-set-always-output" @click="setg('alwaysOutputData', !node.alwaysOutputData)"><span class="pk" /></button>
            </div>
            <div class="set-row">
              <span class="set-label">Execute Once</span>
              <button class="pswitch" :class="{ on: node.executeOnce }" type="button" role="switch" :aria-checked="Boolean(node.executeOnce)" data-test="ndv-set-execute-once" @click="setg('executeOnce', !node.executeOnce)"><span class="pk" /></button>
            </div>
            <div class="set-row">
              <span class="set-label">Retry On Fail</span>
              <button class="pswitch" :class="{ on: node.retryOnFail }" type="button" role="switch" :aria-checked="Boolean(node.retryOnFail)" data-test="ndv-set-retry" @click="setg('retryOnFail', !node.retryOnFail)"><span class="pk" /></button>
            </div>
            <!-- 重试细项仅在 Retry On Fail 打开时出现;取值域与引擎 resolveRetry 的钳制一致 -->
            <template v-if="node.retryOnFail">
              <div class="set-field">
                <label class="set-label">Max. Tries</label>
                <input class="set-num" type="number" :min="RETRY_MAX_TRIES_MIN" :max="RETRY_MAX_TRIES_MAX" :value="node.maxTries ?? RETRY_MAX_TRIES_DEFAULT" data-test="ndv-set-max-tries" @change="setg('maxTries', Number(($event.target as HTMLInputElement).value))" />
                <p class="set-hint">Number of times to attempt to execute the node before failing the execution</p>
              </div>
              <div class="set-field">
                <label class="set-label">Wait Between Tries (ms)</label>
                <input class="set-num" type="number" :min="RETRY_WAIT_MS_MIN" :max="RETRY_WAIT_MS_MAX" :value="node.waitBetweenTries ?? RETRY_WAIT_MS_DEFAULT" data-test="ndv-set-wait-between" @change="setg('waitBetweenTries', Number(($event.target as HTMLInputElement).value))" />
                <p class="set-hint">How long to wait between each attempt (in milliseconds)</p>
              </div>
            </template>
            <div class="set-field">
              <label class="set-label">On Error</label>
              <select :value="node.onError ?? 'stopWorkflow'" data-test="ndv-set-onerror" @change="setg('onError', ($event.target as HTMLSelectElement).value)">
                <option value="stopWorkflow">Stop Workflow</option>
                <option value="continueRegularOutput">Continue (using regular output)</option>
                <option value="continueErrorOutput">Continue (using error output)</option>
              </select>
            </div>
            <div class="set-field">
              <label class="set-label">Notes</label>
              <textarea class="set-notes" :value="node.notes ?? ''" rows="3" placeholder="Optional note to save with the node" data-test="ndv-set-notes" @input="setg('notes', ($event.target as HTMLTextAreaElement).value)" />
            </div>
            <div class="set-row">
              <span class="set-label">Display note in flow?</span>
              <button class="pswitch" :class="{ on: node.notesInFlow }" type="button" role="switch" :aria-checked="Boolean(node.notesInFlow)" data-test="ndv-set-noteflow" @click="setg('notesInFlow', !node.notesInFlow)"><span class="pk" /></button>
            </div>
            <p v-if="showVersionNote" class="set-version" data-test="ndv-version-note">
              This node is version {{ node.typeVersion }} (Latest version: {{ latestVersion }})
            </p>
          </div>
        </section>

        <section class="ndv-col side">
          <DataPane
            title="Output"
            :items="outputItems"
            empty-title="No output data"
            empty-action="Execute step"
            empty-caption="to view output data"
            @empty-action="executeStep"
          />
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 基线实测（NDV 骨架）：全屏浮层，模态左右/底部各留 25px 露出画布；
   顶部 66px 头带（标题/拖柄/Docs/X）；三栏 = 侧栏 375px 定宽 bg light-3、
   中栏弹性 bg light-1(4px 拖柄)；容器底角 8px 圆角 */
.ndv-overlay {
  position: fixed; inset: 0; z-index: var(--ndv--z);
  background: var(--dialog--overlay--color--background--dark);
  display: flex; flex-direction: column;
}
.ndv {
  flex: 1; min-height: 0; margin: 0 25px 25px;
  display: flex; flex-direction: column; overflow: hidden;
}
.ndv-head {
  display: flex; justify-content: space-between; align-items: center;
  height: 66px; flex-shrink: 0; padding: 0 var(--spacing--sm);
  color: var(--color--text--shade-1);
}
/* 基线实测：头带 = 节点图标 + 名称(16px 白)，右侧 Docs/X */
.ndv-head-actions { display: flex; align-items: center; gap: var(--spacing--xs); }
.ndv-docs {
  display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px;
  font-size: var(--font-size--2xs); color: var(--color--text--tint-1); text-decoration: none;
  border-radius: var(--radius);
}
.ndv-docs:hover { color: var(--color--text--shade-1); background: var(--color--background--light-1); }
.ndv-docs-i { width: 14px; height: 14px; }
.ndv-wish-row { display: flex; justify-content: center; padding: 18px 0 8px; }
.ndv-wish { font-size: var(--font-size--2xs); color: var(--color--text--tint-1); cursor: pointer; }
.ndv-wish:hover { color: var(--color--primary); text-decoration: underline; }
.ndv-title { display: flex; align-items: center; gap: var(--spacing--2xs); min-width: 0; }
.ndv-node-icon { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; flex-shrink: 0; }
.ndv-name { font-size: var(--font-size--md); font-weight: var(--font-weight--regular); color: var(--color--text--shade-1); }
.ndv-body {
  flex: 1; display: flex; min-height: 0; position: relative;
  border-radius: 0 0 var(--radius--lg) var(--radius--lg); overflow: hidden;
}
.ndv-col { min-width: 0; display: flex; flex-direction: column; }
.ndv-col.params { position: relative; }

/* D092 相邻节点 floating chip(两侧边缘垂直居中) */
.floating-nodes {
  position: absolute; top: 50%; transform: translateY(-50%); z-index: 6;
  display: flex; flex-direction: column; gap: 8px;
}
.floating-nodes.left { left: 6px; }
.floating-nodes.right { right: 6px; }
.floating-node {
  width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
  background: var(--color--background--light-3); border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius); cursor: pointer;
}
.floating-node:hover { border-color: var(--color--primary); }

/* D093 中栏两侧拖拽分隔条(覆在 4px 边上) */
.col-drag {
  position: absolute; top: 0; bottom: 0; width: 8px; z-index: 7; cursor: col-resize;
}
.col-drag.left { left: -6px; }
.col-drag.right { right: -6px; }
.col-drag::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 2px;
  background: transparent; transition: background 0.15s;
}
.col-drag:hover::after, .col-drag:active::after { background: var(--color--primary); }
/* 基线实测：侧栏弹性均分、中栏定宽(IF/HTTP 类 640;简单节点 420 —— 每节点宽度表留后续) */
.ndv-col.side { flex: 1; min-width: 0; background: var(--color--background--light-3); }
.ndv-col.params { flex: 0 0 640px; background: var(--ndv--header--color); border-left: 4px solid var(--color--background--light-1); border-right: 4px solid var(--color--background--light-1); }
.param-tabs {
  display: flex; align-items: center; gap: 4px;
  padding: 10px var(--spacing--sm); flex-shrink: 0;
}
/* 基线实测：tab 12px/600；激活橙、未激活 tint-1 */
.ptab {
  background: none; border: none; border-radius: 0; height: auto;
  color: var(--color--text--tint-1); padding: 4px 8px;
  font-size: var(--font-size--2xs); font-weight: var(--font-weight--bold);
}
.ptab:hover { color: var(--color--text); background: none; }
.ptab.active { color: var(--color--primary); }
/* 基线实测：Execute step 28px 高 / 13px-500 / primary + inset 环 */
.execute-step {
  height: 28px; background: var(--button--color--background--primary); border: none; color: var(--button--color--text--primary);
  padding: 0 var(--spacing--xs); font-size: 13px; font-weight: var(--font-weight--medium);
  border-radius: var(--radius);
  box-shadow: inset 0 0 0 1px var(--button--border-color--primary), 0 1px 3px -1px var(--color--black-alpha-100);
}
.execute-step:hover { background: var(--button--color--background--primary--hover-active-focus); }
.params-body { flex: 1; overflow-y: auto; padding: 12px var(--spacing--sm); }
.setting-row { display: flex; align-items: center; gap: 6px; margin: 0; }

/* 凭证选择器 */
.cred-section { margin-bottom: 18px; padding-bottom: 16px; border-bottom: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 12px; }
.cred-field { display: flex; flex-direction: column; gap: 6px; }
.cred-label { font-size: var(--font-size--2xs); font-weight: var(--font-weight--medium); color: var(--color--text--shade-1); }
.cred-req { color: var(--color--danger); }
.cred-select {
  height: 32px; background: var(--color--background--light-2); border: none;
  box-shadow: inset 0 0 0 1px var(--border-color); border-radius: var(--radius);
  color: var(--color--text--shade-1); font-size: var(--font-size--sm); padding: 0 10px;
}
.cred-select:focus { outline: none; box-shadow: inset 0 0 0 1px var(--color--primary); }
.cred-create {
  align-self: flex-start; background: none; border: none; padding: 2px 0;
  color: var(--color--primary); font-size: var(--font-size--2xs); cursor: pointer;
}
.cred-create:hover { text-decoration: underline; }

/* NDV Settings tab */
.ndv-set { display: flex; flex-direction: column; gap: 16px; }
.set-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.set-field { display: flex; flex-direction: column; gap: 6px; }
.set-label { font-size: var(--font-size--2xs); font-weight: var(--font-weight--medium); color: var(--color--text--shade-1); }
.set-field select {
  height: 30px; background: var(--color--background--light-2); border: 1px solid var(--border-color);
  border-radius: var(--radius); padding: 0 10px; font-size: var(--font-size--2xs); color: var(--color--text--shade-1);
}
.set-notes {
  background: var(--color--background--light-2); border: 1px solid var(--border-color); border-radius: var(--radius);
  padding: 6px 8px; font-size: var(--font-size--2xs); color: var(--color--text--shade-1); resize: vertical; font-family: inherit;
}
.set-notes:focus, .set-field select:focus, .set-num:focus { outline: none; border-color: var(--color--primary); }
.set-num {
  height: 30px; background: var(--color--background--light-2); border: 1px solid var(--border-color);
  border-radius: var(--radius); padding: 0 10px; font-size: var(--font-size--2xs); color: var(--color--text--shade-1);
}
.set-hint { margin: 0; font-size: var(--font-size--3xs); color: var(--color--text--tint-1); }
.set-version { margin: 0; font-size: 11px; color: var(--color--text--tint-1); }
/* 基线开关 32×16(与 ParamInput 一致) */
.pswitch {
  position: relative; width: 32px; height: 16px; flex-shrink: 0; padding: 0; cursor: pointer;
  border-radius: 8px; border: 1px solid var(--switch--border-color); background: var(--switch--color--background); transition: background 0.15s, border-color 0.15s;
}
.pswitch .pk {
  position: absolute; top: 1px; left: 1px; width: 12px; height: 12px; border-radius: 50%;
  background: var(--switch--toggle--color); transition: transform 0.15s;
}
.pswitch.on { background: var(--switch--color--background--active); border-color: var(--switch--color--background--active); }
.pswitch.on .pk { transform: translateX(16px); }

/* Focus panel 钉按钮：悬浮参数行右上，hover 显现 */
.param-pin-row { position: relative; }
.param-pin {
  position: absolute; top: 0; right: 0; z-index: 2;
  background: none; border: none; padding: 2px 4px; cursor: pointer;
  color: var(--text-faint); opacity: 0;
}
.param-pin-row:hover .param-pin { opacity: 1; }
.param-pin.pinned { opacity: 1; color: var(--accent); }
.param-pin:hover { color: var(--accent); }
</style>
