<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth.js';
import { useProjectsStore } from '../../stores/projects.js';
import { useUiStore } from '../../stores/ui.js';
import SettingsMenu from './SettingsMenu.vue';
import { WHATS_NEW, hasUnreadNews, markNewsRead } from '../../lib/whats-new.js';
import { api } from '../../api/client.js';
import { t } from '../../lib/i18n.js';

/**
 * 左侧边栏：品牌 + 顶栏工具（新建/搜索/折叠）、
 * AI Assistant / Overview / Personal，底部 Admin Panel · Templates · Insights · Help · Settings。
 * 折叠态收为窄图标栏；快速新建下拉；搜索开命令面板；Help/Settings 弹出子菜单。
 */
const auth = useAuthStore();
const projects = useProjectsStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

const collapsed = computed(() => ui.sidebarCollapsed);
const personalProjects = computed(() => projects.projects.filter((p) => p.type === 'personal'));
const teamProjects = computed(() => projects.projects.filter((p) => p.type !== 'personal'));

/* 拖拽调整侧栏宽度（展开态才可拖；宽度持久化在 ui store） */
let resizeStartX = 0;
let resizeStartW = 0;
function onResizeMove(e: MouseEvent) {
  ui.setSidebarWidth(resizeStartW + (e.clientX - resizeStartX));
}
function endResize() {
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
  window.removeEventListener('mousemove', onResizeMove);
  window.removeEventListener('mouseup', endResize);
}
function startResize(e: MouseEvent) {
  if (collapsed.value) return;
  e.preventDefault();
  resizeStartX = e.clientX;
  resizeStartW = ui.sidebarWidth;
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';
  window.addEventListener('mousemove', onResizeMove);
  window.addEventListener('mouseup', endResize);
}

const flyout = ref<'settings' | 'help' | null>(null);

/* A1 对标 n8n：Help 红点 = What's New 未读；打开即读 */
const newsUnread = ref(hasUnreadNews());
const showNews = ref(false);
function openWhatsNew() {
  showNews.value = true;
  markNewsRead();
  newsUnread.value = false;
  closeAll();
}
const quickOpen = ref(false);
function toggleFlyout(which: 'settings' | 'help') {
  quickOpen.value = false;
  flyout.value = flyout.value === which ? null : which;
}
/* A3 对标 n8n：Help/Settings 子菜单 hover 展开（离开延迟收起，给滑向子菜单留缓冲） */
let flyoutHideTimer: ReturnType<typeof setTimeout> | null = null;
function flyoutEnter(which: 'settings' | 'help') {
  if (flyoutHideTimer) clearTimeout(flyoutHideTimer);
  flyoutHideTimer = null;
  quickOpen.value = false;
  flyout.value = which;
}
function flyoutLeave() {
  if (flyoutHideTimer) clearTimeout(flyoutHideTimer);
  flyoutHideTimer = setTimeout(() => (flyout.value = null), 250);
}
function closeAll() {
  flyout.value = null;
  quickOpen.value = false;
}

/** 切到某项目的视图（Personal / 团队项目各自一页）。换了上下文才重载拉数据。 */
function switchProject(projectId: string) {
  const changed = projects.current?.id !== projectId;
  projects.switchTo(projectId);
  const nav = router.push({ name: 'overview', query: { project: projectId } });
  if (changed) void nav.then(() => router.go(0));
}



