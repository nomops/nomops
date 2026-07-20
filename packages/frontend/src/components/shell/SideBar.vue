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
import { LINKS } from '../../lib/links.js';

/**
 * 左侧边栏(对标基线):品牌 + 顶栏工具（新建/搜索/折叠）、Overview / Chat(Preview)、
 * 底部 Templates(外链) · Insights · Help · Settings。固定 201px 不可拖拽。
 * 折叠态收为窄图标栏；快速新建下拉(4 项)；搜索开命令面板；Help/Settings 弹出子菜单。
 */
const auth = useAuthStore();
const projects = useProjectsStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

const collapsed = computed(() => ui.sidebarCollapsed);
// D002 对标基线:侧栏固定 201px、不可拖拽(移除调宽把手与逻辑)。
const teamProjects = computed(() => projects.projects.filter((p) => p.type !== 'personal'));
/* D004:基线主侧栏的 "Personal" 项指向个人项目 */
const personalProject = computed(() => projects.projects.find((p) => p.type === 'personal') ?? null);

const flyout = ref<'settings' | 'help' | null>(null);

/* D007/D012–D015:侧栏外链一律指向项目自有资源。Templates 走站内 /templates 路由。 */
const HELP_LINKS = {
  quickstart: LINKS.quickstart,
  documentation: LINKS.docs,
  forum: LINKS.forum,
  course: LINKS.course,
  reportBug: LINKS.reportBug,
  changelog: LINKS.changelog,
};

