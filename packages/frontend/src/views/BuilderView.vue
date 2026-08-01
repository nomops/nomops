<script setup lang="ts">
/**
 * AI 建流会话（#45 M1）：左=会话列表,中=对话(多轮迭代),右=草稿预览(ReadOnlyCanvas)。
 * 多轮改流 → 草稿 revision 链 → 预览 → 回退到任一轮 → Apply 落正式 workflow。
 */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type BuilderSessionRow, type BuilderRevisionRow } from '../api/client.js';
import type { IConnections, INode } from '@nomops/workflow';
import ReadOnlyCanvas from '../components/canvas/ReadOnlyCanvas.vue';
import { useUiStore } from '../stores/ui.js';
import UiState from '../components/ui/UiState.vue';

const router = useRouter();
const route = useRoute();
const ui = useUiStore();
const sessions = ref<BuilderSessionRow[]>([]);
const selected = ref<BuilderSessionRow | null>(null);
const revisions = ref<BuilderRevisionRow[]>([]);
const preview = ref<{ id: string; nodes: INode[]; connections: IConnections } | null>(null);
const newGoal = ref('');
const chatInput = ref('');
const busy = ref('');
const error = ref('');
const listLoading = ref(true);
const listError = ref('');
const detailLoading = ref(false);

async function loadList() {
  listLoading.value = true;
  listError.value = '';
  try { sessions.value = await api.builder.list(); }
  catch (e) { listError.value = (e as Error).message; }
  finally { listLoading.value = false; }
}
onMounted(async () => {
  await loadList();
  const id = String(route.params['id'] ?? '');
  const target = sessions.value.find((session) => session.id === id);
  if (target) await select(target, false);
});

async function select(s: BuilderSessionRow, syncRoute = true) {
  detailLoading.value = true;
  error.value = '';
  try {
    const detail = await api.builder.get(s.id);
    selected.value = detail.session;
    revisions.value = detail.revisions;
    preview.value = null;
    if (syncRoute) void router.replace({ name: 'builder', params: { id: s.id } });
    const cur = detail.session.currentRevisionId;
    if (cur) await showRevision(cur);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    detailLoading.value = false;
  }
}

async function showRevision(revisionId: string) {
  if (!selected.value) return;
  try {
    const rev = await api.builder.revision(selected.value.id, revisionId);
    preview.value = { id: rev.id, nodes: rev.nodes, connections: rev.connections };
  } catch (e) { error.value = (e as Error).message; }
}

