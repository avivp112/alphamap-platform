import { createClient } from "@supabase/supabase-js";

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Which of the two required build-time variables are missing, if any.
 *
 * Vite inlines import.meta.env.VITE_* at BUILD time, so a deploy built without
 * these is permanently broken no matter what the runtime environment holds —
 * and createClient(undefined, undefined) throws "supabaseUrl is required"
 * while this module is still being imported. That throw happens before React
 * ever mounts, so nothing catches it and the user gets a silent white screen
 * with the real cause buried in the console.
 *
 * So: report the problem instead of throwing. main.tsx checks this and renders
 * a readable message naming the missing variables.
 */
export const missingSupabaseEnv: string[] = [
  ...(rawUrl?.trim() ? [] : ["VITE_SUPABASE_URL"]),
  ...(rawKey?.trim() ? [] : ["VITE_SUPABASE_ANON_KEY"]),
];

// Syntactically valid placeholders so createClient cannot throw at import
// time. They are never reached: main.tsx refuses to mount the app when
// missingSupabaseEnv is non-empty.
const supabaseUrl = rawUrl?.trim() || "https://missing-config.invalid";
const supabaseAnonKey = rawKey?.trim() || "missing-config";

// "Remember me" by default — the session (and its refresh token) is persisted
// to localStorage and silently refreshed in the background, so a signed-in
// visitor stays signed in across visits/restarts until they explicitly log
// out (TopNav's handleSignOut is the only place that calls auth.signOut()).
// These are already supabase-js's defaults; spelled out explicitly here so
// the "stay logged in" behavior is a documented decision, not an accident of
// defaults someone could silently change later.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});

export type RoundType =
  | "Pre-Seed" | "Seed"
  | "Series A" | "Series B" | "Series C" | "Series D" | "Series E+"
  | "Growth" | "Bridge" | "Convertible Note"
  | "Bootstrapped" | "Grant" | "Acquired"
  // Non-VC financial events — categorized distinctly so the scoring engine
  // can exclude them from equity-capital math (a debt facility is not a
  // dilutive round; a secondary sends no money to the company; a PE buyout
  // signals the mature_private archetype rather than venture traction).
  | "PE Buyout" | "Secondary" | "Debt"
  | "Other";

export type GrowthTrend =
  | "rapid growth" | "moderate growth" | "stable" | "reduction" | "unknown";

// Background signals feeding the AlphaMap Score's Founder & Team Quality
// pillar (see calculate_alphamap_score / scripts/bulk_enrich_all.ts) — any
// ONE person on the team carrying a flag counts for the whole company.
// Absent/undefined reads as false, never a penalty by itself; these are
// only ever set when genuinely verified, never guessed.
export interface PersonQualityTags {
  had_prior_exit?: boolean | null;    // founded a company that was acquired or IPO'd
  elite_background?: boolean | null;  // elite technical/military unit, top R&D lab
  notable_pedigree?: boolean | null;  // key role at a unicorn, or an elite university degree
}

export interface Leader extends PersonQualityTags {
  name: string;
  role: string;
  linkedin_url?: string | null;
  // When this person joined, if known — feeds the Recency & Activity pillar
  // ("a C-level hire in the last 30-90 days"). Best-effort; omitted far
  // more often than it's known.
  joined_date?: string | null;
}

export interface Founder extends PersonQualityTags {
  name: string;
  linkedin_url?: string | null;
}

// startup_id is set when the competitor could be matched to another row in
// this table by website domain (see scripts/bulk_enrich_all.ts), enabling a
// clickable cross-reference; null when the competitor isn't one we track.
export interface Competitor {
  name: string;
  website?: string | null;
  how_it_competes: string;
  startup_id?: string | null;
}

// One entry per investor whose SPECIFIC dollar contribution to a round is
// disclosed — rare; most rounds only report the round total (amount_raised).
export interface InvestorAmount { name: string; amount: number }

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
  investor_amounts?: InvestorAmount[] | null;
  created_at: string;
}

// acquired_startup_id is set when the acquired company could be matched to
// another row in this table by website domain, same as Competitor.
export interface Acquisition {
  company_name: string;
  website?: string | null;
  acquired_date?: string | null;
  amount?: number | null;
  description?: string | null;
  acquired_startup_id?: string | null;
}

// Company social profiles — distinct from a person's own linkedin_url
// inside founders/leadership. Fill-null only, same as website.
export interface CompanySocialLinks {
  linkedin_url?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
}

