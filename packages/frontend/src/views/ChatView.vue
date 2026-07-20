<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type WorkflowRow } from '../api/client.js';
import SettingsMenu from '../components/shell/SettingsMenu.vue';

/**
 * Chat 页（D1，完全对标 n8n Chat）：整页接管布局。
 * 专属侧栏：New chat / Personal agents / Workflow agents / 按日期分组的会话历史 / Settings。
 * 主区：顶栏 Select model 下拉（搜索 + Personal agents / Workflow agents / Anthropic 模型），
 * 未选模型时输入禁用并显示提示条；选中后正常对话。
 * 真实链路：模型 → /api/assistant/chat(model)；个人 agent → 同端点 + system；
 * 工作流 agent（Chat Trigger）→ /api/workflows/:id/chat。
 */
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  workflow?: { name: string; nodes: unknown[]; connections: unknown } | null;
  error?: boolean;
}
interface PersonalAgent {
  id: string;
  name: string;
  system: string;
}
/** 会话目标：模型 / 个人 agent / 工作流 agent（同 n8n Select model 三类）。 */
interface ChatTarget {
  type: 'model' | 'agent' | 'workflow';
  label: string;
  model?: string;
  agentId?: string;
  workflowId?: string;
}
interface ChatSession {
  id: string;
  title: string;
  target: ChatTarget | null;
  wfSessionId?: string;
  messages: Msg[];
  createdAt: number;
}

const router = useRouter();

/* ── 持久化 ── */
const SESSIONS_KEY = 'nomops.chat.sessions.v2';
const AGENTS_KEY = 'nomops.chat.agents.v1';
const loadJson = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T;
  } catch {
    return fallback;
  }
};
const sessions = ref<ChatSession[]>(loadJson(SESSIONS_KEY, []));
const agents = ref<PersonalAgent[]>(loadJson(AGENTS_KEY, []));
const persistSessions = () => localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.value));
const persistAgents = () => localStorage.setItem(AGENTS_KEY, JSON.stringify(agents.value));

/* ── 视图 ── */
type View = 'chat' | 'personal-agents' | 'workflow-agents';
const view = ref<View>('chat');
const activeSessionId = ref<string | null>(null);
const activeSession = computed(() => sessions.value.find((s) => s.id === activeSessionId.value) ?? null);
const input = ref('');
const busy = ref(false);
const listEl = ref<HTMLElement>();

/* ── Workflow agents（含 Chat Trigger 的工作流） ── */
const workflowAgents = ref<WorkflowRow[]>([]);
async function loadWorkflowAgents() {
  const all = await api.workflows.list().catch(() => [] as WorkflowRow[]);
  workflowAgents.value = all.filter((w) => w.nodes.some((n) => n.type === 'nomops.chatTrigger' && !n.disabled));
}
onMounted(loadWorkflowAgents);

/* ── Chat providers（服务端注册表：Anthropic / DeepSeek / 豆包 / 千问 / Kimi / GLM） ── */
const providers = ref<Array<{ id: string; label: string; credentialType: string; models: string[]; enabled: boolean }>>([]);
onMounted(async () => {
  providers.value = await api.assistant.providers().catch(() => []);
});

/* ── 会话 ── */
function newChat() {
  const session: ChatSession = {
    id: crypto.randomUUID().slice(0, 8),
    title: 'New Chat',
    target: null,
    messages: [],
    createdAt: Date.now(),
  };
  sessions.value.unshift(session);
  persistSessions();
  activeSessionId.value = session.id;
  view.value = 'chat';
}
function openSession(id: string) {
  activeSessionId.value = id;
  view.value = 'chat';
  void scrollDown();
}
function deleteSession(id: string) {
  sessions.value = sessions.value.filter((s) => s.id !== id);
  persistSessions();
  if (activeSessionId.value === id) activeSessionId.value = null;
}

/** 会话历史按日期分组（Today / Yesterday / Previous，同 n8n）。 */
const groupedSessions = computed(() => {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const groups: Array<{ label: string; items: ChatSession[] }> = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous', items: [] },
  ];
  for (const s of sessions.value) {
    if (s.createdAt >= today) groups[0]!.items.push(s);
    else if (s.createdAt >= yesterday) groups[1]!.items.push(s);
    else groups[2]!.items.push(s);
  }
  return groups.filter((g) => g.items.length > 0);
});