/* 快速新建 */
async function quickNewWorkflow() {
  closeAll();
  const wf = await api.workflows.create({ name: 'My workflow', nodes: [], connections: {} });
  void router.push(`/workflow/${wf.id}`);
}
function quickNewCredential() {
  closeAll();
  void router.push({ name: 'overview', query: { tab: 'credentials', new: 'cred' } });
}
function quickNewVariable() {
  closeAll();
  void router.push({ name: 'overview', query: { tab: 'variables' } });
}
function quickNewDataTable() {
  closeAll();
  void router.push({ name: 'overview', query: { tab: 'data-tables' } });
}
function quickNewAiChat() {
  closeAll();
  void router.push({ name: 'chat' });
}
/** 新建团队项目（低套餐显示 Upgrade；有 rbac 才可建）。 */
async function quickNewProject() {
  closeAll();
  if (!projects.hasFeature('rbac')) {
    void router.push({ name: 'settings', query: { s: 'billing' } });
    return;
  }
  const name = window.prompt(t('Project name'), t('My project'));
  if (name === null) return;
  const project = await projects.createProject(name.trim() || t('My project'));
  projects.switchTo(project.id);
  void router.push({ name: 'overview', query: { project: project.id } }).then(() => router.go(0));
}

/* ⌘K / Ctrl-K 打开命令面板 */
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    ui.openPalette();
  }
}
/* Settings → Chat 关停时隐藏 Chat 入口（状态在 ui store：Settings 切换即实时生效） */
const chatEnabled = computed(() => ui.chatEnabled);
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  void api.chatSettings
    .get()
    .then((s) => ui.setChatEnabled(s.enabled))
    .catch(() => ui.setChatEnabled(true));
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  endResize();
});

const showAbout = ref(false);
const showBug = ref(false);
const about = ref<Awaited<ReturnType<typeof api.about>> | null>(null);
async function openAbout() {
  closeAll();
  showAbout.value = true;
  about.value = await api.about().catch(() => null);
}
</script>

