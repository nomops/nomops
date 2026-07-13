<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../api/client.js';
import { useProjectsStore } from '../../stores/projects.js';
import { useExecutionStore } from '../../stores/execution.js';

/** Overview 顶部统计卡行（n8n 版）：生产执行 / 失败 / 失败率 / 节省工时 / 平均耗时。 */
const projects = useProjectsStore();
const execution = useExecutionStore();

type Insights = Awaited<ReturnType<typeof api.insights>>;
const data = ref<Insights | null>(null);

async function load() {
  data.value = await api.insights().catch(() => null);
}

onMounted(load);
watch(() => projects.current?.id, load);
// 执行完刷新
watch(() => execution.lastExecutionId, load);

/** ms → 人类可读平均耗时（对齐 n8n "0s" 展示）。 */
function fmtRuntime(ms: number): { value: string; unit: string } {
  if (!ms) return { value: '0', unit: 's' };
  if (ms < 1000) return { value: String(ms), unit: 'ms' };
  return { value: (ms / 1000).toFixed(1).replace(/\.0$/, ''), unit: 's' };
}

/** 分钟 → 节省工时；无数据显示 "--"（n8n 空态）。 */
function fmtSaved(min: number): { value: string; unit: string; dim: boolean } {
  if (!min) return { value: '--', unit: '', dim: true };
  if (min < 60) return { value: String(min), unit: 'm', dim: false };
  return { value: `${Math.floor(min / 60)}h ${min % 60}`, unit: 'm', dim: false };
}

const cards = computed(() => {
  const d = data.value;
  const runtime = fmtRuntime(d?.avgRuntimeMs ?? 0);
  const saved = fmtSaved(d?.estSavedMinutes ?? 0);
  return [
    { label: 'Prod. executions', value: d ? String(d.total) : '0', unit: '', dim: false, saved: false },
    { label: 'Failed prod. executions', value: d ? String(d.error) : '0', unit: '', dim: false, saved: false },
    { label: 'Failure rate', value: d ? `${Math.round(d.failureRate * 100)}%` : '0%', unit: '', dim: false, saved: false },
    { label: 'Time saved', value: saved.value, unit: saved.unit, dim: saved.dim, saved: true },
    { label: 'Run time (avg.)', value: runtime.value, unit: runtime.unit, dim: false, saved: false },
  ];
});
</script>

<template>
  <div class="stats-bar" data-test="stats-bar">
    <div v-for="c in cards" :key="c.label" class="stat-card" :class="{ saved: c.saved }">
      <div class="stat-label">
        {{ c.label }}
        <svg v-if="c.saved" class="info-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" stroke-linecap="round" />
        </svg>
      </div>
      <div class="stat-value" :class="{ dim: c.dim }">
        {{ c.value }}<span v-if="c.unit" class="unit">{{ c.unit }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats-bar {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-bottom: 26px;
}
.stat-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 18px 18px;
  min-width: 0;
}
/* "Time saved" 卡：n8n 式左上细微高亮 */
.stat-card.saved {
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0) 55%),
    var(--bg-panel);
}
.stat-label {
  font-size: 14px;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 6px;
}
.stat-value {
  font-size: 30px;
  font-weight: 600;
  color: var(--text-hi);
  margin-top: 14px;
  letter-spacing: -0.5px;
  line-height: 1;
}
.stat-value.dim {
  color: var(--text-faint);
  font-weight: 500;
}
.stat-value .unit {
  font-size: 20px;
  font-weight: 500;
  margin-left: 1px;
}
.info-i {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: var(--text-faint);
}
@media (max-width: 1080px) {
  .stats-bar { grid-template-columns: repeat(2, 1fr); }
}
</style>
