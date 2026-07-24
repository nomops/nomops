<script setup lang="ts">
/**
 * Agents 平台管理页（backlog #44 M1）：建 agent、编辑 system、发布、版本回滚。
 * M1 只覆盖定义+版本;工具/记忆/定时(M2-M4)后续接入。
 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type AgentRow, type CredentialView } from '../api/client.js';

const router = useRouter();
const agents = ref<AgentRow[]>([]);
const selected = ref<AgentRow | null>(null);
const versions = ref<Array<{ id: string; versionNumber: number; createdAt: string }>>([]);
const newName = ref('');
const systemDraft = ref('');
const busy = ref('');
const error = ref('');

/* 模型配置（#44 M2） */
const provider = ref('anthropic');
const model = ref('claude-sonnet-5');
const credentialId = ref('');
const credentials = ref<CredentialView[]>([]);

/* 测试对话 + 运行（#44 M2） */
interface RunMeta { executionId: string | null; inputTokens: number; outputTokens: number; costMicros: number; model: string }
interface ChatMsg { role: string; text: string; run?: RunMeta }
const messages = ref<ChatMsg[]>([]);
const threadId = ref<string | null>(null);
const chatInput = ref('');

async function load() {
  agents.value = await api.agents.list().catch(() => []);
}
onMounted(async () => {
  await load();
  credentials.value = await api.credentials.list().catch(() => []);
});

async function select(a: AgentRow) {
  selected.value = a;
  systemDraft.value = String(a.config?.['system'] ?? '');
  provider.value = String(a.config?.['provider'] ?? 'anthropic');
  model.value = String(a.config?.['model'] ?? '');
  credentialId.value = String(a.config?.['credentialId'] ?? '');
  versions.value = await api.agents.versions(a.id).catch(() => []);
  messages.value = [];
  threadId.value = null;
}

async function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg || !selected.value || busy.value === 'chat') return;
  chatInput.value = '';
  messages.value.push({ role: 'user', text: msg });
  busy.value = 'chat';
  try {
    const res = await api.agents.chat(selected.value.id, msg, threadId.value ?? undefined);
    threadId.value = res.threadId;
    messages.value.push({
      role: 'assistant',
      text: res.error ?? res.reply,
      run: { executionId: res.executionId, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costMicros: res.costMicros, model: res.model },
    });
    if (!selected.value['backingWorkflowId']) selected.value = await api.agents.get(selected.value.id).catch(() => selected.value);
  } catch (e) {
    messages.value.push({ role: 'assistant', text: `[error] ${(e as Error).message}` });
  } finally {
    busy.value = '';
  }
}

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(6)}`;
function openExecution(execId: string) {
  const wf = selected.value?.['backingWorkflowId'] as string | null | undefined;
  if (wf) void router.push({ name: 'canvas', params: { id: wf }, query: { tab: 'executions', exec: execId } });
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
    const a = await api.agents.update(selected.value.id, {
      config: { ...selected.value.config, system: systemDraft.value, provider: provider.value, model: model.value, credentialId: credentialId.value },
    });
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
      <textarea v-model="systemDraft" class="agent-system" data-test="agent-system" rows="6" placeholder="You are a helpful assistant…" />

      <!-- 模型配置（#44 M2） -->
      <label class="agent-label">Model</label>
      <div class="agent-model-row">
        <select v-model="provider" data-test="agent-provider">
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="deepseek">DeepSeek</option>
          <option value="doubao">Doubao</option>
          <option value="qwen">Qwen</option>
          <option value="kimi">Kimi</option>
          <option value="glm">GLM</option>
        </select>
        <input v-model="model" data-test="agent-model" placeholder="model id (e.g. claude-sonnet-5)" />
        <select v-model="credentialId" data-test="agent-credential">
          <option value="">— credential —</option>
          <option v-for="c in credentials" :key="c.id" :value="c.id">{{ c.name }} ({{ c.type }})</option>
        </select>
      </div>
      <div>
        <button class="btn neutral" data-test="agent-save" :disabled="busy === 'save'" @click="saveSystem">
          {{ busy === 'save' ? 'Saving…' : 'Save' }}
        </button>
      </div>

      <!-- 测试对话（#44 M2）：触发运行 + token/成本 + 跳 execution -->
      <h3 class="agent-versions-title">Test chat</h3>
      <div class="agent-chat" data-test="agent-chat">
        <div v-for="(m, i) in messages" :key="i" class="agent-msg" :class="m.role">
          <div class="agent-bubble">{{ m.text }}</div>
          <div v-if="m.run" class="agent-run-meta" data-test="agent-run-meta">
            {{ m.run.model }} · {{ m.run.inputTokens }}→{{ m.run.outputTokens }} tok · {{ usd(m.run.costMicros) }}
            <button v-if="m.run.executionId" class="link" data-test="agent-open-exec" @click="openExecution(m.run.executionId)">open execution ↗</button>
          </div>
        </div>
        <div class="agent-chat-input">
          <input v-model="chatInput" data-test="agent-chat-input" placeholder="Message the agent…" @keyup.enter="sendChat" />
          <button class="btn primary" data-test="agent-chat-send" :disabled="busy === 'chat' || !chatInput.trim()" @click="sendChat">
            {{ busy === 'chat' ? 'Running…' : 'Send' }}
          </button>
        </div>
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
.agent-model-row { display: flex; gap: 8px; }
.agent-model-row select, .agent-model-row input { height: 32px; padding: 0 8px; border: 1px solid var(--border-color, #2a2a33); border-radius: 6px; background: none; color: inherit; }
.agent-model-row input { flex: 1; min-width: 0; }
.agent-chat { display: flex; flex-direction: column; gap: 10px; max-width: 720px; }
.agent-msg { display: flex; flex-direction: column; gap: 3px; }
.agent-msg.user { align-items: flex-end; }
.agent-bubble { max-width: 80%; padding: 8px 12px; border-radius: 12px; font-size: 13.5px; white-space: pre-wrap; }
.agent-msg.user .agent-bubble { background: var(--accent, #ff6900); color: #fff; }
.agent-msg.assistant .agent-bubble { background: var(--color--background--light-1, rgba(127,127,127,0.12)); }
.agent-run-meta { font-size: 11.5px; color: var(--text-dim, #9a9aa5); display: flex; gap: 8px; align-items: center; }
.agent-chat-input { display: flex; gap: 8px; margin-top: 4px; }
.agent-chat-input input { flex: 1; height: 34px; padding: 0 12px; border: 1px solid var(--border-color, #2a2a33); border-radius: 8px; background: none; color: inherit; }
</style>
