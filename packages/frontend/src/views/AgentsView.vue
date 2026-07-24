<script setup lang="ts">
/**
 * Agents 平台管理页（backlog #44 M1）：建 agent、编辑 system、发布、版本回滚。
 * M1 只覆盖定义+版本;工具/记忆/定时(M2-M4)后续接入。
 */
import { onMounted, ref } from 'vue';
import { api, type AgentRow } from '../api/client.js';

const agents = ref<AgentRow[]>([]);
const selected = ref<AgentRow | null>(null);
const versions = ref<Array<{ id: string; versionNumber: number; createdAt: string }>>([]);
const newName = ref('');
const systemDraft = ref('');
const busy = ref('');
const error = ref('');

async function load() {
  agents.value = await api.agents.list().catch(() => []);
}
onMounted(load);

async function select(a: AgentRow) {
  selected.value = a;
  systemDraft.value = String(a.config?.['system'] ?? '');
  versions.value = await api.agents.versions(a.id).catch(() => []);
}

async function create() {
  const name = newName.value.trim();
  if (!name) return;
  error.value = '';
  try {
    const a = await api.agents.create({ name, config: { system: '' } });
    newName.value = '';
    await load();
    await select(a);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function saveSystem() {
  if (!selected.value) return;
  busy.value = 'save';
  try {
    const a = await api.agents.update(selected.value.id, { config: { ...selected.value.config, system: systemDraft.value } });
    selected.value = a;
    await load();
  } finally {
    busy.value = '';
  }
}

async function publish() {
  if (!selected.value) return;
  busy.value = 'publish';
  try {
    await api.agents.publish(selected.value.id);
    await select(selected.value);
    await load();
  } finally {
    busy.value = '';
  }
}

async function rollback(versionId: string) {
  if (!selected.value) return;
  busy.value = 'rollback';
  try {
    await api.agents.restore(selected.value.id, versionId);
    const fresh = await api.agents.get(selected.value.id);
    await select(fresh);
    await load();
  } finally {
    busy.value = '';
  }
}

async function remove(a: AgentRow) {
  if (!window.confirm(`Delete agent "${a.name}"?`)) return;
  await api.agents.remove(a.id).catch(() => undefined);
  if (selected.value?.id === a.id) selected.value = null;
  await load();
}

const fmt = (iso: string) => new Date(iso).toLocaleString();
</script>

<template>
  <div class="agents-page" data-test="agents-view">
    <aside class="agents-list">
      <div class="agents-head">
        <h1>Agents</h1>
      </div>
      <div class="agents-new">
        <input v-model="newName" placeholder="New agent name" data-test="agent-new-name" @keyup.enter="create" />
        <button class="btn primary" data-test="agent-create" :disabled="!newName.trim()" @click="create">Create</button>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <p v-if="!agents.length" class="dim" style="padding: 12px">No agents yet.</p>
      <ul class="agents-ul">
        <li
          v-for="a in agents"
          :key="a.id"
          class="agent-item"
          :class="{ sel: selected?.id === a.id }"
          data-test="agent-item"
          @click="select(a)"
        >
          <div class="agent-item-name">{{ a.name }}</div>
          <span v-if="a.publishedVersionId" class="agent-badge" title="Published">published</span>
        </li>
      </ul>
    </aside>

    <section v-if="selected" class="agent-detail" data-test="agent-detail">
      <header class="agent-detail-head">
        <h2>{{ selected.name }}</h2>
        <span style="flex: 1" />
        <button class="btn secondary" data-test="agent-delete" @click="remove(selected)">Delete</button>
        <button class="btn primary" data-test="agent-publish" :disabled="busy === 'publish'" @click="publish">
          {{ busy === 'publish' ? 'Publishing…' : 'Publish' }}
        </button>
      </header>

      <label class="agent-label">System prompt</label>
      <textarea v-model="systemDraft" class="agent-system" data-test="agent-system" rows="8" placeholder="You are a helpful assistant…" />
      <div>
        <button class="btn neutral" data-test="agent-save" :disabled="busy === 'save'" @click="saveSystem">
          {{ busy === 'save' ? 'Saving…' : 'Save' }}
        </button>
      </div>

      <h3 class="agent-versions-title">Version history</h3>
      <p v-if="!versions.length" class="dim">Not published yet.</p>
      <ul v-else class="agent-versions" data-test="agent-versions">
        <li v-for="v in versions" :key="v.id" class="agent-version">
          <span><b>v{{ v.versionNumber }}</b> · {{ fmt(v.createdAt) }}</span>
          <button class="link" data-test="agent-rollback" :disabled="busy === 'rollback'" @click="rollback(v.id)">Roll back to this</button>
        </li>
      </ul>
    </section>
    <section v-else class="agent-detail empty"><p class="dim">Select or create an agent.</p></section>
  </div>
</template>

<style scoped>
.agents-page { display: flex; height: 100%; min-height: 0; }
.agents-list { width: 300px; flex-shrink: 0; border-right: 1px solid var(--border-color, #2a2a33); overflow-y: auto; }
.agents-head { padding: 18px 16px 6px; }
.agents-head h1 { margin: 0; font-size: 20px; }
.agents-new { display: flex; gap: 6px; padding: 8px 16px 12px; }
.agents-new input { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: 1px solid var(--border-color, #2a2a33); border-radius: 6px; background: none; color: inherit; }
.agents-ul { list-style: none; margin: 0; padding: 0; }
.agent-item { display: flex; align-items: center; gap: 8px; padding: 10px 16px; cursor: pointer; border-bottom: 1px solid var(--border-color, #23232a); }
.agent-item:hover { background: var(--color--background--light-1, rgba(127,127,127,0.06)); }
.agent-item.sel { background: var(--color--background--light-1, rgba(127,127,127,0.1)); }
.agent-item-name { flex: 1; font-weight: 500; }
.agent-badge { font-size: 10.5px; padding: 2px 6px; border-radius: 10px; background: var(--color--background--light-1, rgba(76,195,138,0.15)); color: #4cc38a; }
.agent-detail { flex: 1; padding: 22px 28px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.agent-detail.empty { align-items: center; justify-content: center; }
.agent-detail-head { display: flex; align-items: center; gap: 10px; }
.agent-detail-head h2 { margin: 0; }
.agent-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim, #9a9aa5); }
.agent-system { width: 100%; padding: 10px 12px; border: 1px solid var(--border-color, #2a2a33); border-radius: 8px; background: none; color: inherit; font-family: var(--font-family--monospace, monospace); font-size: 13px; resize: vertical; }
.agent-versions-title { margin: 10px 0 4px; font-size: 15px; }
.agent-versions { list-style: none; margin: 0; padding: 0; }
.agent-version { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border-color, #23232a); font-size: 13px; }
</style>
