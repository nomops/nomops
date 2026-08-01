<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type AuditLogRow } from '../api/client.js';
import { LINKS } from '../lib/links.js';
import { useProjectsStore } from '../stores/projects.js';
import UiState from '../components/ui/UiState.vue';

const projects = useProjectsStore();
const logs = ref<AuditLogRow[]>([]);
const error = ref('');
const ready = ref(false);
const loading = ref(false);

/** 未授权时不发请求、不显示裸 403 文案，改出锁卡（与设置页各企业分区一致）。 */
const unlocked = computed(() => projects.hasFeature('auditLogs'));

onMounted(async () => {
  try { await projects.fetch(); }
  catch (e) { error.value = (e as Error).message; }
  ready.value = true;
  if (unlocked.value) await load();
});

async function load() {
  error.value = '';
  const current = projects.current;
  if (!current) return;
  loading.value = true;
  try {
    logs.value = await api.auditLogs.list(current.id);
  } catch (e) {
    error.value = (e as Error).message; // 非项目 owner → 403
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="page-wrap">
    <div style="display: flex; align-items: center; margin-bottom: 16px">
      <h1 class="page-title">Audit logs</h1>
      <span class="dim" style="margin-left: 12px; font-size: 12px">
        Project: {{ projects.current?.name ?? '-' }} (visible to owners)
      </span>
      <span style="flex: 1" />
      <button v-if="unlocked" @click="load">Refresh</button>
    </div>

    <div v-if="ready && !error && !unlocked" class="locked-card" data-test="audit-locked">
      <h2>Available on the Enterprise plan</h2>
      <p>
        Track who changed what and when across your projects — workflow edits, credential changes,
        executions, and member management.
      </p>
      <a class="btn primary" :href="LINKS.pricing" target="_blank" rel="noopener">See plans</a>
    </div>

    <UiState v-else-if="!ready || loading" kind="loading" title="Loading audit logs" />
    <UiState v-else-if="error" kind="error" title="Could not load audit logs" :description="error" data-test="audit-error">
      <button type="button" @click="load">Retry</button>
    </UiState>

    <div v-else-if="unlocked" class="card" style="padding: 0">
      <UiState v-if="logs.length === 0" compact title="No audit entries yet" description="Workflow, credential, execution, and member changes will appear here." />
      <div v-else class="audit-table-wrap"><table data-test="audit-table">
        <thead>
          <tr><th>Time</th><th>Action</th><th>Resource</th><th>Details</th><th>IP</th></tr>
        </thead>
        <tbody>
          <tr v-for="log in logs" :key="log.id">
            <td class="dim" style="white-space: nowrap">{{ new Date(log.timestamp).toLocaleString() }}</td>
            <td><code>{{ log.action }}</code></td>
            <td class="dim">{{ log.resourceType ?? '-' }}</td>
            <td class="dim" style="max-width: 320px; overflow: hidden; text-overflow: ellipsis">
              {{ log.details ? JSON.stringify(log.details) : '-' }}
            </td>
            <td class="dim">{{ log.ip ?? '-' }}</td>
          </tr>
        </tbody>
      </table></div>
    </div>
  </div>
</template>

<style scoped>
.page-wrap { padding: 22px 26px 40px; width: 100%; }
.page-title { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.2px; color: var(--text-hi); }
.audit-table-wrap { overflow-x: auto; }
@media (max-width: 640px) { .page-wrap { padding: 16px; } }
</style>