<template>
  <aside
    class="sidebar"
    :class="{ collapsed }"
    :style="collapsed ? undefined : { width: ui.sidebarWidth + 'px' }"
    data-test="sidebar"
    @click="closeAll"
  >
    <!-- 拖拽调宽把手（展开态） -->
    <div v-if="!collapsed" class="resize-handle" data-test="sidebar-resize" :title="t('Drag to resize')" @mousedown="startResize" @click.stop />

    <!-- 品牌 + 顶栏工具 -->
    <div class="brand-row">
      <RouterLink class="brand" :to="{ name: 'overview' }" title="nomops">
        <svg class="brand-mark" viewBox="19 37 130 54" fill="none">
          <defs>
            <linearGradient id="nomops-mark-nav" gradientUnits="userSpaceOnUse" x1="23" y1="64" x2="145" y2="64">
              <stop offset="0" stop-color="#22d3ee" />
              <stop offset="0.5" stop-color="#6366f1" />
              <stop offset="1" stop-color="#a855f7" />
            </linearGradient>
          </defs>
          <path d="M57 64C73.2 90 75.4 90 84 64C92.6 38 94.8 38 111 64" stroke="url(#nomops-mark-nav)" stroke-width="6.5" stroke-linecap="round" />
          <circle cx="40" cy="64" r="17" fill="url(#nomops-mark-nav)" />
          <circle cx="128" cy="64" r="17" fill="url(#nomops-mark-nav)" />
        </svg>
        <span v-if="!collapsed" class="brand-word">nomops</span>
      </RouterLink>

      <div v-if="!collapsed" class="brand-tools" @click.stop>
        <div class="flyout-anchor">
          <button class="icon-btn" data-test="quick-create" :title="t('Create')" @click.stop="quickOpen = !quickOpen; flyout = null">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <div v-if="quickOpen" class="flyout quick" data-test="quick-menu" @click.stop>
            <button class="flyout-item qc" data-test="quick-workflow" @click="quickNewWorkflow">{{ t('New workflow') }}<span class="qc-chev">›</span></button>
            <button class="flyout-item qc" data-test="quick-credential" @click="quickNewCredential">{{ t('New credential') }}<span class="qc-chev">›</span></button>
            <button class="flyout-item qc" data-test="quick-variable" @click="quickNewVariable">{{ t('New variable') }}<span class="qc-chev">›</span></button>
            <button class="flyout-item qc" data-test="quick-datatable" @click="quickNewDataTable">{{ t('New data table') }}<span class="qc-chev">›</span></button>
            <button class="flyout-item qc" data-test="quick-project" @click="quickNewProject">
              {{ t('New project') }}
              <span v-if="!projects.hasFeature('rbac')" class="qc-upgrade">{{ t('Upgrade') }}</span>
              <span v-else class="qc-chev">›</span>
            </button>
            <button class="flyout-item qc" data-test="quick-aichat" @click="quickNewAiChat">{{ t('New AI chat') }}</button>
          </div>
        </div>
        <button class="icon-btn" data-test="sidebar-search" :title="t('Search (⌘K)')" @click.stop="ui.openPalette()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        </button>
        <button class="icon-btn" data-test="sidebar-collapse" :title="t('Collapse')" @click.stop="ui.toggleSidebar()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
        </button>
      </div>
      <button v-else class="icon-btn expand" data-test="sidebar-collapse" :title="t('Expand')" @click.stop="ui.toggleSidebar()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    </div>

    <!-- 顶部导航 -->
    <RouterLink class="nav-item" :class="{ active: (route.name === 'overview' && !route.query.project) || route.name === 'canvas' }" :to="{ name: 'overview' }" :title="t('Overview')">
      <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /></svg>
      <span class="lbl">{{ t('Overview') }}</span>
    </RouterLink>

    <RouterLink v-if="chatEnabled" class="nav-item" :class="{ active: route.name === 'chat' }" :title="t('Chat')" data-test="nav-chat" :to="{ name: 'chat' }">
      <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" /></svg>
      <span class="lbl">{{ t('Chat') }}</span>
      <span v-if="!collapsed" class="badge-preview">{{ t('Preview') }}</span>
    </RouterLink>

    <!-- 个人空间（恒显示为 "Personal"） -->
    <button v-for="p in personalProjects" :key="p.id" class="nav-item" :class="{ active: route.name === 'overview' && route.query.project === p.id }" :data-test-project="p.id" :title="t('Personal')" @click="switchProject(p.id)">
      <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" /></svg>
      <span class="lbl">{{ t('Personal') }}</span>
    </button>

    <!-- 团队项目 -->
    <template v-if="teamProjects.length">
      <div v-if="!collapsed" class="nav-section">{{ t('Projects') }}</div>
      <button v-for="p in teamProjects" :key="p.id" class="nav-item" :class="{ active: route.name === 'overview' && route.query.project === p.id }" :data-test-project="p.id" :title="p.name" @click="switchProject(p.id)">
        <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3" /><path d="M2 20c0-3.2 2.6-5 5.5-5 1 0 1.9.2 2.7.6" /><circle cx="17" cy="10" r="2.6" /><path d="M12.5 20c0-2.8 2.2-4.4 4.7-4.4S22 17.2 22 20" /></svg>
        <span class="lbl">{{ p.name }}</span>
      </button>
    </template>

    <div class="sb-spacer" />

    <div class="sidebar-bottom">
      <RouterLink class="nav-item" :class="{ active: route.name === 'admin' }" data-test="nav-admin" :title="t('Admin Panel')" :to="{ name: 'admin' }">
        <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16a4 4 0 0 1 .4-8A5.5 5.5 0 0 1 17 8.5 3.75 3.75 0 0 1 18 16H6z" /></svg>
        <span class="lbl">{{ t('Admin Panel') }}</span>
      </RouterLink>
      <RouterLink class="nav-item" :class="{ active: route.name === 'templates' }" :to="{ name: 'templates' }" :title="t('Templates')" data-test="nav-templates">
        <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 7.5 12 12l9-4.5L12 3z" /><path d="M3 12l9 4.5L21 12M3 16.5 12 21l9-4.5" /></svg>
        <span class="lbl">{{ t('Templates') }}</span>
      </RouterLink>
      <RouterLink class="nav-item" :class="{ active: route.name === 'insights' }" :to="{ name: 'insights' }" :title="t('Insights')" data-test="nav-insights">
        <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4M4 20h16" /><rect x="7" y="12" width="3" height="5" /><rect x="12" y="8" width="3" height="9" /><rect x="17" y="10" width="3" height="7" /></svg>
        <span class="lbl">{{ t('Insights') }}</span>
      </RouterLink>

      <div class="flyout-anchor" @mouseenter="flyoutEnter('help')" @mouseleave="flyoutLeave">
        <button class="nav-item" data-test="help-menu" :title="t('Help')" @click.stop="toggleFlyout('help')">
          <span class="ico-wrap">
            <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .8-1 1.7" /><path d="M12 17h.01" /></svg>
            <span v-if="newsUnread" class="news-dot" data-test="news-dot" />
          </span>
          <span class="lbl">{{ t('Help') }}</span>
          <svg v-if="!collapsed" class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6" /></svg>
        </button>
        <!-- 结构对齐 n8n Help 菜单：普通条目 → About → 分组标题 "What's new" → 组内条目 -->
        <div v-if="flyout === 'help'" class="flyout" data-test="help-flyout" @click.stop>
          <button class="flyout-item" data-test="help-run-demo" @click="router.push({ name: 'templates' }); closeAll()">
            {{ t('Run live demo') }}
          </button>
          <span class="flyout-item dim" data-test="help-docs">{{ t('Documentation') }} · docs/ (README → 01–10)</span>
          <button class="flyout-item" data-test="help-bug" @click="showBug = true; closeAll()">{{ t('Report a problem') }}</button>
          <button class="flyout-item" data-test="help-about" @click="openAbout">{{ t('About nomops') }}</button>
          <div class="flyout-label">{{ t("What's new") }}</div>
          <button class="flyout-item" data-test="help-whats-new" @click="openWhatsNew">
            {{ t("What's New") }}
            <span v-if="newsUnread" class="news-dot inline" />
          </button>
        </div>
      </div>

      <div class="flyout-anchor" @mouseenter="flyoutEnter('settings')" @mouseleave="flyoutLeave">
        <button class="nav-item" :class="{ active: route.name === 'settings' }" data-test="settings-menu" :title="t('Settings')" @click.stop="toggleFlyout('settings')">
          <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-1.7-1L15 3H11l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.3-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5z" /></svg>
          <span class="lbl">{{ t('Settings') }}</span>
          <svg v-if="!collapsed" class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6" /></svg>
        </button>
        <div v-if="flyout === 'settings'" class="flyout flyout-bare" @click.stop>
          <SettingsMenu @close="closeAll" />
        </div>
      </div>
    </div>
  </aside>

  <div v-if="showAbout" class="about-overlay" data-test="about-modal" @click.self="showAbout = false">
    <div class="about-card">
      <div class="brand-word" style="font-size: 24px">nomops</div>
      <div class="dim" style="font-size: 12px; margin-top: 2px">
        v{{ about?.version ?? '…' }}
        <span class="plan-badge" :class="about?.plan">{{ about?.plan === 'enterprise' ? t('Enterprise') : t('Community') }}</span>
      </div>
      <p class="dim" style="font-size: 13px; margin: 14px 0">
        {{ about?.description ?? t('Node-based workflow automation platform') }}
      </p>
      <div class="about-meta">
        <div><span class="dim">{{ t('Core') }}</span><span>workflow · core · nodes</span></div>
        <div><span class="dim">{{ t('Built-in nodes') }}</span><span>{{ about?.nodeCount ?? '–' }}</span></div>
        <div><span class="dim">{{ t('Docs') }}</span><span>{{ about?.docs ?? 'docs/' }}</span></div>
      </div>
      <button class="btn primary" style="margin-top: 16px" @click="showAbout = false">{{ t('Close') }}</button>
    </div>
  </div>

  <!-- 报告问题 -->
  <div v-if="showNews" class="news-mask" data-test="whats-new-modal" @click.self="showNews = false">
      <div class="news-card">
        <div class="news-head">
          <strong>{{ t("What's New") }}</strong>
          <button class="news-x" @click="showNews = false">✕</button>
        </div>
        <div class="news-body">
          <div v-for="e in WHATS_NEW" :key="e.id" class="news-entry">
            <div class="news-title">{{ e.title }} <span class="dim news-date">{{ e.date }}</span></div>
            <ul>
              <li v-for="(pt, i) in e.points" :key="i">{{ pt }}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showBug" class="about-overlay" data-test="bug-modal" @click.self="showBug = false">
    <div class="about-card" style="text-align: left; width: 380px">
      <div style="font-weight: 600; font-size: 16px; text-align: center; margin-bottom: 12px">{{ t('Report a problem') }}</div>
      <p class="dim" style="font-size: 13px; line-height: 1.7">
        {{ t('Please include the following so we can reproduce it:') }}<br />
        {{ t('1. Steps, expected vs actual result') }}<br />
        {{ t('2. Failing node name and execution ID (see Executions)') }}<br />
        {{ t('3. Browser console / instance log snippet') }}<br />
        {{ t('4. Version v{v}', { v: about?.version ?? '…' }) }}
      </p>
      <p class="dim" style="font-size: 12px; margin-top: 10px">
        {{ t('Self-hosted logs: {cmd}; in dev, see the server process output.', { cmd: 'docker logs' }) }}
      </p>
      <button class="btn primary" style="width: 100%; margin-top: 14px" @click="showBug = false">{{ t('Got it') }}</button>
    </div>
  </div>
