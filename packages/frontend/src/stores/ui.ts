import { defineStore } from 'pinia';
import { api } from '../api/client.js';

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

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface UiToast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}
export interface InputDialogOptions {
  title: string;
  message?: string;
  label: string;
  value?: string;
  placeholder?: string;
  submitLabel?: string;
}

let toastId = 0;
let confirmResolver: ((confirmed: boolean) => void) | null = null;
let inputResolver: ((value: string | null) => void) | null = null;

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
    /** D026:面板上下文徽标（如 "Workflow · 名称"）。 */
    paletteContextLabel: null as string | null,
    toasts: [] as UiToast[],
    confirmDialog: null as (ConfirmDialogOptions & { open: true }) | null,
    inputDialog: null as (InputDialogOptions & { open: true }) | null,
    /** Settings → Chat 开关的共享状态：侧栏 Chat 入口实时显隐（切换即生效，无需刷新）。 */
    chatEnabled: true,
  }),
  actions: {
    /** #43：从服务端 users.settings 水合偏好（登录后调用；DB 为准,localStorage 只当快取）。 */
    hydrateFromServer(settings: Record<string, unknown> | undefined) {
      if (!settings) return;
      if (typeof settings['sidebarCollapsed'] === 'boolean') {
        this.sidebarCollapsed = settings['sidebarCollapsed'];
        localStorage.setItem('nomops.sidebarCollapsed', this.sidebarCollapsed ? '1' : '0');
      }
      const w = Number(settings['sidebarWidth']);
      if (w >= SIDEBAR_MIN && w <= SIDEBAR_MAX) {
        this.sidebarWidth = w;
        localStorage.setItem('nomops.sidebarWidth', String(w));
      }
    },
    /** 落库当前偏好（#43，fire-and-forget）。 */
    persistToServer() {
      void api.saveSettings({ sidebarCollapsed: this.sidebarCollapsed, sidebarWidth: this.sidebarWidth }).catch(() => undefined);
    },
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      localStorage.setItem('nomops.sidebarCollapsed', this.sidebarCollapsed ? '1' : '0');
      this.persistToServer();
    },
    /** 拖拽调整侧栏宽度（clamp + 持久化）。 */
    setSidebarWidth(px: number) {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px)));
      this.sidebarWidth = w;
      localStorage.setItem('nomops.sidebarWidth', String(w));
      this.persistToServer();
    },
    openPalette() {
      this.paletteOpen = true;
    },
    closePalette() {
      this.paletteOpen = false;
    },
    setPaletteContext(commands: PaletteCommand[], label: string | null = null) {
      this.paletteContext = commands;
      this.paletteContextLabel = label;
    },
    clearPaletteContext() {
      this.paletteContext = [];
      this.paletteContextLabel = null;
    },
    setChatEnabled(enabled: boolean) {
      this.chatEnabled = enabled;
    },
    notify(input: Omit<UiToast, 'id'>, duration = 4000) {
      const id = ++toastId;
      this.toasts.push({ id, ...input });
      if (duration > 0) window.setTimeout(() => this.dismissToast(id), duration);
      return id;
    },
    dismissToast(id: number) {
      this.toasts = this.toasts.filter((toast) => toast.id !== id);
    },
    requestConfirm(options: ConfirmDialogOptions) {
      if (confirmResolver) confirmResolver(false);
      this.confirmDialog = { ...options, open: true };
      return new Promise<boolean>((resolve) => {
        confirmResolver = resolve;
      });
    },
    resolveConfirm(confirmed: boolean) {
      const resolve = confirmResolver;
      confirmResolver = null;
      this.confirmDialog = null;
      resolve?.(confirmed);
    },
    requestInput(options: InputDialogOptions) {
      if (inputResolver) inputResolver(null);
      this.inputDialog = { ...options, open: true };
      return new Promise<string | null>((resolve) => {
        inputResolver = resolve;
      });
    },
    resolveInput(value: string | null) {
      const resolve = inputResolver;
      inputResolver = null;
      this.inputDialog = null;
      resolve?.(value);
    },
  },
});
