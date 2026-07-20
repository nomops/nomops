/**
 * SVG 图标库（画布节点 + 凭证），对标基线的图标观感。
 *
 * 两类图标：
 *  - line()  ：单色描线图标，走 `currentColor`，由调用方传入的 accent 着色（核心节点 / 通用鉴权）。
 *  - brand() ：品牌标记，自带官方配色，忽略 accent（Slack / GitHub / Stripe…）。
 *
 * 统一 24×24 viewBox，不写 width/height（由 <IconSvg> 用 CSS 控制尺寸）。
 */

export interface IconVisual {
  /** 完整 <svg> 字符串。 */
  svg: string;
  /** line 图标的着色（brand 图标为 ''，自带配色）。 */
  color: string;
}

const line = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const brand = (body: string): string => `<svg viewBox="0 0 24 24" fill="none">${body}</svg>`;

// ── 单色描线图标（currentColor） ─────────────────────────────────────────
const GLYPH = {
  mousePointer: line('<path d="M5 3l0 14.4 3.5-3.4 2 4.9 2.6-1.1-2-4.8 5.1 0z"/>'),
  webhook: line(
    '<circle cx="8" cy="7" r="2.1"/><circle cx="6.4" cy="16.4" r="2.1"/><circle cx="17" cy="15" r="2.1"/><path d="M8.2 9.1l2.5 4.2M10 6.2A5 5 0 0 1 15.5 12.9M8.5 15.9a4.9 4.9 0 0 0 6.4-.5"/>',
  ),
  clock: line('<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.3 2"/>'),
  broadcast: line(
    '<circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/><path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 15.7a5.2 5.2 0 0 0 0-7.4M5.8 5.8a8.7 8.7 0 0 0 0 12.4M18.2 18.2a8.7 8.7 0 0 0 0-12.4"/>',
  ),
  pen: line('<path d="M4 20h4L18.7 9.3a1.9 1.9 0 0 0-2.7-2.7L5 17.3z"/><path d="M14.5 8.5l3 3"/>'),
  arrowRight: line('<circle cx="12" cy="12" r="8.4"/><path d="M8.4 12h6.6M12.2 9.2l3 2.8-3 2.8"/>'),
  branch: line(
    '<circle cx="6.5" cy="6" r="2"/><circle cx="6.5" cy="18" r="2"/><circle cx="17.5" cy="12" r="2"/><path d="M6.5 8v8M8.4 6h3.1a4 4 0 0 1 4 4v.4M8.4 18h3.1a4 4 0 0 0 4-4v-.4"/>',
  ),
  merge: line(
    '<circle cx="5.5" cy="6.5" r="2"/><circle cx="5.5" cy="17.5" r="2"/><circle cx="18" cy="12" r="2"/><path d="M7.5 6.9c4 .6 4.5 2.4 4.5 5.1M7.5 17.1c4-.6 4.5-2.4 4.5-5.1M12 12h4"/>',
  ),
  code: line('<path d="M8.5 8L5 12l3.5 4M15.5 8l3.5 4-3.5 4M13.5 6l-3 12"/>'),
  globe: line(
    '<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8M12 3.6c2.4 2.3 2.4 14.5 0 16.8M12 3.6c-2.4 2.3-2.4 14.5 0 16.8"/>',
  ),
  subflow: line(
    '<rect x="2.6" y="9" width="5.6" height="6" rx="1.3"/><rect x="15.8" y="3.8" width="5.6" height="6" rx="1.3"/><rect x="15.8" y="14.2" width="5.6" height="6" rx="1.3"/><path d="M8.2 12h3.6M11.8 12V6.8h4M11.8 12v5.2h4"/>',
  ),
  pause: line('<circle cx="12" cy="12" r="8.4"/><path d="M10 8.8v6.4M14 8.8v6.4"/>'),
  robot: line(
    '<rect x="4.5" y="8" width="15" height="11" rx="2.6"/><circle cx="12" cy="4.4" r="1.2" fill="currentColor" stroke="none"/><path d="M12 5.6V8"/><circle cx="9.4" cy="13" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.6" cy="13" r="1.1" fill="currentColor" stroke="none"/><path d="M9.6 16h4.8M2.8 11.5v3M21.2 11.5v3"/>',
  ),
  wrench: line(
    '<path d="M15.6 4.3a4.6 4.6 0 0 0-6 5.9L4 15.7 8.3 20l5.5-5.6a4.6 4.6 0 0 0 5.9-6l-2.9 2.9-2.5-.6-.6-2.5z"/>',
  ),
  memory: line(
    '<rect x="6.4" y="6.4" width="11.2" height="11.2" rx="1.6"/><rect x="9.6" y="9.6" width="4.8" height="4.8" rx="0.8"/><path d="M9.2 3.4v2.8M12 3.4v2.8M14.8 3.4v2.8M9.2 17.8v2.8M12 17.8v2.8M14.8 17.8v2.8M3.4 9.2h2.8M3.4 12h2.8M3.4 14.8h2.8M17.8 9.2h2.8M17.8 12h2.8M17.8 14.8h2.8"/>',
  ),
  note: line(
    '<path d="M5 3.6h9.5L19.5 8.6V20.4H5z"/><path d="M14.2 3.6v5h5"/><path d="M8 12.5h6M8 15.8h4"/>',
  ),
  dot: line('<circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/>'),

  // 通用鉴权 / 类别图标（凭证用）
  key: line(
    '<circle cx="8.2" cy="8.2" r="4.4"/><path d="M11.3 11.3l7.5 7.5M15.5 15.5l2-2M17.5 17.5l1.6-1.6"/>',
  ),
  user: line('<circle cx="12" cy="8.4" r="3.8"/><path d="M5 20c0-3.8 3.2-5.8 7-5.8s7 2 7 5.8"/>'),
  lock: line(
    '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/>',
  ),
  searchKey: line(
    '<circle cx="10.5" cy="10.5" r="6"/><path d="M14.8 14.8L20 20M8.6 10.5h3.8M10.5 8.6v3.8"/>',
  ),
  link: line(
    '<path d="M9.5 14.5l5-5M8.5 12.5l-2 2a3.2 3.2 0 0 0 4.5 4.5l2-2M15.5 11.5l2-2a3.2 3.2 0 0 0-4.5-4.5l-2 2"/>',
  ),
  unlock: line(
    '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 7.8-1.2"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/>',
  ),
  database: line(
    '<ellipse cx="12" cy="5.6" rx="7" ry="2.8"/><path d="M5 5.6v12.8c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8V5.6M5 12c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8"/>',
  ),
  cloud: line('<path d="M7 18a4.2 4.2 0 0 1-.5-8.37A5.6 5.6 0 0 1 17.3 9.1 3.9 3.9 0 0 1 18 18H7z"/>'),
  envelope: line('<rect x="3.2" y="5.5" width="17.6" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>'),
  calendar: line(
    '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8 3.2v3.6M16 3.2v3.6"/>',
  ),
  chat: line('<path d="M20 14a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>'),
  ticket: line(
    '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4 2 2 0 0 0 0-4z"/><path d="M14 6.5v11" stroke-dasharray="1.6 2"/>',
  ),
  cart: line(
    '<circle cx="9" cy="20" r="1.4" fill="currentColor" stroke="none"/><circle cx="17" cy="20" r="1.4" fill="currentColor" stroke="none"/><path d="M3 4h2l2.2 11.2a1.5 1.5 0 0 0 1.5 1.2h8.1a1.5 1.5 0 0 0 1.5-1.2L20.5 8H6.2"/>',
  ),
  board: line(
    '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="7" y="7" width="3.5" height="9" rx="0.6" fill="currentColor" stroke="none"/><rect x="13.5" y="7" width="3.5" height="5.5" rx="0.6" fill="currentColor" stroke="none"/>',
  ),
  checklist: line(
    '<path d="M4 6.5l1.6 1.6L8.5 5M4 12.5l1.6 1.6L8.5 11M4 18.5l1.6 1.6L8.5 17M11.5 7h8M11.5 13h8M11.5 19h8"/>',
  ),
  contacts: line(
    '<circle cx="9" cy="8.6" r="3.2"/><path d="M3.5 19c0-3.1 2.5-4.8 5.5-4.8s5.5 1.7 5.5 4.8"/><circle cx="17.5" cy="9.5" r="2.4"/><path d="M15 14.4c2.3-.6 5 .8 5 3.9"/>',
  ),
  video: line('<rect x="3.5" y="7" width="12" height="10" rx="2"/><path d="M15.5 10.5l5-3v9l-5-3z"/>'),
  phone: line(
    '<path d="M6.5 4.5c.5 0 1 .3 1.2.8l1.2 2.9c.2.5.1 1-.3 1.4l-1.3 1.2a11 11 0 0 0 4.9 4.9l1.2-1.3c.4-.4.9-.5 1.4-.3l2.9 1.2c.5.2.8.7.8 1.2v2.7c0 .9-.8 1.6-1.6 1.5C10.6 21.7 4.3 15.4 4.5 6.1c0-.9.7-1.6 1.5-1.6z"/>',
  ),
  headset: line(
    '<path d="M5 13v-1a7 7 0 0 1 14 0v1"/><rect x="3.5" y="13" width="3.5" height="6" rx="1.4"/><rect x="17" y="13" width="3.5" height="6" rx="1.4"/><path d="M19 19v.6a2.4 2.4 0 0 1-2.4 2.4H12"/>',
  ),
  sprocket: line(
    '<path d="M15.5 5.4V2.6"/><circle cx="15.5" cy="8" r="2.8"/><path d="M13.4 9.7 9.2 13.8M15.5 10.8v2.4"/><circle cx="7.5" cy="15.6" r="2.4"/><circle cx="15.5" cy="15.6" r="2.2"/>',
  ),
  funnel: line('<path d="M4 5h16l-6 7v6l-4 2v-8z"/>'),
  grid: line('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5h16M4 15h16M9.5 4v16"/>'),
  layers: line('<path d="M12 3.5 21 8l-9 4.5L3 8z"/><path d="M3 12l9 4.5L21 12M3 16l9 4.5L21 16"/>'),
};

