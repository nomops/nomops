<script setup lang="ts">
/**
 * Agents 平台管理页（backlog #44 M1）：建 agent、编辑 system、发布、版本回滚。
 * M1 只覆盖定义+版本;工具/记忆/定时(M2-M4)后续接入。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type AgentChannelRow, type AgentFileRow, type AgentRow, type AgentTaskRow, type CredentialView } from '../api/client.js';
import UiState from '../components/ui/UiState.vue';
import { useUiStore } from '../stores/ui.js';

const router = useRouter();
const ui = useUiStore();
const agents = ref<AgentRow[]>([]);
const selected = ref<AgentRow | null>(null);
const versions = ref<Array<{ id: string; versionNumber: number; createdAt: string }>>([]);
const newName = ref('');
const systemDraft = ref('');
const busy = ref('');
const error = ref('');
const loading = ref(true);

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

/* 分层记忆 + 证据链（#44 M3）：跨线程记住的记忆,每条可追溯到来源运行 */
type MemoryRow = Awaited<ReturnType<typeof api.agents.memory>>[number];
const memories = ref<MemoryRow[]>([]);
async function loadMemory() {
  if (!selected.value) return;
  memories.value = await api.agents.memory(selected.value.id).catch(() => []);
}

/* 定时任务（#44 M4）：任务定义 ↔ #38 调度作业 */
const tasks = ref<AgentTaskRow[]>([]);
const taskName = ref('');
const taskMessage = ref('');
const taskMode = ref<'cron' | 'interval'>('interval');
const taskCron = ref('0 9 * * *');
const taskEvery = ref(3600);
async function loadTasks() {
  if (!selected.value) return;
  tasks.value = await api.agents.tasks(selected.value.id).catch(() => []);
}
async function createTask() {
  if (!selected.value || !taskName.value.trim() || !taskMessage.value.trim()) return;
  busy.value = 'task';
  error.value = '';
  try {
    const schedule = taskMode.value === 'cron' ? { mode: 'cron', cron: taskCron.value } : { mode: 'interval', everySeconds: taskEvery.value };
    await api.agents.createTask(selected.value.id, { name: taskName.value.trim(), message: taskMessage.value.trim(), schedule });
    taskName.value = '';
    taskMessage.value = '';
    await loadTasks();
    ui.notify({ kind: 'success', title: 'Scheduled task created' });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}
async function toggleTask(t: AgentTaskRow) {
  if (!selected.value) return;
  try {
    await api.agents.updateTask(selected.value.id, t.id, { active: !t.active });
    await loadTasks();
    ui.notify({ kind: 'success', title: t.active ? 'Scheduled task paused' : 'Scheduled task resumed' });
  } catch (e) { error.value = (e as Error).message; }
}
async function removeTask(t: AgentTaskRow) {
  if (!selected.value) return;
  const confirmed = await ui.requestConfirm({ title: 'Delete scheduled task?', message: `“${t.name}” and its schedule will be removed.`, confirmLabel: 'Delete', tone: 'danger' });
  if (!confirmed) return;
  try {
    await api.agents.removeTask(selected.value.id, t.id);
    await loadTasks();
    ui.notify({ kind: 'success', title: 'Scheduled task deleted' });
  } catch (e) { error.value = (e as Error).message; }
}
const scheduleLabel = (t: AgentTaskRow) =>
  t.schedule.mode === 'cron' ? `cron ${t.schedule.cron}` : t.schedule.mode === 'once' ? `once @ ${t.schedule.fireAt}` : `every ${t.schedule.everySeconds}s`;

/* 文件 + 外部渠道（#44 M5） */
const files = ref<AgentFileRow[]>([]);
const channels = ref<AgentChannelRow[]>([]);
const channelCredentialId = ref('');
async function loadFilesChannels() {
  if (!selected.value) return;
  files.value = await api.agents.files(selected.value.id).catch(() => []);
  channels.value = await api.agents.channels(selected.value.id).catch(() => []);
}
async function uploadFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f || !selected.value) return;
  busy.value = 'file';
  error.value = '';
  try {
    const buf = await f.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await api.agents.uploadFile(selected.value.id, { fileName: f.name, mimeType: f.type || 'application/octet-stream', data: btoa(bin) });
    input.value = '';
    await loadFilesChannels();
    ui.notify({ kind: 'success', title: 'File uploaded', message: f.name });
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = '';
  }
}
async function removeFile(f: AgentFileRow) {
  if (!selected.value) return;
  const confirmed = await ui.requestConfirm({ title: 'Delete agent file?', message: `“${f.fileName}” will no longer be available to this agent.`, confirmLabel: 'Delete', tone: 'danger' });
  if (!confirmed) return;
  try {
    await api.agents.removeFile(selected.value.id, f.id);
    await loadFilesChannels();
    ui.notify({ kind: 'success', title: 'Agent file deleted' });
  } catch (e) { error.value = (e as Error).message; }
}
function downloadFile(f: AgentFileRow) {
  if (!selected.value) return;
  void fetch(api.agents.fileDownloadUrl(selected.value.id, f.id), {
    headers: { Authorization: `Bearer ${localStorage.getItem('nomops.token') ?? ''}` },
  })
    .then((r) => r.blob())
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = f.fileName;
      a.click();
      URL.revokeObjectURL(a.href);
    });
}
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const telegramCredentials = computed(() => credentials.value.filter((c) => c.type === 'telegramApi'));
async function addChannel() {
  if (!selected.value || !channelCredentialId.value) return;
  busy.value = 'channel';
  error.value = '';
  try {
    await api.agents.createChannel(selected.value.id, { type: 'telegram', credentialId: channelCredentialId.value });
    await loadFilesChannels();
    ui.notify({ kind: 'success', title: 'Telegram channel connected' });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}
async function toggleChannel(c: AgentChannelRow) {
  if (!selected.value) return;
  await api.agents.updateChannel(selected.value.id, c.id, { active: !c.active }).catch(() => undefined);
  await loadFilesChannels();
}
async function removeChannel(c: AgentChannelRow) {
  if (!selected.value) return;
  const confirmed = await ui.requestConfirm({ title: 'Disconnect channel?', message: 'Incoming messages through this channel will stop reaching the agent.', confirmLabel: 'Disconnect', tone: 'danger' });
  if (!confirmed) return;
  try {
    await api.agents.removeChannel(selected.value.id, c.id);
    await loadFilesChannels();
    ui.notify({ kind: 'success', title: 'Channel disconnected' });
  } catch (e) { error.value = (e as Error).message; }
}
async function copyWebhookUrl(c: AgentChannelRow) {
  try {
    await navigator.clipboard.writeText(c.webhookUrl);
    ui.notify({ kind: 'success', title: 'Webhook URL copied' });
  } catch { error.value = 'Could not copy the webhook URL'; }
}

async function load() {
  error.value = '';
  loading.value = true;
  try { agents.value = await api.agents.list(); }
  catch (e) { error.value = (e as Error).message; }
  finally { loading.value = false; }
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
  await loadMemory();
  await loadTasks();
  await loadFilesChannels();
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
    await loadMemory();
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
    ui.notify({ kind: 'success', title: 'Agent created', message: a.name });
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
    ui.notify({ kind: 'success', title: 'Agent settings saved' });
  } catch (e) {
    error.value = (e as Error).message;
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
    ui.notify({ kind: 'success', title: 'Agent published' });
  } catch (e) {
    error.value = (e as Error).message;
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
    ui.notify({ kind: 'success', title: 'Agent version restored' });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function remove(a: AgentRow) {
  const confirmed = await ui.requestConfirm({ title: 'Delete agent?', message: `“${a.name}” and its tasks, files, channels, and history will be permanently deleted.`, confirmLabel: 'Delete', tone: 'danger' });
  if (!confirmed) return;
  try {
    await api.agents.remove(a.id);
    if (selected.value?.id === a.id) selected.value = null;
    await load();
    ui.notify({ kind: 'success', title: 'Agent deleted', message: a.name });
  } catch (e) { error.value = (e as Error).message; }
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
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <UiState v-if="loading" compact title="Loading agents" />
      <UiState v-else-if="!agents.length && !error" compact title="No agents yet" description="Create an agent to configure its model, tools, memory, and channels." />
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

      <!-- 定时任务（#44 M4）：任务定义 ↔ #38 调度作业,历次触发聚在专属线程 -->
      <h3 class="agent-versions-title">Scheduled tasks</h3>
      <div class="agent-task-new" data-test="agent-task-new">
        <input v-model="taskName" data-test="agent-task-name" placeholder="Task name" />
        <input v-model="taskMessage" data-test="agent-task-message" placeholder="Message to send the agent" class="grow" />
        <select v-model="taskMode" data-test="agent-task-mode">
          <option value="interval">Interval</option>
          <option value="cron">Cron</option>
        </select>
        <input v-if="taskMode === 'cron'" v-model="taskCron" data-test="agent-task-cron" placeholder="0 9 * * *" class="mono" />
        <input v-else v-model.number="taskEvery" data-test="agent-task-every" type="number" min="60" class="mono" title="seconds" />
        <button class="btn primary" data-test="agent-task-create" :disabled="busy === 'task' || !taskName.trim() || !taskMessage.trim()" @click="createTask">Add</button>
      </div>
      <p v-if="!tasks.length" class="dim">No scheduled tasks.</p>
      <ul v-else class="agent-tasks" data-test="agent-tasks">
        <li v-for="t in tasks" :key="t.id" class="agent-task">
          <span class="agent-task-main">
            <b>{{ t.name }}</b>
            <span class="agent-mem-badge">{{ scheduleLabel(t) }}</span>
            <span v-if="!t.active" class="agent-mem-badge">paused</span>
          </span>
          <span class="agent-task-side">
            <span class="dim" v-if="t.lastRunAt">last run {{ fmt(t.lastRunAt) }}</span>
            <button class="link" data-test="agent-task-toggle" @click="toggleTask(t)">{{ t.active ? 'Pause' : 'Resume' }}</button>
            <button class="link" data-test="agent-task-delete" @click="removeTask(t)">Delete</button>
          </span>
        </li>
      </ul>

      <!-- 文件（#44 M5）：binaryStore 存储,上传/下载/删除 -->
      <h3 class="agent-versions-title">Files</h3>
      <label class="agent-file-upload">
        <input type="file" data-test="agent-file-input" style="display: none" @change="uploadFile" />
        <span class="btn">{{ busy === 'file' ? 'Uploading…' : 'Upload file' }}</span>
      </label>
      <p v-if="!files.length" class="dim">No files.</p>
      <ul v-else class="agent-tasks" data-test="agent-files">
        <li v-for="f in files" :key="f.id" class="agent-task">
          <span class="agent-task-main">
            <b>{{ f.fileName }}</b>
            <span class="agent-mem-badge">{{ f.mimeType }} · {{ fmtSize(f.size) }}</span>
          </span>
          <span class="agent-task-side">
            <button class="link" data-test="agent-file-download" @click="downloadFile(f)">Download</button>
            <button class="link" data-test="agent-file-delete" @click="removeFile(f)">Delete</button>
          </span>
        </li>
      </ul>

      <!-- 外部渠道（#44 M5）：Telegram bot webhook → agent 线程 → 回复回渠道 -->
      <h3 class="agent-versions-title">Channels <span class="dim" style="font-weight: 400">· Telegram</span></h3>
      <div class="agent-task-new" data-test="agent-channel-new">
        <select v-model="channelCredentialId" data-test="agent-channel-cred">
          <option value="" disabled>Telegram bot credential…</option>
          <option v-for="c in telegramCredentials" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <button class="btn primary" data-test="agent-channel-add" :disabled="busy === 'channel' || !channelCredentialId" @click="addChannel">Connect Telegram</button>
        <span v-if="!telegramCredentials.length" class="dim" style="align-self: center">Create a Telegram API credential first.</span>
      </div>
      <ul v-if="channels.length" class="agent-tasks" data-test="agent-channels">
        <li v-for="c in channels" :key="c.id" class="agent-task">
          <span class="agent-task-main">
            <b>{{ c.type }}</b>
            <span v-if="!c.active" class="agent-mem-badge">paused</span>
          </span>
          <span class="agent-task-side">
            <button class="link" data-test="agent-channel-copy" title="Copy webhook URL" @click="copyWebhookUrl(c)">Copy webhook URL</button>
            <button class="link" data-test="agent-channel-toggle" @click="toggleChannel(c)">{{ c.active ? 'Pause' : 'Resume' }}</button>
            <button class="link" data-test="agent-channel-delete" @click="removeChannel(c)">Delete</button>
          </span>
        </li>
      </ul>

      <!-- 分层记忆 + 证据链（#44 M3）：跨线程召回的记忆,每条可追溯到来源运行 -->
      <h3 class="agent-versions-title">Memory <span class="dim" style="font-weight: 400">· recalled across threads</span></h3>
      <p v-if="!memories.length" class="dim">No memories yet — chat with the agent to build them.</p>
      <ul v-else class="agent-memory" data-test="agent-memory">
        <li v-for="m in memories" :key="m.id" class="agent-mem">
          <div class="agent-mem-head">
            <span class="agent-mem-badge">{{ m.scope }}·{{ m.kind }}</span>
            <span class="agent-mem-content">{{ m.content }}</span>
          </div>
          <div class="agent-mem-obs" data-test="agent-mem-obs">
            <span class="dim">from run{{ m.observations.length > 1 ? 's' : '' }}:</span>
            <button
              v-for="o in m.observations"
              :key="o.id"
              class="link"
              data-test="agent-mem-run"
              @click="o.runId && router.push({ name: 'canvas', params: { id: (selected as AgentRow).backingWorkflowId }, query: { tab: 'executions' } })"
            >
              {{ o.runId.slice(0, 8) }} ↗
            </button>
          </div>
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
.agent-memory { list-style: none; margin: 0; padding: 0; max-width: 720px; }
.agent-mem { padding: 8px 0; border-bottom: 1px solid var(--border-color, #23232a); font-size: 13px; }
.agent-mem-head { display: flex; gap: 8px; align-items: baseline; }
.agent-mem-badge { font-size: 10.5px; padding: 2px 6px; border-radius: 10px; background: var(--color--background--light-1, rgba(127,127,127,0.12)); color: var(--text-dim, #9a9aa5); flex-shrink: 0; }
.agent-mem-content { white-space: pre-wrap; }
.agent-mem-obs { margin-top: 3px; font-size: 11.5px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.agent-task-new { display: flex; gap: 6px; flex-wrap: wrap; max-width: 900px; }
.agent-task-new input, .agent-task-new select { height: 32px; padding: 0 8px; border: 1px solid var(--border-color, #2a2a33); border-radius: 6px; background: none; color: inherit; }
.agent-task-new .grow { flex: 1; min-width: 220px; }
.agent-task-new .mono { width: 110px; font-family: var(--font-family--monospace, monospace); font-size: 12.5px; }
.agent-tasks { list-style: none; margin: 0; padding: 0; max-width: 900px; }
.agent-task { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border-color, #23232a); font-size: 13px; }
.agent-task-main { display: flex; gap: 8px; align-items: center; min-width: 0; }
.agent-task-side { display: flex; gap: 10px; align-items: center; flex-shrink: 0; font-size: 12px; }
.agent-file-upload { align-self: flex-start; cursor: pointer; }
@media (max-width: 780px) {
  .agents-page { flex-direction: column; overflow-y: auto; }
  .agents-list { width: 100%; max-height: 220px; border-right: none; border-bottom: 1px solid var(--border-color, #2a2a33); }
  .agent-detail { overflow: visible; padding: 18px 16px; }
  .agent-detail-head, .agent-model-row, .agent-task { flex-wrap: wrap; }
  .agent-model-row > * { flex: 1 1 180px; }
  .agent-task-side { flex-wrap: wrap; }
}
</style>
