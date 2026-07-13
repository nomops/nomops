<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/client.js';
import { useProjectsStore } from '../stores/projects.js';
import StatsBar from '../components/shell/StatsBar.vue';

/** Insights page: stat cards + a 7-day execution trend bar chart. */
const projects = useProjectsStore();
type Insights = Awaited<ReturnType<typeof api.insights>>;
const data = ref<Insights | null>(null);

onMounted(async () => {
  await projects.fetch().catch(() => undefined);
  data.value = await api.insights().catch(() => null);
});

const projectName = computed(() => projects.currentName);

const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function label(date: string): { dow: string; date: string } {
  const d = new Date(date + 'T00:00:00Z');
  return { dow: dow[d.getUTCDay()] ?? '', date: `${mon[d.getUTCMonth()] ?? ''} ${d.getUTCDate()}` };
}

const maxDaily = computed(() => Math.max(1, ...(data.value?.daily ?? []).map((d) => d.total)));

/** Enrich each day with pre-computed axis labels for the template. */
const days = computed(() =>
  (data.value?.daily ?? []).map((d) => ({ ...d, ...label(d.date) })),
);

/** Scale a count to a pixel height within the chart body. */
function barPx(n: number): string {
  return `${(n / maxDaily.value) * 150}px`;
}
</script>

<template>
  <div class="page-wrap">
    <header class="head">
      <h1>Insights</h1>
      <p class="sub">Execution analytics for {{ projectName }}</p>
    </header>

    <StatsBar />

    <section class="chart-card" data-test="insights-trend">
      <div class="chart-head">
        <h2 class="chart-title">Executions (last 7 days)</h2>
        <div class="legend">
          <span class="legend-item"><i class="dot success" /> Successful</span>
          <span class="legend-item"><i class="dot error" /> Failed</span>
        </div>
      </div>

      <div class="chart">
        <div v-for="d in days" :key="d.date" class="col">
          <div class="col-total tnum">{{ d.total }}</div>
          <div class="stack" :title="`Successful ${d.success} · Failed ${d.error}`">
            <div class="seg success" :style="{ height: barPx(d.success) }" />
            <div class="seg error" :style="{ height: barPx(d.error) }" />
          </div>
        </div>
      </div>

      <div class="axis">
        <div v-for="d in days" :key="d.date" class="axis-col">
          <span class="ax-dow">{{ d.dow }}</span>
          <span class="ax-date tnum">{{ d.date }}</span>
        </div>
      </div>
    </section>

    <p class="foot-note">Time saved is estimated at ~3 minutes per successful execution.</p>
  </div>
</template>

<style scoped>
.page-wrap { padding: 22px 26px 40px; width: 100%; }

/* Header */
.head { margin-bottom: 22px; }
.head h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.2px; color: var(--text-hi); }
.sub { margin: 4px 0 0; font-size: 14px; color: var(--text-dim); }

/* Trend card */
.chart-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px 22px 18px;
}
.chart-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.chart-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-hi); }

.legend { display: flex; gap: 18px; }
.legend-item { display: inline-flex; align-items: center; font-size: 12.5px; color: var(--text-dim); }
.dot { width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; }
.dot.success { background: var(--ok); }
.dot.error { background: var(--err); }

/* Chart body */
.chart {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  height: 176px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
.col { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
.col-total { font-size: 12px; font-weight: 500; color: var(--text-dim); margin-bottom: 7px; }
.stack {
  display: flex;
  flex-direction: column-reverse;
  justify-content: flex-end;
  width: 100%;
  max-width: 44px;
  border-radius: 3px 3px 0 0;
  overflow: hidden;
}
.seg { width: 100%; min-height: 0; transition: height 0.25s ease; }
.seg.success { background: var(--ok); }
.seg.error { background: var(--err); }
.col:hover .stack { filter: brightness(1.12); }

/* X axis labels */
.axis { display: flex; gap: 12px; margin-top: 8px; }
.axis-col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 1px; }
.ax-dow { font-size: 11.5px; font-weight: 500; color: var(--text); }
.ax-date { font-size: 10.5px; color: var(--text-faint); }

.foot-note { margin: 14px 0 0; font-size: 12px; color: var(--text-faint); }

.tnum { font-variant-numeric: tabular-nums; }
</style>
