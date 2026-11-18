// =============================================================================
// src/lib/startupFilters.ts — pure helpers behind the Private Market FilterBar,
// FilterDrawer, filter chips and table. No React, no Supabase client: everything
// here is plain data in, plain data out, so it is unit-tested directly.
// =============================================================================

import { STAGE_STEPS, type StageStep } from "./taxonomy";
import type { RoundType } from "./supabase";

// ── Money ranges (valuation, total raised) ──────────────────────────────────

/** Bounds in whole USD. `null` means unbounded on that side. */
export interface MoneyRange {
  min: number | null;
  max: number | null;
  /** Valuation only: also keep companies with no valuation on record. */
  includeUnknown: boolean;
}

export const EMPTY_RANGE: MoneyRange = { min: null, max: null, includeUnknown: true };

export function rangeIsActive(r: MoneyRange): boolean {
  return r.min != null || r.max != null;
}

/** "50" (millions of dollars, as typed in the UI) -> 50_000_000. Blank or invalid -> null. */
export function parseMillions(input: string): number | null {
  const cleaned = input.replace(/[\s,$]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000);
}

export function formatUsdShort(usd: number): string {
  if (usd >= 1e9) return `$${trim(usd / 1e9)}B`;
  if (usd >= 1e6) return `$${trim(usd / 1e6)}M`;
  if (usd >= 1e3) return `$${trim(usd / 1e3)}K`;
  return `$${usd}`;
}
function trim(n: number): string {
  return n >= 100 ? n.toFixed(0) : String(Math.round(n * 10) / 10);
}

/** "$50M to $500M", "$50M and up", "Up to $500M". */
export function rangeLabel(r: MoneyRange): string {
  if (r.min != null && r.max != null) return `${formatUsdShort(r.min)} to ${formatUsdShort(r.max)}`;
  if (r.min != null) return `${formatUsdShort(r.min)} and up`;
  if (r.max != null) return `Up to ${formatUsdShort(r.max)}`;
  return "";
}

/** Swap the bounds if the user typed them the wrong way round. */
export function normalizeRange(r: MoneyRange): MoneyRange {
  if (r.min != null && r.max != null && r.min > r.max) return { ...r, min: r.max, max: r.min };
  return r;
}

/**
 * PostgREST `or` clause for a valuation range that must also keep companies with
 * no valuation. Returns null when the range is unbounded, or when unknowns are
 * not wanted (then a plain gte/lte pair is enough).
 */
export function valuationOrClause(r: MoneyRange): string | null {
  if (!rangeIsActive(r) || !r.includeUnknown) return null;
  const parts: string[] = [];
  if (r.min != null) parts.push(`latest_valuation.gte.${r.min}`);
  if (r.max != null) parts.push(`latest_valuation.lte.${r.max}`);
  const inRange = parts.length === 1 ? parts[0] : `and(${parts.join(",")})`;
  return `${inRange},latest_valuation.is.null`;
}

// ── Stage (multi-select) ────────────────────────────────────────────────────

export type StageChoice = Exclude<StageStep, "all">;

/** Union of the round types behind the chosen stage buckets. Empty = no stage filter. */
export function stageRounds(steps: StageChoice[]): RoundType[] {
  const out = new Set<RoundType>();
  for (const s of steps) {
    const def = STAGE_STEPS.find((x) => x.value === s);
    if (def) for (const r of def.rounds) out.add(r);
  }
  return [...out];
}

export function toggleStage(steps: StageChoice[], s: StageChoice): StageChoice[] {
  return steps.includes(s) ? steps.filter((x) => x !== s) : [...steps, s];
}

// ── Sorting ─────────────────────────────────────────────────────────────────

/** Only columns that exist on startups_market and are safe to ORDER BY. */
export const SORT_KEYS = ["name", "latest_valuation", "total_raised", "employee_count", "updated_at"] as const;
export type StartupSortKey = (typeof SORT_KEYS)[number];
export interface StartupSort { key: StartupSortKey; dir: "asc" | "desc" }

export function isSortKey(k: string): k is StartupSortKey {
  return (SORT_KEYS as readonly string[]).includes(k);
}

/** Text sorts A-Z first; numbers and dates sort largest or newest first. */
export function nextSort(current: StartupSort | null, key: StartupSortKey): StartupSort | null {
  if (!current || current.key !== key) return { key, dir: key === "name" ? "asc" : "desc" };
  if (current.dir === (key === "name" ? "asc" : "desc")) return { key, dir: key === "name" ? "desc" : "asc" };
  return null; // third click returns to the default order
}

// ── Row display helpers ─────────────────────────────────────────────────────

