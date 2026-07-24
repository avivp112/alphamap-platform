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
  sector: PublicSectorKey;
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
  { ticker: "CRWD", name: "CrowdStrike",        sector: "cyber",   marketCap:  95_000, netDebt:  -3_500, ttmRevenue:  3_900, ttmEbitda:   850, yoyGrowthPct: 33, momentumPct:  45, privateCompHint: "Wiz" },
  { ticker: "PANW", name: "Palo Alto Networks", sector: "cyber",   marketCap: 120_000, netDebt:  -1_000, ttmRevenue:  8_500, ttmEbitda: 1_900, yoyGrowthPct: 15, momentumPct:  30, privateCompHint: "Snyk" },
  { ticker: "ZS",   name: "Zscaler",            sector: "cyber",   marketCap:  30_000, netDebt:  -1_500, ttmRevenue:  2_300, ttmEbitda:   250, yoyGrowthPct: 30, momentumPct:  20, privateCompHint: "Netskope" },
  { ticker: "FTNT", name: "Fortinet",           sector: "cyber",   marketCap:  72_000, netDebt:  -2_000, ttmRevenue:  5_700, ttmEbitda: 1_700, yoyGrowthPct: 12, momentumPct:  25, privateCompHint: null },
  { ticker: "S",    name: "SentinelOne",        sector: "cyber",   marketCap:   7_000, netDebt:  -1_000, ttmRevenue:    800, ttmEbitda:   -50, yoyGrowthPct: 30, momentumPct:   5, privateCompHint: "Abnormal Security" },

  // ── B2B SaaS / Dev Tools ──
  { ticker: "NOW",  name: "ServiceNow",         sector: "saas",    marketCap: 200_000, netDebt:  -3_000, ttmRevenue: 11_000, ttmEbitda: 2_600, yoyGrowthPct: 22, momentumPct:  30, privateCompHint: null },
  { ticker: "DDOG", name: "Datadog",            sector: "saas",    marketCap:  48_000, netDebt:  -2_500, ttmRevenue:  2_700, ttmEbitda:   500, yoyGrowthPct: 25, momentumPct:  35, privateCompHint: "Grafana Labs" },
  { ticker: "SNOW", name: "Snowflake",          sector: "saas",    marketCap:  55_000, netDebt:  -4_000, ttmRevenue:  3_600, ttmEbitda:   150, yoyGrowthPct: 28, momentumPct:  15, privateCompHint: "Databricks" },
  { ticker: "MDB",  name: "MongoDB",            sector: "saas",    marketCap:  22_000, netDebt:  -2_000, ttmRevenue:  2_000, ttmEbitda:   120, yoyGrowthPct: 20, momentumPct:  -5, privateCompHint: "Cockroach Labs" },
  { ticker: "GTLB", name: "GitLab",             sector: "saas",    marketCap:   9_000, netDebt:  -1_000, ttmRevenue:    750, ttmEbitda:    30, yoyGrowthPct: 30, momentumPct:  10, privateCompHint: null },

  // ── Fintech ──
  { ticker: "PYPL", name: "PayPal",             sector: "fintech", marketCap:  75_000, netDebt:   2_000, ttmRevenue: 31_000, ttmEbitda: 6_500, yoyGrowthPct:  8, momentumPct:  12, privateCompHint: "Stripe" },
  { ticker: "COIN", name: "Coinbase",           sector: "fintech", marketCap:  65_000, netDebt:  -4_000, ttmRevenue:  6_500, ttmEbitda: 2_500, yoyGrowthPct: 50, momentumPct:  60, privateCompHint: "Kraken" },
  { ticker: "XYZ",  name: "Block",              sector: "fintech", marketCap:  45_000, netDebt:       0, ttmRevenue: 24_000, ttmEbitda: 3_000, yoyGrowthPct: 10, momentumPct:  18, privateCompHint: "Brex" },
  { ticker: "AFRM", name: "Affirm",             sector: "fintech", marketCap:  20_000, netDebt:   3_000, ttmRevenue:  2_700, ttmEbitda:   200, yoyGrowthPct: 40, momentumPct:  55, privateCompHint: "Klarna" },
  { ticker: "NU",   name: "Nu Holdings",        sector: "fintech", marketCap:  55_000, netDebt:       0, ttmRevenue: 11_000, ttmEbitda: 3_000, yoyGrowthPct: 40, momentumPct:  25, privateCompHint: null },

  // ── AI ──
  { ticker: "NVDA", name: "NVIDIA",             sector: "ai",      marketCap: 3_400_000, netDebt: -25_000, ttmRevenue: 130_000, ttmEbitda: 85_000, yoyGrowthPct: 90, momentumPct:  80, privateCompHint: "Cerebras" },
  { ticker: "PLTR", name: "Palantir",           sector: "ai",      marketCap: 180_000, netDebt:  -5_000, ttmRevenue:  2_900, ttmEbitda:   800, yoyGrowthPct: 30, momentumPct: 150, privateCompHint: "Scale AI" },
  { ticker: "ARM",  name: "Arm Holdings",       sector: "ai",      marketCap: 140_000, netDebt:  -2_000, ttmRevenue:  3_500, ttmEbitda:   900, yoyGrowthPct: 25, momentumPct:  40, privateCompHint: "SiFive" },
  { ticker: "AI",   name: "C3.ai",              sector: "ai",      marketCap:   3_500, netDebt:    -700, ttmRevenue:    380, ttmEbitda:  -280, yoyGrowthPct: 25, momentumPct: -10, privateCompHint: "Anthropic" },
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

// ── Live market-cap refresh (optional, reuses the Stocks page's FMP key) ─────

const FMP_KEY = (import.meta as unknown as { env: Record<string, string> }).env.VITE_FMP_API_KEY ?? "";

export const hasLiveDataKey = Boolean(FMP_KEY);

interface FmpQuote { symbol: string; marketCap: number }

/**
 * Fetch fresh market caps (USD millions) keyed by ticker from Financial
 * Modeling Prep. Returns null when no key is configured or the call fails, so
 * the hub gracefully stays on the reference snapshot.
 */
export async function fetchLiveMarketCaps(): Promise<Map<string, number> | null> {
  if (!FMP_KEY) return null;
  try {
    const symbols = PUBLIC_COMPANIES.map((c) => c.ticker).join(",");
    const res = await fetch(`https://financialmodelingprep.com/api/v3/quote/${symbols}?apikey=${FMP_KEY}`);
    if (!res.ok) return null;
    const data = (await res.json()) as FmpQuote[];
    if (!Array.isArray(data)) return null;
    const map = new Map<string, number>();
    for (const q of data) {
      if (q.symbol && typeof q.marketCap === "number" && q.marketCap > 0) {
        map.set(q.symbol, q.marketCap / 1e6); // FMP returns absolute USD → millions
      }
    }
    return map.size ? map : null;
  } catch {
    return null;
  }
}
