import { ref } from 'vue';
import { zhCN } from './i18n-zh.js';

/**
 * 轻量 i18n：以英文原文为 key 查词典，未收录词条回落英文。
 * locale 是响应式 ref —— 模板里调用 t() 会订阅它，切换语言即时全局生效。
 */
export type Locale = 'en' | 'zh-CN';

export const LOCALES: Array<{ value: Locale; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
];

const STORAGE_KEY = 'nomops.locale';
const stored = localStorage.getItem(STORAGE_KEY);

export const locale = ref<Locale>(stored === 'zh-CN' || stored === 'en' ? stored : 'en');
document.documentElement.lang = locale.value;

export function setLocale(next: Locale): void {
  locale.value = next;
  localStorage.setItem(STORAGE_KEY, next);
  document.documentElement.lang = next;
}

/** t('Save') / t('Version {v}', { v }) —— 支持 {name} 占位符插值。 */
export function t(text: string, params?: Record<string, string | number>): string {
  let s = locale.value === 'en' ? text : (zhCN[text] ?? text);
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}