async function createSession() {
  const goal = newGoal.value.trim();
  if (!goal) return;
  error.value = '';
  try {
    const s = await api.builder.create(goal);
    newGoal.value = '';
    await loadList();
    await select(s);
    // 首条目标即作为第一轮消息发出
    chatInput.value = goal;
    await sendChat();
    ui.notify({ kind: 'success', title: 'Builder session created' });
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg || !selected.value || busy.value === 'chat') return;
  chatInput.value = '';
  busy.value = 'chat';
  error.value = '';
  try {
    const r = await api.builder.chat(selected.value.id, msg);
    await select(selected.value); // 刷新消息 + revisions + 预览到最新草稿
    if (r.revision) await showRevision(r.revision.id);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function rollback(rev: BuilderRevisionRow) {
  if (!selected.value) return;
  if (selected.value.currentRevisionId === rev.id) {
    await showRevision(rev.id);
    return;
  }
  const confirmed = await ui.requestConfirm({ title: 'Restore this revision?', message: `Restore v${rev.revision} “${rev.name}” as the active draft? Later revisions remain in history.`, confirmLabel: 'Restore' });
  if (!confirmed) return;
  busy.value = 'rollback';
  error.value = '';
  try {
    const detail = await api.builder.rollback(selected.value.id, rev.id);
    selected.value = detail.session;
    revisions.value = detail.revisions;
    await showRevision(rev.id);
    ui.notify({ kind: 'success', title: 'Builder revision restored', message: `v${rev.revision}` });
  } catch (e) { error.value = (e as Error).message; }
  finally { busy.value = ''; }
}

async function apply() {
  if (!selected.value || !preview.value) return;
  busy.value = 'apply';
  error.value = '';
  try {
    const res = await api.builder.apply(selected.value.id, preview.value.id);
    await select(selected.value);
    await loadList();
    ui.notify({ kind: 'success', title: 'Draft applied to workflow', message: res.name });
    // 跳到落地的正式工作流画布
    void router.push({ name: 'canvas', params: { id: res.workflowId } });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function discard(s: BuilderSessionRow) {
  const confirmed = await ui.requestConfirm({ title: 'Discard builder session?', message: 'The conversation and all un-applied workflow revisions will be permanently deleted.', confirmLabel: 'Discard', tone: 'danger' });
  if (!confirmed) return;
  try {
    await api.builder.discard(s.id);
    if (selected.value?.id === s.id) {
      selected.value = null;
      revisions.value = [];
      preview.value = null;
      void router.replace({ name: 'builder' });
    }
    await loadList();
    ui.notify({ kind: 'success', title: 'Builder session discarded' });
  } catch (e) { error.value = (e as Error).message; }
}

const fmt = (iso: string) => new Date(iso).toLocaleString();

watch(() => route.params['id'], async (id) => {
  const value = String(id ?? '');
  if (!value || selected.value?.id === value || listLoading.value) return;
  const target = sessions.value.find((session) => session.id === value);
  if (target) await select(target, false);
});
</script>

<template>
  <div class="builder-page" data-test="builder-view">
   <div class="builder-row">
    <aside class="builder-list">
      <div class="builder-head"><h1>AI Builder</h1></div>
      <div class="builder-new">
        <input v-model="newGoal" data-test="builder-new-goal" placeholder="Describe the workflow to build…" @keyup.enter="createSession" />
        <button class="btn primary" data-test="builder-create" :disabled="!newGoal.trim()" @click="createSession">New</button>
      </div>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <UiState v-if="listLoading" compact kind="loading" title="Loading builder sessions" />
      <UiState v-else-if="listError" compact kind="error" title="Could not load builder sessions" :description="listError">
        <button type="button" @click="loadList">Retry</button>
      </UiState>
      <ul class="builder-ul">
        <li
          v-for="s in sessions"
          :key="s.id"
          class="builder-item"
          :class="{ sel: selected?.id === s.id }"
          data-test="builder-item"
          @click="select(s)"
        >
          <span class="builder-item-title">{{ s.title }}</span>
          <span class="builder-badge" :class="s.status">{{ s.status }}</span>
          <button class="link discard" type="button" aria-label="Discard builder session" title="Discard" @click.stop="discard(s)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </li>
        <li v-if="!listLoading && !listError && !sessions.length"><UiState compact title="No builder sessions yet" description="Describe a workflow goal above to create your first AI-assisted draft." /></li>
      </ul>
    </aside>

    <UiState v-if="detailLoading" kind="loading" title="Loading builder session" description="Fetching its conversation and workflow revisions." />
    <section v-else-if="selected" class="builder-main">
      <div class="builder-chat" data-test="builder-chat">
        <div v-for="(m, i) in selected.messages" :key="i" class="builder-msg" :class="m.role">
          <div class="builder-bubble">{{ m.content }}</div>
        </div>
        <UiState v-if="!selected.messages.length" compact title="Start describing the workflow" description="Tell the builder what should trigger the workflow and what outcome you need." />
      </div>
      <div v-if="selected.status === 'active'" class="builder-input">
        <input v-model="chatInput" data-test="builder-chat-input" placeholder="Refine the workflow…" @keyup.enter="sendChat" />
        <button class="btn primary" data-test="builder-chat-send" :disabled="busy === 'chat' || !chatInput.trim()" @click="sendChat">
          {{ busy === 'chat' ? 'Thinking…' : 'Send' }}
        </button>
      </div>
      <p v-else class="dim builder-closed">Session {{ selected.status }}. Read-only.</p>
    </section>

    <section v-if="selected && !detailLoading" class="builder-preview">
      <div class="builder-preview-head">
        <h3>Draft preview</h3>
        <button
          class="btn primary"
          data-test="builder-apply"
          :disabled="!preview || selected.status !== 'active' || busy === 'apply'"
          @click="apply"
        >
          {{ busy === 'apply' ? 'Applying…' : 'Apply → Workflow' }}
        </button>
      </div>
      <div class="builder-canvas">
        <ReadOnlyCanvas v-if="preview" :nodes="preview.nodes" :connections="preview.connections" />
        <UiState v-else compact title="No draft yet" description="Send a message to generate the first workflow revision." />
      </div>
      <div class="builder-revs" data-test="builder-revisions">
        <span class="agent-label">Revisions</span>
        <button
          v-for="r in revisions"
          :key="r.id"
          class="builder-rev"
          :class="{ cur: preview?.id === r.id, active: selected.currentRevisionId === r.id }"
          data-test="builder-rev"
          :title="r.summary"
          :disabled="busy === 'rollback'"
          @click="rollback(r)"
        >
          v{{ r.revision }} · {{ r.name }}
        </button>
        <span v-if="selected.appliedWorkflowId" class="dim" style="font-size: 12px">Applied {{ fmt(selected.updatedAt) }}</span>
      </div>
    </section>
    <section v-else-if="!detailLoading" class="builder-main empty"><UiState compact title="Select or create a builder session" description="Continue an existing draft or start with a new workflow goal." /></section>
   </div>
  </div>
</template>

<style scoped>
/* 根节点会被 App.vue 注入 flex-direction:column+overflow-y:auto;真正的三栏行布局放在内层 */
.builder-page { flex: 1; min-height: 0; display: flex; }
.builder-row { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: row; overflow: hidden; }
.builder-list { width: 280px; flex-shrink: 0; border-right: 1px solid var(--border-color, #2a2a33); overflow-y: auto; }
.builder-head { padding: 18px 16px 6px; }
.builder-head h1 { margin: 0; font-size: 20px; }
.builder-new { display: flex; gap: 6px; padding: 8px 16px 12px; }
.builder-new input { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: 1px solid var(--border-color, #2a2a33); border-radius: 6px; background: none; color: inherit; }
.builder-ul { list-style: none; margin: 0; padding: 0; }
.builder-item { display: flex; align-items: center; gap: 8px; padding: 10px 16px; cursor: pointer; border-bottom: 1px solid var(--border-color, #23232a); }
.builder-item:hover { background: var(--color--background--light-1, rgba(127,127,127,0.06)); }
.builder-item.sel { background: var(--color--background--light-1, rgba(127,127,127,0.1)); }
.builder-item-title { flex: 1; font-weight: 500; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.builder-badge { font-size: 10.5px; padding: 2px 6px; border-radius: 10px; background: var(--color--background--light-1, rgba(127,127,127,0.15)); color: var(--text-dim, #9a9aa5); }
.builder-badge.active { background: rgba(76,195,138,0.15); color: #4cc38a; }
.builder-badge.applied { background: rgba(255,105,0,0.15); color: var(--accent, #ff6900); }
.discard { opacity: 0; }
.builder-item:hover .discard { opacity: 1; }
.discard svg { width: 14px; height: 14px; }
.builder-main { flex: 1; display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--border-color, #2a2a33); }
.builder-main.empty { align-items: center; justify-content: center; }
.builder-chat { flex: 1; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; }
.builder-msg { display: flex; flex-direction: column; }
.builder-msg.user { align-items: flex-end; }
.builder-bubble { max-width: 82%; padding: 8px 12px; border-radius: 12px; font-size: 13.5px; white-space: pre-wrap; }
.builder-msg.user .builder-bubble { background: var(--accent, #ff6900); color: #fff; }
.builder-msg.assistant .builder-bubble { background: var(--color--background--light-1, rgba(127,127,127,0.12)); }
.builder-input { display: flex; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--border-color, #2a2a33); }
.builder-input input { flex: 1; height: 34px; padding: 0 12px; border: 1px solid var(--border-color, #2a2a33); border-radius: 8px; background: none; color: inherit; }
.builder-closed { padding: 14px 20px; border-top: 1px solid var(--border-color, #2a2a33); }
.builder-preview { width: 42%; min-width: 360px; display: flex; flex-direction: column; }
.builder-preview-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; }
.builder-preview-head h3 { margin: 0; font-size: 15px; }
.builder-canvas { flex: 1; min-height: 0; display: flex; border-top: 1px solid var(--border-color, #2a2a33); border-bottom: 1px solid var(--border-color, #2a2a33); }
.builder-revs { padding: 10px 18px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.agent-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim, #9a9aa5); }
.builder-rev { padding: 4px 10px; border: 1px solid var(--border-color, #2a2a33); border-radius: 14px; background: none; color: inherit; font-size: 12px; cursor: pointer; }
.builder-rev:hover { border-color: var(--accent, #ff6900); }
.builder-rev.cur { border-color: var(--accent, #ff6900); color: var(--accent, #ff6900); }
.builder-rev.active::after { content: ' ●'; color: #4cc38a; }
@media (max-width: 1100px) {
  .builder-row { flex-wrap: wrap; overflow-y: auto; }
  .builder-list { width: 100%; max-height: 220px; border-right: none; border-bottom: 1px solid var(--border-color, #2a2a33); }
  .builder-main { min-height: 420px; flex: 1 1 55%; }
  .builder-preview { min-height: 420px; flex: 1 1 45%; width: auto; }
}
@media (max-width: 720px) {
  .builder-main, .builder-preview { flex: 1 0 100%; min-width: 0; }
  .builder-preview-head, .builder-input { flex-wrap: wrap; }
}
</style>
