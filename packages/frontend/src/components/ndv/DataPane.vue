<script setup lang="ts">
import { computed } from 'vue';
import type { INodeExecutionData } from '@nomops/workflow';
import { tableOf } from '../../lib/run-data.js';

/** NDV 数据窗格：一组 items 的表格/JSON 展示（输入与输出两侧共用）。 */
const props = defineProps<{ title: string; items: INodeExecutionData[]; emptyHint?: string }>();

const table = computed(() => tableOf(props.items));
</script>

<template>
  <div class="data-pane">
    <div class="pane-head">
      <span>{{ title }}</span>
      <span class="dim" style="font-size: 11px">{{ items.length }} items</span>
    </div>
    <div class="pane-body">
      <p v-if="items.length === 0" class="dim" style="font-size: 12px; text-align: center; margin-top: 30px">
        {{ emptyHint ?? 'No data yet — run once' }}
      </p>
      <table v-else-if="table" class="pane-table">
        <thead>
          <tr><th v-for="c in table.columns" :key="c">{{ c }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in table.rows" :key="i">
            <td v-for="(cell, j) in row" :key="j">{{ cell === undefined ? '' : JSON.stringify(cell) }}</td>
          </tr>
        </tbody>
      </table>
      <pre v-else>{{ JSON.stringify(items.map((it) => it.json), null, 2) }}</pre>
    </div>
  </div>
</template>

<style scoped>
.data-pane { display: flex; flex-direction: column; min-width: 0; height: 100%; }
.pane-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px; border-bottom: 1px solid var(--border);
  font-size: 12px; font-weight: 600; color: var(--text-dim); text-transform: uppercase;
}
.pane-body { flex: 1; overflow: auto; padding: 8px 12px; }
.pane-table th, .pane-table td { font-size: 12px; padding: 6px 8px; }
pre { font-size: 12px; background: var(--bg-input); padding: 10px; border-radius: 6px; }
</style>