/* A1 对标基线：Help 红点 = What's New 未读；打开即读 */
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
/* A3 对标基线：Help/Settings 子菜单 hover 展开（离开延迟收起，给滑向子菜单留缓冲） */
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
function quickNewDataTable() {
  closeAll();
  void router.push({ name: 'overview', query: { tab: 'data-tables' } });
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
    data-test="sidebar"
    @click="closeAll"
  >
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

      <!-- 顶部工具:+/搜索/折叠开关。折叠态竖排(对标基线折叠列仍含这三个图标) -->
      <div class="brand-tools" @click.stop>
        <div class="flyout-anchor">
          <button class="icon-btn" data-test="quick-create" :title="t('Create')" @click.stop="quickOpen = !quickOpen; flyout = null">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <!-- D008/D010 对标基线:+ 菜单项**无尾部 ›**(live 实测基线 5 项、宽 198,均无 chevron) -->
          <div v-if="quickOpen" class="flyout quick" data-test="quick-menu" @click.stop>
            <button class="flyout-item qc" data-test="quick-workflow" @click="quickNewWorkflow">{{ t('New workflow') }}</button>
            <button class="flyout-item qc" data-test="quick-credential" @click="quickNewCredential">{{ t('New credential') }}</button>
            <button class="flyout-item qc" data-test="quick-datatable" @click="quickNewDataTable">{{ t('New data table') }}</button>
            <!-- D009 对标基线:New project 带 Enterprise 徽章且置灰不可点 -->
            <button v-if="projects.hasFeature('rbac')" class="flyout-item qc" data-test="quick-project" @click="quickNewProject">
              {{ t('New project') }}
            </button>
            <span v-else class="flyout-item qc disabled" data-test="quick-project" :title="t('Available on the Enterprise plan')">
              {{ t('New project') }}<span class="qc-enterprise">{{ t('Enterprise') }}</span>
            </span>
          </div>
        </div>
        <button class="icon-btn" data-test="sidebar-search" :title="t('Search (⌘K)')" @click.stop="ui.openPalette()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        </button>
        <button class="icon-btn" data-test="sidebar-collapse" :title="collapsed ? t('Expand') : t('Collapse')" @click.stop="ui.toggleSidebar()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
        </button>
      </div>
    </div>

    <!-- 顶部导航 -->
    <RouterLink class="nav-item" :class="{ active: (route.name === 'overview' && !route.query.project) || route.name === 'canvas' }" :to="{ name: 'overview' }" :title="t('Overview')">
      <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /></svg>
      <span class="lbl">{{ t('Overview') }}</span>
    </RouterLink>

    <!-- D004 对标基线:Overview 之后、Chat 之前有独立的 "Personal" 项(指向个人项目) -->
    <button
      v-if="personalProject"
      class="nav-item"
      :class="{ active: route.name === 'overview' && route.query.project === personalProject.id }"
      data-test="nav-personal"
      :title="t('Personal')"
      @click="switchProject(personalProject.id)"
    >
      <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
      <span class="lbl">{{ t('Personal') }}</span>
    </button>

    <RouterLink v-if="chatEnabled" class="nav-item" :class="{ active: route.name === 'chat' }" :title="t('Chat')" data-test="nav-chat" :to="{ name: 'chat' }">
      <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" /></svg>
      <span class="lbl">{{ t('Chat') }}</span>
      <span v-if="!collapsed" class="badge-preview">{{ t('Preview') }}</span>
    </RouterLink>

    <!-- D004 对标基线:无独立 "Personal" 项(个人空间即 Overview 默认上下文) -->

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
      <!-- D005 对标基线:侧栏无 "Admin Panel"(路由 /admin 保留,仅移除侧栏入口) -->
      <!-- D007:Templates 走站内模板库路由 -->
      <RouterLink class="nav-item" :class="{ active: route.name === 'templates' }" :to="{ name: 'templates' }" :title="t('Templates')" data-test="nav-templates" @click="closeAll">
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
        <!-- D012–D015 对标基线 Help 菜单:Quickstart/Documentation/Forum/Course/Report a bug 外链自有仓库(见 lib/links.ts);
             About 保留 nomops 品牌;底部 What's new 分组(新闻标题 + Full changelog + Update)。 -->
        <div v-if="flyout === 'help'" class="flyout" data-test="help-flyout" @click.stop>
          <a class="flyout-item" :href="HELP_LINKS.quickstart" target="_blank" rel="noopener" data-test="help-quickstart" @click="closeAll">{{ t('Quickstart') }}</a>
          <a class="flyout-item" :href="HELP_LINKS.documentation" target="_blank" rel="noopener" data-test="help-docs" @click="closeAll">{{ t('Documentation') }}</a>
          <a class="flyout-item" :href="HELP_LINKS.forum" target="_blank" rel="noopener" data-test="help-forum" @click="closeAll">{{ t('Forum') }}</a>
          <a class="flyout-item" :href="HELP_LINKS.course" target="_blank" rel="noopener" data-test="help-course" @click="closeAll">{{ t('Course') }}</a>
          <a class="flyout-item" :href="HELP_LINKS.reportBug" target="_blank" rel="noopener" data-test="help-bug" @click="closeAll">{{ t('Report a bug') }}</a>
          <button class="flyout-item" data-test="help-about" @click="openAbout">{{ t('About nomops') }}</button>
          <div class="flyout-label">{{ t("What's new") }}</div>
          <button class="flyout-item wn-item" data-test="help-whats-new" @click="openWhatsNew">
            <span class="wn-dot" />
            <span class="wn-title">{{ WHATS_NEW[0]?.title ?? t("What's New") }}</span>
          </button>
          <a class="flyout-item" :href="HELP_LINKS.changelog" target="_blank" rel="noopener" data-test="help-changelog" @click="closeAll">{{ t('Full changelog') }}</a>
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
/* D002 对标基线:侧栏固定 201px、不可拖拽 */
.sidebar { position: relative; }
.sidebar:not(.collapsed) { width: 201px; }

/* D003 live 实测基线折叠态：rail 42px，条目 29×32 落在 x=6（即左右各 6px 内边距） */
.sidebar.collapsed { width: 42px; padding: 10px 6px; align-items: center; }
.sidebar.collapsed .lbl { display: none; }
.sidebar.collapsed .nav-item { justify-content: center; padding: 0; height: 32px; }
/* 折叠态:logo 在上,+/搜索/折叠 三键竖排在下(对标基线折叠列) */
.sidebar.collapsed .brand-row { flex-direction: column; justify-content: center; gap: 4px; }
.sidebar.collapsed .brand-tools { flex-direction: column; margin-left: 0; gap: 2px; }
.sidebar.collapsed .flyout.quick { left: calc(100% + 4px); top: 0; }

.brand-row { display: flex; align-items: center; gap: 6px; padding: 6px 6px 14px; }
.brand { display: flex; align-items: center; gap: 5px; text-decoration: none; min-width: 0; flex: 1; }
.brand-word { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.brand-mark { width: 38px; height: 22px; flex-shrink: 0; }
.brand-word { font-weight: 700; font-size: 16px; letter-spacing: -0.3px; color: var(--text-hi); }
.brand-tools { display: flex; align-items: center; gap: 0; margin-left: auto; flex-shrink: 0; }
/* 基线实测：顶部工具钮 28×28/圆角 4；导航图标 16×16 白（24px 盒居中）；
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
/* D016 live 实测基线 Help 弹层：宽 250、圆角 8、底色 --color--background--light-3、
   阴影 0 10px 15px -3px + 0 4px 6px -4px、padding 0、无边框 */
.flyout {
  position: absolute; left: calc(100% + 4px); bottom: 0; z-index: 40;
  width: 250px; background: var(--color--background--light-3); border: none;
  border-radius: 8px; padding: 0;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
}
.flyout.quick { top: 100%; left: 0; bottom: auto; width: 212px; margin-top: 4px; }
.flyout-item.qc { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.qc-upgrade {
  font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 8px;
  background: var(--bg-hover); color: var(--text-dim); border: 1px solid var(--border);
}
/* D009 New project Enterprise 徽章 + 置灰 */
.qc-enterprise {
  font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 8px;
  background: var(--bg-hover); color: var(--text-dim); border: 1px solid var(--border);
}
.flyout-item.qc.disabled { opacity: 0.5; cursor: default; }
.flyout-item.qc.disabled:hover { background: none; }
/* D015 What's new 新闻标题条 */
.wn-item { display: flex; align-items: center; gap: 8px; }
.wn-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: var(--err, #e5484d); }
.wn-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
  background: var(--color--background--light-1); border: 1px solid var(--border); border-radius: 12px;
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
