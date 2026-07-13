<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';

/** n8n 式 AI Assistant 整页视图：空态居中组合器 + 建议 chips；发消息后转为对话。 */
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  workflow?: { name: string; nodes: unknown[]; connections: unknown } | null;
}

const router = useRouter();

const messages = ref<Msg[]>([]);
const input = ref('');
const busy = ref(false);
const error = ref('');
const listEl = ref<HTMLElement>();

const suggestions: Array<{ icon: string; label: string }> = [
  { icon: '<path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/>', label: 'Score my leads' },
  { icon: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>', label: 'Process invoices' },
  { icon: '<path d="M4 12a8 8 0 1 1 3.5 6.6L4 20l1.4-3.5A8 8 0 0 1 4 12z"/>', label: 'WhatsApp support agent' },
  { icon: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/>', label: 'Schedule social posts' },
];

async function scrollDown() {
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
}

async function send(text?: string) {
  const content = (text ?? input.value).trim();
  if (!content || busy.value) return;
  error.value = '';
  messages.value.push({ role: 'user', content });
  input.value = '';
  busy.value = true;
  void scrollDown();
  try {
    const history = messages.value.map((m) => ({ role: m.role, content: m.content }));
    const res = await api.assistant.chat(history);
    messages.value.push({ role: 'assistant', content: res.reply, workflow: res.workflow });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
    void scrollDown();
  }
}

function useSuggestion(label: string) {
  void send(`Build an automation to ${label.toLowerCase()}.`);
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

/** 去掉回复里的 ```json 代码块（已单独渲染为「应用」按钮）。 */
function displayText(m: Msg): string {
  return m.content.replace(/```json[\s\S]*?```/g, '').trim();
}
</script>

<template>
  <div class="assistant-page" data-test="assistant-page">
    <!-- 空态：居中组合器 + 建议 -->
    <div v-if="messages.length === 0" class="hero">
      <h1 class="hero-title">
        <svg class="spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3z" /><path d="M18.5 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" /></svg>
        What do you want to automate?
      </h1>

      <div class="composer">
        <textarea
          v-model="input"
          data-test="assistant-input"
          rows="3"
          placeholder="Tell me what to build or ask me a question"
          @keydown.enter.exact.prevent="send()"
        />
        <button class="send" data-test="assistant-send" :disabled="busy || !input.trim()" @click="send()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
        </button>
      </div>

      <div class="chips">
        <button v-for="s in suggestions" :key="s.label" class="chip" @click="useSuggestion(s.label)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" v-html="s.icon" />
          {{ s.label }}
        </button>
      </div>
      <p class="hint">Requires an Anthropic credential configured under Credentials.</p>
    </div>

    <!-- 对话态 -->
    <template v-else>
      <div ref="listEl" class="chat">
        <div class="chat-inner">
          <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
            <div class="bubble">
              <p class="bubble-text">{{ displayText(m) }}</p>
              <button v-if="m.workflow" class="apply" :data-test-apply="i" @click="applyWorkflow(m)">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" /></svg>
                Add to canvas — {{ m.workflow.name }} ({{ m.workflow.nodes.length }} nodes)
              </button>
            </div>
          </div>
          <div v-if="busy" class="msg assistant"><div class="bubble thinking">Thinking…</div></div>
          <p v-if="error" class="error-text" data-test="assistant-error">{{ error }}</p>
        </div>
      </div>

      <div class="composer-dock">
        <div class="composer">
          <textarea
            v-model="input"
            data-test="assistant-input"
            rows="1"
            placeholder="Reply to the assistant…"
            @keydown.enter.exact.prevent="send()"
          />
          <button class="send" data-test="assistant-send" :disabled="busy || !input.trim()" @click="send()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.assistant-page { flex: 1; display: flex; flex-direction: column; min-height: 0; }

/* 空态 hero */
.hero {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px; padding: 24px; max-width: 760px; width: 100%; margin: 0 auto;
}
.hero-title {
  display: flex; align-items: center; gap: 10px;
  margin: 0 0 6px; font-size: 24px; font-weight: 500; color: var(--text-hi); text-align: center;
}
.hero-title .spark { width: 24px; height: 24px; color: var(--accent); flex-shrink: 0; }

/* 组合器 */
.composer {
  position: relative; width: 100%;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 10px;
  padding: 14px 16px; transition: border-color 0.15s, box-shadow 0.15s;
}
.composer:focus-within { border-color: #7c5cd6; box-shadow: 0 0 0 3px rgba(124, 92, 214, 0.25); }
.composer textarea {
  width: 100%; border: none; background: none; outline: none; resize: none;
  color: var(--text); font-size: 14.5px; font-family: inherit; line-height: 1.6;
  padding: 0; padding-right: 40px; max-height: 200px;
}
.composer textarea::placeholder { color: var(--text-faint); }
.send {
  position: absolute; right: 12px; bottom: 12px;
  width: 32px; height: 32px; border: none; border-radius: 6px; cursor: pointer;
  background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center;
}
.send svg { width: 16px; height: 16px; }
.send:hover { background: var(--accent-dim); }
.send:disabled { opacity: 0.45; cursor: not-allowed; }

/* 建议 chips */
.chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.chip {
  display: inline-flex; align-items: center; gap: 7px;
  background: #323232; border: 1px solid var(--border); border-radius: 9999px;
  padding: 7px 14px; color: var(--text); font-size: 13px; cursor: pointer; font-family: inherit;
}
.chip:hover { background: #3a3a3a; }
.chip svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-dim); }
.hint { color: var(--text-faint); font-size: 12px; margin: 4px 0 0; }

/* 对话态 */
.chat { flex: 1; overflow-y: auto; }
.chat-inner { max-width: 760px; margin: 0 auto; padding: 28px 24px; display: flex; flex-direction: column; gap: 14px; }
.msg { display: flex; }
.msg.user { justify-content: flex-end; }
.bubble {
  max-width: 82%; padding: 11px 14px; border-radius: 12px; font-size: 14px; line-height: 1.6;
  background: var(--bg-panel); border: 1px solid var(--border);
}
.msg.user .bubble { background: var(--accent); border-color: var(--accent); color: #fff; }
.bubble-text { margin: 0; white-space: pre-wrap; }
.bubble.thinking { color: var(--text-dim); }
.apply {
  display: inline-flex; align-items: center; gap: 7px; margin-top: 12px; width: 100%; justify-content: center;
  background: var(--accent); border: none; border-radius: 6px; color: #fff;
  padding: 8px 12px; font-size: 13px; cursor: pointer; font-family: inherit;
}
.apply:hover { background: var(--accent-dim); }
.apply svg { width: 14px; height: 14px; }
.composer-dock { border-top: 1px solid var(--border); padding: 16px 24px; }
.composer-dock .composer { max-width: 760px; margin: 0 auto; padding: 12px 16px; }
</style>
