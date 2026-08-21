import { ref, watch } from 'vue';
import { zhCN } from './i18n-zh.js';
import { zhCNGenerated } from './i18n-zh-generated.js';

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
const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);

export const locale = ref<Locale>(stored === 'zh-CN' || stored === 'en' ? stored : 'en');
if (typeof document !== 'undefined') document.documentElement.lang = locale.value;

export function setLocale(next: Locale): void {
  locale.value = next;
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

/** t('Save') / t('Version {v}', { v }) —— 支持 {name} 占位符插值。 */
export function t(text: string, params?: Record<string, string | number>): string {
  let s = locale.value === 'en' ? text : translateExact(text);
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

const messages: Record<string, string> = { ...zhCNGenerated, ...zhCN };
const patterns = Object.entries(messages)
  .filter(([key]) => /\{\w+\}/.test(key))
  .map(([key, value]) => {
    const names: string[] = [];
    const source = key
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{(\w+)\\\}/g, (_match, name: string) => {
        names.push(name);
        return '(.+?)';
      });
    return { regex: new RegExp(`^${source}$`), names, value };
  });

/** Translate a complete UI message while preserving its surrounding whitespace. */
export function translateExact(text: string): string {
  if (locale.value === 'en' || !text || /[\u3400-\u9fff]/.test(text)) return text;
  const leading = text.match(/^\s*/)?.[0] ?? '';
  const trailing = text.match(/\s*$/)?.[0] ?? '';
  const source = text.slice(leading.length, text.length - trailing.length || undefined);
  const exact = messages[source];
  if (exact) return `${leading}${exact}${trailing}`;
  for (const pattern of patterns) {
    const match = source.match(pattern.regex);
    if (!match) continue;
    let translated = pattern.value;
    pattern.names.forEach((name, index) => {
      translated = translated.replaceAll(`{${name}}`, match[index + 1] ?? '');
    });
    return `${leading}${translated}${trailing}`;
  }
  return text;
}

export function hasTranslation(text: string): boolean {
  return Object.prototype.hasOwnProperty.call(messages, text);
}

const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const TRANSLATED_ATTRIBUTES = ['aria-label', 'placeholder', 'title'];
const IGNORE_SELECTOR = 'code, pre, textarea, [contenteditable="true"], [data-i18n-ignore], .cm-editor';
let translatingDom = false;

function translateTextNode(node: Text): void {
  if (node.parentElement?.closest(IGNORE_SELECTOR)) return;
  if (locale.value === 'en') {
    const original = originalText.get(node);
    if (original !== undefined && node.data !== original) node.data = original;
    originalText.delete(node);
    return;
  }
  const previous = originalText.get(node);
  if (previous !== undefined && node.data === translateExact(previous)) return;
  const translated = translateExact(node.data);
  if (translated !== node.data) {
    originalText.set(node, node.data);
    node.data = translated;
  }
}

function translateElement(element: Element): void {
  if (element.matches(IGNORE_SELECTOR)) return;
  let originals = originalAttributes.get(element);
  for (const name of TRANSLATED_ATTRIBUTES) {
    const current = element.getAttribute(name);
    if (locale.value === 'en') {
      const original = originals?.get(name);
      if (original !== undefined && current !== original) element.setAttribute(name, original);
      originals?.delete(name);
      continue;
    }
    if (!current) continue;
    const previous = originals?.get(name);
    if (previous !== undefined && current === translateExact(previous)) continue;
    const translated = translateExact(current);
    if (translated !== current) {
      originals ??= new Map();
      originals.set(name, current);
      element.setAttribute(name, translated);
    }
  }
  if (originals?.size) originalAttributes.set(element, originals);
  else originalAttributes.delete(element);
}

function translateTree(root: Node): void {
  translatingDom = true;
  try {
    if (root.nodeType === Node.TEXT_NODE) translateTextNode(root as Text);
    if (root.nodeType === Node.ELEMENT_NODE) translateElement(root as Element);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) {
      if (current.nodeType === Node.TEXT_NODE) translateTextNode(current as Text);
      else translateElement(current as Element);
    }
  } finally {
    translatingDom = false;
  }
}

/** Localize legacy static templates while views migrate to explicit t() calls. */
export function startDomTranslation(root: Element): () => void {
  translateTree(root);
  const observer = new MutationObserver((mutations) => {
    if (translatingDom) return;
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') translateTextNode(mutation.target as Text);
      else if (mutation.type === 'attributes') translateElement(mutation.target as Element);
      else for (const node of mutation.addedNodes) translateTree(node);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: TRANSLATED_ATTRIBUTES });
  const stop = watch(locale, () => queueMicrotask(() => translateTree(root)));
  return () => {
    stop();
    observer.disconnect();
  };
}
