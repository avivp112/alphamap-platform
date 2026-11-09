/**
 * lib/enrichment/articleBudget.ts — how many full articles a company's run reads (owner, 2026-11-07: six, not four).
 * MAX_ARTICLES sets it; ARTICLES_TO_READ, its older name, still works. Pure.
 */
export const DEFAULT_MAX_ARTICLES = 6;

export function maxArticles(env: Record<string, string | undefined> = process.env): number {
  for (const raw of [env.MAX_ARTICLES, env.ARTICLES_TO_READ]) {
    if (raw == null || raw.trim() === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return DEFAULT_MAX_ARTICLES;
}
