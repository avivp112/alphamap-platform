/**
 * lib/enrichment/searchCache.ts — per-company cache of everything fetched
 * from the web (Serper web/news results, Tavily results, website pages,
 * full article text), saved to disk so a re-run after a code fix re-uses
 * them instead of paying for the same searches again. Only Claude is
 * billed again on a re-run.
 *
 * One JSON file per company (cache/enrich_v2/<startup id>.json, git-
 * ignored), entries expire after SEARCH_CACHE_DAYS (default 30) so data
 * doesn't go stale. Only non-empty results are stored — an empty answer
 * may be a transient failure and is always retried.
 *
 *   SEARCH_CACHE=false       disable entirely
 *   SEARCH_CACHE_DAYS=30     entry lifetime
 *   SEARCH_CACHE_DIR=...     location (default cache/enrich_v2)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

interface Entry { savedAt: string; value: unknown }

export class SearchCache {
  hits = 0;
  private data: Record<string, Entry> = {};
  private dirty = false;

  constructor(private readonly file: string | null, private readonly maxAgeDays: number, private readonly now: () => number = Date.now) {
    if (file && existsSync(file)) {
      try { this.data = JSON.parse(readFileSync(file, "utf8")) as Record<string, Entry>; } catch { this.data = {}; }
    }
  }

  get<T>(key: string): T | undefined {
    const entry = this.data[key];
    if (!entry) return undefined;
    const ageDays = (this.now() - new Date(entry.savedAt).getTime()) / 86_400_000;
    if (!(ageDays <= this.maxAgeDays)) { delete this.data[key]; this.dirty = true; return undefined; }
    this.hits++;
    return entry.value as T;
  }

  set(key: string, value: unknown): void {
    if (value == null || (Array.isArray(value) && value.length === 0)) return;
    this.data[key] = { savedAt: new Date(this.now()).toISOString(), value };
    this.dirty = true;
  }

  save(): void {
    if (!this.file || !this.dirty) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data));
    this.dirty = false;
  }
}

/** The cache for one company, or undefined when SEARCH_CACHE=false. */
export function openSearchCache(companyId: string): SearchCache | undefined {
  if (process.env.SEARCH_CACHE === "false") return undefined;
  const dir = process.env.SEARCH_CACHE_DIR ?? join("cache", "enrich_v2");
  const days = Number(process.env.SEARCH_CACHE_DAYS ?? 30);
  return new SearchCache(join(dir, `${companyId.replace(/[^a-zA-Z0-9-]/g, "_")}.json`), days);
}
