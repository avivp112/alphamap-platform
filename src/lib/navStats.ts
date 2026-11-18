import { supabase, fetchStartupsCount } from "./supabase";

// The few real numbers the top navigation shows: how big each data set is, and how fresh.
// Fetched when the menu first opens, then reused for ten minutes. Each figure is independent:
// one that cannot be read is null and simply not shown.

export interface NavStats {
  companies: number | null;
  firms: number | null;
  /** When any company record last changed (ISO). */
  updatedAt: string | null;
}

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; value: Promise<NavStats> } | null = null;

async function settle<T>(p: PromiseLike<T>): Promise<T | null> {
  try { return await p; } catch { return null; }
}

async function load(): Promise<NavStats> {
  const [companies, firms, updated] = await Promise.all([
    settle(fetchStartupsCount({})),
    settle(supabase.from("investors").select("id", { count: "exact", head: true }).then((r) => (r.error ? null : r.count ?? null))),
    settle(supabase.from("startups_search").select("updated_at").order("updated_at", { ascending: false }).limit(1).then((r) => (r.error ? null : (r.data?.[0]?.updated_at as string | undefined) ?? null))),
  ]);
  return { companies, firms, updatedAt: updated };
}

export function fetchNavStats(now: number = Date.now()): Promise<NavStats> {
  if (!cache || now - cache.at > TTL_MS) cache = { at: now, value: load() };
  return cache.value;
}

let filingCache: { at: number; value: Promise<string | null> } | null = null;

/** Date of the newest company deal on file (YYYY-MM-DD). Fetched only when the Data menu opens: deal_feed is the heaviest source. */
export function fetchLastFiling(now: number = Date.now()): Promise<string | null> {
  if (!filingCache || now - filingCache.at > TTL_MS) {
    filingCache = {
      at: now,
      value: settle(supabase.from("deal_feed").select("deal_date").eq("kind", "company").order("deal_date", { ascending: false }).limit(1)
        .then((r) => (r.error ? null : ((r.data?.[0]?.deal_date as string | undefined) ?? null)))),
    };
  }
  return filingCache.value;
}
