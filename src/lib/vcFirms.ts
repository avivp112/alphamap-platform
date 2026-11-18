// =============================================================================
// src/lib/vcFirms.ts — pure logic behind the redesigned VCs page: turning an
// `investors` row into what the page shows, filtering, sorting, and reading SEC
// fund filings. No React, no Supabase client.
//
// Rule for this file and everything built on it: show only what the investors
// row or an SEC filing says. A missing value stays missing ("—", or the section
// is left out). Nothing is estimated from other fields.
// =============================================================================

import type { InvestorRow, Leader } from "./supabase";

// ── The firm, as the page uses it ───────────────────────────────────────────

export interface SectorShare { sector: string; weight: number }

export type Region = "North America" | "Europe" | "Israel" | "Asia-Pacific" | "MENA";
export const REGIONS: Region[] = ["North America", "Europe", "Israel", "Asia-Pacific", "MENA"];

export interface VcFirm {
  id: string;                 // investors.id
  slug: string;
  name: string;
  description: string | null;
  thesis: string | null;
  foundedYear: number | null;
  hq: string | null;
  region: Region | null;
  fundSizeLabel: string | null;
  fundSizeM: number | null;   // millions of USD
  checkLabel: string | null;
  checkMinUsd: number | null;
  checkMaxUsd: number | null;
  portfolio: number | null;   // reported; null when not filled in
  stages: string[];
  sectors: SectorShare[];     // largest first
  notable: string[];
  website: string | null;
  leadership: Leader[];
}

// ── Parsing the text fields ─────────────────────────────────────────────────

/** "$1.5M" -> 1_500_000, "500K" -> 500_000, "$2B" -> 2e9. A bare number is dollars. */
export function parseMoneyUsd(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/\$?\s*([\d][\d,]*\.?\d*)\s*([KMB])?/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  switch ((m[2] ?? "").toUpperCase()) {
    case "K": return Math.round(n * 1e3);
    case "M": return Math.round(n * 1e6);
    case "B": return Math.round(n * 1e9);
    default: return Math.round(n);
  }
}

/** "$1M-$5M", "$500K to $2M", "$1M" -> a range. One figure is a range of one value. */
export function parseCheckRange(text: string | null | undefined): { min: number; max: number } | null {
  if (!text) return null;
  const parts = text.split(/\s*(?:-|–|—|to)\s*/i).filter(Boolean);
  const first = parseMoneyUsd(parts[0]);
  if (first == null) return null;
  // "$1M-5M": a unit missing on the first figure borrows the last one's
  let min = first;
  let max = parts.length > 1 ? parseMoneyUsd(parts[parts.length - 1]) ?? first : first;
  if (parts.length > 1 && /^\s*\$?[\d.,]+\s*$/.test(parts[0]) && max >= 1e3) {
    const unit = (parts[parts.length - 1].match(/[KMB]/i) ?? [""])[0].toUpperCase();
    const scale = unit === "K" ? 1e3 : unit === "M" ? 1e6 : unit === "B" ? 1e9 : 1;
    if (scale > 1 && first < scale) min = Math.round(first * scale);
  }
  if (min > max) [min, max] = [max, min];
  return { min, max };
}

/** Fund size text to millions of USD. */
export function parseFundSizeMillions(text: string | null | undefined): number | null {
  const usd = parseMoneyUsd(text);
  return usd == null ? null : Math.round(usd / 1e6);
}

