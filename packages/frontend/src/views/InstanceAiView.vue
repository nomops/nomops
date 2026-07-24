<script setup lang="ts">
/**
 * 实例助手 · 有检查点的 AI 线程（#45 M2）：可序列化状态检查点 + 回滚续跑。
 * 左=线程列表,右=对话 + 工作态(state) + 检查点条(存/回滚)。核心演示：中断后从检查点恢复,状态一致。
 */
import { onMounted, ref } from 'vue';
import { api, type InstanceAiThreadRow, type InstanceAiMessageRow, type InstanceAiCheckpointRow } from '../api/client.js';

const threads = ref<InstanceAiThreadRow[]>([]);
const selected = ref<InstanceAiThreadRow | null>(null);
const messages = ref<InstanceAiMessageRow[]>([]);
const checkpoints = ref<InstanceAiCheckpointRow[]>([]);
const newTitle = ref('');
const chatInput = ref('');
const model = ref('');
const cpLabel = ref('');
const stateDraft = ref('{}');
const busy = ref('');
const error = ref('');

async function loadList() {
  threads.value = await api.instanceAi.list().catch(() => []);
}
onMounted(loadList);

function applyDetail(d: { thread: InstanceAiThreadRow; messages: InstanceAiMessageRow[]; checkpoints: InstanceAiCheckpointRow[] }) {
  selected.value = d.thread;
  messages.value = d.messages;
  checkpoints.value = d.checkpoints;
  stateDraft.value = JSON.stringify(d.thread.state, null, 2);
}

async function select(t: InstanceAiThreadRow) {
  const d = await api.instanceAi.get(t.id).catch(() => null);
  if (d) applyDetail(d);
}

async function createThread() {
  const title = newTitle.value.trim() || 'New thread';
  error.value = '';
  try {
    const t = await api.instanceAi.create(title);
    newTitle.value = '';
    await loadList();
    await select(t);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function refresh() {
  if (selected.value) await select(selected.value);
}

async function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg || !selected.value || busy.value === 'chat') return;
  chatInput.value = '';
  busy.value = 'chat';
  error.value = '';
  try {
    await api.instanceAi.chat(selected.value.id, msg, model.value.trim() || undefined);
    await refresh();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function saveState() {
  if (!selected.value) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stateDraft.value);
  } catch {
    error.value = 'State must be valid JSON';
    return;
  }
  busy.value = 'state';
  error.value = '';
  try {
    await api.instanceAi.setState(selected.value.id, parsed);
    await refresh();
  } finally {
    busy.value = '';
  }
}

async function saveCheckpoint() {
  if (!selected.value) return;
  busy.value = 'cp';
  try {
    await api.instanceAi.checkpoint(selected.value.id, cpLabel.value.trim());
    cpLabel.value = '';
    await refresh();
  } finally {
    busy.value = '';
  }
}

async function restore(cp: InstanceAiCheckpointRow) {
  if (!selected.value || !window.confirm(`Restore to checkpoint "${cp.label || 'v' + cp.seq}"? Messages and state after it are discarded.`)) return;
  busy.value = 'restore';
  error.value = '';
  try {
    const d = await api.instanceAi.restore(selected.value.id, cp.id);
    applyDetail(d);
    await loadList();
  } finally {
    busy.value = '';
  }
}

async function remove(t: InstanceAiThreadRow) {
  if (!window.confirm(`Delete thread "${t.title}"?`)) return;
  await api.instanceAi.remove(t.id).catch(() => undefined);
  if (selected.value?.id === t.id) selected.value = null;
  await loadList();
}
</script>