// Auto-populated by scripts/bulk_enrich_all.ts — same fill-null-when-empty
// write policy as competitors/acquisitions.
export interface NewsItem {
  title: string;
  url: string;
  source?: string | null;
  published_date?: string | null;
  // Best-effort — omitted by the enrichment pipeline when the article's own
  // page doesn't expose them (e.g. no og:image, or a paywalled summary).
  summary?: string | null;
  image_url?: string | null;
}

// News articles enriched before image_url existed (most of them, at least
// until the next bulk_enrich_all.ts pass touches each company again) don't
// carry one. Rather than wait on a full re-enrichment, fetch it on demand
// client-side via the fetch-article-image Edge Function, which fetches the
// article's own page server-side (the browser can't — CORS) and reads its
// og:image/twitter:image share-preview tag. In-memory cache (not persisted
// to the DB — the anon client has no write access to startups.news) so the
// same article shown twice in one session only triggers one fetch.
const articleImageCache = new Map<string, Promise<string | null>>();

export async function fetchArticleImage(url: string): Promise<string | null> {
  const cached = articleImageCache.get(url);
  if (cached) return cached;
  const promise = supabase.functions
    .invoke("fetch-article-image", { method: "POST", body: { url } })
    .then(({ data, error }) => (error ? null : (data?.image_url ?? null)))
    .catch(() => null);
  articleImageCache.set(url, promise);
  return promise;
}

export interface Startup extends CompanySocialLinks {
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
  news?: NewsItem[] | null;
  // Resolved via PostgREST FK embedding in fetchStartupDetail — the single
  // stored sector_id name (this company's main/primary field), when set.
  // Falls back to the client-side keyword classifier (classifyIndustry)
  // when null, same COALESCE precedence the startups_search view already
  // uses server-side.
  sector?: { name: string } | null;
  // Every OTHER field this company meaningfully operates in (typically
  // 1-4), from the startup_sub_sectors join table — see
  // supabase/migrations/20260915000000_startup_sub_sector_tags.sql. Free to
  // include sectors from a different parent tree than `sector` above (e.g.
  // a biotech company also tagged "AI Agents").
  sub_sectors?: { sector: { name: string } | null }[] | null;
  funding_rounds: FundingRound[];
  // Auto-populated by scripts/bulk_enrich_all.ts (fill-null only — never
  // overwrites pre-existing curated data). Accepts the legacy plain-string
  // shape too, for any rows written before the structured format landed.
  competitors?: (Competitor | string)[] | null;
  // Companies THIS startup has acquired (outbound only — being acquired is
  // tracked via a funding_rounds row with round_type 'Acquired'). Same
  // fill-null write policy as competitors.
  acquisitions?: Acquisition[] | null;
  // Best-effort IP signal — NULL means "not found", never "zero patents".
  patent_count?: number | null;
  patent_fields?: string[] | null;
  // Claude's assessment (as of the last enrichment run) of whether
  // funding_rounds is this company's complete history. NULL = not yet
  // assessed. FALSE = a gap is suspected (e.g. a Series B+ round found with
  // no earlier Seed/Series A) — surface a warning rather than presenting
  // the rounds shown as if they were the whole story.
  funding_history_complete?: boolean | null;
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
  competitors?: (Competitor | string)[] | null;
  sector_parent: string;
  // Every OTHER field this company is tagged with, beyond sector_parent —
  // see startup_sub_sectors / supabase/migrations/20260915000000.
  sub_sector_names: string[];
  stage_group_val: "early" | "growth" | "late" | "unknown";
  latest_round_type: RoundType | null;
  latest_valuation: number | null;
  latest_round_date: string | null;
  latest_round_is_estimated: boolean | null;
  total_raised: number;
  has_recent_round: boolean;
  peer_count: number;
  peer_count_valid: boolean;
  // 0-15, one point per populated field (website, description, industry,
  // funding data, etc.) — powers the Private Market page's default sort,
  // best-documented companies first.
  completeness_score: number;
}

export interface StartupSearchFilters {
  search?: string;
  sectorParent?: string;
  // Dynamic ILIKE-OR patterns for sub-sector drill-down, built client-side
  // from the same INDUSTRY_KEYWORD_MAP used for display classification —
  // avoids duplicating ~90 keyword→sub mappings as SQL. Used by the
  // sidebar's hierarchical (parent-then-child) filter.
  sectorSubKeywords?: string[];
  // Exact match against a single stored sub-sector TAG (startup_sub_sectors
  // / sub_sector_names) — used when a user clicks a sub-sector chip on a
  // company's tearsheet to see every other company sharing that tag,
  // independent of what either company's own main sector is.
  subSectorTag?: string;
  country?: string;
  city?: string;
  stageRoundTypes?: RoundType[];
  headcountMin?: number;
  headcountMax?: number;
  momentum?: boolean;
  density?: "crowded" | "blue-ocean";
  /** Latest funding round announced within this many days of today. */
  fundedWithinDays?: number;
}

