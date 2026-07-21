import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, savedTheme, setTheme } from '../theme.js';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.setAttribute('data-theme', 'dark'); // index.html 预置态
  });

  it('无已存偏好 → 默认 dark（保持产品现状）', () => {
    expect(savedTheme()).toBe('dark');
  });

  it('非法存值 → 回落 dark', () => {
    localStorage.setItem('nomops.theme', 'neon');
    expect(savedTheme()).toBe('dark');
  });

  it('light/dark 写到 body 的 data-theme（令牌作用域在 body，不在 html）', () => {
    applyTheme('light');
    expect(document.body.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    applyTheme('dark');
    expect(document.body.getAttribute('data-theme')).toBe('dark');
  });

  it('system → 摘除属性，走 prefers-color-scheme', () => {
    applyTheme('system');
    expect(document.body.hasAttribute('data-theme')).toBe(false);
  });

  it('setTheme 持久化 + 应用，savedTheme 可回读', () => {
    setTheme('light');
    expect(localStorage.getItem('nomops.theme')).toBe('light');
    expect(document.body.getAttribute('data-theme')).toBe('light');
    expect(savedTheme()).toBe('light');
  });
});
