/**
 * What's New 内容源（对标基线 Help 菜单的 What's New + 未读红点）。
 * 每次发布把亮点加到数组头部；id 单调递增，未读判定 = localStorage 里已读 id < 最新 id。
 */
export interface WhatsNewEntry {
  id: number;
  date: string; // YYYY-MM-DD
  title: string;
  points: string[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: 2,
    date: '2026-07-17',
    title: 'Canvas power-ups',
    points: [
      'Chat Trigger node — chat with your workflow from the canvas (Chat | Logs panel) or via POST /api/workflows/:id/chat',
      'Command bar (⌘K) now includes canvas actions: execute, publish, tidy up, import/export and more',
      'Focus panel — pin any node parameter and edit it while the workflow runs',
      'Tidy up (⇧⌥T), reset zoom, and a floating canvas toolbar',
      'Execute workflow from a specific trigger when there are several',
    ],
  },
  {
    id: 1,
    date: '2026-07-16',
    title: 'Overview & credentials refresh',
    points: [
      'Dependency pills on workflow and credential cards — see what references what, jump straight to it',
      'Executions table: auto refresh, multi-select delete, and retry (saved or original snapshot)',
      'Credentials can now be edited in place — blank fields keep their current value',
      'Folders get a naming dialog; the create button follows the active tab',
    ],
  },
];

export const LATEST_NEWS_ID = WHATS_NEW[0]?.id ?? 0;

const READ_KEY = 'nomops.whatsNewRead';

export function hasUnreadNews(): boolean {
  return Number(localStorage.getItem(READ_KEY) ?? 0) < LATEST_NEWS_ID;
}

export function markNewsRead(): void {
  localStorage.setItem(READ_KEY, String(LATEST_NEWS_ID));
}