// ── 品牌标记（自带配色） ─────────────────────────────────────────────────
const BRAND = {
  slack: brand(
    '<g stroke="none">' +
      '<path fill="#E01E5A" d="M7.6 14.4a1.9 1.9 0 1 1-3.8 0 1.9 1.9 0 0 1 1.9-1.9h1.9zM8.5 14.4a1.9 1.9 0 0 1 3.8 0v4.7a1.9 1.9 0 1 1-3.8 0z"/>' +
      '<path fill="#36C5F0" d="M10.4 6.9a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 1.9 1.9v1.9zM10.4 7.8a1.9 1.9 0 0 1 0 3.8H5.7a1.9 1.9 0 1 1 0-3.8z"/>' +
      '<path fill="#2EB67D" d="M17.9 10.4a1.9 1.9 0 1 1 3.8 0 1.9 1.9 0 0 1-1.9 1.9h-1.9zM17 10.4a1.9 1.9 0 0 1-3.8 0V5.7a1.9 1.9 0 1 1 3.8 0z"/>' +
      '<path fill="#ECB22E" d="M14.4 17.9a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1-1.9-1.9v-1.9zM14.4 17a1.9 1.9 0 0 1 0-3.8h4.7a1.9 1.9 0 1 1 0 3.8z"/>' +
      '</g>',
  ),
  github: brand(
    '<path fill="#e6e6e6" d="M12 2C6.48 2 2 6.58 2 12.26c0 4.5 2.87 8.32 6.84 9.67.5.09.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 2.5-.34c.85 0 1.71.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.02 10.02 0 0 0 22 12.26C22 6.58 17.52 2 12 2z"/>',
  ),
  notion: brand(
    '<path fill="#ffffff" stroke="none" d="M5.6 5h3.4l5.4 8V5h2.9v14h-3.3L8.5 10.4V19H5.6z"/>',
  ),
  stripe: brand(
    '<path fill="#635BFF" stroke="none" d="M11.4 9.6c0-.65.53-.9 1.4-.9 1.24 0 2.8.38 4.05 1.05V6.2A10.6 10.6 0 0 0 12.8 5.4C9.66 5.4 7.6 7.04 7.6 9.78c0 4.27 5.87 3.6 5.87 5.44 0 .76-.65 1-1.57 1-1.35 0-3.08-.56-4.45-1.3v3.5c1.5.65 3.05.93 4.45.93 3.22 0 5.45-1.59 5.45-4.36 0-4.61-5.9-3.8-5.9-5.52z"/>',
  ),
  sendgrid: brand(
    '<g stroke="none">' +
      '<rect x="4" y="4" width="7.6" height="7.6" rx="0.6" fill="#99e1f4"/>' +
      '<rect x="12.4" y="4" width="7.6" height="7.6" rx="0.6" fill="#1a82e2"/>' +
      '<rect x="4" y="12.4" width="7.6" height="7.6" rx="0.6" fill="#1a82e2"/>' +
      '<rect x="12.4" y="12.4" width="7.6" height="7.6" rx="0.6" fill="#00b3e3"/>' +
      '</g>',
  ),
  hackerNews: brand(
    '<rect x="3" y="3" width="18" height="18" rx="2" fill="#ff6600"/><path fill="#ffffff" d="M11.1 12.3L7.7 6h2l2.4 4.6L14.4 6h1.9l-3.4 6.3V17h-1.8z"/>',
  ),
  anthropic: brand(
    '<g stroke="#D97757" stroke-width="1.9" stroke-linecap="round"><path d="M12 3v18M3 12h18M5.8 5.8l12.4 12.4M18.2 5.8 5.8 18.2M7.7 4.1l8.6 15.8M16.3 4.1 7.7 19.9M4.1 7.7l15.8 8.6M4.1 16.3 19.9 7.7"/></g>',
  ),
  openai: brand(
    '<path fill="#ffffff" stroke="none" d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6 6 0 0 0 4.98 4.18a5.98 5.98 0 0 0-3.99 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 22a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zM13.26 20.5a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.3zM3.6 16.38a4.47 4.47 0 0 1-.54-3.01l.14.09 4.78 2.76a.78.78 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 20.05a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.48 4.48 0 0 1 2.35-1.97v5.68a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.9zm16.61 3.86l-5.84-3.39L15.13 7.2a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.4-.65zm2.01-3.03l-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.44 9.24V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.34 12.85l-2.02-1.17a.08.08 0 0 1-.04-.05V6.05a4.5 4.5 0 0 1 7.38-3.45l-.14.08L8.72 5.44a.79.79 0 0 0-.39.68zm1.1-2.37L12 8.98l2.6 1.5v3l-2.6 1.5-2.6-1.5z"/>',
  ),
  airtable: brand(
    '<g stroke="none">' +
      '<path fill="#FCB400" d="M11.3 4.2 3.8 7.3c-.5.2-.5.6 0 .8l7.5 3c.5.2 1.3.2 1.8 0l7.5-3c.5-.2.5-.6 0-.8l-7.5-3.1c-.5-.2-1.3-.2-1.8 0z"/>' +
      '<path fill="#18BFFF" d="M11 12.6 3.7 9.1c-.35-.15-.7.1-.7.5v6.7c0 .4.2.75.55.9l7 3c.4.15.75-.1.75-.5v-6.6c0-.2-.1-.4-.3-.5z"/>' +
      '<path fill="#F82B60" d="M13 12.7v6.5c0 .4.35.65.7.5l6.9-3c.35-.15.55-.5.55-.9V9.6c0-.3-.3-.5-.6-.35z"/>' +
      '</g>',
  ),
  asana: brand(
    '<g stroke="none" fill="#F06A6A"><circle cx="12" cy="6.4" r="3"/><circle cx="6.3" cy="15.4" r="3"/><circle cx="17.7" cy="15.4" r="3"/></g>',
  ),
  discord: brand(
    '<path fill="#5865F2" stroke="none" d="M19.5 6.3A16 16 0 0 0 15.5 5l-.2.4a12 12 0 0 1 3.5 1.8c-4.1-1.9-8.5-1.9-12.6 0A12 12 0 0 1 9.7 5.4L9.5 5a16 16 0 0 0-4 1.3C2.9 10.1 2.2 13.8 2.5 17.4a16 16 0 0 0 4.9 2.5l.5-.9a10 10 0 0 1-1.6-.8l.4-.3c3.1 1.4 6.5 1.4 9.6 0l.4.3a10 10 0 0 1-1.6.8l.5.9a16 16 0 0 0 4.9-2.5c.4-4.2-.7-7.8-2.9-11.1zM9 15c-.9 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.8 2-1.7 2zm6 0c-.9 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.8 2-1.7 2z"/>',
  ),
  dropbox: brand(
    '<g fill="#0061FF" stroke="none"><path d="M7.5 4 3 7l4.5 3L12 7zM16.5 4 12 7l4.5 3L21 7zM3 13l4.5 3L12 13 7.5 10zM16.5 10 12 13l4.5 3 4.5-3zM7.5 17l4.5 3 4.5-3-4.5-3z"/></g>',
  ),
  telegram: brand(
    '<path fill="#26A5E4" stroke="none" d="M21.2 4.3 2.9 11.4c-.9.35-.9 1.2-.15 1.45l4.6 1.45 1.75 5.5c.2.55.15.75.75.75.45 0 .65-.2.9-.45l2.2-2.15 4.55 3.36c.85.47 1.45.22 1.65-.78l3-14.1c.3-1.24-.5-1.8-1.7-1.38z"/><path fill="#c8daea" stroke="none" d="m8.3 14 9.3-5.9c.4-.25.8.05.5.35L10.5 15.7l-.3 3.2z"/>',
  ),
  jira: brand(
    '<path fill="#2684FF" stroke="none" d="M12 2.4 4.3 10.1a1 1 0 0 0 0 1.4l3.1 3.1L12 10l4.6 4.6 3.1-3.1a1 1 0 0 0 0-1.4z"/><path fill="#2684FF" opacity="0.6" stroke="none" d="M12 10.9 7.4 15.5l3.9 3.9a1 1 0 0 0 1.4 0l3.9-3.9z"/>',
  ),
  linear: brand(
    '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill="#5E6AD2" stroke="none"/><path stroke="#fff" stroke-width="1.6" stroke-linecap="round" d="M6.5 13.5 13.5 6.5M8.5 16 16 8.5M11.5 17.5 17.5 11.5"/>',
  ),
  gitlab: brand(
    '<g stroke="none">' +
      '<path fill="#E24329" d="M12 20.5 8.9 11H15.1z"/>' +
      '<path fill="#FC6D26" d="M12 20.5 8.9 11H4.6z"/>' +
      '<path fill="#FCA326" d="M4.6 11 3.6 14.1c-.1.3 0 .6.3.8L12 20.5z"/>' +
      '<path fill="#E24329" d="M4.6 11H8L6.5 6.3c-.1-.25-.5-.25-.6 0z"/>' +
      '<path fill="#FC6D26" d="M12 20.5 15.1 11h4.3z"/>' +
      '<path fill="#FCA326" d="M19.4 11l1 3.1c.1.3 0 .6-.3.8L12 20.5z"/>' +
      '<path fill="#E24329" d="M19.4 11H16l1.5-4.7c.1-.25.5-.25.6 0z"/>' +
      '</g>',
  ),
  googleDrive: brand(
    '<g stroke="none">' +
      '<path fill="#FFBA00" d="M8.7 4h6.6l6.2 10.7h-6.6z"/>' +
      '<path fill="#0066DA" d="M8.7 4 2.5 14.7 5.8 20.4 12 9.6z"/>' +
      '<path fill="#00AC47" d="M5.8 20.4h12.4l3.3-5.7H9.1z"/>' +
      '</g>',
  ),
};

