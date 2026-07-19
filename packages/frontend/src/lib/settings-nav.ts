/**
 * Settings 导航单一事实源（对标 n8n）：Settings 页专属侧栏、主侧栏 Settings flyout、
 * Chat 页 Settings flyout 三处共用（顺序 / 命名 / 徽标 / 图标一致）。
 */
export type SettingsSection =
  | 'billing'
  | 'personal'
  | 'languages'
  | 'users'
  | 'roles'
  | 'api'
  | 'secrets'
  | 'sourcecontrol'
  | 'sso'
  | 'security'
  | 'ldap'
  | 'logstream'
  | 'opentelemetry'
  | 'community'
  | 'mcp'
  | 'chat';

export const SETTINGS_SECTIONS: Array<{ key: SettingsSection; label: string; badge?: string }> = [
  { key: 'billing', label: 'Usage and plan' },
  { key: 'personal', label: 'Personal' },
  // D017/D132 对标 n8n:设置左导航无 "Languages"(section 渲染保留,仅移除导航入口)
  { key: 'users', label: 'Users' },
  { key: 'roles', label: 'Roles', badge: 'New' },
  { key: 'api', label: 'nomops API' },
  { key: 'secrets', label: 'External Secrets' },
  { key: 'sourcecontrol', label: 'Environments' },
  { key: 'sso', label: 'SSO' },
  { key: 'security', label: 'Security & policies' },
  { key: 'ldap', label: 'LDAP' },
  { key: 'logstream', label: 'Log Streaming' },
  { key: 'opentelemetry', label: 'OpenTelemetry' },
  { key: 'community', label: 'Community nodes' },
  { key: 'mcp', label: 'Instance-level MCP', badge: 'Preview' },
  { key: 'chat', label: 'Chat', badge: 'Preview' },
];

/** 24x24 stroke 图标 path（v-html 注入 svg）。 */
export const SETTINGS_ICONS: Record<SettingsSection, string> = {
  billing: '<path d="M4 19V9.5L8 5l4 4.5L16 5l4 4.5V19H4z" fill="none"/><path d="M4 19h16M8 15v1.5M12 13v3.5M16 15v1.5"/>',
  personal: '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c0-3.4 3-5.2 6.5-5.2s6.5 1.8 6.5 5.2"/>',
  languages: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3z"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.2 2.6-5 5.5-5 1 0 1.9.2 2.7.6"/><circle cx="17" cy="10" r="2.6"/><path d="M12.5 20c0-2.8 2.2-4.4 4.7-4.4S22 17.2 22 20"/>',
  roles: '<circle cx="12" cy="7.5" r="3"/><path d="M6 20c0-3.2 2.6-5.2 6-5.2s6 2 6 5.2"/><path d="M18.5 4.5l1.2 1.2M4.3 5.7l1.2-1.2"/>',
  api: '<circle cx="7" cy="12" r="3.2"/><path d="M10.2 12H21M17 12v3.5M20.5 12v2.5"/>',
  secrets: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  sourcecontrol: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M8.4 6.5c6 0 7.6 1.5 7.6 4.5M18 10.5c0 3.5-3 5-8 5"/>',
  sso: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3.5M21.5 12v2.5"/>',
  security: '<path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z"/>',
  ldap: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v3M6 16v-2.5h12V16"/>',
  logstream: '<path d="M4 12h11M11 8l4 4-4 4M20 5v14"/>',
  opentelemetry: '<path d="M4 4l4 5 4-2.5 4 5.5 4-3.5"/><path d="M4 20h16M6 20v-4M11 20v-6.5M16 20v-3.5M21 20v-6"/>',
  community: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14v7M14 17.5h7"/>',
  mcp: '<path d="M5 15c-1.7 0-3-1.3-3-3s1.3-3 3-3M5 9c0-3 2.5-5 5.5-5 2 0 3.7 1 4.6 2.6M19 9c1.7 0 3 1.3 3 3s-1.3 3-3 3M19 15c0 3-2.5 5-5.5 5-2 0-3.7-1-4.6-2.6"/>',
  chat: '<path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.6A8 8 0 1 1 21 12z"/>',
};
