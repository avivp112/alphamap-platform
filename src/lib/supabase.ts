import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type RoundType =
  | "Pre-Seed" | "Seed"
  | "Series A" | "Series B" | "Series C" | "Series D" | "Series E+"
  | "Growth" | "Bridge" | "Convertible Note"
  | "Bootstrapped" | "Grant" | "Acquired" | "Other";

export type GrowthTrend =
  | "rapid growth" | "moderate growth" | "stable" | "reduction" | "unknown";

export interface Leader { name: string; role: string; linkedin_url?: string | null }

export interface Founder { name: string; linkedin_url?: string | null }

export interface FundingRound {
  id: string;
  startup_id: string;
  round_type: RoundType | null;
  amount_raised: number | null;
  valuation: number | null;
  is_valuation_estimated: boolean | null;
  announcement_date: string | null;
  source_url: string | null;
  lead_investor: string | null;
  investors: string[] | null;
  created_at: string;
}

export interface Startup {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  industry: string | null;
  founded_year: number | null;
  employee_count: number | null;
  growth_trend: GrowthTrend | null;
  leadership: Leader[] | null;
  country: string | null;
  city: string | null;
  founders: Founder[] | null;
  created_at: string;
  updated_at: string;
  funding_rounds: FundingRound[];
  // Competitor names or URLs, manually curated by the research team — never
  // inferred from sector/stage similarity (see CompetitorsMarketTab).
  competitors?: string[] | null;
}

// PostgREST caps any single response at its configured max-rows (1000 by
// default), so a plain unpaginated select silently truncates once the table
// grows past that — this loops in batches until a short page signals the end,
// so callers that genuinely need the whole table (e.g. GlobalTechHubMap) get
// all of it regardless of how large `startups` gets.
export async function fetchStartups(): Promise<Startup[]> {
  const BATCH = 1000;
  const all: Startup[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("startups")
      .select("*, funding_rounds(*)")
      .order("created_at", { ascending: false })
      .range(from, from + BATCH - 1);
    if (error) throw error;
    const batch = (data ?? []) as Startup[];
    all.push(...batch);
    if (batch.length < BATCH) break;
    from += BATCH;
  }
  return all;
}

// ── Startups Hub: server-side filtered + paginated search ───────────────────
// Backed by the `startups_search` view (see supabase/migrations/
// 20260713000000_startups_scalable_search.sql), which precomputes the latest
// funding round, total raised, sector bucket, and a scalable peer_count — so
// none of this needs the full `startups` table (or its funding_rounds) in
// memory. Every field below lives directly on that view.
export interface StartupListRow {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  industry: string | null;
  founded_year: number | null;
  employee_count: number | null;
  growth_trend: GrowthTrend | null;
  leadership: Leader[] | null;
  country: string | null;
  city: string | null;
  founders: Founder[] | null;
  created_at: string;
  updated_at: string;
  competitors?: string[] | null;
  sector_parent: string;
  stage_group_val: "early" | "growth" | "late" | "unknown";
  latest_round_type: RoundType | null;
  latest_valuation: number | null;
  latest_round_date: string | null;
  latest_round_is_estimated: boolean | null;
  total_raised: number;
  has_recent_round: boolean;
  peer_count: number;
  peer_count_valid: boolean;
}

export interface StartupSearchFilters {
  search?: string;
  sectorParent?: string;
  // Dynamic ILIKE-OR patterns for sub-sector drill-down, built client-side
  // from the same INDUSTRY_KEYWORD_MAP used for display classification —
  // avoids duplicating ~90 keyword→sub mappings as SQL.
  sectorSubKeywords?: string[];
  country?: string;
  city?: string;
  stageRoundTypes?: RoundType[];
  headcountMin?: number;
  headcountMax?: number;
  momentum?: boolean;
  density?: "crowded" | "blue-ocean";
}

export const STARTUPS_PAGE_SIZE = 40;

function applyStartupSearchFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  filters: StartupSearchFilters,
) {
  let q = query;
  if (filters.search) {
    const term = filters.search.replace(/[%,]/g, "");
    q = q.or(
      [
        `name.ilike.%${term}%`,
        `industry.ilike.%${term}%`,
        `country.ilike.%${term}%`,
        `city.ilike.%${term}%`,
        `description.ilike.%${term}%`,
      ].join(","),
    );
  }
  if (filters.sectorParent) q = q.eq("sector_parent", filters.sectorParent);
  if (filters.sectorSubKeywords && filters.sectorSubKeywords.length > 0) {
    q = q.or(filters.sectorSubKeywords.map((k) => `industry.ilike.%${k.replace(/[%,]/g, "")}%`).join(","));
  }
  if (filters.country) q = q.eq("country", filters.country);
  if (filters.city) q = q.or(`city.ilike.%${filters.city}%,country.ilike.%${filters.city}%`);
  if (filters.stageRoundTypes && filters.stageRoundTypes.length > 0) {
    q = q.in("latest_round_type", filters.stageRoundTypes);
  }
  if (filters.headcountMin != null) q = q.gte("employee_count", filters.headcountMin);
  if (filters.headcountMax != null) q = q.lte("employee_count", filters.headcountMax);
  if (filters.momentum) {
    q = q.eq("has_recent_round", true).in("growth_trend", ["rapid growth", "moderate growth"]);
  }
  if (filters.density === "crowded")    q = q.eq("peer_count_valid", true).gte("peer_count", 4);
  if (filters.density === "blue-ocean") q = q.eq("peer_count_valid", true).lte("peer_count", 2);
  return q;
}

export async function fetchStartupsPage(
  filters: StartupSearchFilters,
  page: number,
): Promise<StartupListRow[]> {
  const from = (page - 1) * STARTUPS_PAGE_SIZE;
  const to = from + STARTUPS_PAGE_SIZE - 1;
  const query = applyStartupSearchFilters(supabase.from("startups_search").select("*"), filters);
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return (data ?? []) as StartupListRow[];
}

