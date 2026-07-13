<script setup lang="ts">
import { useAuthStore } from '../stores/auth.js';
import LandingView from './LandingView.vue';
import OverviewView from './OverviewView.vue';

/**
 * 根路由 `/` 的分流：未登录 → 公开落地页（对标 n8n.io）；已登录 → Overview。
 * App.vue 外壳已按 auth.token 决定是否套 SideBar，这里只负责选组件。
 */
const auth = useAuthStore();
</script>

<template>
  <LandingView v-if="!auth.token" />
  <OverviewView v-else />
</template>
