<script setup lang="ts">
/**
 * 实例助手 · 有检查点的 AI 线程（#45 M2）：可序列化状态检查点 + 回滚续跑。
 * 左=线程列表,右=对话 + 工作态(state) + 检查点条(存/回滚)。核心演示：中断后从检查点恢复,状态一致。
 */
import { computed, onMounted, ref } from 'vue';
import { api, type InstanceAiThreadRow, type InstanceAiMessageRow, type InstanceAiCheckpointRow, type InstanceAiActionRow, type InstanceAiRunNodeRow, type InstanceAiMemoryRow, type InstanceAiMcpRow } from '../api/client.js';

const threads = ref<InstanceAiThreadRow[]>([]);
const selected = ref<InstanceAiThreadRow | null>(null);
const messages = ref<InstanceAiMessageRow[]>([]);
const checkpoints = ref<InstanceAiCheckpointRow[]>([]);
const actions = ref<InstanceAiActionRow[]>([]);
const toolName = ref('archive_workflow');
const toolArgs = ref('{ "id": "" }');
const pendingActions = computed(() => actions.value.filter((a) => a.status === 'pending'));

/* 运行树（#45 M4） */
const runs = ref<InstanceAiRunNodeRow[]>([]);
const rootRuns = computed(() => runs.value.filter((r) => !r.parentId));
const childrenOf = (id: string) => runs.value.filter((r) => r.parentId === id);

/* 观察-反思记忆（#45 M4） */
const recallQuery = ref('');
const recallResults = ref<InstanceAiMemoryRow[]>([]);
const memContent = ref('');
const memScope = ref('instance');

/* MCP 连接（#45 M5） */
const mcpConns = ref<InstanceAiMcpRow[]>([]);
const mcpServerName = ref('');
const mcpUrl = ref('');
const mcpToken = ref('');
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

async function loadActions() {
  if (!selected.value) return;
  actions.value = await api.instanceAi.actions(selected.value.id).catch(() => []);
  runs.value = await api.instanceAi.runs(selected.value.id).catch(() => []);
  mcpConns.value = await api.instanceAi.mcpConnections().catch(() => []);
}