const REGION_WORDS: Record<Region, string[]> = {
  "North America": ["usa", "us", "u.s.", "united states", "america", "canada", "toronto", "vancouver", "montreal", "new york", "san francisco",
    "palo alto", "menlo park", "boston", "cambridge", "austin", "seattle", "los angeles", "chicago", "denver", "miami", "washington", "california",
    "texas", "massachusetts", "silicon valley"],
  "Europe": ["uk", "u.k.", "united kingdom", "england", "london", "germany", "berlin", "munich", "france", "paris", "spain", "madrid", "barcelona",
    "italy", "milan", "netherlands", "amsterdam", "sweden", "stockholm", "denmark", "copenhagen", "finland", "helsinki", "norway", "oslo",
    "switzerland", "zurich", "geneva", "ireland", "dublin", "belgium", "brussels", "austria", "vienna", "poland", "warsaw", "portugal", "lisbon", "estonia", "tallinn"],
  "Israel": ["israel", "tel aviv", "jerusalem", "herzliya", "haifa", "ramat gan"],
  "Asia-Pacific": ["singapore", "china", "beijing", "shanghai", "shenzhen", "hong kong", "japan", "tokyo", "korea", "seoul", "india", "bangalore",
    "bengaluru", "mumbai", "delhi", "australia", "sydney", "melbourne", "indonesia", "jakarta", "vietnam", "thailand", "taiwan", "new zealand"],
  "MENA": ["dubai", "abu dhabi", "uae", "united arab emirates", "saudi", "riyadh", "qatar", "doha", "egypt", "cairo", "jordan", "amman", "bahrain", "kuwait"],
};

/** The region of a headquarters text, matched on whole words ("uk" does not match "Duke"). Unknown -> null. */
export function regionOfHq(hq: string | null | undefined): Region | null {
  if (!hq) return null;
  const text = ` ${hq.toLowerCase().replace(/[,;()/]+/g, " ")} `;
  // Israel before the others: "Tel Aviv, Israel" must not be anything else.
  const order: Region[] = ["Israel", "North America", "Europe", "Asia-Pacific", "MENA"];
  for (const r of order) {
    for (const w of REGION_WORDS[r]) {
      if (text.includes(` ${w} `)) return r;
    }
  }
  return null;
}

// ── Stages and sectors ──────────────────────────────────────────────────────

export const STAGE_ORDER = ["Pre-Seed", "Seed", "Series A", "Series B", "Series C", "Growth", "Late"];

export function stageRank(stage: string): number {
  const i = STAGE_ORDER.findIndex((s) => s.toLowerCase() === stage.trim().toLowerCase());
  return i === -1 ? STAGE_ORDER.length : i;
}

/** Stages as the data names them, early to late, each once. */
export function stageOptions(firms: readonly VcFirm[]): string[] {
  const seen = new Map<string, string>();
  for (const f of firms) for (const s of f.stages) { const k = s.trim().toLowerCase(); if (k && !seen.has(k)) seen.set(k, s.trim()); }
  return [...seen.values()].sort((a, b) => stageRank(a) - stageRank(b) || a.localeCompare(b));
}

/** A firm "focuses on" a sector when it holds at least this share of its allocation. */
export const SECTOR_FOCUS_SHARE = 0.25;

export function normalizeSectors(allocation: Record<string, number> | null | undefined): SectorShare[] {
  const entries = Object.entries(allocation ?? {}).filter(([, w]) => Number.isFinite(w) && w > 0);
  return entries.map(([sector, weight]) => ({ sector, weight })).sort((a, b) => b.weight - a.weight || a.sector.localeCompare(b.sector));
}

export function sectorShare(firm: Pick<VcFirm, "sectors">, sector: string): number {
  const total = firm.sectors.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return 0;
  const hit = firm.sectors.find((x) => x.sector.toLowerCase() === sector.toLowerCase());
  return hit ? hit.weight / total : 0;
}

