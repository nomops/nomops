<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth.js';
import { SETTINGS_SECTIONS, SETTINGS_ICONS } from '../../lib/settings-nav.js';
import { t } from '../../lib/i18n.js';

/**
 * Settings flyout 菜单（对标基线）：主侧栏与 Chat 页共用。
 * 内容与 Settings 页专属侧栏完全一致（同一数据源）+ 底部 Sign out。
 */
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const auth = useAuthStore();

function go(key: string) {
  emit('close');
  void router.push({ name: 'settings', query: { s: key } });
}
function signOut() {
  emit('close');
  auth.logout();
  void router.push({ name: 'login' });
}
</script>

<template>
  <div class="settings-menu" data-test="settings-flyout" @click.stop>
    <button
      v-for="s in SETTINGS_SECTIONS"
      :key="s.key"
      class="sm-item"
      :data-test="`settings-${s.key}`"
      @click="go(s.key)"
    >
      <svg class="sm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" v-html="SETTINGS_ICONS[s.key]" />
      <span class="sm-label">{{ t(s.label) }}</span>
      <span v-if="s.badge" class="sm-badge" :class="s.badge.toLowerCase()">{{ t(s.badge) }}</span>
    </button>
    <div class="sm-sep" />
    <button class="sm-item" data-test="settings-logout" @click="signOut">
      <svg class="sm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
      <span class="sm-label">{{ t('Sign out') }}</span>
    </button>
  </div>
</template>

<style scoped>
.settings-menu {
  min-width: 250px; max-height: 78vh; overflow-y: auto;
  background: var(--panel, #26262e); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5); padding: 6px;
}
.sm-item {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  background: none; border: none; border-radius: 7px; padding: 8px 10px;
  font-size: 13px; color: var(--text); cursor: pointer; white-space: nowrap;
}
.sm-item:hover { background: var(--hover, rgba(255, 255, 255, 0.07)); }
.sm-ico { width: 15px; height: 15px; flex: none; color: var(--text-dim); }
.sm-item:hover .sm-ico { color: var(--text); }
.sm-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.sm-badge {
  font-size: 10px; padding: 1px 7px; border-radius: 8px; font-weight: 600;
}
.sm-badge.new { background: rgba(76, 157, 240, 0.18); color: #7db4f5; }
.sm-badge.preview { background: rgba(139, 92, 246, 0.2); color: #b39df1; }
.sm-sep { height: 1px; background: var(--border); margin: 5px 4px; }
</style>
