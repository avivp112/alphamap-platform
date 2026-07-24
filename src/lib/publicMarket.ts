import { supabase, fetchDeals, type StartupListRow, type DealRow } from "./supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Public Market Hub — the cross-market intelligence layer.
//
// The public-company reference set below is a STATIC, DATED SNAPSHOT of real
// listed companies (approximate figures, USD millions, as of PUBLIC_SNAPSHOT_AS_OF).
// It ships in-repo so the hub works with zero setup — no migration to run, no
// key required. Slow-moving fundamentals (revenue, EBITDA, net debt, growth)
// live here; the fast-moving number (market cap) can be refreshed live at
// runtime via fetchLiveMarketCaps() using the same Financial Modeling Prep key
// the Stocks page already uses (VITE_FMP_API_KEY). When a live refresh lands,
// enterprise value and every multiple are recomputed from the fresh cap.
//
// (A serverless yahoo-finance2 / Finnhub cron that upserts these rows into a
// Supabase table would be the production upgrade path; FMP-on-the-client is
// reused here because it's already wired and needs no new infra.)
// ─────────────────────────────────────────────────────────────────────────────

export const PUBLIC_SNAPSHOT_AS_OF = "2026-06-30";
export const ILLIQUIDITY_DISCOUNT = 0.25; // standard private-company haircut

export type PublicSectorKey = "cyber" | "saas" | "fintech" | "ai";
// A company synced via the search bar may not fall into one of the 4 curated
// sectors — it's still stored and shown in the companies directory, just
// excluded from the Sector Matrix / Sentiment Barometer (which stay scoped to
// the curated 4, by design).
export type AnySectorKey = PublicSectorKey | "other";

export function sectorLabel(key: AnySectorKey): string {
  if (key === "other") return "Other";
  return sectorConfig(key).label;
}

export function isCuratedSector(key: AnySectorKey): key is PublicSectorKey {
  return key !== "other";
}

const OTHER_SECTOR_ACCENT = "#64748b"; // neutral slate — no curated benchmark for ad-hoc tickers

/** Accent color for any sector key, including the 'other' bucket (ad-hoc search results). */
export function sectorAccent(key: AnySectorKey): string {
  return isCuratedSector(key) ? sectorConfig(key).accent : OTHER_SECTOR_ACCENT;
}

export interface PublicSectorConfig {
  key: PublicSectorKey;
  label: string;
  // sector_parent value(s) emitted by classify_sector_parent() on the private
  // `startups_search` view — used to pull the private cohort for this sector.
  startupSectorParents: string[];
  // Estimated revenue per employee (USD), used to approximate a private
  // startup's ARR from its headcount when no revenue is on file. Rough
  // sector-typical SaaS figures — always surfaced in the UI as "estimated".
  revenuePerEmployee: number;
  accent: string; // hex, for cards/charts
}

export const PUBLIC_SECTORS: PublicSectorConfig[] = [
  { key: "cyber",   label: "Cybersecurity", startupSectorParents: ["Cybersecurity"],                    revenuePerEmployee: 250_000, accent: "#0e7490" },
  { key: "saas",    label: "B2B SaaS",      startupSectorParents: ["SaaS & Dev Tools", "Enterprise Software"], revenuePerEmployee: 200_000, accent: "#7c3aed" },
  { key: "fintech", label: "Fintech",       startupSectorParents: ["Fintech"],                          revenuePerEmployee: 300_000, accent: "#059669" },
  { key: "ai",      label: "AI",            startupSectorParents: ["AI & ML"],                           revenuePerEmployee: 220_000, accent: "#d97706" },
];

export function sectorConfig(key: PublicSectorKey): PublicSectorConfig {
  return PUBLIC_SECTORS.find((s) => s.key === key)!;
}

export interface PublicCompany {
  ticker: string;
  name: string;
  sector: AnySectorKey;
  exchange: string | null; // NASDAQ | NYSE | ... (as reported by FMP)
  marketCap: number;   // USD millions
  netDebt: number;     // USD millions (negative = net cash)
  ttmRevenue: number;  // USD millions
  ttmEbitda: number;   // USD millions (can be negative — not yet profitable)
  yoyGrowthPct: number;// TTM revenue YoY %
  momentumPct: number; // ~trailing-12-month share-price change %, drives sentiment
  // A well-known private counterpart tracked (or trackable) in AlphaMap. Matched
  // against startups_search by name ILIKE at runtime — only shown if it actually
  // exists in the user's database, otherwise flagged "not tracked yet".
  privateCompHint: string | null;
}

