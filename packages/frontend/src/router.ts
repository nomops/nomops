import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth.js';

/** meta.public: 未登录可访问；meta.marketing: 全幅营销页（登录态也不套 app 外壳）。 */
const FeatureView = () => import('./views/marketing/FeatureView.vue');
const HubView = () => import('./views/marketing/HubView.vue');

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/signup', name: 'signup', component: () => import('./views/SignupView.vue'), meta: { public: true } },
    // 根路由：未登录渲染公开落地页，登录后渲染 Overview（RootView 分流）
    { path: '/', name: 'overview', component: () => import('./views/RootView.vue'), meta: { public: true } },

    // ── 营销站（对标 n8n.io 导航），全部公开 + marketing ──
    { path: '/product', name: 'm-product', component: FeatureView, meta: { public: true, marketing: true } },
    { path: '/product/:slug', name: 'm-product-item', component: FeatureView, meta: { public: true, marketing: true } },
    { path: '/use-cases', name: 'm-use-cases', component: HubView, meta: { public: true, marketing: true } },
    { path: '/use-cases/:slug', name: 'm-use-case', component: FeatureView, meta: { public: true, marketing: true } },
    { path: '/pricing', name: 'm-pricing', component: () => import('./views/marketing/PricingView.vue'), meta: { public: true, marketing: true } },
    { path: '/enterprise', name: 'm-enterprise', component: () => import('./views/marketing/EnterpriseView.vue'), meta: { public: true, marketing: true } },
    { path: '/docs', name: 'm-docs', component: HubView, meta: { public: true, marketing: true } },
    { path: '/docs/:slug', name: 'm-doc', component: FeatureView, meta: { public: true, marketing: true } },
    { path: '/community', name: 'm-community', component: HubView, meta: { public: true, marketing: true } },
    { path: '/community/:slug', name: 'm-community-item', component: FeatureView, meta: { public: true, marketing: true } },

    // 旧路径兼容：并入 Overview 的 tab
    { path: '/credentials', redirect: { path: '/', query: { tab: 'credentials' } } },
    { path: '/executions', redirect: { path: '/', query: { tab: 'executions' } } },
    { path: '/assistant', name: 'assistant', component: () => import('./views/AssistantView.vue') },
    { path: '/workflow/:id', name: 'canvas', component: () => import('./views/CanvasView.vue') },
    { path: '/datatables/:id', name: 'datatable', component: () => import('./views/DataTableView.vue') },
    { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue') },
    { path: '/projects', name: 'projects', component: () => import('./views/ProjectsView.vue') },
    { path: '/audit', name: 'audit', component: () => import('./views/AuditView.vue') },
    { path: '/insights', name: 'insights', component: () => import('./views/InsightsView.vue') },
    { path: '/templates', name: 'templates', component: () => import('./views/TemplatesView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    { path: '/sso/done', name: 'ssoDone', component: () => import('./views/SsoDoneView.vue'), meta: { public: true } },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!auth.token && !to.meta['public']) return { name: 'login' };
  if (auth.token && to.name === 'login') return { name: 'overview' };
  return true;
});
