<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from './stores/auth.js';
import { useProjectsStore } from './stores/projects.js';
import { useUiStore } from './stores/ui.js';
import { api } from './api/client.js';
import SideBar from './components/shell/SideBar.vue';
import CommandPalette from './components/shell/CommandPalette.vue';
import UiConfirmHost from './components/ui/UiConfirmHost.vue';
import UiToastHost from './components/ui/UiToastHost.vue';
import UiInputHost from './components/ui/UiInputHost.vue';
import { titleFor } from './router.js';
import { t } from './lib/i18n.js';

const auth = useAuthStore();
const projects = useProjectsStore();
const ui = useUiStore();
const route = useRoute();

/** #43：登录后从 users.settings 水合每用户偏好（DB 为准,替 localStorage）。 */
async function hydratePrefs() {
  const me = await api.me().catch(() => null);
  if (me?.settings) ui.hydrateFromServer(me.settings);
}

// app 外壳（侧栏）：仅登录态。登录/注册等公开页走裸 RouterView。
const showShell = computed(() => Boolean(auth.token));
// 整页接管路由（对标基线）：Chat 与 Settings 用专属侧栏替换主侧栏
const chatHubTakeover = computed(() => route.name === 'chat' || route.name === 'settings');
const currentPageTitle = computed(() => t(titleFor(route)) || 'nomops');

onMounted(() => {
  if (auth.token) {
    void projects.fetch();
    void hydratePrefs();
  }
});

watch(
  () => auth.token,
  (token) => {
    if (token) {
      void projects.fetch();
      void hydratePrefs();
    }
  },
);
</script>

<template>
  <!-- app 外壳：左侧边栏 + 主区。营销全幅页 / 登录态外则走裸 RouterView -->
  <div v-if="showShell" class="app-shell">
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <SideBar v-if="!chatHubTakeover" />
    <main id="main-content" class="app-main" tabindex="-1">
      <span class="sr-only" role="status" aria-live="polite">{{ currentPageTitle }}</span>
      <RouterView
        :style="chatHubTakeover
          ? 'flex: 1; min-height: 0; display: flex; overflow: hidden'
          : 'flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto'"
      />
    </main>
    <CommandPalette />
  </div>
  <RouterView v-else />
  <UiConfirmHost />
  <UiInputHost />
  <UiToastHost />
</template>
