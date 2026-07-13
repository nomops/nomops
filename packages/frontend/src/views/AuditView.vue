<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type AuditLogRow } from '../api/client.js';
import { useProjectsStore } from '../stores/projects.js';

const projects = useProjectsStore();
const logs = ref<AuditLogRow[]>([]);
const error = ref('');

onMounted(async () => {
  await projects.fetch();
  await load();
});

async function load() {
  error.value = '';
  const current = projects.current;
  if (!current) return;
  try {
    logs.value = await api.auditLogs.list(current.id);
  } catch (e) {
    error.value = (e as Error).message; // 非 owner / 社区版 → 403
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
      <button @click="load">Refresh</button>
    </div>

    <p v-if="error" class="error-text" data-test="audit-error">{{ error }}</p>

    <div v-else class="card" style="padding: 0">
      <p v-if="logs.length === 0" class="dim" style="padding: 20px">No entries yet.</p>
      <table v-else data-test="audit-table">
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
      </table>
    </div>
  </div>
</template>

<style scoped>
.page-wrap { padding: 22px 26px 40px; width: 100%; }
.page-title { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.2px; color: var(--text-hi); }
</style>