/* ── Select model 下拉（同 n8n：搜索 + Personal agents / Workflow agents / Anthropic） ── */
const modelPickerOpen = ref(false);
const settingsFlyoutOpen = ref(false);
const modelSearch = ref('');
interface PickerItem {
  group: string;
  label: string;
  target: ChatTarget;
}
const pickerItems = computed<PickerItem[]>(() => {
  const items: PickerItem[] = [
    ...agents.value.map((a) => ({
      group: 'Personal agents',
      label: a.name,
      target: { type: 'agent' as const, label: a.name, agentId: a.id },
    })),
    ...workflowAgents.value.map((w) => ({
      group: 'Workflow agents',
      label: w.name,
      target: { type: 'workflow' as const, label: w.name, workflowId: w.id },
    })),
    ...providers.value.filter((p) => p.enabled).flatMap((p) =>
      p.models.map((m) => ({
        group: p.label,
        label: m,
        target: { type: 'model' as const, label: m, model: m },
      })),
    ),
  ];
  const q = modelSearch.value.trim().toLowerCase();
  return q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q)) : items;
});
const pickerGroups = computed(() => {
  const order: string[] = [];
  const byGroup = new Map<string, PickerItem[]>();
  for (const item of pickerItems.value) {
    if (!byGroup.has(item.group)) {
      byGroup.set(item.group, []);
      order.push(item.group);
    }
    byGroup.get(item.group)!.push(item);
  }
  return order.map((g) => ({ group: g, items: byGroup.get(g)! }));
});
/* D157 对标 n8n:provider → models 两级级联。
   Agents 两组仍是直选;每个 provider 一行带 ›,悬停/点击展开其 models 子菜单。
   搜索时退化为扁平列表(跨 provider 搜 model),同 n8n。 */
const isSearching = computed(() => modelSearch.value.trim().length > 0);
const agentGroups = computed(() =>
  pickerGroups.value.filter((g) => g.group === 'Personal agents' || g.group === 'Workflow agents'),
);
const providerRows = computed(() =>
  providers.value
    .filter((p) => p.enabled)
    .map((p) => ({
      label: p.label,
      models: p.models.map((m) => ({ group: p.label, label: m, target: { type: 'model' as const, label: m, model: m } })),
    }))
    .filter((p) => p.models.length > 0),
);
const expandedProvider = ref<string | null>(null);

function pickTarget(item: PickerItem) {
  const session = activeSession.value ?? (newChat(), activeSession.value!);
  session.target = item.target;
  if (item.target.type === 'workflow' && !session.wfSessionId) {
    session.wfSessionId = crypto.randomUUID().slice(0, 8);
  }
  persistSessions();
  modelPickerOpen.value = false;
  modelSearch.value = '';
}
function onDocClick() {
  modelPickerOpen.value = false;
  settingsFlyoutOpen.value = false;
}
onMounted(() => window.addEventListener('click', onDocClick));
onUnmounted(() => window.removeEventListener('click', onDocClick));

async function scrollDown() {
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
}

/* ── 发送 ── */
const canSend = computed(() => Boolean(activeSession.value?.target) && !busy.value);
async function send() {
  const content = input.value.trim();
  const session = activeSession.value;
  if (!content || !session?.target || busy.value) return;
  if (session.messages.length === 0) {
    session.title = content.length > 40 ? content.slice(0, 40) + '…' : content;
  }
  input.value = '';
  session.messages.push({ role: 'user', content });
  persistSessions();
  busy.value = true;
  void scrollDown();
  try {
    const target = session.target;
    if (target.type === 'workflow' && target.workflowId) {
      const res = await api.workflows.chat(target.workflowId, content, session.wfSessionId ?? 'default');
      session.messages.push({ role: 'assistant', content: res.error ?? res.reply, error: Boolean(res.error) });
    } else {
      const history = session.messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
      const system = target.type === 'agent' ? agents.value.find((a) => a.id === target.agentId)?.system : undefined;
      const res = await api.assistant.chat(history, {
        ...(system ? { system } : {}),
        ...(target.type === 'model' && target.model ? { model: target.model } : {}),
      });
      session.messages.push({ role: 'assistant', content: res.reply, workflow: res.workflow });
    }
  } catch (e) {
    session.messages.push({ role: 'assistant', content: (e as Error).message, error: true });
  } finally {
    persistSessions();
    busy.value = false;
    void scrollDown();
  }
}

