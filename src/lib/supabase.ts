import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type StartupStage =
  | "Pre-Seed"
  | "Seed"
  | "Series A"
  | "Series B"
  | "Series C+"
  | "Growth"
  | "Bootstrapped"
  | "Acquired";

export type HiringTrend = "Growing" | "Stable" | "Shrinking" | "Unknown";

export interface Founder {
  name: string;
  title: string;
  linkedin?: string;
}

export interface Startup {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  industry: string | null;
  stage: StartupStage | null;
  website: string | null;
  domain: string | null;
  linkedin_url: string | null;
  valuation_usd: number | null;
  total_raised_usd: number | null;
  founding_year: number | null;
  location: string | null;
  employee_count: number | null;
  last_funding_date: string | null;
  founders: Founder[] | null;
  hiring_trend: HiringTrend | null;
  data_confidence: number | null;
  created_at: string;
  updated_at: string;
}

export async function fetchStartups(): Promise<Startup[]> {
  const { data, error } = await supabase
    .from("startups")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Startup[];
}

export async function ingestStartup(companyName: string): Promise<Startup> {
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
  return json.startup as Startup;
}