async function mcpConnect() {
  if (!selected.value || !mcpUrl.value.trim()) return;
  busy.value = 'mcp';
  error.value = '';
  try {
    await api.instanceAi.mcpConnect(selected.value.id, {
      serverName: mcpServerName.value.trim(),
      url: mcpUrl.value.trim(),
      ...(mcpToken.value.trim() ? { config: { token: mcpToken.value.trim() } } : {}),
    });
    mcpServerName.value = '';
    mcpUrl.value = '';
    mcpToken.value = '';
    await refresh();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}
async function mcpDisconnect(c: InstanceAiMcpRow) {
  if (!window.confirm(`Disconnect "${c.serverName}"?`)) return;
  await api.instanceAi.mcpDisconnect(c.id).catch(() => undefined);
  await refresh();
}
async function proposeMcpTool(c: InstanceAiMcpRow, tool: string) {
  if (!selected.value) return;
  busy.value = 'mcp';
  error.value = '';
  try {
    await api.instanceAi.propose(selected.value.id, `mcp/${c.id}/${tool}`, {});
    await refresh();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function doRecall() {
  if (!selected.value || !recallQuery.value.trim()) return;
  recallResults.value = await api.instanceAi.recall(recallQuery.value.trim(), selected.value.id).catch(() => []);
}
async function remember() {
  if (!selected.value || !memContent.value.trim()) return;
  busy.value = 'mem';
  error.value = '';
  try {
    await api.instanceAi.remember(selected.value.id, {
      scope: memScope.value,
      kind: memScope.value === 'instance' ? 'reflection' : 'observation',
      content: memContent.value.trim(),
    });
    memContent.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function select(t: InstanceAiThreadRow) {
  const d = await api.instanceAi.get(t.id).catch(() => null);
  if (d) applyDetail(d);
  await loadActions();
}

async function proposeTool() {
  if (!selected.value) return;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolArgs.value || '{}');
  } catch {
    error.value = 'Args must be valid JSON';
    return;
  }
  busy.value = 'tool';
  error.value = '';
  try {
    await api.instanceAi.propose(selected.value.id, toolName.value.trim(), args);
    await refresh();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function approveAction(a: InstanceAiActionRow) {
  busy.value = 'act';
  error.value = '';
  try {
    await api.instanceAi.approve(a.id);
    await refresh();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function rejectAction(a: InstanceAiActionRow) {
  busy.value = 'act';
  await api.instanceAi.reject(a.id).catch(() => undefined);
  await refresh();
  busy.value = '';
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
  if (!selected.value) return;
  const d = await api.instanceAi.get(selected.value.id).catch(() => null);
  if (d) applyDetail(d);
  await loadActions();
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

      <!-- HITL 待确认（#45 M3）：危险动作先挂 pending,人确认后才执行 -->
      <h3 class="iai-side-title">Actions <span class="dim" style="font-weight: 400">· HITL gate</span></h3>
      <div class="iai-cp-new">
        <input v-model="toolName" data-test="iai-tool-name" placeholder="tool" style="flex: 0 0 130px" />
        <input v-model="toolArgs" data-test="iai-tool-args" placeholder='{"id":"…"}' class="mono-in" />
      </div>
      <button class="btn" data-test="iai-tool-run" :disabled="busy === 'tool'" @click="proposeTool">Propose action</button>
      <p v-if="!pendingActions.length" class="dim">No actions awaiting approval.</p>
      <ul v-else class="iai-cps" data-test="iai-actions">
        <li v-for="a in pendingActions" :key="a.id" class="iai-action">
          <div class="iai-action-head">
            <b>{{ a.tool }}</b>
            <span class="iai-badge danger">needs approval</span>
          </div>
          <div class="dim iai-action-reason">{{ a.reason }}</div>
          <div class="iai-action-btns">
            <button class="btn primary" data-test="iai-approve" :disabled="busy === 'act'" @click="approveAction(a)">Approve &amp; run</button>
            <button class="btn" data-test="iai-reject" :disabled="busy === 'act'" @click="rejectAction(a)">Reject</button>
          </div>
        </li>
      </ul>

      <!-- 运行树（#45 M4）：助手动作的调用树,供「观察」 -->
      <h3 class="iai-side-title">Run tree <span class="dim" style="font-weight: 400">· observability</span></h3>
      <p v-if="!rootRuns.length" class="dim">No runs yet. Execute a tool to see its call tree.</p>
      <ul v-else class="iai-runs" data-test="iai-runs">
        <li v-for="r in rootRuns" :key="r.id">
          <div class="iai-run">
            <span class="iai-run-dot" :class="r.status" />
            <b>{{ r.label }}</b>
            <span class="iai-badge">{{ r.status }}</span>
          </div>
          <div v-for="c in childrenOf(r.id)" :key="c.id" class="iai-run child">
            <span class="iai-run-dot" :class="c.status" />
            {{ c.label }}
            <span class="iai-badge">{{ c.status }}</span>
          </div>
        </li>
      </ul>

      <!-- 观察-反思记忆（#45 M4）：embedding 跨线程召回 -->
      <h3 class="iai-side-title">Memory <span class="dim" style="font-weight: 400">· cross-thread</span></h3>
      <textarea v-model="memContent" class="iai-state" data-test="iai-mem-content" rows="2" placeholder="Record an observation / reflection…"></textarea>
      <div class="iai-cp-new">
        <select v-model="memScope" data-test="iai-mem-scope" style="flex: 0 0 110px; height: 32px; border: 1px solid var(--border-color, #2a2a33); border-radius: 6px; background: none; color: inherit">
          <option value="instance">instance</option>
          <option value="thread">thread</option>
        </select>
        <button class="btn primary" data-test="iai-mem-save" :disabled="busy === 'mem' || !memContent.trim()" @click="remember">Remember</button>
      </div>
      <div class="iai-cp-new" style="margin-top: 6px">
        <input v-model="recallQuery" data-test="iai-recall-q" placeholder="Recall relevant memory…" @keyup.enter="doRecall" />
        <button class="btn" data-test="iai-recall" @click="doRecall">Recall</button>
      </div>
      <ul v-if="recallResults.length" class="iai-cps" data-test="iai-recall-results">
        <li v-for="m in recallResults" :key="m.id" class="iai-mem-hit">
          <span class="iai-badge">{{ m.scope }}·{{ m.kind }}</span>
          <span>{{ m.content }}</span>
        </li>
      </ul>

      <!-- MCP 连接（#45 M5）：挂 MCP server → 其工具进工具集(经 HITL gate) -->
      <h3 class="iai-side-title">MCP servers <span class="dim" style="font-weight: 400">· tools</span></h3>
      <div class="iai-cp-new">
        <input v-model="mcpServerName" data-test="iai-mcp-name" placeholder="name" style="flex: 0 0 90px" />
        <input v-model="mcpUrl" data-test="iai-mcp-url" placeholder="MCP server URL" class="mono-in" />
      </div>
      <div class="iai-cp-new" style="margin-top: 6px">
        <input v-model="mcpToken" data-test="iai-mcp-token" placeholder="bearer token (optional)" class="mono-in" type="password" />
        <button class="btn primary" data-test="iai-mcp-connect" :disabled="busy === 'mcp' || !mcpUrl.trim()" @click="mcpConnect">Connect</button>
      </div>
      <p v-if="!mcpConns.length" class="dim">No MCP servers connected.</p>
      <ul v-else class="iai-cps" data-test="iai-mcp-conns">
        <li v-for="c in mcpConns" :key="c.id" class="iai-mcp">
          <div class="iai-mcp-head">
            <b>{{ c.serverName }}</b>
            <span class="iai-badge">{{ c.status }}</span>
            <button class="link" data-test="iai-mcp-disconnect" style="margin-left: auto" @click="mcpDisconnect(c)">✕</button>
          </div>
          <div class="iai-mcp-tools">
            <button v-for="t in c.tools" :key="t.name" class="iai-tool-chip" data-test="iai-mcp-tool" :title="t.description" :disabled="busy === 'mcp'" @click="proposeMcpTool(c, t.name)">
              {{ t.name }}
            </button>
          </div>
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
.iai-cp-new .mono-in { flex: 1; min-width: 0; font-family: var(--font-family--monospace, monospace); font-size: 12px; }
.iai-badge.danger { background: rgba(232, 89, 89, 0.16); color: #e85959; }
.iai-action { padding: 9px 0; border-bottom: 1px solid var(--border-color, #23232a); display: flex; flex-direction: column; gap: 5px; }
.iai-action-head { display: flex; gap: 8px; align-items: center; }
.iai-action-reason { font-size: 12px; }
.iai-action-btns { display: flex; gap: 6px; }
.iai-runs { list-style: none; margin: 0; padding: 0; }
.iai-run { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 12.5px; }
.iai-run.child { padding-left: 18px; font-size: 12px; color: var(--text-dim, #9a9aa5); }
.iai-run-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--text-dim, #9a9aa5); }
.iai-run-dot.success { background: #4cc38a; }
.iai-run-dot.error { background: #e85959; }
.iai-run-dot.running { background: var(--accent, #ff6900); }
.iai-mem-hit { display: flex; gap: 6px; align-items: baseline; padding: 6px 0; border-bottom: 1px solid var(--border-color, #23232a); font-size: 12.5px; }
.iai-mcp { padding: 8px 0; border-bottom: 1px solid var(--border-color, #23232a); }
.iai-mcp-head { display: flex; gap: 8px; align-items: center; font-size: 13px; }
.iai-mcp-tools { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 5px; }
.iai-tool-chip { padding: 3px 9px; border: 1px solid var(--border-color, #2a2a33); border-radius: 12px; background: none; color: inherit; font-size: 11.5px; cursor: pointer; font-family: var(--font-family--monospace, monospace); }
.iai-tool-chip:hover { border-color: var(--accent, #ff6900); color: var(--accent, #ff6900); }
</style>