/** Sectors that appear in the data, most firms first. */
export function sectorOptions(firms: readonly VcFirm[]): { sector: string; count: number }[] {
  const counts = new Map<string, { sector: string; count: number }>();
  for (const f of firms) {
    for (const x of f.sectors) {
      if (sectorShare(f, x.sector) < SECTOR_FOCUS_SHARE) continue;
      const k = x.sector.toLowerCase();
      const cur = counts.get(k);
      if (cur) cur.count += 1; else counts.set(k, { sector: x.sector, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector));
}

// ── The investors row, as a firm ────────────────────────────────────────────

const clean = (s: string | null | undefined): string | null => { const t = (s ?? "").trim(); return t ? t : null; };

export function toVcFirm(row: InvestorRow): VcFirm {
  const check = parseCheckRange(row.typical_check_size);
  const fundM = parseFundSizeMillions(row.fund_size);
  const founded = row.founded_year && row.founded_year > 1800 ? row.founded_year : null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: clean(row.description),
    thesis: clean(row.thesis),
    foundedYear: founded,
    hq: clean(row.headquarters),
    region: regionOfHq(row.headquarters),
    fundSizeLabel: fundM != null ? clean(row.fund_size) : null,
    fundSizeM: fundM,
    checkLabel: check ? clean(row.typical_check_size) : null,
    checkMinUsd: check?.min ?? null,
    checkMaxUsd: check?.max ?? null,
    portfolio: row.portfolio_size && row.portfolio_size > 0 ? row.portfolio_size : null,
    stages: (row.stages ?? []).map((s) => s.trim()).filter(Boolean),
    sectors: normalizeSectors(row.sector_allocation),
    notable: (row.notable_investments ?? []).map((s) => s.trim()).filter(Boolean),
    website: clean(row.website),
    leadership: (row.leadership ?? []).filter((l) => l && l.name),
  };
}

// ── Filters ─────────────────────────────────────────────────────────────────

export interface Bucket { id: string; label: string; min: number | null; max: number | null }

/** Typical check, whole USD. A firm matches when its range overlaps the bucket. */
export const CHECK_BUCKETS: Bucket[] = [
  { id: "micro", label: "Under $500K", min: null, max: 500_000 },
  { id: "seed", label: "$500K to $2M", min: 500_000, max: 2_000_000 },
  { id: "a", label: "$2M to $10M", min: 2_000_000, max: 10_000_000 },
  { id: "growth", label: "$10M and up", min: 10_000_000, max: null },
];

/** Fund size, millions of USD. */
export const FUND_BUCKETS: Bucket[] = [
  { id: "small", label: "Under $100M", min: null, max: 100 },
  { id: "mid", label: "$100M to $500M", min: 100, max: 500 },
  { id: "large", label: "$500M to $2B", min: 500, max: 2_000 },
  { id: "xl", label: "$2B and up", min: 2_000, max: null },
];

export interface VcFilterState {
  stages: string[];
  sectors: string[];
  regions: Region[];
  checkIds: string[];
  fundIds: string[];
  /** Only firms with an open SEC fund offering. */
  raisingOnly: boolean;
  followingOnly: boolean;
}

export const EMPTY_VC_FILTERS: VcFilterState = {
  stages: [], sectors: [], regions: [], checkIds: [], fundIds: [], raisingOnly: false, followingOnly: false,
};

export function activeVcFilterCount(f: VcFilterState): number {
  return (f.stages.length ? 1 : 0) + (f.sectors.length ? 1 : 0) + (f.regions.length ? 1 : 0) + (f.checkIds.length ? 1 : 0)
    + (f.fundIds.length ? 1 : 0) + (f.raisingOnly ? 1 : 0) + (f.followingOnly ? 1 : 0);
}

export function toggleIn<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function overlaps(min: number, max: number, b: Bucket): boolean {
  const lo = b.min ?? -Infinity;
  const hi = b.max ?? Infinity;
  return max >= lo && min < hi;
}

export interface VcFilterContext {
  /** Watchlisted investor ids. */
  followed: ReadonlySet<string>;
  /** Investor ids with an open SEC fund offering. */
  raising: ReadonlySet<string>;
}

export function matchesVcFilters(f: VcFirm, s: VcFilterState, ctx: VcFilterContext): boolean {
  if (s.stages.length) {
    const want = s.stages.map((x) => x.toLowerCase());
    if (!f.stages.some((x) => want.includes(x.toLowerCase()))) return false;
  }
  if (s.sectors.length && !s.sectors.some((x) => sectorShare(f, x) >= SECTOR_FOCUS_SHARE)) return false;
  if (s.regions.length && (f.region == null || !s.regions.includes(f.region))) return false;
  if (s.checkIds.length) {
    if (f.checkMinUsd == null || f.checkMaxUsd == null) return false;
    const lo = f.checkMinUsd, hi = f.checkMaxUsd;
    if (!CHECK_BUCKETS.some((b) => s.checkIds.includes(b.id) && overlaps(lo, hi, b))) return false;
  }
  if (s.fundIds.length) {
    if (f.fundSizeM == null) return false;
    const m = f.fundSizeM;
    if (!FUND_BUCKETS.some((b) => s.fundIds.includes(b.id) && overlaps(m, m, b))) return false;
  }
  if (s.raisingOnly && !ctx.raising.has(f.id)) return false;
  if (s.followingOnly && !ctx.followed.has(f.id)) return false;
  return true;
}

// ── Sorting ─────────────────────────────────────────────────────────────────

export type VcSortKey = "name" | "fundSize" | "check" | "portfolio" | "founded";
export interface VcSort { key: VcSortKey; dir: "asc" | "desc" }

function sortValue(f: VcFirm, key: VcSortKey): number | string | null {
  switch (key) {
    case "name": return f.name.toLowerCase();
    case "fundSize": return f.fundSizeM;
    case "check": return f.checkMaxUsd;
    case "portfolio": return f.portfolio;
    case "founded": return f.foundedYear;
  }
}

/** Sorts a copy. Firms without a value always go last, whichever way the sort points. */
export function sortFirms(firms: readonly VcFirm[], sort: VcSort): VcFirm[] {
  const d = sort.dir === "asc" ? 1 : -1;
  return [...firms].sort((a, b) => {
    const x = sortValue(a, sort.key), y = sortValue(b, sort.key);
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : (x as number) - (y as number);
    return c !== 0 ? d * c : a.name.localeCompare(b.name);
  });
}

/** Text first-click direction: names A to Z, numbers largest first. Third click returns to the default. */
export function nextVcSort(current: VcSort | null, key: VcSortKey): VcSort | null {
  const first = key === "name" ? "asc" : "desc";
  if (!current || current.key !== key) return { key, dir: first };
  if (current.dir === first) return { key, dir: first === "asc" ? "desc" : "asc" };
  return null;
}

// ── SEC fund filings ────────────────────────────────────────────────────────

export interface FundFiling {
  investorId: string;
  name: string;
  fundSeries: number | null;
  filedOn: string;            // YYYY-MM-DD
  amendedOn: string | null;
  offering: number | null;    // USD
  sold: number | null;        // USD
  url: string | null;
}

/** An offering is "open" when it was filed in the last 18 months and has sold less than it set out to raise. */
export const OPEN_OFFERING_DAYS = 548;

export function isOpenOffering(f: FundFiling, now: number = Date.now()): boolean {
  if (f.offering == null || f.sold == null || f.offering <= 0) return false;
  const age = (now - Date.parse(`${f.filedOn}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(age) && age <= OPEN_OFFERING_DAYS && f.sold < f.offering;
}

/** Filings by investor, newest first. */
export function groupFilings(filings: readonly FundFiling[]): Map<string, FundFiling[]> {
  const out = new Map<string, FundFiling[]>();
  for (const f of filings) {
    const list = out.get(f.investorId);
    if (list) list.push(f); else out.set(f.investorId, [f]);
  }
  for (const list of out.values()) list.sort((a, b) => b.filedOn.localeCompare(a.filedOn));
  return out;
}

export function raisingInvestorIds(byInvestor: ReadonlyMap<string, FundFiling[]>, now: number = Date.now()): Set<string> {
  const out = new Set<string>();
  for (const [id, list] of byInvestor) if (list.some((f) => isOpenOffering(f, now))) out.add(id);
  return out;
}

export function soldPercent(f: Pick<FundFiling, "sold" | "offering">): number | null {
  if (f.sold == null || f.offering == null || f.offering <= 0) return null;
  return Math.min(100, Math.round((f.sold / f.offering) * 100));
}