async function applyWorkflow(m: Msg) {
  if (!m.workflow) return;
  const wf = await api.workflows.create({
    name: m.workflow.name,
    nodes: m.workflow.nodes as never,
    connections: m.workflow.connections as never,
  });
  void router.push(`/workflow/${wf.id}`);
}
function displayText(m: Msg): string {
  return m.content.replace(/```json[\s\S]*?```/g, '').trim();
}

/* ── Personal agents 管理 ── */
const agentDraftName = ref('');
const agentDraftSystem = ref('');
const agentFormOpen = ref(false);
function saveAgent() {
  const name = agentDraftName.value.trim();
  const system = agentDraftSystem.value.trim();
  if (!name || !system) return;
  agents.value.push({ id: crypto.randomUUID().slice(0, 8), name, system });
  persistAgents();
  agentDraftName.value = '';
  agentDraftSystem.value = '';
  agentFormOpen.value = false;
}
function deleteAgent(id: string) {
  agents.value = agents.value.filter((a) => a.id !== id);
  persistAgents();
}
function chatWith(target: ChatTarget) {
  newChat();
  pickTarget({ group: '', label: target.label, target });
}
</script>

<template>
  <div class="chatpage" data-test="chat-page">
    <!-- 专属侧栏（整页接管，对标 n8n Chat） -->
    <aside class="chat-side" data-test="chat-side">
      <div class="side-top">
        <button class="side-logo" title="Back to nomops" data-test="chat-logo" @click="router.push({ name: 'overview' })">
          <svg viewBox="0 0 32 20" fill="none" class="side-logo-mark"><path d="M2 10c3-6 6-6 9 0s6 6 9 0 6-6 9 0" stroke="url(#chg)" stroke-width="3" stroke-linecap="round" /><defs><linearGradient id="chg" x1="0" y1="0" x2="32" y2="0"><stop stop-color="#4c9df0" /><stop offset="1" stop-color="#8b5cf6" /></linearGradient></defs></svg>
          nomops
        </button>
      </div>

      <button class="side-item strong" data-test="chat-new" @click="newChat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        New chat
      </button>
      <button class="side-item" :class="{ active: view === 'personal-agents' }" data-test="chat-personal-agents" @click="view = 'personal-agents'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" /></svg>
        Personal agents
      </button>
      <button class="side-item" :class="{ active: view === 'workflow-agents' }" data-test="chat-workflow-agents" @click="view = 'workflow-agents'; void loadWorkflowAgents()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
        Workflow agents
      </button>

      <div class="side-history" data-test="chat-history">
        <template v-for="g in groupedSessions" :key="g.label">
          <div class="side-group dim">{{ g.label }}</div>
          <div
            v-for="s in g.items"
            :key="s.id"
            class="side-chat-row"
            :class="{ active: s.id === activeSessionId && view === 'chat' }"
          >
            <button class="side-chat-title" :data-test-session="s.id" @click="openSession(s.id)">{{ s.title }}</button>
            <button class="side-chat-del" title="Delete chat" @click="deleteSession(s.id)">×</button>
          </div>
        </template>
      </div>

      <div class="chat-settings-anchor" @click.stop>
        <button class="side-item" data-test="chat-settings" @click="settingsFlyoutOpen = !settingsFlyoutOpen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-1.7-1L15 3H11l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.3-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5z" /></svg>
          Settings
          <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6" /></svg>
        </button>
        <div v-if="settingsFlyoutOpen" class="chat-settings-pop">
          <SettingsMenu @close="settingsFlyoutOpen = false" />
        </div>
      </div>
    </aside>

    <!-- 主区 -->
    <div class="chat-main">
      <!-- Personal agents 页(对标 n8n:标题 + 副标 + 右上 New Agent 橙钮 + 空态) -->
      <div v-if="view === 'personal-agents'" class="agents-page" data-test="personal-agents-page">
        <div class="agents-head">
          <div>
            <h1>Personal Agents</h1>
            <!-- D158 副标 -->
            <p class="dim sub">Create and manage custom AI agents with specific instructions and behaviors</p>
          </div>
          <!-- D159 右上 New Agent 橙钮 -->
          <button class="btn primary" data-test="agent-new" @click="agentFormOpen = true">＋ New Agent</button>
        </div>
        <!-- D160 空态 -->
        <p v-if="agents.length === 0 && !agentFormOpen" class="agents-empty dim" data-test="agents-empty">
          No personal agents available. Create your first custom agent to get started.
        </p>
        <div class="agent-grid">
          <div v-for="a in agents" :key="a.id" class="agent-card" :data-test-agent="a.id">
            <div class="agent-head">
              <strong>{{ a.name }}</strong>
              <button class="side-chat-del show" title="Delete agent" @click="deleteAgent(a.id)">×</button>
            </div>
            <p class="agent-system dim">{{ a.system }}</p>
            <button
              class="btn primary btn-xs"
              :data-test-agent-chat="a.id"
              @click="chatWith({ type: 'agent', label: a.name, agentId: a.id })"
            >
              Start chat
            </button>
          </div>
          <div v-if="agentFormOpen" class="agent-card" data-test="agent-form">
            <input v-model="agentDraftName" data-test="agent-name" placeholder="Agent name" />
            <textarea v-model="agentDraftSystem" data-test="agent-system" rows="4" placeholder="System prompt — who is this agent and how should it answer?" />
            <div style="display: flex; gap: 8px">
              <button class="btn primary btn-xs" data-test="agent-save" :disabled="!agentDraftName.trim() || !agentDraftSystem.trim()" @click="saveAgent">Save</button>
              <button class="btn neutral btn-xs" @click="agentFormOpen = false">Cancel</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Workflow agents 页（文案对标 n8n） -->
      <div v-else-if="view === 'workflow-agents'" class="agents-page" data-test="workflow-agents-page">
        <h1>Workflow Agents</h1>
        <p class="dim sub">Browse and use AI agents built with nomops workflows</p>
        <div class="agent-grid">
          <div v-for="w in workflowAgents" :key="w.id" class="agent-card" :data-test-wf-agent="w.id">
            <div class="agent-head"><strong>{{ w.name }}</strong></div>
            <p class="agent-system dim">{{ w.description || 'Workflow with a Chat Trigger — messages run the workflow.' }}</p>
            <button
              class="btn primary btn-xs"
              :data-test-wf-agent-chat="w.id"
              @click="chatWith({ type: 'workflow', label: w.name, workflowId: w.id })"
            >
              Start chat
            </button>
          </div>
          <p v-if="workflowAgents.length === 0" class="dim" style="grid-column: 1/-1; text-align: center; padding: 30px">
            No workflows with a Chat Trigger yet. Add a “Chat Trigger” node to a workflow to chat with it here.
          </p>
        </div>
      </div>

      <!-- 会话区（对标 n8n：顶栏 Select model；未选模型禁输入） -->
      <template v-else>
        <!-- 顶栏：Select model 下拉 -->
        <div class="model-bar" @click.stop>
          <button class="model-btn" data-test="select-model" @click="modelPickerOpen = !modelPickerOpen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="i15"><path d="M20 14a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" /></svg>
            {{ activeSession?.target?.label ?? 'Select model' }}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="i14"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <div v-if="modelPickerOpen" class="model-pop" data-test="model-pop">
            <input v-model="modelSearch" class="model-search" data-test="model-search" placeholder="Search..." autocomplete="off" />
            <!-- D157:搜索时扁平;否则 Agents 直选 + provider 两级级联 -->
            <div class="model-list">
              <template v-if="isSearching">
                <template v-for="g in pickerGroups" :key="g.group">
                  <div class="model-group dim">{{ g.group }}</div>
                  <button
                    v-for="item in g.items"
                    :key="g.group + item.label"
                    class="model-item"
                    :data-test-model="item.label"
                    @click="pickTarget(item)"
                  >
                    {{ item.label }}
                  </button>
                </template>
              </template>
              <template v-else>
                <template v-for="g in agentGroups" :key="g.group">
                  <div class="model-group dim">{{ g.group }}</div>
                  <button
                    v-for="item in g.items"
                    :key="g.group + item.label"
                    class="model-item"
                    :data-test-model="item.label"
                    @click="pickTarget(item)"
                  >
                    {{ item.label }}
                  </button>
                </template>
                <div v-if="providerRows.length" class="model-group dim">Models</div>
                <div
                  v-for="p in providerRows"
                  :key="p.label"
                  class="model-provider-row"
                  :data-test-provider="p.label"
                  @mouseenter="expandedProvider = p.label"
                  @mouseleave="expandedProvider = null"
                >
                  <button class="model-item provider" @click="expandedProvider = expandedProvider === p.label ? null : p.label">
                    {{ p.label }}<span class="prov-chev">›</span>
                  </button>
                  <div v-if="expandedProvider === p.label" class="model-submenu" :data-test-submenu="p.label">
                    <button
                      v-for="m in p.models"
                      :key="m.label"
                      class="model-item"
                      :data-test-model="m.label"
                      @click="pickTarget(m)"
                    >
                      {{ m.label }}
                    </button>
                  </div>
                </div>
              </template>
              <p v-if="pickerItems.length === 0" class="dim" style="padding: 12px; font-size: 12px; text-align: center">No matches</p>
            </div>
          </div>
        </div>

        <!-- 消息区 -->
        <div ref="listEl" class="chat-scroll">
          <div v-if="!activeSession || activeSession.messages.length === 0" class="chat-empty">
            <p class="chat-empty-title" data-test="chat-empty">
              {{ activeSession?.target ? 'Send a message to start chatting' : 'Select a model to start chatting' }}
            </p>
          </div>
          <div v-else class="chat-inner">
            <div v-for="(m, i) in activeSession.messages" :key="i" class="msg" :class="m.role">
              <div class="bubble" :class="{ err: m.error }">
                <p class="bubble-text">{{ displayText(m) }}</p>
                <button v-if="m.workflow" class="apply" :data-test-apply="i" @click="applyWorkflow(m)">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" /></svg>
                  Add to canvas — {{ m.workflow.name }} ({{ m.workflow.nodes.length }} nodes)
                </button>
              </div>
            </div>
            <div v-if="busy" class="msg assistant"><div class="bubble thinking">Thinking…</div></div>
          </div>
        </div>

        <!-- 底部输入区（对标 n8n：未选模型显示提示条 + 禁用输入） -->
        <div class="composer-dock">
          <div v-if="!activeSession?.target" class="model-hint" data-test="model-hint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" class="i14"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M12 11v5" /></svg>
            Please
            <a href="#" data-test="model-hint-link" @click.prevent.stop="modelPickerOpen = true">select a model</a>
            to start a conversation
          </div>
          <!-- D156 对标 n8n:输入区 + 底栏(左 +Tools / 右 橙色发送) -->
          <div class="composer" :class="{ disabled: !activeSession?.target }">
            <textarea
              v-model="input"
              data-test="chat-input"
              rows="1"
              :placeholder="activeSession?.target ? 'Type a message…' : 'Select a model'"
              :disabled="!activeSession?.target"
              @keydown.enter.exact.prevent="send()"
            />
            <div class="composer-bar">
              <button class="composer-tools" data-test="chat-tools" :disabled="!activeSession?.target">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
                Tools
              </button>
              <span class="spacer" style="flex: 1" />
              <button class="send" data-test="chat-send" :disabled="!canSend || !input.trim()" @click="send()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.chatpage { flex: 1; display: flex; min-height: 0; }

