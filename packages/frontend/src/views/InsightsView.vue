<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/client.js';
import { useProjectsStore } from '../stores/projects.js';
import StatsBar from '../components/shell/StatsBar.vue';

/** Insights page: stat cards + execution trend chart with a date-range picker (E2, mirrors n8n). */
const projects = useProjectsStore();
type Insights = Awaited<ReturnType<typeof api.insights>>;
const data = ref<Insights | null>(null);

/* ── 日期范围（对标 n8n：预设列表 + 手输范围 + Apply；nomops 全部解锁） ── */
const PRESETS = [
  { label: 'Last 24 hours', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: '6 months', days: 182 },
  { label: 'One year', days: 365 },
] as const;
const rangeFrom = ref(new Date(Date.now() - 6 * 86_400_000));
const rangeTo = ref(new Date());
const activePreset = ref<string | null>('Last 7 days');
const pickerOpen = ref(false);
const manualDraft = ref('');

const fmtShort = (d: Date) => `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;
const rangeLabel = computed(() => `${fmtShort(rangeFrom.value)} - ${fmtShort(rangeTo.value)}, ${rangeTo.value.getFullYear()}`);

async function loadInsights() {
  data.value = await api.insights(rangeFrom.value.toISOString(), rangeTo.value.toISOString()).catch(() => null);
}
function pickPreset(p: (typeof PRESETS)[number]) {
  rangeTo.value = new Date();
  // Last 24 hours = 恰好 1 天窗口；其余为「含今天的 N 天」（回退 N-1 天）
  const spanDays = p.days === 1 ? 1 : p.days - 1;
  rangeFrom.value = new Date(Date.now() - spanDays * 86_400_000);
  activePreset.value = p.label;
  pickerOpen.value = false;
  void loadInsights();
}
/** 手输 "M/D/YYYY-M/D/YYYY"（同 n8n 输入框格式）。 */
function applyManualRange() {
  const m = manualDraft.value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return;
  const from = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  const to = new Date(Number(m[6]), Number(m[4]) - 1, Number(m[5]), 23, 59, 59);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return;
  rangeFrom.value = from;
  rangeTo.value = to;
  activePreset.value = null;
  pickerOpen.value = false;
  void loadInsights();
}
function togglePicker() {
  manualDraft.value = `${rangeFrom.value.getMonth() + 1}/${rangeFrom.value.getDate()}/${rangeFrom.value.getFullYear()}-${rangeTo.value.getMonth() + 1}/${rangeTo.value.getDate()}/${rangeTo.value.getFullYear()}`;
  pickerOpen.value = !pickerOpen.value;
}

onMounted(async () => {
  await projects.fetch().catch(() => undefined);
  await loadInsights();
});

const projectName = computed(() => projects.currentName);

const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function label(date: string): { dow: string; date: string } {
  if (data.value?.granularity === 'hour') {
    const d = new Date(date.includes('T') ? date + ':00Z' : date);
    return { dow: '', date: `${String(d.getUTCHours()).padStart(2, '0')}:00` };
  }
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
      <div>
        <h1>Insights</h1>
        <p class="sub">Execution analytics for {{ projectName }}</p>
      </div>
      <div class="range-anchor" @click.stop>
        <button class="range-btn" data-test="insights-range" @click="togglePicker">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i15"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
          {{ rangeLabel }}
        </button>
        <div v-if="pickerOpen" class="range-pop" data-test="insights-range-pop">
          <div class="range-presets">
            <button
              v-for="p in PRESETS"
              :key="p.label"
              class="preset"
              :class="{ sel: activePreset === p.label }"
              :data-test-preset="p.label"
              @click="pickPreset(p)"
            >
              {{ p.label }}
            </button>
          </div>
          <div class="range-manual">
            <input
              v-model="manualDraft"
              class="range-input"
              data-test="insights-range-input"
              placeholder="7/10/2026-7/17/2026"
              @keydown.enter="applyManualRange"
            />
            <button class="btn primary" data-test="insights-range-apply" @click="applyManualRange">Apply</button>
          </div>
        </div>
      </div>
    </header>

    <StatsBar :override="data" />

    <section class="chart-card" data-test="insights-trend">
      <div class="chart-head">
        <h2 class="chart-title">Executions ({{ activePreset ? activePreset.toLowerCase() : rangeLabel }})</h2>
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
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.range-anchor { position: relative; }
.range-btn {
  display: inline-flex; align-items: center; gap: 9px;
  padding: 8px 14px; font-size: 13px; border-radius: 8px;
  background: var(--bg-panel, transparent); border: 1px solid var(--border); color: var(--text); cursor: pointer;
}
.range-btn:hover { border-color: var(--accent); }
.range-pop {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 50; width: 300px;
  background: var(--panel, #26262e); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5); padding: 10px;
}
.range-presets { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
.preset {
  text-align: left; padding: 7px 11px; font-size: 13px; border: none; border-radius: 7px;
  background: none; color: var(--text); cursor: pointer;
}
.preset:hover { background: var(--hover, rgba(255, 255, 255, 0.06)); }
.preset.sel { background: var(--accent); color: #fff; }
.range-manual { display: flex; gap: 8px; border-top: 1px solid var(--border); padding-top: 10px; }
.range-input {
  flex: 1; padding: 7px 10px; font-size: 12.5px;
  background: transparent; border: 1px solid var(--border); border-radius: 7px; color: var(--text); outline: none;
}
.range-input:focus { border-color: var(--accent); }

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
