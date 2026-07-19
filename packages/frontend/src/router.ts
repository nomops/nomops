import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth.js';

/** meta.public: 未登录可访问。自托管实例无营销站，根路由即 app 首页（自托管）。 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/signup', name: 'signup', component: () => import('./views/SignupView.vue'), meta: { public: true } },
    // 根路由 = app 首页（Overview），需登录；未登录经守卫跳 /login
    { path: '/', name: 'overview', component: () => import('./views/OverviewView.vue') },

    // 旧路径兼容：并入 Overview 的 tab
    { path: '/credentials', redirect: { path: '/', query: { tab: 'credentials' } } },
    { path: '/executions', redirect: { path: '/', query: { tab: 'executions' } } },
    { path: '/chat', name: 'chat', component: () => import('./views/ChatView.vue') },
    // Shared with you(对标 n8n /shared/workflows | /shared/credentials)
    { path: '/shared/workflows', name: 'shared', component: () => import('./views/SharedView.vue') },
    { path: '/shared/credentials', name: 'sharedCredentials', component: () => import('./views/SharedView.vue') },
    { path: '/assistant', redirect: '/chat' },
    { path: '/workflow/:id', name: 'canvas', component: () => import('./views/CanvasView.vue') },
    // 版本历史整页(对标 n8n /workflow/:id/history/:versionId):只读斜纹画布 + 版本面板
    { path: '/workflow/:id/history/:versionId?', name: 'workflowHistory', component: () => import('./views/WorkflowHistoryView.vue') },
    { path: '/datatables/:id', name: 'datatable', component: () => import('./views/DataTableView.vue') },
    { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue') },
    { path: '/projects', name: 'projects', component: () => import('./views/ProjectsView.vue') },
    { path: '/audit', name: 'audit', component: () => import('./views/AuditView.vue') },
    { path: '/insights/:metric?', name: 'insights', component: () => import('./views/InsightsView.vue') },
    { path: '/templates', name: 'templates', component: () => import('./views/TemplatesView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    { path: '/sso/done', name: 'ssoDone', component: () => import('./views/SsoDoneView.vue'), meta: { public: true } },

    // 兜底：未知路径（含已摘除的营销页 / 旧书签）回首页
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!auth.token && !to.meta['public']) return { name: 'login' };
  if (auth.token && to.name === 'login') return { name: 'overview' };
  return true;
});

/**
 * 动态文档标题(对标 n8n "Workflows - n8n"):按路由/Overview tab 生成
 * `<页名> - nomops`,兜底 `nomops`。编辑器页由 CanvasView 用工作流名覆盖。
 */
const OVERVIEW_TAB_TITLE: Record<string, string> = {
  workflows: 'Workflows',
  credentials: 'Credentials',
  executions: 'Executions',
  variables: 'Variables',
  datatables: 'Data tables',
};
const ROUTE_TITLE: Record<string, string> = {
  chat: 'Chat',
  shared: 'Workflows',
  sharedCredentials: 'Credentials',
  insights: 'Insights',
  settings: 'Settings',
  admin: 'Admin Panel',
  projects: 'Projects',
  audit: 'Audit',
  templates: 'Templates',
  login: 'Sign in',
  signup: 'Sign up',
};
export function titleFor(to: { name?: unknown; query?: Record<string, unknown> }): string {
  const name = String(to.name ?? '');
  if (name === 'overview') {
    const tab = String(to.query?.['tab'] ?? 'workflows');
    return OVERVIEW_TAB_TITLE[tab] ?? 'Overview';
  }
  if (name === 'canvas') return 'Workflow'; // CanvasView 会用工作流名覆盖
  if (name === 'workflowHistory') return 'Version history';
  return ROUTE_TITLE[name] ?? '';
}
router.afterEach((to) => {
  const t = titleFor(to);
  document.title = t ? `${t} - nomops` : 'nomops';
});