// ── 节点类型（短名）→ 图标 ───────────────────────────────────────────────
const NODE: Record<string, IconVisual> = {
  manualTrigger: { svg: GLYPH.mousePointer, color: '#b0b0bb' },
  chatTrigger: { svg: GLYPH.chat, color: '#4cc38a' },
  webhook: { svg: GLYPH.webhook, color: '#8b5cf6' },
  schedule: { svg: GLYPH.clock, color: '#f5a623' },
  pollingTrigger: { svg: GLYPH.broadcast, color: '#f5a623' },
  set: { svg: GLYPH.pen, color: '#4c9df0' },
  noOp: { svg: GLYPH.arrowRight, color: '#9a9aa6' },
  if: { svg: GLYPH.branch, color: '#4cc38a' },
  merge: { svg: GLYPH.merge, color: '#4cc38a' },
  code: { svg: GLYPH.code, color: '#e4e4ea' },
  httpRequest: { svg: GLYPH.globe, color: '#4c9df0' },
  executeWorkflow: { svg: GLYPH.subflow, color: '#8b5cf6' },
  wait: { svg: GLYPH.pause, color: '#f5a623' },
  aiAgent: { svg: GLYPH.robot, color: '#ff6900' },
  anthropicChatModel: { svg: BRAND.anthropic, color: '' },
  httpTool: { svg: GLYPH.wrench, color: '#8b5cf6' },
  windowMemory: { svg: GLYPH.memory, color: '#4cc38a' },
  slack: { svg: BRAND.slack, color: '' },
  github: { svg: BRAND.github, color: '' },
  sendGrid: { svg: BRAND.sendgrid, color: '' },
  stripe: { svg: BRAND.stripe, color: '' },
  notion: { svg: BRAND.notion, color: '' },
  hackerNews: { svg: BRAND.hackerNews, color: '' },
  stickyNote: { svg: GLYPH.note, color: '#f3d34a' },
};