// Approximate reference figures (USD millions) — a labeled snapshot, not a live
// feed. Relative multiples land in credible ranges; live refresh overrides cap.
export const PUBLIC_COMPANIES: PublicCompany[] = [
  // ── Cybersecurity ──
  { ticker: "CRWD", name: "CrowdStrike",        sector: "cyber",   exchange: "NASDAQ", marketCap:  95_000, netDebt:  -3_500, ttmRevenue:  3_900, ttmEbitda:   850, yoyGrowthPct: 33, momentumPct:  45, privateCompHint: "Wiz" },
  { ticker: "PANW", name: "Palo Alto Networks", sector: "cyber",   exchange: "NASDAQ", marketCap: 120_000, netDebt:  -1_000, ttmRevenue:  8_500, ttmEbitda: 1_900, yoyGrowthPct: 15, momentumPct:  30, privateCompHint: "Snyk" },
  { ticker: "ZS",   name: "Zscaler",            sector: "cyber",   exchange: "NASDAQ", marketCap:  30_000, netDebt:  -1_500, ttmRevenue:  2_300, ttmEbitda:   250, yoyGrowthPct: 30, momentumPct:  20, privateCompHint: "Netskope" },
  { ticker: "FTNT", name: "Fortinet",           sector: "cyber",   exchange: "NASDAQ", marketCap:  72_000, netDebt:  -2_000, ttmRevenue:  5_700, ttmEbitda: 1_700, yoyGrowthPct: 12, momentumPct:  25, privateCompHint: null },
  { ticker: "S",    name: "SentinelOne",        sector: "cyber",   exchange: "NYSE",   marketCap:   7_000, netDebt:  -1_000, ttmRevenue:    800, ttmEbitda:   -50, yoyGrowthPct: 30, momentumPct:   5, privateCompHint: "Abnormal Security" },

  // ── B2B SaaS / Dev Tools ──
  { ticker: "NOW",  name: "ServiceNow",         sector: "saas",    exchange: "NYSE",   marketCap: 200_000, netDebt:  -3_000, ttmRevenue: 11_000, ttmEbitda: 2_600, yoyGrowthPct: 22, momentumPct:  30, privateCompHint: null },
  { ticker: "DDOG", name: "Datadog",            sector: "saas",    exchange: "NASDAQ", marketCap:  48_000, netDebt:  -2_500, ttmRevenue:  2_700, ttmEbitda:   500, yoyGrowthPct: 25, momentumPct:  35, privateCompHint: "Grafana Labs" },
  { ticker: "SNOW", name: "Snowflake",          sector: "saas",    exchange: "NYSE",   marketCap:  55_000, netDebt:  -4_000, ttmRevenue:  3_600, ttmEbitda:   150, yoyGrowthPct: 28, momentumPct:  15, privateCompHint: "Databricks" },
  { ticker: "MDB",  name: "MongoDB",            sector: "saas",    exchange: "NASDAQ", marketCap:  22_000, netDebt:  -2_000, ttmRevenue:  2_000, ttmEbitda:   120, yoyGrowthPct: 20, momentumPct:  -5, privateCompHint: "Cockroach Labs" },
  { ticker: "GTLB", name: "GitLab",             sector: "saas",    exchange: "NASDAQ", marketCap:   9_000, netDebt:  -1_000, ttmRevenue:    750, ttmEbitda:    30, yoyGrowthPct: 30, momentumPct:  10, privateCompHint: null },

  // ── Fintech ──
  { ticker: "PYPL", name: "PayPal",             sector: "fintech", exchange: "NASDAQ", marketCap:  75_000, netDebt:   2_000, ttmRevenue: 31_000, ttmEbitda: 6_500, yoyGrowthPct:  8, momentumPct:  12, privateCompHint: "Stripe" },
  { ticker: "COIN", name: "Coinbase",           sector: "fintech", exchange: "NASDAQ", marketCap:  65_000, netDebt:  -4_000, ttmRevenue:  6_500, ttmEbitda: 2_500, yoyGrowthPct: 50, momentumPct:  60, privateCompHint: "Kraken" },
  { ticker: "XYZ",  name: "Block",              sector: "fintech", exchange: "NYSE",   marketCap:  45_000, netDebt:       0, ttmRevenue: 24_000, ttmEbitda: 3_000, yoyGrowthPct: 10, momentumPct:  18, privateCompHint: "Brex" },
  { ticker: "AFRM", name: "Affirm",             sector: "fintech", exchange: "NASDAQ", marketCap:  20_000, netDebt:   3_000, ttmRevenue:  2_700, ttmEbitda:   200, yoyGrowthPct: 40, momentumPct:  55, privateCompHint: "Klarna" },
  { ticker: "NU",   name: "Nu Holdings",        sector: "fintech", exchange: "NYSE",   marketCap:  55_000, netDebt:       0, ttmRevenue: 11_000, ttmEbitda: 3_000, yoyGrowthPct: 40, momentumPct:  25, privateCompHint: null },

  // ── AI ──
  { ticker: "NVDA", name: "NVIDIA",             sector: "ai",      exchange: "NASDAQ", marketCap: 3_400_000, netDebt: -25_000, ttmRevenue: 130_000, ttmEbitda: 85_000, yoyGrowthPct: 90, momentumPct:  80, privateCompHint: "Cerebras" },
  { ticker: "PLTR", name: "Palantir",           sector: "ai",      exchange: "NYSE",   marketCap: 180_000, netDebt:  -5_000, ttmRevenue:  2_900, ttmEbitda:   800, yoyGrowthPct: 30, momentumPct: 150, privateCompHint: "Scale AI" },
  { ticker: "ARM",  name: "Arm Holdings",       sector: "ai",      exchange: "NASDAQ", marketCap: 140_000, netDebt:  -2_000, ttmRevenue:  3_500, ttmEbitda:   900, yoyGrowthPct: 25, momentumPct:  40, privateCompHint: "SiFive" },
  { ticker: "AI",   name: "C3.ai",              sector: "ai",      exchange: "NYSE",   marketCap:   3_500, netDebt:    -700, ttmRevenue:    380, ttmEbitda:  -280, yoyGrowthPct: 25, momentumPct: -10, privateCompHint: "Anthropic" },
];

