<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { navMenus } from '../../lib/marketing-content.js';

/** 营销站导航（浮动玻璃 pill + 下拉 mega-menu）。对标 n8n.io，品牌 nomops。 */
const router = useRouter();
const openLabel = ref<string | null>(null);

let closeTimer: ReturnType<typeof setTimeout> | undefined;
function openMenu(label: string) {
  clearTimeout(closeTimer);
  openLabel.value = label;
}
function scheduleClose() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => (openLabel.value = null), 120);
}
function go(to?: string) {
  openLabel.value = null;
  if (to) void router.push(to);
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') openLabel.value = null;
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="nav-outer">
    <nav class="nav" @mouseleave="scheduleClose">
      <RouterLink to="/" class="brand" @click="openLabel = null">
        <svg class="mark" viewBox="0 0 32 32" fill="none">
          <circle cx="7" cy="16" r="3" fill="#ff8a4c" />
          <circle cx="16" cy="9" r="3" fill="#ee4620" />
          <circle cx="16" cy="23" r="3" fill="#ee4620" />
          <circle cx="25" cy="16" r="3.4" fill="#ff8a4c" />
          <path d="M9.5 15 13.5 10.5M9.5 17 13.5 21.5M18.5 9.5 22.5 15M18.5 22.5 22.5 17" stroke="#7d7d8c" stroke-width="1.4" />
        </svg>
        nomops
      </RouterLink>

      <div class="nav-links">
        <div
          v-for="menu in navMenus"
          :key="menu.label"
          class="nav-item"
          @mouseenter="menu.columns ? openMenu(menu.label) : (openLabel = null)"
        >
          <button
            class="nav-link"
            :class="{ active: openLabel === menu.label }"
            @click="go(menu.to)"
            @focus="menu.columns ? openMenu(menu.label) : undefined"
          >
            {{ menu.label }}
            <svg v-if="menu.columns" class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6" /></svg>
          </button>

          <!-- Mega menu -->
          <div v-if="menu.columns && openLabel === menu.label" class="mega" @mouseenter="openMenu(menu.label)">
            <div class="mega-cols" :style="{ gridTemplateColumns: `repeat(${menu.columns.length}, minmax(220px, 1fr))` }">
              <div v-for="(col, ci) in menu.columns" :key="ci" class="mega-col">
                <button v-for="item in col" :key="item.title" class="mega-item" @click="go(item.to)">
                  <span v-if="item.icon" class="mega-ico">{{ item.icon }}</span>
                  <span class="mega-text">
                    <span class="mega-title">{{ item.title }}</span>
                    <span v-if="item.desc" class="mega-desc">{{ item.desc }}</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="nav-right">
        <a class="gh" href="#github">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.6 2 12.3c0 4.5 2.9 8.3 6.8 9.7.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .8.1-.7.3-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .3.3.7 1 .7 2v3c0 .3.2.6.7.5A10.3 10.3 0 0 0 22 12.3C22 6.6 17.5 2 12 2Z" /></svg>
          Star on GitHub
        </a>
        <RouterLink class="signin" to="/login">Sign in</RouterLink>
        <RouterLink class="mkt-btn mkt-btn-accent" to="/signup">Get Started</RouterLink>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.nav-outer { position: sticky; top: 14px; z-index: 100; padding: 14px 20px 0; }
.nav {
  max-width: var(--mkt-maxw); margin: 0 auto; display: flex; align-items: center; gap: 14px;
  height: 60px; padding: 0 12px 0 20px; background: rgba(22, 22, 30, 0.78); backdrop-filter: blur(14px);
  border: 1px solid var(--mkt-border2); border-radius: 16px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}
.brand { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 20px; letter-spacing: -0.01em; color: var(--mkt-text); }
.brand .mark { width: 30px; height: 30px; flex-shrink: 0; }

.nav-links { display: flex; align-items: center; gap: 2px; margin-left: 22px; }
.nav-item { position: relative; }
.nav-link {
  display: inline-flex; align-items: center; gap: 5px; padding: 8px 12px; border-radius: 8px;
  font-size: 14.5px; color: var(--mkt-dim); background: none; border: none; cursor: pointer; font-family: inherit;
  transition: color .15s, background .15s;
}
.nav-link:hover, .nav-link.active { color: var(--mkt-text); background: rgba(255, 255, 255, 0.05); }
.caret { width: 13px; height: 13px; opacity: .6; flex-shrink: 0; }

.mega {
  position: absolute; top: calc(100% + 10px); left: 0; z-index: 120;
  background: var(--mkt-panel); border: 1px solid var(--mkt-border2); border-radius: 14px;
  padding: 12px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
}
.mega-cols { display: grid; gap: 6px; }
.mega-col { display: flex; flex-direction: column; }
.mega-item {
  display: flex; align-items: flex-start; gap: 11px; text-align: left; width: 100%;
  padding: 10px 12px; border-radius: 10px; background: none; border: none; cursor: pointer; font-family: inherit;
  transition: background .13s;
}
.mega-item:hover { background: var(--mkt-bg2); }
.mega-ico {
  width: 34px; height: 34px; flex-shrink: 0; border-radius: 9px; background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--mkt-border); display: flex; align-items: center; justify-content: center; font-size: 16px;
}
.mega-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mega-title { font-size: 14px; font-weight: 600; color: var(--mkt-text); }
.mega-desc { font-size: 12.5px; color: var(--mkt-faint); line-height: 1.4; }
.mega-col:only-child .mega-item { min-width: 210px; }

.nav-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.gh {
  display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px;
  background: rgba(255, 255, 255, 0.06); border: 1px solid var(--mkt-border2); border-radius: 8px;
  font-size: 13.5px; color: var(--mkt-text);
}
.gh svg { width: 16px; height: 16px; flex-shrink: 0; }
.signin { font-size: 14.5px; color: var(--mkt-text); padding: 0 6px; }
.nav-right .mkt-btn { height: 38px; }

@media (max-width: 940px) {
  .nav-links { display: none; }
}
</style>