export const STALE_AFTER_DAYS = 14;

export function daysSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** "Today", "3d", "5w", "4mo". */
export function freshnessLabel(days: number | null): string {
  if (days == null) return "—";
  if (days === 0) return "Today";
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

export function isStale(days: number | null): boolean {
  return days != null && days >= STALE_AFTER_DAYS;
}

export type TrendTone = "pos" | "neg" | "flat" | "none";
export interface TrendView { arrow: string; label: string; tone: TrendTone }

/** The list carries a categorical growth trend, not a percentage. */
export function trendView(trend: string | null | undefined): TrendView {
  switch (trend) {
    case "rapid growth":    return { arrow: "▲", label: "Rapid", tone: "pos" };
    case "moderate growth": return { arrow: "▲", label: "Growing", tone: "pos" };
    case "stable":          return { arrow: "▬", label: "Stable", tone: "flat" };
    case "reduction":       return { arrow: "▼", label: "Shrinking", tone: "neg" };
    default:                return { arrow: "", label: "", tone: "none" };
  }
}

// ── Active-filter chips ─────────────────────────────────────────────────────

export interface FilterChip { id: string; label: string }

export interface ChipInput {
  search: string;
  parentSector: string;
  subSector: string;
  subSectorTag: string;
  country: string;
  city: string;
  israelRelated: boolean;
  stageLabels: string[];
  headcountLabel: string | null;
  momentum: boolean;
  density: "all" | "crowded" | "blue-ocean";
  fundedWithinDays: number | null;
  valuation: MoneyRange;
  raised: MoneyRange;
  updatedWithinDays: number | null;
}

/** Translator hook: (key, variables, English fallback). The default returns the fallback. */
export type ChipTr = (key: string, vars: Record<string, string | number>, fallback: string) => string;
const identityTr: ChipTr = (_k, _v, fallback) => fallback;

/** One chip per active filter, in the order the filter bar shows them. */
export function buildChips(i: ChipInput, tr: ChipTr = identityTr): FilterChip[] {
  const c: FilterChip[] = [];
  if (i.search) c.push({ id: "search", label: tr("chip.search", { value: i.search }, `Name: “${i.search}”`) });
  if (i.subSectorTag) c.push({ id: "subSectorTag", label: tr("chip.tag", { value: i.subSectorTag }, `Tag: ${i.subSectorTag}`) });
  else if (i.parentSector) {
    const v = i.subSector ? `${i.parentSector} › ${i.subSector}` : i.parentSector;
    c.push({ id: "sector", label: tr("chip.sector", { value: v }, `Sector: ${v}`) });
  }
  if (i.stageLabels.length) { const v = i.stageLabels.join(", "); c.push({ id: "stage", label: tr("chip.stage", { value: v }, `Stage: ${v}`) }); }
  if (i.country) c.push({ id: "country", label: tr("chip.country", { value: i.country }, `Country: ${i.country}`) });
  if (i.city) c.push({ id: "city", label: tr("chip.city", { value: i.city }, `City: ${i.city}`) });
  if (i.israelRelated) c.push({ id: "israel", label: tr("chip.israel", {}, "Israel related") });
  if (i.headcountLabel) c.push({ id: "headcount", label: tr("chip.headcount", { value: i.headcountLabel }, `Headcount: ${i.headcountLabel}`) });
  if (rangeIsActive(i.valuation)) {
    const v = rangeLabel(i.valuation);
    c.push({ id: "valuation", label: i.valuation.includeUnknown
      ? tr("chip.valuationOrNone", { value: v }, `Valuation: ${v}, or none`)
      : tr("chip.valuation", { value: v }, `Valuation: ${v}`) });
  }
  if (rangeIsActive(i.raised)) { const v = rangeLabel(i.raised); c.push({ id: "raised", label: tr("chip.raised", { value: v }, `Raised: ${v}`) }); }
  if (i.fundedWithinDays != null) c.push({ id: "funded", label: tr("chip.funded", { count: i.fundedWithinDays }, `Funded in the last ${i.fundedWithinDays} days`) });
  if (i.momentum) c.push({ id: "momentum", label: tr("chip.momentum", {}, "Raised and growing") });
  if (i.density !== "all") c.push({ id: "density", label: i.density === "crowded" ? tr("chip.crowded", {}, "Crowded market") : tr("chip.blueOcean", {}, "Blue ocean") });
  if (i.updatedWithinDays != null) c.push({ id: "updated", label: tr("chip.updated", { count: i.updatedWithinDays }, `Updated in the last ${i.updatedWithinDays} days`) });
  return c;
}