// ── Per-company derived metrics ─────────────────────────────────────────────

export interface DerivedPublicCompany extends PublicCompany {
  enterpriseValue: number;      // marketCap + netDebt
  evRevenue: number;            // EV / TTM revenue
  evEbitda: number | null;      // EV / TTM EBITDA (null when EBITDA <= 0)
  ebitdaMarginPct: number;      // TTM EBITDA / TTM revenue * 100
}

export function derivePublicCompany(c: PublicCompany, marketCapOverride?: number): DerivedPublicCompany {
  const marketCap = marketCapOverride ?? c.marketCap;
  const enterpriseValue = marketCap + c.netDebt;
  const evRevenue = c.ttmRevenue > 0 ? enterpriseValue / c.ttmRevenue : 0;
  const evEbitda = c.ttmEbitda > 0 ? enterpriseValue / c.ttmEbitda : null;
  const ebitdaMarginPct = c.ttmRevenue > 0 ? (c.ttmEbitda / c.ttmRevenue) * 100 : 0;
  return { ...c, marketCap, enterpriseValue, evRevenue, evEbitda, ebitdaMarginPct };
}

export function deriveAll(liveMarketCaps?: Map<string, number> | null): DerivedPublicCompany[] {
  return PUBLIC_COMPANIES.map((c) => derivePublicCompany(c, liveMarketCaps?.get(c.ticker)));
}

// ── Sector multiples matrix ─────────────────────────────────────────────────