<template>
  <div class="iai-page" data-test="instance-ai-view">
   <div class="iai-row">
    <aside class="iai-list">
      <div class="iai-head"><h1>Assistant</h1></div>
      <div class="iai-new">
        <input v-model="newTitle" data-test="iai-new-title" placeholder="New thread title…" @keyup.enter="createThread" />
        <button class="btn primary" data-test="iai-create" @click="createThread">New</button>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <ul class="iai-ul">
        <li v-for="t in threads" :key="t.id" class="iai-item" :class="{ sel: selected?.id === t.id }" data-test="iai-item" @click="select(t)">
          <span class="iai-item-title">{{ t.title }}</span>
          <span class="iai-badge">{{ t.kind }}</span>
          <button class="link discard" title="Delete" @click.stop="remove(t)">✕</button>
        </li>
        <li v-if="!threads.length" class="dim" style="padding: 12px">No threads yet.</li>
      </ul>
    </aside>

    <section v-if="selected" class="iai-main">
      <div class="iai-chat" data-test="iai-messages">
        <div v-for="m in messages" :key="m.id" class="iai-msg" :class="m.role">
          <span class="iai-seq">#{{ m.seq }}</span>
          <div class="iai-bubble">{{ m.content.text ?? JSON.stringify(m.content) }}</div>
        </div>
        <p v-if="!messages.length" class="dim">No messages. Chat below or append via API.</p>
      </div>
      <div class="iai-input">
        <input v-model="chatInput" data-test="iai-chat-input" placeholder="Message the assistant…" @keyup.enter="sendChat" />
        <input v-model="model" class="iai-model" data-test="iai-model" placeholder="model (optional)" />
        <button class="btn primary" data-test="iai-chat-send" :disabled="busy === 'chat' || !chatInput.trim()" @click="sendChat">
          {{ busy === 'chat' ? '…' : 'Send' }}
        </button>
      </div>
    </section>

    <section v-if="selected" class="iai-side">
      <h3 class="iai-side-title">Working state <span class="dim" style="font-weight: 400">· serializable</span></h3>
      <textarea v-model="stateDraft" class="iai-state" data-test="iai-state" rows="6" spellcheck="false"></textarea>
      <button class="btn" data-test="iai-state-save" :disabled="busy === 'state'" @click="saveState">Save state</button>

      <h3 class="iai-side-title">Checkpoints</h3>
      <div class="iai-cp-new">
        <input v-model="cpLabel" data-test="iai-cp-label" placeholder="label (optional)" @keyup.enter="saveCheckpoint" />
        <button class="btn primary" data-test="iai-cp-save" :disabled="busy === 'cp'" @click="saveCheckpoint">Checkpoint</button>
      </div>
      <p v-if="!checkpoints.length" class="dim">No checkpoints. Save one to enable rollback.</p>
      <ul v-else class="iai-cps" data-test="iai-checkpoints">
        <li v-for="cp in checkpoints" :key="cp.id" class="iai-cp">
          <span class="iai-cp-main">
            <b>v{{ cp.seq }}</b> {{ cp.label || '—' }}
            <span class="iai-badge">{{ cp.messageCount }} msg</span>
          </span>
          <button class="link" data-test="iai-restore" :disabled="busy === 'restore'" @click="restore(cp)">Restore</button>
        </li>
      </ul>
    </section>
    <section v-else class="iai-main empty"><p class="dim">Select or create a thread.</p></section>
   </div>
  </div>
</template>

<style scoped>
.iai-page { flex: 1; min-height: 0; display: flex; }
.iai-row { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: row; overflow: hidden; }
.iai-list { width: 260px; flex-shrink: 0; border-right: 1px solid var(--border-color, #2a2a33); overflow-y: auto; }
.iai-head { padding: 18px 16px 6px; }
.iai-head h1 { margin: 0; font-size: 20px; }
.iai-new { display: flex; gap: 6px; padding: 8px 16px 12px; }
.iai-new input { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: 1px solid var(--border-color, #2a2a33); border-radius: 6px; background: none; color: inherit; }
.iai-ul { list-style: none; margin: 0; padding: 0; }
.iai-item { display: flex; align-items: center; gap: 8px; padding: 10px 16px; cursor: pointer; border-bottom: 1px solid var(--border-color, #23232a); }
.iai-item:hover { background: var(--color--background--light-1, rgba(127,127,127,0.06)); }
.iai-item.sel { background: var(--color--background--light-1, rgba(127,127,127,0.1)); }
.iai-item-title { flex: 1; font-weight: 500; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iai-badge { font-size: 10.5px; padding: 2px 6px; border-radius: 10px; background: var(--color--background--light-1, rgba(127,127,127,0.15)); color: var(--text-dim, #9a9aa5); }
.discard { opacity: 0; }
.iai-item:hover .discard { opacity: 1; }
.iai-main { flex: 1; display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--border-color, #2a2a33); }
.iai-main.empty { align-items: center; justify-content: center; }
.iai-chat { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; }
.iai-msg { display: flex; gap: 8px; align-items: baseline; }
.iai-msg.user { flex-direction: row-reverse; }
.iai-seq { font-size: 11px; color: var(--text-dim, #9a9aa5); flex-shrink: 0; }
.iai-bubble { max-width: 78%; padding: 7px 11px; border-radius: 11px; font-size: 13.5px; white-space: pre-wrap; }
.iai-msg.user .iai-bubble { background: var(--accent, #ff6900); color: #fff; }
.iai-msg.assistant .iai-bubble { background: var(--color--background--light-1, rgba(127,127,127,0.12)); }
.iai-msg.tool .iai-bubble, .iai-msg.system .iai-bubble { background: rgba(127,127,127,0.08); font-family: var(--font-family--monospace, monospace); font-size: 12.5px; }
.iai-input { display: flex; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--border-color, #2a2a33); }
.iai-input input { height: 34px; padding: 0 12px; border: 1px solid var(--border-color, #2a2a33); border-radius: 8px; background: none; color: inherit; }
.iai-input input:first-child { flex: 1; min-width: 0; }
.iai-model { width: 140px; font-size: 12.5px; }
.iai-side { width: 320px; flex-shrink: 0; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }
.iai-side-title { margin: 8px 0 2px; font-size: 14px; }
.iai-state { width: 100%; padding: 8px 10px; border: 1px solid var(--border-color, #2a2a33); border-radius: 8px; background: none; color: inherit; font-family: var(--font-family--monospace, monospace); font-size: 12.5px; resize: vertical; }
.iai-cp-new { display: flex; gap: 6px; }
.iai-cp-new input { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: 1px solid var(--border-color, #2a2a33); border-radius: 6px; background: none; color: inherit; }
.iai-cps { list-style: none; margin: 0; padding: 0; }
.iai-cp { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border-color, #23232a); font-size: 13px; }
.iai-cp-main { display: flex; gap: 6px; align-items: center; min-width: 0; }
</style>
