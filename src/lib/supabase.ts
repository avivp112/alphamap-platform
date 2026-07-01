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

export interface Leader { name: string; role: string }

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
  founders: string[] | null;
  created_at: string;
  updated_at: string;
  funding_rounds: FundingRound[];
}

export async function fetchStartups(): Promise<Startup[]> {
  const { data, error } = await supabase
    .from("startups")
    .select("*, funding_rounds(*)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Startup[];
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
  snapshot_date: string;
  headcount: number;
}

export async function fetchHeadcountHistory(companyId: string): Promise<HeadcountPoint[]> {
  const { data, error } = await supabase
    .from("headcount_history")
    .select("snapshot_date, headcount")
    .eq("company_id", companyId)
    .order("snapshot_date", { ascending: true });
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
