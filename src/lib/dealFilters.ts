// =============================================================================
// src/lib/dealFilters.ts — pure helpers for the redesigned Deal Flow page
// (filter state, chips, "new since your last visit", rows that follow a
// watchlisted company). No React and no Supabase client, so vitest runs them in Node.
// =============================================================================

import type { DealFeedRow, DealKind } from "./dealFeed";
import { EMPTY_RANGE, rangeIsActive, rangeLabel, type ChipTr, type FilterChip, type MoneyRange } from "./startupFilters";

export type DealStatusFilter = "all" | "verified" | "unreviewed";

export interface DealFilterState {
  /** Sectors as the deal_feed view names them. Empty = any. */
  sectors: string[];
  /** Filed within this many days of today. null = any time. */
  filedWithinDays: number | null;
  /** Amount sold, whole USD. */
  sold: MoneyRange;
  status: DealStatusFilter;
  /** Only deals of companies / funds the user has on the watchlist. */
  followingOnly: boolean;
}

export const EMPTY_DEAL_FILTERS: DealFilterState = {
  sectors: [], filedWithinDays: null, sold: EMPTY_RANGE, status: "all", followingOnly: false,
};

/** The sectors deal_feed assigns to company deals (see Deals SECTOR_CONFIG), plus its fallback. */
export const DEAL_SECTORS = [
  "AI & ML", "Cybersecurity", "Fintech", "SaaS & Dev Tools", "Health & Life Sciences",
  "Climate & Energy", "DeepTech", "Technology",
] as const;

export const FILED_WINDOWS = [7, 30, 90] as const;

const M = 1_000_000;
export const SOLD_PRESETS = [
  { label: "Under $5M", min: null, max: 5 * M },
  { label: "$5M to $25M", min: 5 * M, max: 25 * M },
  { label: "$25M to $100M", min: 25 * M, max: 100 * M },
  { label: "$100M and up", min: 100 * M, max: null },
] as const;

export function activeDealFilterCount(f: DealFilterState): number {
  return (f.sectors.length > 0 ? 1 : 0) + (f.filedWithinDays != null ? 1 : 0) + (rangeIsActive(f.sold) ? 1 : 0)
    + (f.status !== "all" ? 1 : 0) + (f.followingOnly ? 1 : 0);
}

export function toggleSector(sectors: string[], s: string): string[] {
  return sectors.includes(s) ? sectors.filter((x) => x !== s) : [...sectors, s];
}

/** YYYY-MM-DD for "within the last N days" (UTC, like deal_date). */
export function filedCutoff(days: number, now: number = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

const identityTr: ChipTr = (_k, _v, fallback) => fallback;

/** One chip per active filter, in the order the filter bar shows them. */
export function buildDealChips(f: DealFilterState, tr: ChipTr = identityTr): FilterChip[] {
  const c: FilterChip[] = [];
  if (f.sectors.length) { const v = f.sectors.join(", "); c.push({ id: "sectors", label: tr("chip.sector", { value: v }, `Sector: ${v}`) }); }
  if (f.filedWithinDays != null) c.push({ id: "filed", label: tr("chip.filed", { count: f.filedWithinDays }, `Filed in the last ${f.filedWithinDays} days`) });
  if (rangeIsActive(f.sold)) { const v = rangeLabel(f.sold); c.push({ id: "sold", label: tr("chip.sold", { value: v }, `Sold: ${v}`) }); }
  if (f.status !== "all") {
    c.push({ id: "status", label: f.status === "verified" ? tr("chip.verified", {}, "Verified companies") : tr("chip.unreviewed", {}, "Not yet reviewed") });
  }
  if (f.followingOnly) c.push({ id: "following", label: tr("chip.following", {}, "Following only") });
  return c;
}

// ── "New since your last visit" ─────────────────────────────────────────────
// The feed has the date a deal was FILED, not the date AlphaMap first saw it. So "new" means filed
// after the newest filing the user had already seen. A filing that reaches the feed late, with an
// old date, is therefore not counted. The marker is kept in this browser only.

const SEEN_KEY = (kind: DealKind) => `am_deals_seen_${kind}`;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readSeenThrough(kind: DealKind): string | null {
  try {
    const v = localStorage.getItem(SEEN_KEY(kind));
    return v && ISO_DATE.test(v) ? v : null;
  } catch { return null; }
}

export function writeSeenThrough(kind: DealKind, iso: string): void {
  if (!ISO_DATE.test(iso)) return;
  try { localStorage.setItem(SEEN_KEY(kind), iso); } catch { /* storage blocked */ }
}

/** A deal filed after the newest filing already seen. With nothing seen yet, nothing is new. */
export function isNewDeal(row: Pick<DealFeedRow, "deal_date">, seenThrough: string | null): boolean {
  return seenThrough != null && row.deal_date > seenThrough;
}

// ── Following ───────────────────────────────────────────────────────────────

/** The watchlist entry a deal belongs to, or null when it is not in the database. */
export function followTarget(row: Pick<DealFeedRow, "kind" | "startup_id" | "investor_id">): { type: "startup" | "investor"; id: string } | null {
  if (row.kind === "company" && row.startup_id) return { type: "startup", id: row.startup_id };
  if (row.kind === "fund" && row.investor_id) return { type: "investor", id: row.investor_id };
  return null;
}

/** Ids of one kind out of a watchlist membership set (keys look like "startup:<id>"). */
export function followedIds(keys: ReadonlySet<string>, type: "startup" | "investor"): string[] {
  const prefix = `${type}:`;
  const out: string[] = [];
  for (const k of keys) if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
  return out;
}

/** An id that matches nothing, for "following only" when the watchlist is empty. */
export const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000";
