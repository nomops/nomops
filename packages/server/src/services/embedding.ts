/**
 * 本地哈希词袋 embedding + 余弦检索（#44/#45 共用抽象，docs/13 决策 4）。
 * 并非所有 provider 都有 embedding 端点,本地实现让检索可离线测/可活验;生产可换真 provider embedding。
 * #44 分层记忆 与 #45 观察-反思记忆 共用这一套,避免两个 Epic 各造一份。
 */
const EMBED_DIM = 64;

export function embed(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean)) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h = (h ^ tok.charCodeAt(i)) >>> 0;
      h = (h * 16777619) >>> 0;
    }
    const idx = h % EMBED_DIM;
    v[idx] = (v[idx] ?? 0) + 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** 余弦相似度（两向量均已归一化 → 点积）。 */
export function cosine(a: number[], b: number[]): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) d += (a[i] ?? 0) * (b[i] ?? 0);
  return d;
}

/** 按相似度取 top-k（过滤低于阈值的噪声）。 */
export function topKMemories<T extends { embedding: number[] }>(query: number[], items: T[], k = 3, min = 0.05): T[] {
  return items
    .map((m) => ({ m, score: cosine(query, m.embedding) }))
    .filter((x) => x.score > min)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.m);
}