export interface SectorMultiples {
  key: PublicSectorKey;
  label: string;
  accent: string;
  count: number;
  medianEvRevenue: number;
  avgYoyGrowthPct: number;
  avgEbitdaMarginPct: number;
  medianEvEbitda: number | null;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export function computeSectorMultiples(companies: DerivedPublicCompany[]): SectorMultiples[] {
  return PUBLIC_SECTORS.map((cfg) => {
    const rows = companies.filter((c) => c.sector === cfg.key);
    const evEbitdas = rows.map((r) => r.evEbitda).filter((v): v is number => v != null);
    return {
      key: cfg.key,
      label: cfg.label,
      accent: cfg.accent,
      count: rows.length,
      medianEvRevenue: median(rows.map((r) => r.evRevenue)),
      avgYoyGrowthPct: mean(rows.map((r) => r.yoyGrowthPct)),
      avgEbitdaMarginPct: mean(rows.map((r) => r.ebitdaMarginPct)),
      medianEvEbitda: evEbitdas.length ? median(evEbitdas) : null,
    };
  });
}

// ── Valuation engine: public multiple → private implied fair value ──────────

export interface ImpliedValuation {
  startup: StartupListRow;
  estimatedArr: number | null;      // USD (absolute), headcount-derived
  impliedFairValue: number | null;  // USD (absolute)
  currentValuation: number | null;  // USD (absolute), latest tracked round
  gapPct: number | null;            // implied vs current, % (positive = implied higher)
}

/** Estimate a private startup's ARR from headcount × sector revenue-per-employee. */
export function estimateArr(startup: StartupListRow, cfg: PublicSectorConfig): number | null {
  if (!startup.employee_count || startup.employee_count <= 0) return null;
  return startup.employee_count * cfg.revenuePerEmployee;
}

/**
 * Implied fair value = estimated ARR × sector median EV/Revenue × (1 − illiquidity discount).
 * The discount reflects the standard haircut applied to private, illiquid equity
 * versus a freely-traded public comp.
 */
export function impliedFairValue(
  startup: StartupListRow,
  cfg: PublicSectorConfig,
  medianEvRevenue: number,
): ImpliedValuation {
  const estimatedArr = estimateArr(startup, cfg);
  const impliedFairValue =
    estimatedArr != null ? estimatedArr * medianEvRevenue * (1 - ILLIQUIDITY_DISCOUNT) : null;
  const currentValuation = startup.latest_valuation ?? null;
  const gapPct =
    impliedFairValue != null && currentValuation && currentValuation > 0
      ? ((impliedFairValue - currentValuation) / currentValuation) * 100
      : null;
  return { startup, estimatedArr, impliedFairValue, currentValuation, gapPct };
}

/** Pull the tracked private cohort for a public sector, richest-valued first. */
export async function fetchPrivateCohort(cfg: PublicSectorConfig, limit = 8): Promise<StartupListRow[]> {
  const { data, error } = await supabase
    .from("startups_search")
    .select("*")
    .in("sector_parent", cfg.startupSectorParents)
    .order("latest_valuation", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as StartupListRow[];
}

/** Look up a single tracked private startup by (fuzzy) name — for the comps explorer. */
export async function fetchStartupByName(name: string): Promise<StartupListRow | null> {
  const { data, error } = await supabase
    .from("startups_search")
    .select("*")
    .ilike("name", `%${name.replace(/[%,]/g, "")}%`)
    .order("completeness_score", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as StartupListRow) ?? null;
}

// ── IPO / market-sentiment barometer ────────────────────────────────────────

export type SentimentBand = "Wide Open" | "Open" | "Selective" | "Tightening" | "Closed";

export interface SentimentIndex {
  score: number;            // 0–100 "IPO window openness"
  band: SentimentBand;
  avgMomentumPct: number;   // equal-sector-weighted avg momentum
  bestSector: { label: string; momentum: number };
  worstSector: { label: string; momentum: number };
  avgGrowthPct: number;
}

/**
 * IPO-window openness from public tech momentum. Equal-weight per sector (so
 * mega-caps like NVDA don't dominate), mapped onto a 0–100 scale and banded.
 */
export function computeSentiment(companies: DerivedPublicCompany[]): SentimentIndex {
  const perSector = PUBLIC_SECTORS.map((cfg) => {
    const rows = companies.filter((c) => c.sector === cfg.key);
    return { label: cfg.label, momentum: mean(rows.map((r) => r.momentumPct)) };
  });
  const avgMomentumPct = mean(perSector.map((s) => s.momentum));
  const sorted = [...perSector].sort((a, b) => b.momentum - a.momentum);
  const score = Math.max(0, Math.min(100, Math.round(50 + avgMomentumPct * 0.6)));
  const band: SentimentBand =
    score >= 75 ? "Wide Open" :
    score >= 60 ? "Open" :
    score >= 45 ? "Selective" :
    score >= 30 ? "Tightening" : "Closed";
  return {
    score,
    band,
    avgMomentumPct,
    bestSector: sorted[0],
    worstSector: sorted[sorted.length - 1],
    avgGrowthPct: mean(companies.map((c) => c.yoyGrowthPct)),
  };
}

// ── Private late-stage activity (co-moves with the public IPO window) ────────

export type ActivityTrend = "Rising" | "Steady" | "Cooling";

export interface PrivateLateStageActivity {
  recentCount: number;   // late-stage rounds, last 90 days
  priorCount: number;    // late-stage rounds, prior 90 days
  trend: ActivityTrend;
  recentVolume: number;  // USD raised in late-stage rounds, last 90 days
}

const LATE_STAGE_HINTS = ["series c", "series d", "series e", "series f", "growth", "late", "pre-ipo", "secondary"];

function isLateStage(deal: DealRow): boolean {
  const t = (deal.deal_type ?? "").toLowerCase();
  return LATE_STAGE_HINTS.some((h) => t.includes(h));
}

export async function fetchPrivateLateStageActivity(nowMs: number): Promise<PrivateLateStageActivity> {
  const deals = await fetchDeals(500);
  const day = 24 * 60 * 60 * 1000;
  const recentCutoff = nowMs - 90 * day;
  const priorCutoff = nowMs - 180 * day;
  let recentCount = 0, priorCount = 0, recentVolume = 0;
  for (const d of deals) {
    if (!isLateStage(d)) continue;
    const t = d.deal_date ? Date.parse(d.deal_date) : NaN;
    if (isNaN(t)) continue;
    if (t >= recentCutoff) { recentCount++; recentVolume += d.amount_raised ?? 0; }
    else if (t >= priorCutoff) { priorCount++; }
  }
  const trend: ActivityTrend =
    recentCount > priorCount * 1.15 ? "Rising" :
    recentCount < priorCount * 0.85 ? "Cooling" : "Steady";
  return { recentCount, priorCount, trend, recentVolume };
}

// ── Database-backed data (the `public_companies` table, kept fresh daily by the
//    sync-public-markets Edge Function) ─────────────────────────────────────

// One row of the public_companies table. All monetary fields are USD millions;
// ev_revenue / ev_ebitda are ratios. Any field can be null on a fresh row.
export interface PublicCompanyRow {
  ticker: string;
  name: string;
  sector: AnySectorKey;
  exchange: string | null;
  market_cap: number | null;
  enterprise_value: number | null;
  ttm_revenue: number | null;
  ttm_ebitda: number | null;
  ev_revenue: number | null;
  ev_ebitda: number | null;
  yoy_growth_pct: number | null;
  momentum_pct: number | null;
  private_comp_hint: string | null;
  synced_at: string | null;
}

const SECTOR_ORDER: Record<AnySectorKey, number> = { cyber: 0, saas: 1, fintech: 2, ai: 3, other: 4 };

function rowToDerived(r: PublicCompanyRow): DerivedPublicCompany {
  const marketCap = r.market_cap ?? 0;
  const enterpriseValue = r.enterprise_value ?? marketCap;
  const ttmRevenue = r.ttm_revenue ?? 0;
  const ttmEbitda = r.ttm_ebitda ?? 0;
  return {
    ticker: r.ticker,
    name: r.name,
    sector: r.sector,
    exchange: r.exchange,
    marketCap,
    netDebt: enterpriseValue - marketCap,
    ttmRevenue,
    ttmEbitda,
    yoyGrowthPct: r.yoy_growth_pct ?? 0,
    momentumPct: r.momentum_pct ?? 0,
    privateCompHint: r.private_comp_hint,
    enterpriseValue,
    evRevenue: r.ev_revenue ?? (ttmRevenue > 0 ? enterpriseValue / ttmRevenue : 0),
    evEbitda: r.ev_ebitda ?? (ttmEbitda > 0 ? enterpriseValue / ttmEbitda : null),
    ebitdaMarginPct: ttmRevenue > 0 ? (ttmEbitda / ttmRevenue) * 100 : 0,
  };
}

export interface PublicCompaniesResult {
  companies: DerivedPublicCompany[];
  source: "db" | "snapshot";  // "db" = live table; "snapshot" = static fallback
  syncedAt: string | null;    // most-recent synced_at across the table
}

/**
 * Read the public-company set from the `public_companies` table (the source of
 * truth, kept fresh by the daily Edge Function). Falls back to the in-repo
 * static snapshot if the table is empty or unreachable, so the hub always
 * renders something sensible.
 */
export async function fetchPublicCompanies(): Promise<PublicCompaniesResult> {
  try {
    const { data, error } = await supabase.from("public_companies").select("*");
    if (error) throw error;
    if (data && data.length) {
      const companies = (data as PublicCompanyRow[])
        .map(rowToDerived)
        .sort((a, b) => SECTOR_ORDER[a.sector] - SECTOR_ORDER[b.sector] || b.marketCap - a.marketCap);
      const syncedAt = (data as PublicCompanyRow[])
        .map((r) => r.synced_at)
        .filter((s): s is string => !!s)
        .sort()
        .pop() ?? null;
      return { companies, source: "db", syncedAt };
    }
  } catch {
    /* fall through to the static snapshot */
  }
  return { companies: deriveAll(), source: "snapshot", syncedAt: null };
}

/**
 * supabase-js's FunctionsHttpError only exposes a generic "non-2xx status
 * code" message by default — the actual reason (e.g. "FMP_API_KEY is not
 * set") is in the response body our Edge Functions return as {"error": "..."}.
 * Dig it out so failures are actionable instead of generic.
 */
async function extractFunctionsError(error: unknown, fallback: string): Promise<string> {
  try {
    const ctx = (error as { context?: Response })?.context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.clone().json();
      if (body && typeof body.error === "string") return body.error;
    }
  } catch {
    /* fall through to the generic message below */
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * Kick the sync-public-markets Edge Function to pull fresh FMP data on demand.
 * Returns ok:false (gracefully) if the function isn't deployed — the caller can
 * still just re-read whatever is already in the table.
 */
export async function triggerSync(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.functions.invoke("sync-public-markets", { method: "POST" });
    if (error) return { ok: false, error: await extractFunctionsError(error, "Sync failed") };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invoke failed" };
  }
}

// ── On-demand ticker search + sync (the stock search bar) ──────────────────

export interface TickerSearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

export interface TickerSearchOutcome {
  results: TickerSearchResult[];
  error?: string; // set only on a real failure — a genuine zero-match search has no error
}

/**
 * Search ANY NASDAQ/NYSE ticker via the search-tickers Edge Function (a thin
 * proxy over FMP's /v3/search, so the FMP key never reaches the browser).
 * Distinguishes "found nothing" from "the request actually failed" so the
 * search bar can show a real error instead of a misleading "no results".
 */
export async function searchTickers(query: string): Promise<TickerSearchOutcome> {
  const q = query.trim();
  if (!q) return { results: [] };
  try {
    const { data, error } = await supabase.functions.invoke("search-tickers", {
      method: "POST",
      body: { query: q },
    });
    if (error) return { results: [], error: await extractFunctionsError(error, "Search failed") };
    if (data && typeof data.error === "string") return { results: [], error: data.error };
    return { results: Array.isArray(data?.results) ? data.results : [] };
  } catch (e) {
    return { results: [], error: e instanceof Error ? e.message : "invoke failed" };
  }
}

/**
 * Sync one or more specific tickers on demand (the search bar calls this with
 * exactly the ticker the user picked when it isn't already in public_companies).
 * Same Edge Function as the daily cron, just scoped to these tickers.
 */
export async function syncTickers(tickers: string[]): Promise<{ ok: boolean; error?: string }> {
  if (tickers.length === 0) return { ok: true };
  try {
    const { error } = await supabase.functions.invoke("sync-public-markets", {
      method: "POST",
      body: { tickers },
    });
    if (error) return { ok: false, error: await extractFunctionsError(error, "Sync failed") };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invoke failed" };
  }
}

/** Is this ticker already present in the currently-loaded company set? */
export function hasTicker(companies: DerivedPublicCompany[], ticker: string): boolean {
  const t = ticker.toUpperCase();
  return companies.some((c) => c.ticker.toUpperCase() === t);
}
