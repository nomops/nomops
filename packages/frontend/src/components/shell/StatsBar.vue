<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../api/client.js';
import { useProjectsStore } from '../../stores/projects.js';
import { useExecutionStore } from '../../stores/execution.js';
import { t } from '../../lib/i18n.js';

/** Overview 顶部统计卡行：生产执行 / 失败 / 失败率 / 节省工时 / 平均耗时。 */
const projects = useProjectsStore();
const execution = useExecutionStore();

type Insights = Awaited<ReturnType<typeof api.insights>>;

/** override：调用方注入范围过滤后的数据（Insights 页随日期范围联动）；缺省自拉全局近 7 日。 */
const props = defineProps<{ override?: Insights | null }>();
const fetched = ref<Insights | null>(null);
const data = computed(() => props.override ?? fetched.value);

async function load() {
  if (props.override !== undefined) return; // 注入模式不自拉
  fetched.value = await api.insights().catch(() => null);
}

onMounted(load);
watch(() => projects.current?.id, load);
// 执行完刷新
watch(() => execution.lastExecutionId, load);

/** ms → 人类可读平均耗时（"0s" 展示）。 */
function fmtRuntime(ms: number): { value: string; unit: string } {
  if (!ms) return { value: '0', unit: 's' };
  if (ms < 1000) return { value: String(ms), unit: 'ms' };
  return { value: (ms / 1000).toFixed(1).replace(/\.0$/, ''), unit: 's' };
}

/** 分钟 → 节省工时；无数据显示 "--"。 */
function fmtSaved(min: number): { value: string; unit: string; dim: boolean } {
  if (!min) return { value: '--', unit: '', dim: true };
  if (min < 60) return { value: String(min), unit: 'm', dim: false };
  return { value: `${Math.floor(min / 60)}h ${min % 60}`, unit: 'm', dim: false };
}

const cards = computed(() => {
  const d = data.value;
  const runtime = fmtRuntime(d?.avgRuntimeMs ?? 0);
  const saved = fmtSaved(d?.estSavedMinutes ?? 0);
  // D031 对标基线:5 格各深链到自己的 /insights/<metric>
  return [
    { label: 'Prod. executions', value: d ? String(d.total) : '0', unit: '', dim: false, saved: false, to: '/insights/total' },
    { label: 'Failed prod. executions', value: d ? String(d.error) : '0', unit: '', dim: false, saved: false, to: '/insights/failed' },
    // D032 对标基线:单位是独立的 <i>(22px/600),不能焊进数值串
    { label: 'Failure rate', value: d ? String(Math.round(d.failureRate * 100)) : '0', unit: '%', dim: false, saved: false, to: '/insights/failureRate' },
    { label: 'Time saved', value: saved.value, unit: saved.unit, dim: saved.dim, saved: true, to: '/insights/timeSaved' },
    { label: 'Run time (avg.)', value: runtime.value, unit: runtime.unit, dim: false, saved: false, to: '/insights/averageRunTime' },
  ];
});
</script>

<template>
  <!-- 基线实测（2.30.4 /home/workflows KPI 条）：
       ul 外框 1px var(--border-color) + 6px 圆角(--radius--2xs) + overflow hidden;
       格子高 99px、bg --color--background--light-3、padding 6px 24px 0;
       label <strong> 14px/400 白；数值 <em> 24px/600 白；整格可点跳 /insights/<type> -->
  <ul class="stats-bar" data-test="stats-bar">
    <li v-for="c in cards" :key="c.label">
      <router-link class="stat-cell" :to="{ path: c.to }">
        <strong class="stat-label">
          {{ t(c.label) }}
          <svg v-if="c.saved" class="info-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" stroke-linecap="round" />
          </svg>
        </strong>
        <em class="stat-value" :class="{ dim: c.dim }">
          {{ c.value }}<span v-if="c.unit" class="unit">{{ c.unit }}</span>
        </em>
      </router-link>
    </li>
  </ul>
</template>

<style scoped>
.stats-bar {
  display: flex;
  list-style: none;
  margin: 0 0 26px;
  padding: 0;
  border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius--2xs);
  overflow: hidden;
  /* overflow:hidden 会把 flex 子项的 min-height 归零，明确禁止在 .ov 列里被压缩 */
  flex-shrink: 0;
}
.stats-bar li {
  flex: 1;
  display: flex;
  min-width: 0;
}
.stats-bar li + li { border-left: var(--border-width) var(--border-style) var(--border-color); }
.stat-cell {
  flex: 1;
  min-width: 0;
  height: 99px;
  padding: var(--spacing--3xs) var(--spacing--lg) 0;
  background: var(--color--background--light-3);
  text-decoration: none;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--spacing--2xs);
}
.stat-cell:hover { background: var(--color--background--light-1); }
.stat-label {
  font-size: var(--font-size--sm);
  font-weight: var(--font-weight--regular);
  color: var(--color--text--shade-1);
  display: flex;
  align-items: center;
  gap: var(--spacing--3xs);
}
.stat-value {
  font-style: normal;
  font-size: 24px;
  font-weight: var(--font-weight--bold);
  color: var(--color--text--shade-1);
  line-height: var(--line-height--xs);
}
.stat-value.dim {
  color: var(--color--text--tint-1);
  font-weight: var(--font-weight--medium);
}
.stat-value .unit {
  font-size: 22px; /* D032 live 实测基线单位:22px/600(值为 24px/600) */
  font-weight: var(--font-weight--bold);
  margin-left: 1px;
}
.info-i {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: var(--color--text--tint-1);
}
</style>