export const STARTUPS_PAGE_SIZE = 40;

function applyStartupSearchFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  filters: StartupSearchFilters,
) {
  let q = query;
  if (filters.search) {
    // Name only — country/city/sector already have their own dedicated
    // filters, and matching them here too (plus a loose description
    // substring match) let searches for one company surface a page full of
    // unrelated companies whose description happened to share a word.
    // Typing a real company name should reliably surface that company.
    const term = filters.search.replace(/[%,]/g, "");
    q = q.ilike("name", `%${term}%`);
  }
  if (filters.sectorParent) q = q.eq("sector_parent", filters.sectorParent);
  if (filters.sectorSubKeywords && filters.sectorSubKeywords.length > 0) {
    q = q.or(filters.sectorSubKeywords.map((k) => `industry.ilike.%${k.replace(/[%,]/g, "")}%`).join(","));
  }
  if (filters.subSectorTag) q = q.contains("sub_sector_names", [filters.subSectorTag]);
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
  if (filters.fundedWithinDays != null) {
    const cutoff = new Date(Date.now() - filters.fundedWithinDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    q = q.gte("latest_round_date", cutoff);
  }
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
    .order("completeness_score", { ascending: false })
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return (data ?? []) as StartupListRow[];
}

// Export cap — large enough to cover any realistic filtered slice of the
// database, small enough that the browser isn't asked to hold/serialize an
// unbounded CSV. Fetched in PostgREST's max page size (1000) per request.
export const EXPORT_ROW_CAP = 5000;

export async function fetchStartupsForExport(filters: StartupSearchFilters): Promise<StartupListRow[]> {
  const batchSize = 1000;
  const out: StartupListRow[] = [];
  for (let from = 0; from < EXPORT_ROW_CAP; from += batchSize) {
    const to = Math.min(from + batchSize, EXPORT_ROW_CAP) - 1;
    const query = applyStartupSearchFilters(supabase.from("startups_search").select("*"), filters);
    const { data, error } = await query
      .order("completeness_score", { ascending: false })
      .order("updated_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const batch = (data ?? []) as StartupListRow[];
    out.push(...batch);
    if (batch.length < batchSize) break;
  }
  return out;
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
    .select(`
      *, funding_rounds(*),
      sector:sectors!startups_sector_id_fkey(name),
      sub_sectors:startup_sub_sectors(sector:sectors(name))
    `)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Startup;
}

/** Flattens Startup.sub_sectors (the raw FK-embed shape) into plain names. */
export function subSectorNames(startup: Pick<Startup, "sub_sectors">): string[] {
  return (startup.sub_sectors ?? [])
    .map((t) => t.sector?.name)
    .filter((name): name is string => Boolean(name));
}

// Fetches a single row from the search view — used to open the tearsheet for
// a linked competitor that isn't in the currently-loaded page of results.
export async function fetchStartupListRowById(id: string): Promise<StartupListRow | null> {
  const { data, error } = await supabase
    .from("startups_search")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as StartupListRow) ?? null;
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

// Dual-track scoring: the engine classifies each company's archetype before
// scoring and re-weights the pillars accordingly (see the
// dual_track_scoring migration). Pillar labels come from the response, so
// mature companies show "Scale & Longevity" / "M&A & Backing" automatically.
export type CompanyArchetype = 'venture_backed' | 'mature_private';

export interface AlphaScorePillar {
  label: string;
  weight: number;
  score: number | null;
  valid: boolean;
  detail: {
    // investor_quality
    best_tier?: number | null;
    n_investors?: number;
    n_matched?: number;
    source?: string;
    // team_quality
    prior_exit?: boolean;
    elite_background?: boolean;
    notable_pedigree?: boolean;
    n_people?: number;
    // growth_velocity
    growth_pct?: number;
    earliest_date?: string | null;
    latest_date?: string | null;
    // recency_activity
    days_since?: number | null;
    signal?: 'funding_round' | 'leadership_hire' | 'news' | null;
    most_recent_date?: string | null;
    // media_coverage
    n_recent_articles?: number;
    window_days?: number;
  };
}

// 5-pillar AlphaMap Score model (see supabase/migrations/
// 20260827000000_update_alphamap_score_formula.sql for the full formula).
// archetype/archetype_reasons are informational only — classify_company_
// archetype() no longer drives pillar weights, it's just surfaced as
// context (and is still used independently by PrivateEquity.tsx).
export interface AlphaScore {
  score: number;
  tier: 'A' | 'B' | 'C';
  confidence: 'high' | 'medium' | 'low' | 'none';
  archetype?: CompanyArchetype;
  archetype_reasons?: string[];
  base_score: number;
  macro_adj_pct: number;
  sector_id?: string;
  // true when Investor Quality + Founder & Team Quality were both >= 85 and
  // the safety floor had to raise the final score up to 70.
  safety_floor_applied?: boolean;
  pillars: {
    investor_quality: AlphaScorePillar;
    team_quality: AlphaScorePillar;
    growth_velocity: AlphaScorePillar;
    recency_activity: AlphaScorePillar;
    media_coverage: AlphaScorePillar;
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

// One AlphaMap Score snapshot per startup per calendar day, written by
// scripts/bulk_enrich_all.ts after each enrichment pass (calculate_
// alphamap_score is a live, memoryless RPC — this table is what gives it a
// timeline). Same shape/query pattern as fetchHeadcountHistory.
export interface ScoreHistoryPoint {
  recorded_date: string;
  score: number;
  tier: string | null;
}

export async function fetchScoreHistory(startupId: string): Promise<ScoreHistoryPoint[]> {
  const { data, error } = await supabase
    .from("alphamap_score_history")
    .select("recorded_date, score, tier")
    .eq("startup_id", startupId)
    .order("recorded_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ScoreHistoryPoint[];
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
      investor_quality:  score.pillars.investor_quality,
      team_quality:      score.pillars.team_quality,
      growth_velocity:   score.pillars.growth_velocity,
      recency_activity:  score.pillars.recency_activity,
      media_coverage:    score.pillars.media_coverage,
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
  // Added by later migrations (pe_firms, investors_enrichment)
  firm_type?: 'vc' | 'pe' | 'growth';
  leadership?: Leader[] | null;
  thesis?: string | null;
  last_enriched_at?: string | null;
  enrichment_confidence?: number | null;
}

// ── Private Equity ────────────────────────────────────────────────────────────
// The PE directory is DERIVED from real transaction data ('PE Buyout' /
// 'Secondary' rounds carry firm names in lead_investor / investors[]),
// enriched by the investors table (firm_type = 'pe') when a curated profile
// exists for the same name. See supabase/migrations/20260720000000_pe_firms.sql.

export interface PEFirmRow {
  firm_name: string;
  investor_id: string | null;
  slug: string | null;
  description: string | null;
  thesis: string | null;
  founded_year: number | null;
  headquarters: string | null;
  fund_size: string | null;
  website: string | null;
  tier: number | null;
  leadership: Leader[] | null;
  buyout_count: number;
  secondary_count: number;
  debt_count: number;
  portfolio_count: number;
  latest_deal_date: string | null;
  total_deal_value: number;
}

export interface PEPortfolioCompany {
  startup_id: string;
  name: string;
  industry: string | null;
  country: string | null;
  city: string | null;
  employee_count: number | null;
  founded_year: number | null;
  years_active: number | null;
  growth_trend: GrowthTrend | null;
  n_acquisitions: number;
  archetype: CompanyArchetype | null;
  first_deal_date: string | null;
  deal_types: RoundType[];
}

export interface PETransaction {
  round_id: string;
  startup_id: string;
  company_name: string;
  industry: string | null;
  round_type: RoundType;
  amount_raised: number | null;
  valuation: number | null;
  announcement_date: string | null;
  is_lead: boolean;
  source_url: string | null;
}

export async function fetchPEFirms(): Promise<PEFirmRow[]> {
  const { data, error } = await supabase.rpc("pe_firms_directory");
  if (error) throw error;
  return (data ?? []) as PEFirmRow[];
}

export async function fetchPEFirmPortfolio(firmName: string): Promise<PEPortfolioCompany[]> {
  const { data, error } = await supabase.rpc("pe_firm_portfolio", { p_firm_name: firmName });
  if (error) throw error;
  return (data ?? []) as PEPortfolioCompany[];
}

export async function fetchPEFirmTransactions(firmName: string): Promise<PETransaction[]> {
  const { data, error } = await supabase.rpc("pe_firm_transactions", { p_firm_name: firmName });
  if (error) throw error;
  return (data ?? []) as PETransaction[];
}

// Names (lowercased) of investors that appear on a deal in the `deals` feed
// within the last N months — powers the VC directory's "Active (24 mo)"
// filter with real deal data, since investor profile rows carry no deal
// recency of their own.
export async function fetchRecentActiveInvestorNames(months = 24): Promise<Set<string>> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const { data, error } = await supabase
    .from("deals")
    .select("investors")
    .gte("deal_date", cutoff.toISOString().slice(0, 10))
    .not("investors", "is", null);
  if (error) throw error;
  const names = new Set<string>();
  for (const row of (data ?? []) as Array<{ investors: string[] | null }>) {
    for (const n of row.investors ?? []) {
      const t = n?.trim().toLowerCase();
      if (t) names.add(t);
    }
  }
  return names;
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

export type ContactTopic = "general" | "partnership" | "press" | "support" | "enterprise";

export interface ContactMessageInput {
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
}

export async function submitContactMessage(input: ContactMessageInput): Promise<void> {
  const res = await fetch(
    `${supabaseUrl}/functions/v1/send-contact-message`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify(input),
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
}

// =============================================================================
// Preference engine — Phase 1 (schema + types only; see
// supabase/migrations/20260924000000_preference_engine_phase1.sql)
//
// Read/write helper functions are deliberately not added yet — they land in
// the phase that actually calls them (onboarding UI, Pass/Save wiring, the
// vector batch job), so nothing here sits unused in the meantime.
// =============================================================================

/** One current row per user — their onboarding cold-start answers. The
 * deterministic hard-filter side of personalization (kept separate from
 * UserPreferenceVector, which is the soft/continuous side). */
export type PainPointFocus = "origination" | "deck_processing" | "comps_dd" | "ic_prep";
export type SignalTrigger = "founder_pedigree" | "traction_spikes" | "company_registrations" | "pre_public_funding";

export interface UserMandateDeliveryPrefs {
  push?: boolean;
  digest?: boolean;
  tearsheet_1click?: boolean;
  crm_sync?: boolean;
}

export interface UserMandate {
  user_id: string;
  // Free text, validated app-side against the same vocabularies Startups.tsx
  // already filters on (stage steps, the `sectors` table, country list) —
  // not DB-enforced, same convention as startups.tags.
  stages: string[];
  sectors: string[];
  geographies: string[];
  pain_point_focus: PainPointFocus | null;
  signal_triggers: SignalTrigger[];
  delivery_prefs: UserMandateDeliveryPrefs;
  updated_at: string;
}

/** Append-only explicit + implicit signal log — source data for the (later)
 * user_preference_vectors batch recompute. Never updated or deleted. */
export type InteractionActionType = "pass" | "save" | "tearsheet_summary" | "crm_sync" | "lookalikes_view";
export type PassReason = "sector" | "stage" | "valuation" | "team";
export type TearsheetTabId = "overview" | "funding" | "captable" | "talent" | "competitors" | "acquisitions" | "news";

export interface UserInteraction {
  id: string;
  user_id: string;
  startup_id: string;
  action_type: InteractionActionType;
  /** Only set when action_type === "pass". */
  pass_reason: PassReason | null;
  /** Only set when action_type === "tearsheet_summary" — one row per
   * tearsheet close, flushed client-side, never one row per hover/section. */
  tabs_visited: TearsheetTabId[] | null;
  total_active_seconds: number | null;
  created_at: string;
}

/** The derived preference-embedding artifact: one row per user, recomputed
 * periodically by a batch job (later phase) from user_interactions +
 * watchlist_items. Never written directly by the client — the embedding
 * itself isn't exposed here since there's no client use case for the raw
 * 1536-dim vector yet, only the metadata needed to gate the UI. */
export interface UserPreferenceVectorMeta {
  user_id: string;
  /** Gates the UI: below some minimum, show "still calibrating" rather than
   * a misleadingly confident match percentage. */
  signal_count: number;
  updated_at: string;
}

/** Per-user generic outbound webhook target (v1 CRM sync). */
export interface UserWebhook {
  id: string;
  user_id: string;
  target_url: string;
  secret: string;
  enabled: boolean;
  created_at: string;
}

/** In-app alert backing TopNav's bell — currently a decorative static dot
 * with no data behind it. Client can read its own and mark read; rows are
 * otherwise only ever created by a service-role alert-matching job. */
export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}