// ── 凭证类型 → 图标 ──────────────────────────────────────────────────────
const CRED: Record<string, IconVisual> = {
  // 通用鉴权
  httpHeaderAuth: { svg: GLYPH.key, color: '#b0b0bb' },
  httpBasicAuth: { svg: GLYPH.user, color: '#b0b0bb' },
  httpDigestAuth: { svg: GLYPH.lock, color: '#b0b0bb' },
  httpQueryAuth: { svg: GLYPH.searchKey, color: '#b0b0bb' },
  oauth2Api: { svg: GLYPH.link, color: '#4c9df0' },
  oauth1Api: { svg: GLYPH.link, color: '#4c9df0' },
  demoOAuth2: { svg: GLYPH.unlock, color: '#4cc38a' },

  // 品牌
  anthropicApi: { svg: BRAND.anthropic, color: '' },
  openAiApi: { svg: BRAND.openai, color: '' },
  activeCampaignApi: { svg: GLYPH.envelope, color: '#356AE6' },
  acuitySchedulingApi: { svg: GLYPH.calendar, color: '#1B489B' },
  airtableApi: { svg: BRAND.airtable, color: '' },
  airtableOAuth2Api: { svg: BRAND.airtable, color: '' },
  asanaApi: { svg: BRAND.asana, color: '' },
  asanaOAuth2Api: { svg: BRAND.asana, color: '' },
  aws: { svg: GLYPH.cloud, color: '#FF9900' },
  clickUpApi: { svg: GLYPH.grid, color: '#7B68EE' },
  discordApi: { svg: BRAND.discord, color: '' },
  discordWebhook: { svg: BRAND.discord, color: '' },
  dropboxApi: { svg: BRAND.dropbox, color: '' },
  dropboxOAuth2Api: { svg: BRAND.dropbox, color: '' },
  freshdeskApi: { svg: GLYPH.ticket, color: '#25C16F' },
  githubApi: { svg: BRAND.github, color: '' },
  githubOAuth2Api: { svg: BRAND.github, color: '' },
  gitlabApi: { svg: BRAND.gitlab, color: '' },
  gmailOAuth2: { svg: GLYPH.envelope, color: '#EA4335' },
  googleCalendarOAuth2Api: { svg: GLYPH.calendar, color: '#4285F4' },
  googleDriveOAuth2Api: { svg: BRAND.googleDrive, color: '' },
  googleSheetsOAuth2Api: { svg: GLYPH.grid, color: '#0F9D58' },
  hubspotApi: { svg: GLYPH.sprocket, color: '#FF7A59' },
  hubspotOAuth2Api: { svg: GLYPH.sprocket, color: '#FF7A59' },
  intercomApi: { svg: GLYPH.chat, color: '#1F8DED' },
  jiraApi: { svg: BRAND.jira, color: '' },
  linearApi: { svg: BRAND.linear, color: '' },
  mailchimpApi: { svg: GLYPH.envelope, color: '#FFE01B' },
  mattermostApi: { svg: GLYPH.chat, color: '#0058CC' },
  microsoftOutlookOAuth2Api: { svg: GLYPH.envelope, color: '#0078D4' },
  microsoftTeamsOAuth2Api: { svg: GLYPH.contacts, color: '#6264A7' },
  mongoDb: { svg: GLYPH.database, color: '#47A248' },
  mySql: { svg: GLYPH.database, color: '#4479A1' },
  notionApi: { svg: BRAND.notion, color: '' },
  notionOAuth2Api: { svg: BRAND.notion, color: '' },
  pipedriveApi: { svg: GLYPH.funnel, color: '#017737' },
  postgres: { svg: GLYPH.database, color: '#4169E1' },
  redis: { svg: GLYPH.layers, color: '#DC382D' },
  salesforceOAuth2Api: { svg: GLYPH.cloud, color: '#00A1E0' },
  sendGridApi: { svg: BRAND.sendgrid, color: '' },
  shopifyApi: { svg: GLYPH.cart, color: '#95BF47' },
  slackApi: { svg: BRAND.slack, color: '' },
  slackOAuth2Api: { svg: BRAND.slack, color: '' },
  stripeApi: { svg: BRAND.stripe, color: '' },
  telegramApi: { svg: BRAND.telegram, color: '' },
  todoistApi: { svg: GLYPH.checklist, color: '#E44332' },
  todoistOAuth2Api: { svg: GLYPH.checklist, color: '#E44332' },
  trelloApi: { svg: GLYPH.board, color: '#0079BF' },
  trelloOAuth2Api: { svg: GLYPH.board, color: '#0079BF' },
  twilioApi: { svg: GLYPH.phone, color: '#F22F46' },
  zendeskApi: { svg: GLYPH.headset, color: '#78A300' },
  zohoOAuth2Api: { svg: GLYPH.contacts, color: '#E42527' },
  zoomOAuth2Api: { svg: GLYPH.video, color: '#2D8CFF' },
};

/** 剥掉包前缀（nomops.manualTrigger → manualTrigger）。 */
const shortName = (type: string): string =>
  type.includes('.') ? type.slice(type.lastIndexOf('.') + 1) : type;

/** 画布节点 / 节点面板：类型（全名或短名）→ SVG 图标。 */
export function nodeIcon(type: string): IconVisual {
  return NODE[shortName(type)] ?? { svg: GLYPH.dot, color: '#9a9aa6' };
}

/** 凭证类型 → SVG 图标（未登记时回落到通用钥匙）。 */
export function credentialIcon(type: string): IconVisual {
  return CRED[type] ?? { svg: GLYPH.key, color: '#b0b0bb' };
}
