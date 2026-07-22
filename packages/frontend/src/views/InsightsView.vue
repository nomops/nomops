<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client.js';

/**
 * Insights — 真数据页（backlog #8 拆锁墙）：
 * 后端 /api/insights 一直完整（5 指标 + 趋势桶），原前端是按基线 Community 拟态的锁墙,
 * 与 Variables 墙同性质的过度拟态,现改为真实渲染（Overview KPI 卡深链 /insights/<metric> 落这里）。
 * 项目选择器(D153)未做:insights 按当前项目聚合,跨项目筛选需后端扩展,单列待办。
 */
type Summary = Awaited<ReturnType<typeof api.insights>>;
type MetricKey = 'total' | 'failed' | 'failureRate' | 'timeSaved' | 'averageRunTime';

const route = useRoute();
const router = useRouter();

const RANGES = [
  { key: '1d', label: 'Last 24 hours', days: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '14d', label: 'Last 14 days', days: 14 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
] as const;
const rangeKey = ref<(typeof RANGES)[number]['key']>('7d');
const rangeOpen = ref(false);
const rangeDef = computed(() => RANGES.find((r) => r.key === rangeKey.value)!);

const data = ref<Summary | null>(null);
const loading = ref(false);
const loadError = ref('');

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const to = new Date();
    // 1d = 严格近 24h(小时桶);N 天 = 近 N 日含今天(与后端默认口径一致)
    const days = rangeDef.value.days;
    const from = new Date(to.getTime() - (days === 1 ? 1 : days - 1) * 86_400_000);
    data.value = await api.insights(from.toISOString(), to.toISOString());
  } catch (e) {
    loadError.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(rangeKey, () => {
  rangeOpen.value = false;
  void load();
});

/* 选中指标（路由 /insights/:metric,与 Overview KPI 深链对齐） */
const metric = computed<MetricKey>(() => {
  const m = String(route.params['metric'] ?? 'total');
  return (['total', 'failed', 'failureRate', 'timeSaved', 'averageRunTime'] as const).includes(m as MetricKey)
    ? (m as MetricKey)
    : 'total';
});
function selectMetric(m: MetricKey) {
  void router.replace(`/insights/${m}`);
}

const fmtMs = (ms: number): string => {
  if (!ms) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
};
const fmtMinutes = (min: number): string => {
  if (!min) return '0h';
  if (min < 60) return `${Math.round(min)}m`;
  return `${(min / 60).toFixed(1)}h`;
};

const cards = computed(() => {
  const d = data.value;
  return [
    { key: 'total' as const, label: 'Prod. executions', value: d ? String(d.total) : '—' },
    { key: 'failed' as const, label: 'Failed prod. executions', value: d ? String(d.error) : '—' },
    { key: 'failureRate' as const, label: 'Failure rate', value: d ? `${(d.failureRate * 100).toFixed(1)}%` : '—' },
    { key: 'timeSaved' as const, label: 'Time saved', value: d ? fmtMinutes(d.estSavedMinutes) : '—' },
    { key: 'averageRunTime' as const, label: 'Avg. run time', value: d ? fmtMs(d.avgRuntimeMs) : '—' },
  ];
});

/* ── 趋势图（纯 SVG,成功/失败堆叠柱） ── */
const CHART_W = 960;
const CHART_H = 240;
const PAD = { top: 12, right: 8, bottom: 26, left: 34 };

const chart = computed(() => {
  const buckets = data.value?.daily ?? [];
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const step = buckets.length ? innerW / buckets.length : innerW;
  const barW = Math.max(2, Math.min(28, step * 0.6));
  const bars = buckets.map((b, i) => {
    const x = PAD.left + i * step + (step - barW) / 2;
    const hSuccess = (b.success / max) * innerH;
    const hError = (b.error / max) * innerH;
    return {
      key: b.date,
      x,
      barW,
      ySuccess: PAD.top + innerH - hSuccess,
      hSuccess,
      yError: PAD.top + innerH - hSuccess - hError,
      hError,
      total: b.total,
    };
  });
  // 轴标签:最多 8 个,均匀取样
  const every = Math.max(1, Math.ceil(buckets.length / 8));
  const labels = buckets
    .map((b, i) => ({ i, date: b.date }))
    .filter(({ i }) => i % every === 0)
    .map(({ i, date }) => ({
      x: PAD.left + i * step + step / 2,
      text: data.value?.granularity === 'hour' ? date.slice(11, 16) : date.slice(5),
    }));
  const gridYs = [0, 0.5, 1].map((f) => ({
    y: PAD.top + innerH * (1 - f),
    v: Math.round(max * f),
  }));
  return { bars, labels, gridYs, baseline: PAD.top + innerH };
});

const isEmpty = computed(() => Boolean(data.value) && data.value!.total === 0);

const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (d: Date) => `${d.getDate()} ${mon[d.getMonth()]}`;
const rangeLabel = computed(() => {
  const to = new Date();
  const from = new Date(Date.now() - rangeDef.value.days * 86_400_000);
  return `${fmtD(from)} - ${fmtD(to)}, ${to.getFullYear()}`;
});
</script>

<template>
  <div class="page-wrap" @click="rangeOpen = false">
    <header class="head">
      <h1>Insights</h1>
      <div class="dropdown" @click.stop>
        <button class="range-btn" data-test="insights-range" @click="rangeOpen = !rangeOpen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i15"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
          {{ rangeDef.label }} · {{ rangeLabel }}
        </button>
        <div v-if="rangeOpen" class="range-menu" data-test="insights-range-menu">
          <button
            v-for="r in RANGES"
            :key="r.key"
            class="range-item"
            :class="{ sel: r.key === rangeKey }"
            :data-test-range="r.key"
            @click="rangeKey = r.key"
          >
            {{ r.label }}
          </button>
        </div>
      </div>
    </header>

    <p v-if="loadError" class="err" data-test="insights-error">{{ loadError }}</p>

    <!-- KPI 五卡（与 Overview StatsBar 同口径,路由 metric 高亮） -->
    <section class="kpis" data-test="insights-kpis">
      <button
        v-for="c in cards"
        :key="c.key"
        class="kpi"
        :class="{ sel: metric === c.key }"
        :data-test-kpi="c.key"
        @click="selectMetric(c.key)"
      >
        <span class="kpi-label">{{ c.label }}</span>
        <span class="kpi-value">{{ c.value }}</span>
      </button>
    </section>

    <!-- 趋势（成功/失败堆叠柱;粒度由后端定:≤2 天小时桶,否则日桶） -->
    <section class="chart-card" data-test="insights-chart">
      <div class="chart-head">
        <b>Production executions</b>
        <span class="legend">
          <i class="dot ok" /> Success
          <i class="dot err" /> Failed
        </span>
      </div>
      <p v-if="loading" class="dim state">Loading…</p>
      <p v-else-if="isEmpty" class="dim state" data-test="insights-empty">
        No production executions in this period.
      </p>
      <svg v-else :viewBox="`0 0 ${CHART_W} ${CHART_H}`" class="chart-svg" preserveAspectRatio="none">
        <g v-for="g in chart.gridYs" :key="g.y">
          <line :x1="PAD.left" :x2="CHART_W - PAD.right" :y1="g.y" :y2="g.y" class="grid" />
          <text :x="PAD.left - 6" :y="g.y + 3.5" class="axis" text-anchor="end">{{ g.v }}</text>
        </g>
        <g v-for="b in chart.bars" :key="b.key">
          <rect v-if="b.hSuccess > 0" :x="b.x" :y="b.ySuccess" :width="b.barW" :height="b.hSuccess" class="bar-ok">
            <title>{{ b.key }} · {{ b.total }}</title>
          </rect>
          <rect v-if="b.hError > 0" :x="b.x" :y="b.yError" :width="b.barW" :height="b.hError" class="bar-err">
            <title>{{ b.key }} · {{ b.total }}</title>
          </rect>
        </g>
        <line :x1="PAD.left" :x2="CHART_W - PAD.right" :y1="chart.baseline" :y2="chart.baseline" class="grid strong" />
        <text v-for="l in chart.labels" :key="l.x" :x="l.x" :y="CHART_H - 8" class="axis" text-anchor="middle">
          {{ l.text }}
        </text>
      </svg>
    </section>
  </div>
</template>

<style scoped>
.page-wrap { padding: 22px 26px 40px; width: 100%; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
.head h1 { margin: 0; font-size: 20px; font-weight: var(--font-weight--bold); letter-spacing: -0.2px; color: var(--color--text--shade-1); }
.dropdown { position: relative; }
.range-btn {
  display: inline-flex; align-items: center; gap: 9px;
  height: 32px; padding: 0 14px; font-size: var(--font-size--sm); border-radius: var(--radius);
  background: none; border: var(--border-width) var(--border-style) var(--border-color); color: var(--color--text); cursor: pointer;
}
.range-menu {
  position: absolute; right: 0; top: 36px; z-index: 30; min-width: 180px;
  background: var(--color--background--light-3); border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: 6px; padding: 4px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
}
.range-item {
  display: block; width: 100%; text-align: left; height: auto; padding: 7px 10px;
  background: none; border: none; border-radius: 4px; font-size: var(--font-size--sm); color: var(--color--text); cursor: pointer;
}
.range-item:hover { background: var(--color--background--light-1); }
.range-item.sel { color: var(--color--primary); }

.err { color: var(--err); font-size: var(--font-size--sm); }

.kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0; margin-bottom: 18px;
  border: var(--border-width) var(--border-style) var(--border-color); border-radius: 8px; overflow: hidden;
  background: var(--color--background--light-3); }
.kpi {
  display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
  height: auto; padding: 16px 18px; background: none; border: none; border-radius: 0; cursor: pointer;
  border-right: var(--border-width) var(--border-style) var(--border-color); text-align: left;
}
.kpi:last-child { border-right: none; }
.kpi:hover { background: var(--color--background--light-1); }
.kpi.sel { box-shadow: inset 0 -2px 0 var(--color--primary); }
.kpi-label { font-size: var(--font-size--2xs); color: var(--color--text--tint-1); }
.kpi-value { font-size: 24px; font-weight: var(--font-weight--bold); color: var(--color--text--shade-1); }

.chart-card {
  border: var(--border-width) var(--border-style) var(--border-color); border-radius: 8px;
  background: var(--color--background--light-3); padding: 16px 18px 10px;
}
.chart-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;
  font-size: var(--font-size--sm); color: var(--color--text--shade-1); }
.legend { display: inline-flex; align-items: center; gap: 6px; font-size: var(--font-size--2xs); color: var(--color--text--tint-1); }
.dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; margin-left: 10px; }
.dot.ok { background: var(--color--success); }
.dot.err { background: var(--color--danger); }
.state { padding: 48px 0 56px; text-align: center; font-size: var(--font-size--sm); }
.chart-svg { width: 100%; height: 260px; display: block; }
.grid { stroke: var(--border-color); stroke-width: 1; }
.grid.strong { stroke: var(--border-color--strong, var(--border-color)); }
.axis { fill: var(--color--text--tint-1); font-size: 10px; }
.bar-ok { fill: var(--color--success); opacity: 0.85; }
.bar-err { fill: var(--color--danger); opacity: 0.9; }
</style>
