import { defineStore } from 'pinia';

/** 视图注入命令面板的上下文命令（如画布的 Workflow 动作组）。 */
export interface PaletteCommand {
  id: string;
  label: string;
  /** 分组名（显示在副行，如 'Workflow'）。 */
  group: string;
  /** 快捷键标注（仅展示）。 */
  shortcut?: string;
  run: () => void;
}

/* D002 修正:基线主侧栏用 ResizeWrapper,min 200 / max 500,默认 200(量到的 201 = 200 + 1px 边框) */
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 500;
const storedWidth = Number(localStorage.getItem('nomops.sidebarWidth'));

/** Shell 级 UI 状态：侧栏折叠 / 宽度、命令面板开关。 */
export const useUiStore = defineStore('ui', {
  state: () => ({
    sidebarCollapsed: localStorage.getItem('nomops.sidebarCollapsed') === '1',
    sidebarWidth: storedWidth >= SIDEBAR_MIN && storedWidth <= SIDEBAR_MAX ? storedWidth : 200,
    paletteOpen: false,
    /** 当前视图注入的上下文命令（离开视图时清空）。 */
    paletteContext: [] as PaletteCommand[],
    /** Settings → Chat 开关的共享状态：侧栏 Chat 入口实时显隐（切换即生效，无需刷新）。 */
    chatEnabled: true,
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
    setPaletteContext(commands: PaletteCommand[]) {
      this.paletteContext = commands;
    },
    clearPaletteContext() {
      this.paletteContext = [];
    },
    setChatEnabled(enabled: boolean) {
      this.chatEnabled = enabled;
    },
  },
});
