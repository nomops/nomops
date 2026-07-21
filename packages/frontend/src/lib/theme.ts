/* 主题偏好。令牌作用域键在 body（design-tokens.css）：
   - dark/light → 显式 body[data-theme=…]
   - system → 摘除属性，走 body:not([data-theme]) + prefers-color-scheme 跟随系统
   无已存偏好时默认暗色（保持产品现状；index.html 预置 data-theme=dark 防启动闪白）。 */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'nomops.theme';

export function savedTheme(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === 'system' || v === 'light' || v === 'dark' ? v : 'dark';
}

export function applyTheme(pref: ThemePref): void {
  if (pref === 'system') document.body.removeAttribute('data-theme');
  else document.body.setAttribute('data-theme', pref);
}

export function setTheme(pref: ThemePref): void {
  localStorage.setItem(KEY, pref);
  applyTheme(pref);
}
