<script setup lang="ts">
import { computed, ref } from 'vue';
import { useEditorStore } from '../../stores/editor.js';
import { useExecutionStore } from '../../stores/execution.js';
import { useNodeTypesStore } from '../../stores/node-types.js';
import { isPropertyVisible } from '../../lib/display-options.js';
import { inputItemsFor, lastRunOf, outputPorts } from '../../lib/run-data.js';
import ParamInput from '../node-view/ParamInput.vue';
import DataPane from './DataPane.vue';

/** NDV 模态：输入数据 | 参数（Parameters/Settings tab）| 输出数据 三栏。双击节点打开。 */
const editor = useEditorStore();
const execution = useExecutionStore();
const nodeTypes = useNodeTypesStore();

const node = computed(() => editor.selectedNode);
const desc = computed(() => (node.value ? nodeTypes.byType.get(node.value.type) : undefined));
const tab = ref<'parameters' | 'settings'>('parameters');

const visibleProps = computed(() => {
  if (!desc.value || !node.value) return [];
  return desc.value.properties.filter((p) =>
    isPropertyVisible(p, node.value!.parameters, desc.value!.properties),
  );
});

const runData = computed(() => execution.lastRunData?.resultData.runData ?? {});
const lastRun = computed(() => (node.value ? lastRunOf(runData.value, node.value.name) : null));
const outputItems = computed(() => outputPorts(lastRun.value).flat());
const inputItems = computed(() =>
  node.value ? inputItemsFor(editor.connections, runData.value, node.value.name) : [],
);
const hasInputPort = computed(() => (desc.value?.inputs.length ?? 0) > 0);

function close() {
  editor.ndvOpen = false;
}

function deleteNode() {
  if (!node.value) return;
  editor.removeNode(node.value.name);
  close();
}

function setContinueOnError(event: Event) {
  if (!node.value) return;
  const target = editor.nodes.find((n) => n.name === node.value!.name);
  if (target) {
    target.continueOnError = (event.target as HTMLInputElement).checked;
    editor.dirty = true;
  }
}

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
        <div>
          <span style="font-weight: 600; font-size: 15px">{{ node.name }}</span>
          <span class="dim" style="margin-left: 8px; font-size: 12px">
            {{ desc?.displayName }} · v{{ node.typeVersion }}
            <template v-if="lastRun"> · {{ lastRun.executionTime }}ms</template>
            <span v-if="lastRun?.error" style="color: var(--err)"> · {{ lastRun.error.message }}</span>
          </span>
        </div>
        <div style="display: flex; gap: 8px">
          <button data-test="ndv-delete" @click="deleteNode">Delete node</button>
          <button data-test="ndv-close" @click="close">✕</button>
        </div>
      </header>

      <div class="ndv-body">
        <section v-if="hasInputPort" class="ndv-col side">
          <DataPane title="Input" :items="inputItems" empty-hint="No upstream data yet" />
        </section>

        <section class="ndv-col params">
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
              ▶ Execute step
            </button>
          </div>

          <div v-show="tab === 'parameters'" class="params-body" data-test="ndv-params">
            <p v-if="visibleProps.length === 0" class="dim">This node has no parameters to configure.</p>
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
          </div>

          <div v-show="tab === 'settings'" class="params-body" data-test="ndv-settings">
            <label class="setting-row">
              <input
                type="checkbox"
                style="width: auto"
                :checked="Boolean(node.continueOnError)"
                @change="setContinueOnError"
              />
              Continue on error (use the error output)
            </label>
            <p class="dim" style="font-size: 11.5px; margin-top: 4px">
              When on, an error here won't stop the run; failed items continue from the error output port.
            </p>
          </div>
        </section>

        <section class="ndv-col side">
          <DataPane title="Output" :items="outputItems" />
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ndv-overlay {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
}
.ndv {
  width: min(1150px, 94vw); height: min(680px, 88vh);
  background: var(--bg-panel);
  border: 1px solid var(--border); border-radius: 12px;
  display: flex; flex-direction: column; overflow: hidden;
}
.ndv-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
}
.ndv-body { flex: 1; display: flex; min-height: 0; }
.ndv-col { min-width: 0; display: flex; flex-direction: column; }
.ndv-col.side { flex: 1; background: var(--bg); }
.ndv-col.params { flex: 1.1; border-left: 1px solid var(--border); border-right: 1px solid var(--border); }
.param-tabs {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 10px; border-bottom: 1px solid var(--border);
}
.ptab {
  background: none; border: none; border-bottom: 2px solid transparent; border-radius: 0;
  color: var(--text-dim); padding: 6px 10px; font-size: 13px;
}
.ptab:hover { color: var(--text); }
.ptab.active { color: var(--text); border-bottom-color: var(--accent); }
.execute-step {
  background: var(--accent); border-color: var(--accent); color: #fff;
  padding: 5px 12px; font-size: 12.5px;
}
.execute-step:hover { background: var(--accent-dim); }
.params-body { flex: 1; overflow-y: auto; padding: 12px 14px; }
.setting-row { display: flex; align-items: center; gap: 6px; margin: 0; }

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
