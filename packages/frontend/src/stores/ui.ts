import { defineStore } from 'pinia';

export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 480;
const storedWidth = Number(localStorage.getItem('nomops.sidebarWidth'));

/** Shell 级 UI 状态：侧栏折叠 / 宽度、命令面板开关。 */
export const useUiStore = defineStore('ui', {
  state: () => ({
    sidebarCollapsed: localStorage.getItem('nomops.sidebarCollapsed') === '1',
    sidebarWidth: storedWidth >= SIDEBAR_MIN && storedWidth <= SIDEBAR_MAX ? storedWidth : 244,
    paletteOpen: false,
  }),
  actions: {
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      localStorage.setItem('nomops.sidebarCollapsed', this.sidebarCollapsed ? '1' : '0');
    },
    /** 拖拽调整侧栏宽度（clamp + 持久化）。 */
    setSidebarWidth(px: number) {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px)));
      this.sidebarWidth = w;
      localStorage.setItem('nomops.sidebarWidth', String(w));
    },
    openPalette() {
      this.paletteOpen = true;
    },
    closePalette() {
      this.paletteOpen = false;
    },
  },
});
