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