/* ── 专属侧栏 ── */
.chat-side {
  width: 200px; flex: none; border-right: 1px solid var(--border);
  background: var(--bg-panel, #232329);
  display: flex; flex-direction: column; padding: 8px; overflow: visible;
}
.chat-side svg { width: 15px; height: 15px; flex: none; }
.side-top { padding: 4px 4px 12px; }
.side-logo {
  display: inline-flex; align-items: center; gap: 8px;
  background: none; border: none; padding: 4px 6px; cursor: pointer;
  font-size: 16px; font-weight: 700; color: var(--text-hi); font-family: inherit;
}
.chat-side .side-logo-mark { width: 26px; height: 16px; }
.side-item {
  display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
  background: none; border: none; border-radius: 7px; padding: 8px 10px;
  font-size: 13.5px; color: var(--text); cursor: pointer; white-space: nowrap;
}
.side-item.strong { font-weight: 600; }
.side-item:hover, .side-item.active { background: var(--hover, rgba(255, 255, 255, 0.07)); }
.side-item .chev { margin-left: auto; }
.side-history { flex: 1; overflow-y: auto; margin-top: 10px; min-height: 0; }
.side-group { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; padding: 8px 10px 3px; }
.side-chat-row { display: flex; align-items: center; border-radius: 7px; }
.side-chat-row:hover, .side-chat-row.active { background: var(--hover, rgba(255, 255, 255, 0.06)); }
.side-chat-title {
  flex: 1; text-align: left; background: none; border: none; padding: 7px 10px;
  font-size: 12.5px; color: var(--text); cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.side-chat-del { background: none; border: none; padding: 2px 8px; color: var(--text-faint); cursor: pointer; opacity: 0; }
.side-chat-row:hover .side-chat-del, .side-chat-del.show { opacity: 1; }
.side-chat-del:hover { color: var(--err); }

/* ── 主区 ── */
.chat-main { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }

/* 顶栏 Select model */
.model-bar { position: relative; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.model-btn {
  display: inline-flex; align-items: center; gap: 9px;
  background: none; border: none; border-radius: 8px; padding: 8px 12px;
  font-size: 13.5px; color: var(--text); cursor: pointer;
}
.model-btn:hover { background: var(--hover, rgba(255, 255, 255, 0.07)); }
.model-pop {
  position: absolute; top: calc(100% - 4px); left: 14px; z-index: 60; width: 250px;
  background: var(--panel, #26262e); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5); overflow: hidden;
  display: flex; flex-direction: column; max-height: 60vh;
}
.model-search {
  border: none; border-bottom: 1px solid var(--border); border-radius: 0;
  background: transparent; padding: 11px 14px; font-size: 13px; color: var(--text); outline: none;
}
.model-list { overflow-y: auto; padding: 4px; }
.model-group { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; padding: 8px 10px 3px; }
.model-item {
  display: block; width: 100%; text-align: left; background: none; border: none;
  padding: 7px 10px; border-radius: 6px; font-size: 13px; color: var(--text); cursor: pointer;
}
.model-item:hover { background: var(--hover, rgba(255, 255, 255, 0.07)); }
/* D157 provider → models 两级级联(内联展开,避免 model-pop overflow 裁切) */
.model-provider-row { position: relative; }
.model-item.provider { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.prov-chev { color: var(--text-faint); font-size: 15px; line-height: 1; transition: transform 0.12s; }
.model-provider-row:hover .prov-chev { transform: rotate(90deg); color: var(--text-dim); }
.model-submenu { padding-left: 10px; border-left: 1px solid var(--border); margin: 2px 0 4px 10px; }
.model-submenu .model-item { font-size: 12.5px; padding: 6px 10px; }

/* 消息区 */
.chat-scroll { flex: 1; overflow-y: auto; }
.chat-empty { height: 100%; display: flex; align-items: center; justify-content: center; }
.chat-empty-title { font-size: 20px; color: var(--text-hi); margin: 0; }
.chat-inner { max-width: 820px; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; gap: 14px; }
.msg { display: flex; }
.msg.user { justify-content: flex-end; }
.bubble {
  max-width: 82%; padding: 11px 14px; border-radius: 12px; font-size: 14px; line-height: 1.6;
  background: var(--bg-panel); border: 1px solid var(--border);
}
.msg.user .bubble { background: var(--accent); border-color: var(--accent); color: #fff; }
.bubble.err { border-color: var(--err); color: var(--err); }
.bubble-text { margin: 0; white-space: pre-wrap; }
.bubble.thinking { color: var(--text-dim); }
.apply {
  display: inline-flex; align-items: center; gap: 7px; margin-top: 12px; width: 100%; justify-content: center;
  background: var(--accent); border: none; border-radius: 6px; color: #fff;
  padding: 8px 12px; font-size: 13px; cursor: pointer; font-family: inherit;
}
.apply:hover { background: var(--accent-dim); }
.apply svg { width: 14px; height: 14px; }

/* 底部输入区 */
.composer-dock { padding: 0 24px 22px; max-width: 806px; width: 100%; margin: 0 auto; } /* n8n 实测 composer 758 宽 */
.model-hint svg, .model-btn svg { width: 14px; height: 14px; flex: none; }
.model-hint {
  display: flex; align-items: center; gap: 7px;
  border: 1px solid var(--focus--border-color); background: var(--color--purple-alpha-100);
  border-radius: var(--radius--lg) var(--radius--lg) 0 0; padding: 12px 16px; font-size: var(--font-size--sm); color: var(--color--text--shade-1);
}
.model-hint a { color: var(--color--purple-300); text-decoration: underline; }
.model-hint + .composer { border-top-left-radius: 0; border-top-right-radius: 0; }
/* n8n 实测：composer = bg light-3 / 圆角 8 / 衬 8 / 1px 白环 + 0 1px 3px -1px 投影 */
.composer {
  position: relative; width: 100%;
  background: var(--color--background--light-3); border: none;
  box-shadow: 0 0 0 1px var(--border-color), 0 1px 3px -1px var(--color--black-alpha-100);
  border-radius: var(--radius--lg);
  padding: var(--spacing--2xs);
}
.composer:focus-within { box-shadow: 0 0 0 1px var(--focus--border-color), 0 1px 3px -1px var(--color--black-alpha-100); }
.composer.disabled { opacity: 0.85; }
.composer textarea {
  width: 100%; border: none; background: none; outline: none; resize: none; box-shadow: none;
  color: var(--color--text--shade-1); font-size: var(--font-size--md); font-family: inherit; line-height: 1.6;
  padding: 6px; max-height: 200px;
}
.composer textarea::placeholder { color: var(--color--text--tint-1); }
.composer textarea:disabled { cursor: not-allowed; }
/* D156 composer 底栏:左 +Tools / 右 发送 */
.composer-bar { display: flex; align-items: center; gap: 8px; padding: 2px 4px 2px 2px; }
.composer-tools {
  display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 10px;
  background: none; border: var(--border-width) var(--border-style) var(--border-color); border-radius: var(--radius);
  color: var(--color--text--shade-1); font-size: var(--font-size--2xs); cursor: pointer;
}
.composer-tools svg { width: 14px; height: 14px; }
.composer-tools:hover:not(:disabled) { background: var(--color--background--light-1); }
.composer-tools:disabled { opacity: 0.5; cursor: not-allowed; }
.send {
  width: 32px; height: 32px; border: none; border-radius: 6px; cursor: pointer; flex-shrink: 0;
  background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center;
}
.send svg { width: 16px; height: 16px; }
.send:hover { background: var(--accent-dim); }
.send:disabled { opacity: 0.45; cursor: not-allowed; }

/* Agents 页 */
.agents-page { padding: 26px 30px; overflow-y: auto; }
.agents-page h1 { margin: 0 0 4px; font-size: 22px; }
.agents-page .sub { margin: 0 0 18px; font-size: 13px; }
/* D159 头部行:标题/副标 + 右上 New Agent 橙钮 */
.agents-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.agents-head .sub { margin: 0; }
/* D160 空态 */
.agents-empty { margin: 22px 0 0; font-size: 14px; }
.agent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.agent-card {
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 10px;
  padding: 14px; display: flex; flex-direction: column; gap: 9px; white-space: normal;
}
.agent-card.add {
  align-items: center; justify-content: center; cursor: pointer; color: var(--text-dim);
  border-style: dashed; font-size: 13.5px; font-family: inherit; min-height: 110px;
}
.agent-card.add:hover { color: var(--text); border-color: var(--accent); }
.agent-head { display: flex; align-items: flex-start; justify-content: space-between; font-size: 14px; }
.agent-system {
  margin: 0; font-size: 12px; line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.agent-card input, .agent-card textarea {
  width: 100%; padding: 7px 10px; font-size: 12.5px; background: transparent;
  border: 1px solid var(--border); border-radius: 7px; color: var(--text); outline: none; resize: vertical;
}
.agent-card input:focus, .agent-card textarea:focus { border-color: var(--accent); }

.chat-settings-anchor { position: relative; }
.chat-settings-pop { position: absolute; bottom: 0; left: calc(100% + 10px); z-index: 90; }
</style>
