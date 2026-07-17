<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from './stores/auth.js';
import { useProjectsStore } from './stores/projects.js';
import SideBar from './components/shell/SideBar.vue';
import CommandPalette from './components/shell/CommandPalette.vue';

const auth = useAuthStore();
const projects = useProjectsStore();
const route = useRoute();

// app 外壳（侧栏）：仅登录态。登录/注册等公开页走裸 RouterView。
const showShell = computed(() => Boolean(auth.token));
// Chat 页整页接管：专属侧栏替换主侧栏（对标 n8n Chat 页）
const chatHubTakeover = computed(() => route.name === 'chat');

onMounted(() => {
  if (auth.token) void projects.fetch();
});

watch(
  () => auth.token,
  (token) => {
    if (token) void projects.fetch();
  },
);
</script>

<template>
  <!-- app 外壳：左侧边栏 + 主区。营销全幅页 / 登录态外则走裸 RouterView -->
  <div v-if="showShell" class="app-shell">
    <SideBar v-if="!chatHubTakeover" />
    <div class="app-main">
      <RouterView
        :style="chatHubTakeover
          ? 'flex: 1; min-height: 0; display: flex; overflow: hidden'
          : 'flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto'"
      />
    </div>
    <CommandPalette />
  </div>
  <RouterView v-else />
</template>