export async function fetchStartupsCount(filters: StartupSearchFilters): Promise<number> {
  const query = applyStartupSearchFilters(
    supabase.from("startups_search").select("id", { count: "exact", head: true }),
    filters,
  );
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function fetchDistinctCountries(): Promise<string[]> {
  const { data, error } = await supabase.rpc("distinct_startup_countries");
  if (error) throw error;
  return ((data ?? []) as Array<{ country: string }>).map((r) => r.country);
}

// Full record (including every funding round) for the Tearsheet modal —
// fetched on demand when a card is opened, since the list view intentionally
// only carries the latest-round summary to keep pages light at 10,000+ rows.
export async function fetchStartupDetail(id: string): Promise<Startup> {
  const { data, error } = await supabase
    .from("startups")
    .select("*, funding_rounds(*)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Startup;
}

export async function fetchSuggestedPeers(
  startupId: string,
  excludeIds: string[],
  limit = 5,
): Promise<StartupListRow[]> {
  const { data, error } = await supabase.rpc("suggested_startup_peers", {
    p_startup_id: startupId,
    p_exclude_ids: excludeIds,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as StartupListRow[];
}

export interface AlphaScorePillar {
  label: string;
  weight: number;
  score: number | null;
  valid: boolean;
  detail: {
    value_creation_x?: number;
    burn_proxy_k?: number;
    tier?: string;
    hc_growth_pct?: number;
    serial_founder?: boolean;
    investor_tier?: number | null;
    follow_on?: boolean;
    source?: string;
    n_investors?: number;
    n_matched?: number;
  };
}

export interface AlphaScore {
  score: number;
  tier: 'A' | 'B' | 'C';
  confidence: 'high' | 'medium' | 'low' | 'none';
  base_score: number;
  macro_adj_pct: number;
  sector_id?: string;
  pillars: {
    capital_efficiency: AlphaScorePillar;
    talent_velocity: AlphaScorePillar;
    ecosystem_signal: AlphaScorePillar;
  };
  error?: string;
  reason?: string;
}

export interface HeadcountPoint {
  recorded_date: string;
  employee_count: number;
}

export async function fetchHeadcountHistory(startupId: string): Promise<HeadcountPoint[]> {
  const { data, error } = await supabase
    .from("headcount_history")
    .select("recorded_date, employee_count")
    .eq("startup_id", startupId)
    .order("recorded_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as HeadcountPoint[];
}

export async function fetchAlphaScore(startupId: string): Promise<AlphaScore | null> {
  const { data, error } = await supabase.rpc('calculate_alphamap_score', { p_startup_id: startupId });
  if (error) {
    console.error(`[AlphaMapEngine] RPC error for startup ${startupId}:`, error);
    throw error;
  }
  const score = data as AlphaScore | null;
  if (score?.error) {
    console.warn(`[AlphaMapEngine] startup ${startupId} returned no score:`, score.error ?? score.reason);
  } else if (score?.pillars) {
    console.log(`[AlphaMapEngine] startup ${startupId} → score=${score.score} tier=${score.tier} confidence=${score.confidence}`, {
      capital_efficiency: score.pillars.capital_efficiency,
      talent_velocity:    score.pillars.talent_velocity,
      ecosystem_signal:   score.pillars.ecosystem_signal,
    });
  }
  return score;
}

// ── Deals ─────────────────────────────────────────────────────────────────────
// Maps 1-to-1 with the `deals` table schema.
// deal_type examples: 'Series A', 'Form D (Equity)', 'M&A'

export interface DealRow {
  id: string;
  company_name: string;
  startup_id: string | null;
  deal_date: string;             // ISO date "YYYY-MM-DD"
  amount_raised: number | null;
  target_amount: number | null;
  deal_type: string;
  investors: string[] | null;
  source_url: string | null;
  sector: string | null;
  country: string | null;
  valuation: number | null;
  is_valuation_estimated: boolean;
  created_at: string;
}

export async function fetchDeals(limit = 200): Promise<DealRow[]> {
  const { data, error } = await supabase
    .from("deals")
    .select("*")
    .order("deal_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as DealRow[];
}

// ── Investors ─────────────────────────────────────────────────────────────────
// Maps 1-to-1 with the `investors` table schema.

export interface InvestorRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  founded_year: number | null;
  headquarters: string | null;
  fund_size: string | null;
  typical_check_size: string | null;
  portfolio_size: number | null;
  stages: string[];
  sector_allocation: Record<string, number>;
  notable_investments: string[];
  website: string | null;
  tier: number | null;
  updated_at: string;
}

export async function fetchInvestors(): Promise<InvestorRow[]> {
  const { data, error } = await supabase
    .from("investors")
    .select("*")
    .order("portfolio_size", { ascending: false });
  if (error) throw error;
  return (data ?? []) as InvestorRow[];
}

// Lightweight name → tier lookup used by the Startup Cap Table tab to grade
// the investors backing a given round (1 = top-tier … 3 = long-tail).
// Keyed by lower-cased/trimmed name to match however funding_rounds.investors
// / lead_investor happen to be capitalized.
export async function fetchInvestorTierMap(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from("investors").select("name, tier");
  if (error) throw error;
  const map = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ name: string; tier: number | null }>) {
    if (row.tier != null) map.set(row.name.trim().toLowerCase(), row.tier);
  }
  return map;
}

export async function ingestStartup(companyName: string): Promise<{ startup: Startup; funding_round: FundingRound | null }> {
  const res = await fetch(
    `${supabaseUrl}/functions/v1/ingest-startup`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ company_name: companyName }),
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return {
    startup: { ...json.startup, funding_rounds: json.funding_round ? [json.funding_round] : [] },
    funding_round: json.funding_round ?? null,
  };
}