</template>

<style scoped>
.sidebar { position: relative; }
.resize-handle {
  position: absolute; top: 0; right: -4px; width: 10px; height: 100%;
  cursor: col-resize; z-index: 30;
}
.resize-handle::after {
  content: ''; position: absolute; top: 0; right: 4px; width: 2px; height: 100%;
  background: transparent; transition: background 0.15s;
}
.resize-handle:hover::after, .resize-handle:active::after { background: var(--accent); }

.sidebar.collapsed { width: 58px; padding: 10px 8px; align-items: center; }
.sidebar.collapsed .lbl { display: none; }
.sidebar.collapsed .nav-item { justify-content: center; padding: 8px 0; }
.sidebar.collapsed .brand-row { justify-content: center; }

.brand-row { display: flex; align-items: center; gap: 6px; padding: 6px 6px 14px; }
.brand { display: flex; align-items: center; gap: 5px; text-decoration: none; min-width: 0; flex: 1; }
.brand-word { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.brand-mark { width: 38px; height: 22px; flex-shrink: 0; }
.brand-word { font-weight: 700; font-size: 16px; letter-spacing: -0.3px; color: var(--text-hi); }
.brand-tools { display: flex; align-items: center; gap: 0; margin-left: auto; flex-shrink: 0; }
/* n8n 实测：顶部工具钮 28×28/圆角 4；导航图标 16×16 白（24px 盒居中）；
   Preview 徽章 purple-200 底/purple-600 字/圆角 16/10px 600/衬 2px 4px */
.icon-btn {
  width: 28px; height: 28px; flex-shrink: 0; border: none; background: none; color: var(--color--text--shade-1);
  border-radius: var(--radius); display: flex; align-items: center; justify-content: center; cursor: pointer;
  padding: 0;
}
.icon-btn:hover { background: var(--color--background--light-1); }
.icon-btn svg { width: 16px; height: 16px; flex-shrink: 0; }

.nav-ico { width: 16px; height: 16px; flex-shrink: 0; margin: var(--spacing--4xs); color: var(--color--text--shade-1); }
.nav-item.active .nav-ico { color: var(--color--text--shade-1); }
.nav-item .lbl { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge-preview {
  font-size: 10px; font-weight: var(--font-weight--bold); padding: 2px var(--spacing--4xs);
  border-radius: var(--radius--md); flex-shrink: 0;
  background: var(--color--purple-200); color: var(--color--purple-600);
}
.nav-section {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--text-faint); padding: 14px 10px 6px;
}
.sb-spacer { flex: 1; }
.sidebar-bottom { display: flex; flex-direction: column; }

.flyout-anchor { position: relative; }
.chev { width: 15px; height: 15px; flex-shrink: 0; margin-left: auto; color: var(--text-faint); }
.flyout {
  position: absolute; left: calc(100% + 4px); bottom: 0; z-index: 40;
  width: 210px; background: var(--bg-panel); border: 1px solid var(--border-strong);
  border-radius: 10px; padding: 6px; box-shadow: 6px 6px 24px rgba(0, 0, 0, 0.45);
}
.flyout.quick { top: 100%; left: 0; bottom: auto; width: 212px; margin-top: 4px; }
.flyout-item.qc { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.qc-chev { color: var(--text-faint); font-size: 16px; line-height: 1; }
.qc-upgrade {
  font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 8px;
  background: var(--bg-hover); color: var(--text-dim); border: 1px solid var(--border);
}
.flyout-item {
  display: block; width: 100%; text-align: left; padding: 8px 10px; border: none;
  background: none; border-radius: 6px; color: var(--text); font-size: 13px; text-decoration: none; cursor: pointer;
}
.flyout-item:hover { background: var(--bg-hover); }
.flyout-label { font-size: 11px; color: var(--text-faint); padding: 8px 10px 2px; text-transform: uppercase; }
.flyout-sep { height: 1px; background: var(--border); margin: 6px 0; }

.about-overlay {
  position: fixed; inset: 0; z-index: 70; background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
}
.about-card {
  background: var(--bg-panel); border: 1px solid var(--border-strong); border-radius: 12px;
  padding: 28px; text-align: center; width: 340px;
}
.about-card .plan-badge { font-size: 11px; padding: 1px 8px; border-radius: 10px; border: 1px solid var(--border); margin-left: 6px; }
.about-card .plan-badge.enterprise { color: var(--accent); border-color: var(--accent); }
.about-meta { text-align: left; font-size: 12.5px; border-top: 1px solid var(--border); padding-top: 12px; margin-top: 4px; }
.about-meta > div { display: flex; justify-content: space-between; padding: 4px 0; }
.about-card code { background: var(--bg-input); padding: 1px 5px; border-radius: 3px; }
.btn { display: inline-flex; align-items: center; justify-content: center; height: 34px; padding: 0 14px; border-radius: var(--radius); border: none; font-size: 14px; font-weight: 500; cursor: pointer; }
.btn.primary { background: var(--accent); color: #fff; }
.btn.primary:hover { background: var(--accent-dim); }

/* A1 What's New 红点与弹窗 */
.ico-wrap { position: relative; display: inline-flex; }
.news-dot {
  position: absolute; top: -3px; right: -3px; width: 7px; height: 7px;
  border-radius: 50%; background: var(--err, #e5484d);
}
.news-dot.inline { position: static; margin-left: 8px; display: inline-block; }
.news-mask { position: fixed; inset: 0; z-index: 110; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; }
.news-card {
  width: 560px; max-height: 70vh; display: flex; flex-direction: column;
  background: var(--panel, #26262e); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
}
.news-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 10px; font-size: 15px; }
.news-x { background: none; border: none; padding: 2px 6px; color: var(--text-dim); cursor: pointer; }
.news-x:hover { color: var(--text); }
.news-body { overflow-y: auto; padding: 4px 20px 18px; }
.news-entry { margin-bottom: 14px; }
.news-title { font-weight: 600; font-size: 13.5px; margin-bottom: 4px; }
.news-date { font-weight: 400; font-size: 11.5px; margin-left: 8px; }
.news-entry ul { margin: 0; padding-left: 18px; }
.news-entry li { font-size: 12.5px; line-height: 1.6; color: var(--text-dim); }

.flyout-bare { padding: 0; background: none; border: none; box-shadow: none; }
</style>
