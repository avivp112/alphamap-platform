#!/usr/bin/env node
/**
 * bulk_enrich_all.ts — Full-database enrichment pass for ALL startups
 *
 * Three-tier priority queue (processed in this order):
 *   Tier 1 (NO data)      — no description, no employee_count, no real funding rounds
 *   Tier 2 (PARTIAL data) — has some profile/round data but key fields are missing
 *   Tier 3 (FULL data)    — complete profile; verification + new rounds + metrics refresh
 *
 * Search engine stack: Tavily (primary, budget-tracked) → Serper.dev (Google Search fallback)
 *   Serper replaces DuckDuckGo — it is a proper REST API with no rate-limit serialisation
 *   needed, so both primary and fallback can fire in parallel per company (funding history,
 *   amounts, investors, profile/headcount, competitors, news). Every query is anchored on the
 *   company's known website domain when one exists (preserved from the CSV import, not reset)
 *   — this disambiguates generic/ambiguous company names (e.g. "Actuality") from unrelated
 *   same-named entities and noise in plain name-only search. When no website is on file — the
 *   stealth/early-stage case most prone to this exact collision — the query falls back to the
 *   row's known country + a light category qualifier instead of searching the bare name alone.
 *   Set SERP_KEY (Serper API key). TAVILY_API_KEY is optional; if absent, Serper is used
 *   for everything.
 *
 *   A context source runs alongside the searches: the company's own website (when known),
 *   fetched via Tavily Extract (root + /about, JS-rendered, budget-tracked like a search call)
 *   when Tavily is available, falling back to a plain fetch + cheerio scrape of the root page's
 *   title/meta description/body text otherwise or if Extract comes back empty — the single most
 *   reliable source for description/industry/HQ location, since it's the company describing
 *   itself rather than a third party. Best-effort throughout: sites that block bots, are JS-only
 *   SPAs, or time out just fail silently, same as a failed search — never blocks a company.
 *
 *   Two conditional, targeted second-pass deep dives run after the general-purpose pass, each
 *   only firing for the specific gap it exists to close (so the added search/API cost is
 *   targeted, not blanket): deepDiveEarlyRounds() when a Series A+ round is confirmed with no
 *   earlier Pre-Seed/Seed (searches seed/pre-seed/angel coverage + backtracks the later round's
 *   lead investors), and deepDiveProfile() when the profile comes back essentially empty — no
 *   description, no location, no socials — targeting LinkedIn/Crunchbase company profile pages
 *   specifically. Both skip the Claude call entirely (and cost nothing beyond the searches
 *   already spent) when every deep-dive query also comes back empty.
 *
 * Resume / skip logic:
 *   MAX_TIER (default 3) — set to 2 to skip Tier 3 (fully-complete) companies and focus
 *   only on companies that actually need enrichment. Use after a partial run to avoid
 *   spending credits re-researching companies already enriched.
 *
 *   Every processed company is stamped with last_enriched_at, and the queue
 *   puts never-enriched companies first (then oldest-stamped). So to walk a
 *   large database across many runs, just re-run with the SAME settings and
 *   OFFSET=0 — each run automatically picks up the next BATCH_SIZE companies
 *   that haven't been touched yet. (OFFSET still exists for resuming a
 *   cancelled run against an unchanged queue, but is normally left at 0.)
 *
 * Write strategy (enforced by code, not just prompt):
 *   All tiers   — only fills NULL profile fields (never overwrites existing non-null values)
 *                 always refreshes employee_count + growth_trend (time-varying metrics)
 *                 merges founders as a union (additive, never destructive)
 *                 appends new funding rounds with dedup (same type + date ±6 months)
 *                 sets leadership only when currently NULL
 *                 sets competitors (4-5, each with a how-it-competes explanation) only when
 *                 currently NULL — cross-linked to our own tracked startups by domain match
 *                 sets acquisitions (companies THIS company bought) only when currently NULL —
 *                 same domain cross-link; [] from the model does NOT count as "set"
 *                 sets patent_count/patent_fields only when currently NULL — best-effort, no
 *                 dedicated search call, omitted rather than guessed
 *                 records per-investor dollar amounts on a round (funding_rounds.investor_amounts)
 *                 only for names explicitly disclosed — never a split of the round total
 *   Tier 3      — identical rule: since profile is complete, only headcount/growth_trend
 *                 are refreshed; everything else is fill-NULL only
 *   Confidence  — gates ONLY funding-round dollar figures, not the whole company. Profile
 *                 fields always write regardless of the overall score (each field already
 *                 carries its own "omit if unverifiable" instruction, so fabrication risk is
 *                 low). If confidence_score < MIN_CONFIDENCE (default: 40), funding_rounds are
 *                 withheld and the row is logged "partial" instead of "success" — profile data
 *                 still lands, funding just waits for a stronger source. A row where NOTHING
 *                 at all was written (empty profile + no rounds) is logged "low_confidence".
 *   Public co.  — is_public_company DELETES the row outright (never touches a
 *                 is_manually_verified=true row) — public companies aren't tracked here, so an
 *                 empty dead row isn't useful; removing it also means it won't keep being
 *                 re-researched every time the queue cycles back around.
 *   Stealth     — a Tier 1/2 row (still genuinely missing core data) that comes back
 *                 "no_data"/"low_confidence" is reclassified "stealth_suspected" when
 *                 last_enriched_at shows this isn't the first attempt — i.e. a repeat miss
 *                 across runs, not just a first pass turning up empty. Purely a reporting
 *                 signal (no separate write path): keeps the summary's "no_data"/
 *                 "low_confidence" counts meaning "still worth another pass" rather than mixing
 *                 in the tail of companies unlikely to ever resolve via search.
 *
 * Usage:
 *   npx tsx scripts/bulk_enrich_all.ts                            # dry run (default)
 *   DRY_RUN=false BATCH_SIZE=300 npx tsx scripts/bulk_enrich_all.ts
 *   …then simply re-run the same command until the queue is empty —
 *   last_enriched_at ordering advances the batch window automatically.
 *
 * GitHub Actions: see .github/workflows/bulk-enrich-all.yml
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as cheerio from "cheerio";

// ── Bootstrap: load .env for local dev (GHA uses repository secrets) ──────────
const __dir   = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

// ── Configuration ─────────────────────────────────────────────────────────────
const BATCH_SIZE     = Number(process.env.BATCH_SIZE     ?? 9999);  // all by default
const OFFSET         = Number(process.env.OFFSET         ?? 0);     // skip first N (for resume)
const DELAY_MS       = Number(process.env.DELAY_MS       ?? 20_000); // 20 s between companies
const DRY_RUN        = process.env.DRY_RUN               !== "false"; // safe default: dry run
const TAVILY_BUDGET  = Number(process.env.TAVILY_BUDGET  ?? 1000);  // max Tavily calls this run
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE ?? 40);     // skip writes below this
const MAX_TIER       = Number(process.env.MAX_TIER       ?? 3);     // 2 = skip complete companies
const MODEL           = process.env.ENRICH_MODEL ?? "claude-haiku-4-5-20251001";

// ── Env-var guard ─────────────────────────────────────────────────────────────
for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"]) {
  if (!process.env[key]) {
    console.error(`❌  Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (!process.env.TAVILY_API_KEY) {
  console.warn("⚠️  TAVILY_API_KEY not set — all searches will use Serper (Google).\n");
}
if (!process.env.SERP_KEY) {
  console.warn("⚠️  SERP_KEY not set — Serper fallback unavailable. Only Tavily will be used.\n");
}

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase  = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Sector taxonomy for Claude's sector_name/sub_sector_name classification —
// fetched once at startup (loadSectorTaxonomy, called from main()) rather
// than hardcoded, so it can never drift from the real `sectors` table that
// sector_id_by_name() resolves against.
let SECTOR_PARENT_NAMES: string[] = [];
let SUB_SECTOR_NAMES: string[] = [];

async function loadSectorTaxonomy(): Promise<void> {
  const { data, error } = await supabase.from("sectors").select("name, parent_id");
  if (error) { console.warn(`⚠️  Failed to load sector taxonomy: ${error.message} — sector_name/sub_sector_name classification will be skipped this run.`); return; }
  const rows = (data ?? []) as Array<{ name: string; parent_id: string | null }>;
  SECTOR_PARENT_NAMES = rows.filter((r) => r.parent_id === null).map((r) => r.name).sort();
  SUB_SECTOR_NAMES    = rows.filter((r) => r.parent_id !== null).map((r) => r.name).sort();
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface StartupRow {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  industry: string | null;
  founded_year: number | null;
  employee_count: number | null;
  growth_trend: string | null;
  country: string | null;
  city: string | null;
  founders: Array<PersonQualityTags & { name: string; linkedin_url: string | null }> | null;
  leadership: Array<PersonQualityTags & { name: string; role: string; linkedin_url?: string | null; joined_date?: string | null }> | null;
  competitors: Competitor[] | null;
  acquisitions: Acquisition[] | null;
  patent_count: number | null;
  patent_fields: string[] | null;
  patents: PatentRecord[] | null;
  funding_history_complete: boolean | null;
  updated_at: string;
  last_enriched_at: string | null;
  sector_id: string | null;
  sub_sector_id: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  news: NewsItem[] | null;
}

// Individual patent/patent-application records — richer than the older
// patent_count/patent_fields summary scalars (which stay as-is; patents[]
// is additive, not a replacement).
interface PatentRecord {
  title: string;
  patent_number: string | null;
  filing_date: string | null;
  url: string | null;
  summary: string | null;
}

interface NewsItem {
  title: string;
  url: string;
  source: string | null;
  published_date: string | null;
  summary: string | null;
  image_url: string | null;
}

interface Competitor {
  name: string;
  website: string | null;
  how_it_competes: string;
  startup_id: string | null;
}

interface Acquisition {
  company_name: string;
  website: string | null;
  acquired_date: string | null;
  amount: number | null;
  description: string | null;
  acquired_startup_id: string | null;
}

interface InvestorAmount { name: string; amount: number }

interface FundingRoundRow {
  id: string;
  startup_id: string;
  round_type: string | null;
  amount_raised: number | null;
  valuation: number | null;
  is_valuation_estimated: boolean | null;
  announcement_date: string | null;
  source_url: string | null;
  lead_investor: string | null;
  investors: string[] | null;
  investor_amounts: InvestorAmount[] | null;
}

interface ExtractedRound {
  round_type: string;
  amount_raised?: number | null;
  valuation?: number | null;
  is_valuation_estimated?: boolean;
  date?: string | null;
  lead_investor?: string | null;
  other_investors?: string[] | null;
  investor_amounts?: InvestorAmount[] | null;
  source_url?: string | null;
}

// Background signals feeding calculate_alphamap_score's Founder & Team
// Quality pillar — any ONE person on the team carrying a flag counts for
// the whole company. Only ever set when genuinely verified, never guessed.
interface PersonQualityTags {
  had_prior_exit?: boolean;
  elite_background?: boolean;
  notable_pedigree?: boolean;
}

interface ExtractedFounder extends PersonQualityTags { name: string; linkedin_url?: string }

interface ExtractedProfile {
  website?: string;
  description?: string;
  industry?: string;
  founded_year?: number;
  country?: string;
  city?: string;
  founders?: ExtractedFounder[];
  sector_name?: string;
  sub_sector_name?: string;
  linkedin_url?: string;
  facebook_url?: string;
  instagram_url?: string;
}

interface ExtractedNewsItem {
  title: string;
  url: string;
  source?: string;
  published_date?: string;
  summary?: string;
  image_url?: string;
}

interface ExtractedPatentRecord {
  title: string;
  patent_number?: string;
  filing_date?: string;
  url?: string;
  summary?: string;
}

interface ExtractedLeader extends PersonQualityTags {
  name: string;
  role: string;
  linkedin_url?: string;
  // When this person joined, if known — feeds the Recency & Activity
  // pillar. Best-effort; far more often omitted than known.
  joined_date?: string;
}

interface ExtractedHeadcountPoint { date: string; employee_count: number; source?: string }

interface ExtractedCompetitor { name: string; website?: string; how_it_competes: string }

interface ExtractedAcquisition {
  company_name: string;
  website?: string;
  acquired_date?: string;
  amount?: number;
  description?: string;
}

interface EnrichmentResult {
  is_public_company: boolean;
  is_tech_company: boolean;
  profile: ExtractedProfile;
  funding_history_complete: boolean;
  funding_rounds: ExtractedRound[];
  leadership: ExtractedLeader[];
  metrics: {
    headcount: number | null;
    growth_trend: string | null;
    headcount_history: ExtractedHeadcountPoint[];
  };
  competitors: ExtractedCompetitor[];
  acquisitions: ExtractedAcquisition[];
  news: ExtractedNewsItem[];
  patent_summary: { patent_count: number | null; patent_fields: string[] };
  patents: ExtractedPatentRecord[];
  confidence_score: number;
  reasoning: string;
  source_url: string;
}

type ProcessStatus =
  | "success" | "partial" | "low_confidence" | "rejected" | "removed_public"
  | "no_data" | "stealth_suspected" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function normalizeRoundType(raw: string): string {
  if (!raw) return "Other";
  const s = raw.toLowerCase().trim();
  if (/pre.?seed/.test(s))                                        return "Pre-Seed";
  if (/\bseed\b/.test(s) && !/series/.test(s))                    return "Seed";
  if (/series\s*a\b/.test(s))                                     return "Series A";
  if (/series\s*b\b/.test(s))                                     return "Series B";
  if (/series\s*c\b/.test(s))                                     return "Series C";
  if (/series\s*d\b/.test(s))                                     return "Series D";
  if (/series\s*[e-z+]/.test(s) || /late.?stage/.test(s))         return "Series E+";
  if (/\bgrowth\b/.test(s) || /expansion/.test(s))                return "Growth";
  if (/bridge/.test(s))                                           return "Bridge";
  if (/convertible|safe\b|\bnote\b/.test(s))                      return "Convertible Note";
  if (/\bdebt\b|credit facilit|term loan|\bloan\b|mezzanine/.test(s)) return "Debt";
  if (/secondar/.test(s))                                         return "Secondary";
  // Financial-sponsor take-overs (checked BEFORE the generic acquisition
  // match): press coverage rarely distinguishes a leveraged from an
  // unleveraged buyout, so LBOs map to the same canonical "PE Buyout".
  if (/buyout|\blbo\b|leveraged buy|take.?private/.test(s))       return "PE Buyout";
  if (/bootstrap/.test(s))                                        return "Bootstrapped";
  if (/\bgrant\b/.test(s))                                        return "Grant";
  if (/acqui|merg/.test(s))                                       return "Acquired";
  if (/\bipo\b|\bpublic\b|nyse|nasdaq/.test(s))                   return "IPO";
  return "Other";
}

function hasRealRounds(rounds: Pick<FundingRoundRow, "round_type">[]): boolean {
  return rounds.some((r) => r.round_type && r.round_type !== "Other");
}

// ── Early-stage deep-dive trigger ──────────────────────────────────────────────
// A company with a confirmed Series A or later round but no Pre-Seed/Seed/
// Convertible Note is treated as an unresolved gap, not a fact — companies
// essentially never skip straight from founding to an institutional round.
const EARLY_STAGE_TYPES = new Set(["Pre-Seed", "Seed", "Convertible Note"]);
const LATER_STAGE_TYPES = new Set(["Series A", "Series B", "Series C", "Series D", "Series E+", "Growth"]);

function needsEarlyStageDeepDive(rounds: { round_type: string }[]): boolean {
  const types = new Set(rounds.map((r) => normalizeRoundType(r.round_type)));
  return [...types].some((t) => LATER_STAGE_TYPES.has(t)) &&
         ![...types].some((t) => EARLY_STAGE_TYPES.has(t));
}

// ── Profile deep-dive trigger ────────────────────────────────────────────────
// A company that came back with essentially no profile at all — no
// description, no location, no social presence — after the general-purpose
// pass is the pattern most common for stealth/very-early-stage companies,
// whose only real web presence is often a LinkedIn/Crunchbase stub that the
// broad news/funding-oriented queries in researchCompany() don't specifically
// target. All must be missing (not just one) so this stays targeted at
// genuinely thin profiles, not a blanket second pass on every company.
function needsProfileDeepDive(profile: Partial<ExtractedProfile>): boolean {
  return !profile.description && !profile.country && !profile.city &&
         !profile.linkedin_url && !profile.facebook_url && !profile.instagram_url;
}

function hasCompetitors(row: Pick<StartupRow, "competitors">): boolean {
  return Array.isArray(row.competitors) && row.competitors.length > 0;
}

function hasPatents(row: Pick<StartupRow, "patents">): boolean {
  return Array.isArray(row.patents) && row.patents.length > 0;
}

function classifyTier(row: StartupRow, rounds: FundingRoundRow[]): 1 | 2 | 3 {
  const realRounds = hasRealRounds(rounds);
  // Tier 1: no profile data AND no real funding round history
  if (!row.description && !row.employee_count && !realRounds) return 1;
  // Tier 3: has description + employee_count + at least one real round + competitors mapped
  if (row.description && row.employee_count && realRounds && hasCompetitors(row)) return 3;
  // Tier 2: has some data but key fields are missing
  return 2;
}

// Domain matcher used to cross-link a found competitor to one of our own
// tracked startups (matches import_startups_list.ts's domain-first strategy).
function websiteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

// ── Claude token/cost tracking ─────────────────────────────────────────────────
// $/token by model, used only for the cost estimate printed in the run summary
// — informational, not billed by this script. Search API costs (Tavily/Serper)
// are separate and not included. Verified current published pricing (2026-07);
// re-check console.claude.com/pricing if it's been a while.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5":          { input: 1 / 1_000_000, output: 5  / 1_000_000 },
  "claude-haiku-4-5-20251001": { input: 1 / 1_000_000, output: 5  / 1_000_000 },
  "claude-sonnet-5":           { input: 3 / 1_000_000, output: 15 / 1_000_000 }, // $2/$10 intro pricing through 2026-08-31
  "claude-opus-4-8":           { input: 5 / 1_000_000, output: 25 / 1_000_000 },
};
const PRICING = MODEL_PRICING[MODEL] ?? MODEL_PRICING["claude-haiku-4-5-20251001"];
let totalInputTokens  = 0;
let totalOutputTokens = 0;

// ── Search stack: Tavily → DuckDuckGo ─────────────────────────────────────────
let tavilyCallCount = 0;
let tavilyExhausted = !process.env.TAVILY_API_KEY;

async function tavilySearch(query: string, attempt = 0): Promise<string | null> {
  if (tavilyExhausted) return null;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "advanced",
        max_results: 6,
        include_answer: true,
      }),
    });

    // Credit / auth exhaustion → permanent fallback for this run
    if (res.status === 401 || res.status === 402 || res.status === 432) {
      const body = await res.text().catch(() => "");
      console.warn(
        `    ⚠️  Tavily HTTP ${res.status} — switching ALL remaining searches to Serper.` +
        (body ? `\n        ${body.slice(0, 120)}` : ""),
      );
      tavilyExhausted = true;
      return null;
    }

    // Temporary rate limit → retry with exponential backoff
    if (res.status === 429 && attempt < 3) {
      const wait = 15_000 * 2 ** attempt;
      console.warn(`    ⚠️  Tavily 429 — waiting ${wait / 1000}s (retry ${attempt + 1}/3)…`);
      await sleep(wait);
      return tavilySearch(query, attempt + 1);
    }

    if (!res.ok) {
      console.warn(`    ⚠️  Tavily HTTP ${res.status} — using Serper for this query.`);
      return null;
    }

    const data = await res.json() as Record<string, unknown>;
    const parts: string[] = [];
    if (data.answer) parts.push(`Summary: ${data.answer}`);
    for (const r of (data.results as Array<Record<string, string>> ?? [])) {
      parts.push(`[${r.title}]\n${r.url}\n${String(r.content ?? "").slice(0, 600)}`);
    }
    if (!parts.length) return null;

    // Proactive budget tracking — switch before we overshoot
    tavilyCallCount++;
    if (tavilyCallCount >= TAVILY_BUDGET) {
      console.warn(
        `    ⚠️  Tavily budget reached (${tavilyCallCount}/${TAVILY_BUDGET}) — switching to Serper for remainder.`,
      );
      tavilyExhausted = true;
    }
    return parts.join("\n---\n");
  } catch (err) {
    console.warn(`    ⚠️  Tavily threw: ${String(err)}`);
    return null;
  }
}

// Tavily Extract — fetches + renders (JS included) one or more URLs and
// returns their cleaned main text, far more reliably than a raw HTML fetch
// on bot-blocked pages or JS-only SPAs (common for early-stage startup
// sites built on Webflow/Framer/Next.js client rendering). Used by
// fetchCompanyWebsite() below as the preferred path when Tavily is
// available; counts against the same budget as a search call, since it's
// the same API/quota.
async function tavilyExtractUrls(urls: string[]): Promise<string | null> {
  if (tavilyExhausted) return null;
  try {
    const res = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, urls }),
    });

    if (res.status === 401 || res.status === 402 || res.status === 432) {
      tavilyExhausted = true;
      return null;
    }
    if (!res.ok) return null;

    const data = await res.json() as {
      results?: Array<{ url: string; raw_content?: string }>;
    };
    const parts = (data.results ?? [])
      .filter((r) => r.raw_content)
      .map((r) => `[${r.url}]\n${r.raw_content!.replace(/\s+/g, " ").trim().slice(0, MAX_WEBSITE_CHARS)}`);
    if (!parts.length) return null;

    tavilyCallCount++;
    if (tavilyCallCount >= TAVILY_BUDGET) tavilyExhausted = true;
    return parts.join("\n---\n");
  } catch {
    return null;
  }
}

// Tavily search with images included — used ONLY for the recent-news query,
// so the news[] field can carry a real article image instead of always
// omitting it. Tavily-only (no Serper equivalent used here): when Tavily is
// unavailable/exhausted this simply returns no images, same as any other
// best-effort source in this script. Images returned are a flat list for
// the whole query, not attributed to a specific result — the prompt is
// instructed to only use one on a news item when it can confidently match
// it to that specific article, never as a generic filler.
async function tavilyNewsSearch(query: string): Promise<{ text: string | null; images: string[] }> {
  if (tavilyExhausted) return { text: null, images: [] };
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "advanced",
        max_results: 6,
        include_answer: true,
        include_images: true,
        include_image_descriptions: true,
      }),
    });

    if (res.status === 401 || res.status === 402 || res.status === 432) {
      tavilyExhausted = true;
      return { text: null, images: [] };
    }
    if (res.status === 429) {
      await sleep(15_000);
      return tavilyNewsSearch(query);
    }
    if (!res.ok) return { text: null, images: [] };

    const data = await res.json() as {
      answer?: string;
      results?: Array<{ title: string; url: string; content?: string }>;
      images?: Array<string | { url: string; description?: string }>;
    };
    const parts: string[] = [];
    if (data.answer) parts.push(`Summary: ${data.answer}`);
    for (const r of data.results ?? []) {
      parts.push(`[${r.title}]\n${r.url}\n${String(r.content ?? "").slice(0, 600)}`);
    }

    const images = (data.images ?? [])
      .map((img) => typeof img === "string" ? { url: img, description: "" } : { url: img.url, description: img.description ?? "" })
      .filter((img) => img.url)
      .slice(0, 8);

    tavilyCallCount++;
    if (tavilyCallCount >= TAVILY_BUDGET) tavilyExhausted = true;

    if (!parts.length && images.length === 0) return { text: null, images: [] };
    return {
      text: parts.length ? parts.join("\n---\n") : null,
      images: images.map((img) => img.description ? `${img.url} — ${img.description}` : img.url),
    };
  } catch {
    return { text: null, images: [] };
  }
}

// ── Serper (Google Search API) fallback ───────────────────────────────────────
// No serialisation lock needed — Serper is a proper REST API with no
// scraping-style rate limits. All 4 per-company searches fire in parallel.
let serperCallCount = 0;

async function serperSearch(query: string, attempt = 0): Promise<string | null> {
  if (!process.env.SERP_KEY) return null;
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERP_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 10 }),
    });

    if (res.status === 429 && attempt < 3) {
      const wait = 10_000 * 2 ** attempt;
      console.warn(`    ⚠️  Serper 429 — waiting ${wait / 1000}s (retry ${attempt + 1}/3)…`);
      await sleep(wait);
      return serperSearch(query, attempt + 1);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`    ⚠️  Serper HTTP ${res.status}` + (body ? ` — ${body.slice(0, 200)}` : ""));
      return null;
    }

    const data = await res.json() as {
      organic?: Array<{ title: string; link: string; snippet: string }>;
      answerBox?: { answer?: string; snippet?: string };
      knowledgeGraph?: { description?: string };
    };

    const parts: string[] = [];
    const answer = data.answerBox?.answer ?? data.answerBox?.snippet ?? data.knowledgeGraph?.description;
    if (answer) parts.push(`Summary: ${answer}`);
    for (const r of (data.organic ?? []).slice(0, 8)) {
      parts.push(`[${r.title}]\n${r.link}\n${(r.snippet ?? "").slice(0, 600)}`);
    }
    if (!parts.length) return null;

    serperCallCount++;
    return parts.join("\n---\n");
  } catch (err) {
    console.warn(`    ⚠️  Serper threw: ${String(err)}`);
    return null;
  }
}

function engineLabel(): string {
  if (!tavilyExhausted) return `Tavily (${tavilyCallCount}/${TAVILY_BUDGET})`;
  return process.env.SERP_KEY ? `Serper (${serperCallCount})` : "no-fallback";
}

async function webSearch(query: string): Promise<string | null> {
  if (!tavilyExhausted) {
    const r = await tavilySearch(query);
    if (r !== null) return r;
    // tavilyExhausted may now be true; fall through to Serper
  }
  return serperSearch(query);
}

// Same fallback shape as webSearch, but via tavilyNewsSearch so the news
// query specifically can come back with images. Serper has no equivalent
// used here, so the Serper-fallback path simply carries no images — same
// best-effort posture as every other Tavily-only enhancement in this script.
async function newsSearchWithImages(query: string): Promise<{ text: string | null; images: string[] }> {
  if (!tavilyExhausted) {
    const r = await tavilyNewsSearch(query);
    if (r.text !== null || r.images.length > 0) return r;
  }
  return { text: await serperSearch(query), images: [] };
}

// ── Company's own website ──────────────────────────────────────────────────
// The single most reliable source for description/industry/HQ location is the
// company's own site, but search-engine snippets rarely capture it in full
// (they show a fragment of whatever page ranked, not the "About" copy).
// Prefers Tavily Extract (root + /about, one call, JS-rendered) when Tavily
// is available — it handles bot-blocked pages and JS-only SPAs (common for
// early-stage startup sites on Webflow/Framer/Next.js client rendering) far
// more reliably than a raw HTML fetch. Falls back to a plain fetch + cheerio
// scrape of the root page when Tavily is unavailable/exhausted, or when
// Extract itself comes back empty. Either way, failure here just means one
// fewer context section, same as a failed search — never blocks a company.
const FETCH_TIMEOUT_MS = 8_000;
const MAX_WEBSITE_CHARS = 3_000;

async function fetchCompanyWebsite(website: string | null | undefined): Promise<string | null> {
  if (!website) return null;
  const url = website.startsWith("http") ? website : `https://${website}`;

  if (!tavilyExhausted) {
    const aboutUrl  = url.replace(/\/+$/, "") + "/about";
    const extracted = await tavilyExtractUrls([url, aboutUrl]);
    if (extracted) return extracted;
    // Extract came back empty (or Tavily just went exhausted) — fall through
    // to the cheerio scrape below rather than give up on this company's
    // website entirely.
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AlphaMapEnrichmentBot/1.0; +https://alphamap.app)",
        "Accept": "text/html",
      },
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, svg, nav, footer").remove();

    const title       = $("title").first().text().trim();
    const metaDesc     = $('meta[name="description"]').attr("content")?.trim()
      ?? $('meta[property="og:description"]').attr("content")?.trim()
      ?? "";
    const bodyText     = $("body").text().replace(/\s+/g, " ").trim();

    const parts = [
      title      ? `Title: ${title}` : "",
      metaDesc   ? `Meta description: ${metaDesc}` : "",
      bodyText   ? `Page text: ${bodyText.slice(0, MAX_WEBSITE_CHARS)}` : "",
    ].filter(Boolean);

    return parts.length > 0 ? parts.join("\n") : null;
  } catch {
    // Bot-blocked, timed out, JS-only SPA with no server-rendered text, DNS
    // failure, etc. — best-effort, fail silently like a failed search.
    return null;
  }
}

// ── Claude: extract complete company profile in one call ──────────────────────
// Shared tool-schema properties for a person (founder or leadership entry)
// — feeds calculate_alphamap_score's Founder & Team Quality pillar. Kept
// deliberately conservative in the descriptions: these are strong,
// specific signals that must be genuinely verifiable in the research, not
// inferred from a title or company reputation alone.
const PERSON_QUALITY_TAG_PROPERTIES = {
  had_prior_exit: {
    type: "boolean" as const,
    description: "TRUE only if you find clear evidence this person previously FOUNDED a company that was later acquired or went public (IPO). Being an early employee or executive at a company that exited does NOT count — must have been a founder/co-founder of the exited company. Omit if unknown rather than guessing false.",
  },
  elite_background: {
    type: "boolean" as const,
    description: "TRUE only if you find clear evidence of an elite technical/military background — e.g. an elite intelligence or technology military unit (such as Unit 8200, Talpiot, or an equivalent unit in another country), or a leadership role at a top-tier R&D lab/research institution. A generic engineering degree or a normal corporate job does NOT qualify. Omit if unknown rather than guessing false.",
  },
  notable_pedigree: {
    type: "boolean" as const,
    description: "TRUE only if you find clear evidence of EITHER a key leadership/senior role (not junior) at a company that was a unicorn ($1B+ valuation) AT THE TIME they worked there, OR a degree from a widely-recognized elite university (e.g. MIT, Stanford, Harvard, Technion, or similarly ranked institutions). Omit if unknown rather than guessing false.",
  },
} as const;

// `website` (already known for most rows from the master CSV import, which
// deliberately never resets it) disambiguates generic/ambiguous company names
// — e.g. a one-word name like "Actuality" collides with unrelated Instagram
// posts and other companies in plain name search. When known, it's added to
// every query as a second anchor so results have to match BOTH the name and
// the known domain, not just the name alone.
async function researchCompany(
  name: string,
  website?: string | null,
  country?: string | null,
): Promise<EnrichmentResult | null> {
  const domain = websiteDomain(website);
  // The known domain is the strongest disambiguator, so prefer it. When no
  // website is on file — exactly the stealth/early-stage case most prone to
  // name collisions (e.g. "1001 Fonts" vs "1001 AI") — fall back to country
  // + a light category qualifier instead of searching the bare name alone.
  const anchor = domain
    ? ` "${domain}"`
    : country
      ? ` ${country} (startup OR tech company)`
      : "";
  const [historyRaw, amountsRaw, backersRaw, profileRaw, competitorsRaw, newsResult, patentsRaw, ownSiteRaw] = await Promise.all([
    webSearch(`"${name}"${anchor} seed round "Series A" first funding earliest founding investors site:crunchbase.com OR site:techcrunch.com OR site:pitchbook.com`),
    webSearch(`"${name}"${anchor} total funding raised since founding all rounds USD million billion valuation announcement history`),
    webSearch(`"${name}"${anchor} lead investor venture capital backed participated investors funded round investment amount check size`),
    webSearch(`"${name}"${anchor} company founder CEO CTO description industry headquarters country city employees headcount acquired acquisition patents intellectual property linkedin.com/in profile linkedin.com/company facebook.com instagram.com 2024 2025`),
    webSearch(`"${name}"${anchor} competitors alternatives vs rivals "compared to" market landscape`),
    // Recency-biased, distinct from the other searches (which skew toward
    // funding history / profile facts, not "what's been published lately").
    // Requests images alongside the search (Tavily only) so news[] can
    // carry a real article image instead of always omitting one.
    newsSearchWithImages(`"${name}"${anchor} news 2025 2026 site:techcrunch.com OR site:venturebeat.com OR site:prnewswire.com OR site:businesswire.com OR site:forbes.com OR site:sifted.eu launch funding announcement`),
    // Dedicated patent search — the profile query above mentions "patents"
    // as one keyword among many and rarely surfaces an actual patent
    // record; searching Google Patents specifically finds real filings.
    webSearch(`"${name}"${anchor} patent OR patents OR site:patents.google.com`),
    fetchCompanyWebsite(website),
  ]);
  const newsRaw    = newsResult.text;
  const newsImages = newsResult.images;

  if (![historyRaw, amountsRaw, backersRaw, profileRaw, competitorsRaw, newsRaw, patentsRaw, ownSiteRaw].some(Boolean)) return null;

  const context = [
    `## Company's Own Website (HIGHEST TRUST for description, industry, and HQ location — this is the company describing itself, not a third party)\n${ownSiteRaw ?? "(not fetched — no known website, fetch failed, or bot-blocked)"}`,
    `## Earliest Rounds (Seed / Series A — search deliberately biased toward early-stage, since general searches tend to surface only the most recent round)\n${historyRaw  ?? "(search failed)"}`,
    `## Full Funding History & Total Raised (all rounds, not year-restricted)\n${amountsRaw    ?? "(search failed)"}`,
    `## Investors & Backers\n${backersRaw            ?? "(search failed)"}`,
    `## Company Profile & Headcount\n${profileRaw   ?? "(search failed)"}`,
    `## Patents (for the patents[] field — only include a real, verifiable patent or published application; return [] if this search found nothing)\n${patentsRaw ?? "(search failed)"}`,
    `## Competitors & Alternatives\n${competitorsRaw ?? "(search failed)"}`,
    `## Recent News & Press Coverage (for the news[] field — only use articles with a real, findable publication date)\n${newsRaw ?? "(search failed)"}`,
    newsImages.length > 0
      ? `## Images Found Alongside The News Search (each is "url" or "url — description"; NOT pre-matched to any specific article above — for news[].image_url, only use one if its URL or description clearly corresponds to a SPECIFIC article by subject/company; never attach a generic, unrelated, or best-guess image, and never invent an image URL not listed here)\n${newsImages.join("\n")}`
      : "",
  ].filter(Boolean).join("\n\n");

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [{
      name: "save_enrichment",
      description: "Save a complete, verified enrichment record for a private tech startup",
      input_schema: {
        type: "object" as const,
        properties: {
          is_public_company: {
            type: "boolean",
            description: "TRUE if listed on NYSE, NASDAQ, LSE, TASE, Euronext, or any other public exchange.",
          },
          is_tech_company: {
            type: "boolean",
            description: [
              "TRUE for ANY company whose core product or competitive edge IS its own technology, software,",
              "or R&D — a broad category, not just \"classic\" software/SaaS. Includes AI/ML, fintech,",
              "biotech/life sciences, healthtech, agtech, proptech, insurtech, cleantech/climate tech, deep",
              "tech, hardware/robotics/IoT, and traditional-industry companies (retail, real estate,",
              "healthcare services, logistics, manufacturing, etc.) whose product IS a proprietary tech",
              "platform — not just a company that merely uses off-the-shelf software to run its business.",
              "This name comes from a curated startup/VC tracking database, so default to TRUE unless the",
              "company is clearly a plain traditional business with no technology product of its own (e.g. a",
              "restaurant chain, a law firm, a construction contractor, a generic local retailer).",
            ].join(" "),
          },
          profile: {
            type: "object" as const,
            description: "Company profile — omit any field you cannot verify.",
            properties: {
              website:      { type: "string",  description: "Root domain URL (https://example.com)" },
              description:  {
                type: "string",
                description: [
                  "4-6 detailed sentences, not a summary blurb. Must cover, in order:",
                  "(1) what the company does and its core product/technology,",
                  "(2) who it serves — target customers, market, or use case,",
                  "(3) its key differentiator vs. competitors,",
                  "(4) one concrete detail of traction, market position, or founding story pulled from the research (e.g. notable customers, awards, a specific milestone).",
                  "Every sentence must add real information found in the research — never pad with generic filler.",
                ].join(" "),
              },
              industry:     { type: "string",  description: "Primary tech sector (e.g. 'AI & ML', 'Cybersecurity', 'FinTech')." },
              founded_year: { type: "integer", description: "Year the company was incorporated." },
              country:      { type: "string",  description: "HQ country full name (e.g. 'United States')." },
              city:         { type: "string",  description: "HQ city (e.g. 'San Francisco')." },
              founders: {
                type: "array",
                description: "ALL founders/co-founders, full legal names.",
                items: {
                  type: "object" as const,
                  properties: {
                    name:         { type: "string", description: "Full legal name." },
                    linkedin_url: { type: "string", description: "Their personal linkedin.com/in/... profile URL, if found. Omit if not found — never guess or construct one from a name." },
                    ...PERSON_QUALITY_TAG_PROPERTIES,
                  },
                  required: ["name"],
                },
              },
              sector_name: {
                type: "string",
                enum: SECTOR_PARENT_NAMES.length > 0 ? SECTOR_PARENT_NAMES : undefined,
                description: "The single best-fit sector from the enumerated list. Omit if genuinely uncertain — never guess.",
              },
              sub_sector_name: {
                type: "string",
                enum: SUB_SECTOR_NAMES.length > 0 ? SUB_SECTOR_NAMES : undefined,
                description: "The single best-fit sub-sector from the enumerated list, one level more specific than sector_name (e.g. under \"AI & ML\": \"LLMs\", \"Computer Vision\"). Omit if genuinely uncertain — never guess.",
              },
              linkedin_url:  { type: "string", description: "The COMPANY's own LinkedIn page (linkedin.com/company/...) — not a person's profile. Omit if not found." },
              facebook_url:  { type: "string", description: "The company's Facebook page. Omit if not found." },
              instagram_url: { type: "string", description: "The company's Instagram profile. Omit if not found." },
            },
          },
          funding_history_complete: {
            type: "boolean",
            description: [
              "FALSE if you have reason to believe funding_rounds is NOT the company's complete history —",
              "e.g. you found a Series B or later round but no earlier Seed/Series A despite the company",
              "being multiple years old and clearly not bootstrapped; or a source states an aggregate like",
              "'8 total funding rounds' or 'raised $500M since founding' that you cannot fully break down",
              "into individual verified rounds. TRUE only when you're confident funding_rounds is the",
              "complete history (including the case where the company has genuinely raised only what's",
              "listed). Default TRUE if you have no specific reason to suspect a gap.",
            ].join(" "),
          },
          funding_rounds: {
            type: "array",
            description: "Every verified funding round OLDEST → NEWEST. Return [] rather than guess.",
            items: {
              type: "object" as const,
              properties: {
                round_type: {
                  type: "string",
                  enum: [
                    "Pre-Seed","Seed","Series A","Series B","Series C",
                    "Series D","Series E+","Growth","Bridge",
                    "Convertible Note","Bootstrapped","Grant","Acquired",
                    "PE Buyout","Secondary","Debt","Other",
                  ],
                },
                amount_raised: {
                  type: "number",
                  description: "USD raised in THIS round as a plain integer ($50M → 50000000). Omit if unknown.",
                },
                valuation: {
                  type: "number",
                  description: "Post-money valuation in USD as a plain integer. Omit if unconfirmed.",
                },
                is_valuation_estimated: {
                  type: "boolean",
                  description: "true if the valuation was estimated or inferred, not officially disclosed.",
                },
                date: {
                  type: "string",
                  description: "Announcement date YYYY-MM-DD. Use YYYY-01-01 if only the year is known.",
                },
                lead_investor: {
                  type: "string",
                  description: "Full name of the lead investor for this specific round. Omit if unknown.",
                },
                other_investors: {
                  type: "array",
                  items: { type: "string" },
                  description: "All other participating investors (not the lead). Omit if none known.",
                },
                investor_amounts: {
                  type: "array",
                  description: [
                    "For any investor named in lead_investor or other_investors whose SPECIFIC dollar",
                    "contribution to THIS round is explicitly disclosed (e.g. 'Sequoia led with $20M of",
                    "the $50M round'), record it here. This is rare — most rounds only disclose the round",
                    "total, not the per-investor split. Return [] if no per-investor amount is disclosed.",
                    "NEVER estimate or split the round total evenly across participants.",
                  ].join(" "),
                  items: {
                    type: "object" as const,
                    properties: {
                      name: { type: "string", description: "Investor name — must match lead_investor or an entry in other_investors." },
                      amount: { type: "number", description: "USD this investor specifically contributed to this round, as a plain integer." },
                    },
                    required: ["name", "amount"],
                  },
                },
                source_url: {
                  type: "string",
                  description: "Best URL for this round: press release, SEC filing, or Crunchbase round page.",
                },
              },
              required: ["round_type"],
            },
          },
          leadership: {
            type: "array",
            description: [
              "Every named, verifiable individual you can identify at this company — not just the",
              "C-suite. Include executives, founders, and any other employee you can attribute a real",
              "name, a current title/role, and ideally a LinkedIn profile to (e.g. from the company's",
              "team/about page, a LinkedIn company-page employee list, or a press mention naming a",
              "specific engineer/PM/etc.). Up to 15 people. Never invent a name or role you can't verify.",
            ].join(" "),
            items: {
              type: "object" as const,
              properties: {
                name:         { type: "string", description: "Full name." },
                role:         { type: "string", description: "Current title (CEO, CTO, Co-Founder, Senior Engineer, etc.)." },
                linkedin_url: { type: "string", description: "Their personal linkedin.com/in/... profile URL, if found. Omit if not found — never guess or construct one from a name." },
                joined_date:  { type: "string", description: "Date they joined this company in this role, YYYY-MM-DD (YYYY-MM-01 if only month+year known). Only for a genuinely dateable hire (e.g. a hiring announcement or press mention) — omit for anyone whose start date isn't stated anywhere, which is most people." },
                ...PERSON_QUALITY_TAG_PROPERTIES,
              },
              required: ["name", "role"],
            },
          },
          metrics: {
            type: "object" as const,
            properties: {
              headcount: {
                type: "number",
                description: "Best available CURRENT total employee count as a plain integer. Omit if unknown.",
              },
              growth_trend: {
                type: "string",
                enum: ["rapid growth","moderate growth","stable","reduction","unknown"],
                description: "12-month headcount trend based on LinkedIn / job-posting signals.",
              },
              headcount_history: {
                type: "array",
                description: [
                  "Every DISTINCT dated employee-count figure found anywhere in the research —",
                  "not just the current figure. Funding announcements, news articles, and LinkedIn",
                  "snapshots often state headcount as of a specific point in time (e.g. \"the 45-person",
                  "startup raised a Series A\", \"now employing over 200 people\" in a 2023 article).",
                  "Scan ALL research sections (funding history, amounts, profile) for these, not just",
                  "the most recent one. Return one entry per distinct data point you can verify, oldest",
                  "to newest. Return [] if no dated figures are found — never invent intermediate points.",
                ].join(" "),
                items: {
                  type: "object" as const,
                  properties: {
                    date: {
                      type: "string",
                      description: "Date this figure was reported/accurate, YYYY-MM-DD. Use YYYY-01-01 if only the year is known.",
                    },
                    employee_count: {
                      type: "integer",
                      description: "Employee count as of that date, as a plain integer.",
                    },
                    source: {
                      type: "string",
                      description: "Where this figure came from, e.g. 'Series A announcement', 'LinkedIn', 'TechCrunch article'.",
                    },
                  },
                  required: ["date", "employee_count"],
                },
              },
            },
          },
          competitors: {
            type: "array",
            description: [
              "4-5 DIRECT competitors — companies that compete for the same customers or solve the",
              "same core problem. For each, explain HOW and IN WHAT WAY they compete: overlapping",
              "product/feature set, same target customer segment, same funding stage, positioned as",
              "an alternative in comparison articles, etc. Prioritize competitors you can verify from",
              "'alternatives to X' listicles, comparison articles, or industry analyses over guessing",
              "same-sector companies from memory. Return [] if you cannot verify any real competitors —",
              "never invent generic competitors based on sector alone.",
            ].join(" "),
            items: {
              type: "object" as const,
              properties: {
                name: { type: "string", description: "Competitor company's name." },
                website: { type: "string", description: "Competitor's root domain URL, if known. Omit if unknown." },
                how_it_competes: {
                  type: "string",
                  description: "1-2 sentences: specifically how and in what way this company competes with the target company.",
                },
              },
              required: ["name", "how_it_competes"],
            },
          },
          acquisitions: {
            type: "array",
            description: [
              "Companies THIS company has ACQUIRED — the OUTBOUND direction only. Do NOT list this",
              "company being acquired by someone else here (that belongs in funding_rounds with",
              "round_type 'Acquired'). For each acquisition, give the acquired company's name, the",
              "acquisition date, the disclosed amount if any, and a one-sentence description of why",
              "(e.g. talent acqui-hire, product/technology, market expansion). Return [] if this",
              "company hasn't acquired anyone, or if you cannot verify any acquisitions — most startups",
              "have never acquired another company, so [] is the common, correct answer.",
            ].join(" "),
            items: {
              type: "object" as const,
              properties: {
                company_name: { type: "string", description: "Name of the company that was acquired." },
                website: { type: "string", description: "Acquired company's root domain URL, if known. Omit if unknown." },
                acquired_date: { type: "string", description: "Acquisition date YYYY-MM-DD. Use YYYY-01-01 if only the year is known. Omit if unknown." },
                amount: { type: "number", description: "USD acquisition price as a plain integer. Omit if undisclosed." },
                description: { type: "string", description: "One sentence: why this acquisition happened (talent, technology, market expansion, etc.)." },
              },
              required: ["company_name"],
            },
          },
          news: {
            type: "array",
            description: [
              "Up to 5 recent news articles/press mentions ABOUT this company (funding announcements,",
              "product launches, press coverage) — from real, verifiable sources found in the research,",
              "with a real publication date. Never fabricate an article or guess a date. Return [] if you",
              "found no dateable news coverage.",
            ].join(" "),
            items: {
              type: "object" as const,
              properties: {
                title:          { type: "string", description: "The article's headline." },
                url:            { type: "string", description: "Direct URL to the article." },
                source:         { type: "string", description: "Publication name (e.g. 'TechCrunch', 'VentureBeat'). Omit if unknown." },
                published_date: { type: "string", description: "Publication date YYYY-MM-DD. Use YYYY-MM-01 if only month+year is known. Omit if genuinely undated." },
                summary:        { type: "string", description: "1-2 sentence summary of what the article actually says, based on its content in the research below — not a restatement of the headline. Omit if the research only gave you the headline/URL with no real content to summarize." },
                image_url:      { type: "string", description: "Only fill this from the 'Images Found Alongside The News Search' section, and only when you can confidently match a specific image to THIS article by subject/company/context. Omit whenever there's no images section, no confident match, or you'd otherwise be guessing — never reuse a generic or unrelated image, and never invent a URL." },
              },
              required: ["title", "url"],
            },
          },
          patent_summary: {
            type: "object" as const,
            description: [
              "Best-effort patent signal — general web search often can't surface real patent data, so",
              "omit rather than guess. Only fill this in when you find genuine evidence (a patents/IP",
              "page, a news article citing a patent count, Google Patents results, etc.).",
            ].join(" "),
            properties: {
              patent_count: {
                type: "integer",
                description: "Best available count of patents held or filed (granted + pending combined is fine). Omit entirely if not found — never default to 0.",
              },
              patent_fields: {
                type: "array",
                items: { type: "string" },
                description: "2-5 technology/subject areas the company's patents cover (e.g. 'Natural Language Processing', 'Battery Chemistry'). Omit if unknown.",
              },
            },
          },
          patents: {
            type: "array",
            description: [
              "Individual registered patents or published patent applications belonging to this company,",
              "found in the 'Patents' research section below (Google Patents results, an IP/patents page,",
              "a news article citing a specific patent). This is real structured evidence, distinct from",
              "patent_summary above which is just a rough count/subject-area guess — every entry here must",
              "be a genuine, identifiable patent, not an inference from 'this company probably has patents'.",
              "Return [] if the Patents research section found nothing verifiable — that is the normal,",
              "expected answer for most early-stage companies.",
            ].join(" "),
            items: {
              type: "object" as const,
              properties: {
                title:         { type: "string", description: "The patent's title, as filed/granted." },
                patent_number: { type: "string", description: "Publication or grant number (e.g. 'US11234567B2'). Omit if not found." },
                filing_date:   { type: "string", description: "Filing or publication date YYYY-MM-DD. Use YYYY-01-01 if only the year is known. Omit if unknown." },
                url:           { type: "string", description: "Direct URL (e.g. a patents.google.com page). Omit if unknown." },
                summary:       { type: "string", description: "One sentence on what the patent actually covers, based on the research below. Omit if only the title is known." },
              },
              required: ["title"],
            },
          },
          confidence_score: {
            type: "number",
            description: [
              "Integer 0–100. Be conservative.",
              "90–100: multiple authoritative sources fully agree on amounts and dates.",
              "70–89: one strong source, no contradictions.",
              "50–69: partial data or minor conflicts.",
              "0–49: mostly inferred — return fewer rounds, never guess amounts.",
            ].join(" "),
          },
          reasoning: {
            type: "string",
            description: "2–3 sentences: sources found, data confirmed, why this confidence score.",
          },
          source_url: {
            type: "string",
            description: "Primary URL for this company's funding overview (Crunchbase, etc.).",
          },
        },
        required: [
          "is_public_company","is_tech_company",
          "funding_rounds","confidence_score","reasoning",
        ],
      },
    }],
    tool_choice: { type: "tool", name: "save_enrichment" },
    messages: [{
      role: "user",
      content: `You are a financial data analyst. Extract the COMPLETE verified profile for the private tech company "${name}".

STRICT RULES:
1. ALL FUNDING ROUNDS — if the company raised Pre-Seed, Seed, Series A, and Series B, the array MUST have 4 items. Never collapse rounds.
1b. DIG FOR EARLY ROUNDS — if you find a Series B or later round, that is strong evidence earlier rounds
    (Seed, Series A) exist, since companies virtually never skip straight to a late round. Before
    concluding there's no earlier round, actively re-scan EVERY research section (not just the ones
    labeled "earliest rounds") for any mention of a founding-era raise, an aggregate round count ("8 total
    rounds"), or a "total raised since founding" figure that's higher than what you can itemize. Only
    conclude a company genuinely skipped early rounds (self-funded/bootstrapped to a late raise) when a
    source says so explicitly. If you still can't verify the earlier rounds after this, set
    funding_history_complete: false rather than silently presenting a partial history as complete.
2. AMOUNTS — plain USD integers ($1.5B → 1500000000, $50M → 50000000). Omit if unverifiable.
3. LEAD INVESTOR — one lead per round in lead_investor; all others in other_investors.
4. VALUATION — set is_valuation_estimated: true if inferred or not officially disclosed.
5. DATES — YYYY-MM-DD; use YYYY-01-01 when only the year is known.
5b. BASIC PROFILE FACTS — description, industry, country, city, and headcount are usually the EASIEST
    facts to verify, not the hardest: the "Company's Own Website" section (when present) is the
    company describing itself and is the highest-trust source for exactly these fields. Prioritize it
    over inferring from third-party search snippets. A missing website fetch does NOT mean these facts
    are unavailable — still extract them from the other research sections whenever present there. There
    is no excuse for a company that has ANY research data at all to come back with profile: {} — at
    minimum, describe what it does if that's mentioned anywhere in the research.
6. FOUNDERS — full legal names only. Distinguish founders from hired executives.
6b. LINKEDIN — when a founder's or leader's personal linkedin.com/in/... profile URL appears in the
    research, include it as linkedin_url on that person's entry (in founders and/or leadership). Omit
    the field entirely if not found — never guess, construct, or infer a LinkedIn URL from a name.
7. HEADCOUNT — most recent available figure in metrics.headcount. growth_trend reflects 12-month direction.
7b. HEADCOUNT HISTORY — separately, mine ALL research sections (not just the profile search) for any
    other dated employee-count mentions — funding announcements frequently state headcount at that time
    (e.g. "the 45-person startup raised..."). Put every distinct dated figure you find into
    metrics.headcount_history, oldest to newest. This is REQUIRED whenever the research contains more
    than one dated headcount figure — do not just report the current number and stop looking.
8. VERIFY BEFORE ADDING — omit anything unconfirmable. Return [] for rounds rather than guess.
9. CONFIDENCE — score honestly and conservatively. Penalise for missing amounts, dates, investor names, or conflicting sources.
10. PRIVACY — if this company has IPO'd or is publicly traded, set is_public_company: true.
11. COMPETITORS — identify 4-5 DIRECT competitors in the competitors array. For each, state specifically
    how and in what way they compete (shared product space, shared target customer, positioned as an
    alternative, etc.) — not just that they're in the same broad sector. Verify from the research; return
    [] rather than guess generic same-sector companies.
12. INVESTOR AMOUNTS — only fill investor_amounts on a round when a SPECIFIC investor's dollar contribution
    is explicitly stated. Never split a round total evenly across participants to fabricate a number.
13. ACQUISITIONS — acquisitions is for companies THIS company bought (outbound only). If this company was
    itself acquired, that goes in funding_rounds as round_type 'Acquired', NOT here. [] is the normal,
    correct answer for most companies — do not force an entry.
14. PATENTS — patent_summary (patent_count/patent_fields) is best-effort only; omit entirely unless you
    find real evidence, and never default patent_count to 0. patents[] is different: it holds actual
    individual patent records found in the "Patents" research section — only include a genuine,
    identifiable patent (a title you can point to in the research, ideally with a patent number or URL),
    never an inference. Return [] for patents[] when that section found nothing verifiable — most
    companies, especially early-stage ones, genuinely have no findable patents, and [] is the correct,
    expected answer, not a failure.
15. TECH CLASSIFICATION — is_tech_company is a BROAD category: any company whose core product or
    competitive edge is its own technology/software/R&D, including fintech, biotech, healthtech, agtech,
    proptech, insurtech, cleantech, deep tech, hardware, and traditional industries with a genuine
    tech-driven product — not just classic SaaS. This name comes from a curated startup/VC database, so
    default to TRUE unless it's clearly a plain traditional business with no technology product of its own.
16. NON-VC FINANCIAL EVENTS — categorize precisely, they are scored differently from VC equity:
    'PE Buyout' = a private-equity firm takes over the company (buyout, LBO, take-private — e.g.
    "acquired by Hellman & Friedman and Bain Capital"). 'Acquired' = bought by a STRATEGIC acquirer
    (another operating company). 'Secondary' = existing shareholders selling their stake; NO new money
    reaches the company — never report a secondary as capital raised. 'Debt' = venture debt, credit
    facilities, term loans; report the amount but never conflate it with an equity round. When a company
    is majority-owned by a PE firm, it is still PRIVATE — do not set is_public_company for buyouts.

Research data:
${context}`,
    }],
  });

  totalInputTokens  += msg.usage.input_tokens;
  totalOutputTokens += msg.usage.output_tokens;

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") return null;

  const i = tool.input as Partial<EnrichmentResult> & {
    profile?: Partial<ExtractedProfile>;
    metrics?: { headcount?: number; growth_trend?: string; headcount_history?: ExtractedHeadcountPoint[] };
    competitors?: ExtractedCompetitor[];
    acquisitions?: ExtractedAcquisition[];
    news?: ExtractedNewsItem[];
    patent_summary?: { patent_count?: number; patent_fields?: string[] };
    patents?: ExtractedPatentRecord[];
  };

  const result: EnrichmentResult = {
    is_public_company: i.is_public_company ?? false,
    is_tech_company:   i.is_tech_company   ?? true,
    profile:           i.profile           ?? {},
    funding_history_complete: i.funding_history_complete ?? true,
    funding_rounds:    (i.funding_rounds   ?? []).filter((r) => r.round_type),
    leadership:        i.leadership        ?? [],
    metrics: {
      headcount:         i.metrics?.headcount         ?? null,
      growth_trend:      i.metrics?.growth_trend      ?? null,
      headcount_history: (i.metrics?.headcount_history ?? []).filter((p) => p.date && p.employee_count != null),
    },
    competitors:      (i.competitors  ?? []).filter((c) => c.name && c.how_it_competes),
    acquisitions:     (i.acquisitions ?? []).filter((a) => a.company_name),
    news:             (i.news ?? []).filter((n) => n.title && n.url),
    patent_summary: {
      patent_count:  typeof i.patent_summary?.patent_count === "number" ? i.patent_summary.patent_count : null,
      patent_fields: (i.patent_summary?.patent_fields ?? []).filter(Boolean),
    },
    patents:          (i.patents ?? []).filter((p) => p.title),
    confidence_score: typeof i.confidence_score === "number" ? i.confidence_score : 0,
    reasoning:        i.reasoning  ?? "",
    source_url:       i.source_url ?? "",
  };

  // Series A+ confirmed but nothing earlier — actively investigate rather than
  // accept the gap. Only fires for exactly this case, so the added search/API
  // cost is targeted, not blanket.
  if (needsEarlyStageDeepDive(result.funding_rounds)) {
    const deepDive = await deepDiveEarlyRounds(name, website, result.funding_rounds);
    if (deepDive) {
      result.funding_rounds = [...deepDive.rounds, ...result.funding_rounds];
      result.funding_history_complete = true;
      result.reasoning += ` [Early-stage deep dive: ${deepDive.note}]`;
    }
  }

  // Profile still essentially empty after the general-purpose pass — most
  // common for stealth/very-early-stage companies whose only web presence
  // is a LinkedIn/Crunchbase stub. Only fires for exactly this case, so the
  // added search/API cost is targeted, not blanket.
  if (needsProfileDeepDive(result.profile)) {
    const deepDive = await deepDiveProfile(name, website, country);
    if (deepDive) {
      const profile = result.profile as Record<string, unknown>;
      const found   = deepDive.profile as Record<string, unknown>;
      for (const key of ["description", "industry", "country", "city", "linkedin_url", "facebook_url", "instagram_url"]) {
        if (!profile[key] && found[key]) profile[key] = found[key];
      }
      result.reasoning += ` [Profile deep dive: ${deepDive.note}]`;
    }
  }

  return result;
}

// ── Early-stage deep dive ───────────────────────────────────────────────────────
// Fires ONLY when researchCompany() confirms a Series A+ round with no earlier
// Seed/Pre-Seed/Convertible Note — the exact gap that a single general-purpose
// search pass tends to miss, since results skew toward whatever round has the
// most recent press coverage. Two targeted expansions, run together:
//   1. Query expansion — searches phrased specifically for early-stage coverage
//      (seed/pre-seed/angel announcements), which a broad "funding history"
//      query frequently fails to surface on its own.
//   2. Investor backtracking — the lead investor(s) behind the confirmed later
//      round(s) are searched by name alongside the company, since seed and
//      Series A backers frequently overlap and an investor's own portfolio
//      page or press mentions often reference a seed round that never got its
//      own dedicated announcement.
// Returns null (no Claude call made) if every deep-dive query comes back empty
// — i.e. the deep dive was genuinely exhausted rather than skipped.
async function deepDiveEarlyRounds(
  name: string,
  website: string | null | undefined,
  firstPassRounds: ExtractedRound[],
): Promise<{ rounds: ExtractedRound[]; note: string } | null> {
  const domain = websiteDomain(website);
  const anchor = domain ? ` "${domain}"` : "";

  // Backtrack via up to 2 distinct lead investors, earliest confirmed later-stage
  // round first (its backers are the most likely to have also been at seed).
  const investors = [...new Set(
    firstPassRounds
      .filter((r) => LATER_STAGE_TYPES.has(normalizeRoundType(r.round_type)))
      .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"))
      .map((r) => r.lead_investor)
      .filter((v): v is string => !!v),
  )].slice(0, 2);

  const results = await Promise.all([
    webSearch(`"${name}"${anchor} seed round investors announcement raised`),
    webSearch(`"${name}"${anchor} pre-seed round announced raised`),
    webSearch(`"${name}"${anchor} angel investors early backers friends and family funding`),
    ...investors.map((inv) => webSearch(`"${inv}" "${name}" seed OR "pre-seed" OR angel investment portfolio`)),
  ]);
  if (!results.some(Boolean)) return null; // deep dive exhausted, genuinely nothing found

  const context = results.filter(Boolean).join("\n---\n");
  const knownRounds = firstPassRounds.map((r) => normalizeRoundType(r.round_type)).join(", ");

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [{
      name: "save_early_rounds",
      description: "Save any Pre-Seed, Seed, or Convertible Note round found for this company that is NOT already known.",
      input_schema: {
        type: "object" as const,
        properties: {
          funding_rounds: {
            type: "array",
            description: "Newly-found early-stage rounds only. Return [] if this deep-dive research does not confirm one.",
            items: {
              type: "object" as const,
              properties: {
                round_type:      { type: "string", enum: ["Pre-Seed", "Seed", "Convertible Note"] },
                amount_raised:   { type: "number", description: "USD plain integer. Omit if unknown." },
                valuation:       { type: "number", description: "Post-money valuation in USD as a plain integer. Omit if unconfirmed." },
                is_valuation_estimated: { type: "boolean" },
                date:            { type: "string", description: "YYYY-MM-DD, or YYYY-01-01 if only the year is known." },
                lead_investor:   { type: "string" },
                other_investors: { type: "array", items: { type: "string" } },
                source_url:      { type: "string" },
              },
              required: ["round_type"],
            },
          },
          reasoning: { type: "string", description: "1-2 sentences: what this deep dive found, or why nothing could be confirmed." },
        },
        required: ["funding_rounds", "reasoning"],
      },
    }],
    tool_choice: { type: "tool", name: "save_early_rounds" },
    messages: [{
      role: "user",
      content: `"${name}" is already confirmed to have raised: ${knownRounds}.

This is a TARGETED deep dive to find an EARLIER Pre-Seed, Seed, or Convertible Note round that the initial research
missed. Companies essentially never skip straight from founding to an institutional round — treat the absence of an
earlier round as a gap to investigate, not a fact. Angel / friends-and-family rounds should be classified as
Pre-Seed or Seed depending on timing and size (there is no separate "Angel" category). Only return a round you can
verify from the research below; return [] if you genuinely cannot confirm one even after this deep dive.

Deep-dive research:
${context}`,
    }],
  });

  totalInputTokens  += msg.usage.input_tokens;
  totalOutputTokens += msg.usage.output_tokens;

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") return null;
  const out = tool.input as { funding_rounds?: ExtractedRound[]; reasoning?: string };
  const rounds = (out.funding_rounds ?? []).filter((r) => r.round_type);
  if (!rounds.length) return null;
  return { rounds, note: out.reasoning ?? "" };
}

// ── Profile deep dive ───────────────────────────────────────────────────────
// Fires ONLY when needsProfileDeepDive() finds pass 1 came back with
// essentially no profile at all — the pattern most common for stealth/
// very-early-stage companies. Targets company-profile-specific sources
// (LinkedIn company page, Crunchbase organization page) that the general
// news/funding-oriented queries in researchCompany() don't specifically
// search for. Same shape as deepDiveEarlyRounds: targeted queries, a small
// tool schema, fill-null merge into whatever pass 1 already found. Returns
// null (no Claude call made) if every deep-dive query comes back empty.
async function deepDiveProfile(
  name: string,
  website: string | null | undefined,
  country: string | null | undefined,
): Promise<{ profile: Partial<ExtractedProfile>; note: string } | null> {
  const domain = websiteDomain(website);
  const anchor = domain ? ` "${domain}"` : country ? ` ${country}` : "";

  const results = await Promise.all([
    webSearch(`site:linkedin.com/company "${name}"${anchor}`),
    webSearch(`site:crunchbase.com/organization "${name}"${anchor}`),
    webSearch(`"${name}"${anchor} about company profile headquarters`),
  ]);
  if (!results.some(Boolean)) return null; // deep dive exhausted, genuinely nothing found

  const context = results.filter(Boolean).join("\n---\n");

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [{
      name: "save_profile_deep_dive",
      description: "Save any basic company profile facts found for this company that were not already known.",
      input_schema: {
        type: "object" as const,
        properties: {
          description:   { type: "string", description: "2-4 sentences on what the company does. Omit if unverifiable." },
          industry:       { type: "string", description: "Primary tech sector (e.g. 'AI & ML', 'Cybersecurity', 'FinTech')." },
          country:        { type: "string", description: "HQ country full name. Omit if unverifiable." },
          city:           { type: "string", description: "HQ city. Omit if unverifiable." },
          linkedin_url:   { type: "string", description: "The COMPANY's own LinkedIn page (linkedin.com/company/...) — not a person's profile. Omit if not found." },
          facebook_url:   { type: "string", description: "The company's Facebook page. Omit if not found." },
          instagram_url:  { type: "string", description: "The company's Instagram profile. Omit if not found." },
          reasoning:      { type: "string", description: "1-2 sentences: what this deep dive found, or why nothing could be confirmed." },
        },
        required: ["reasoning"],
      },
    }],
    tool_choice: { type: "tool", name: "save_profile_deep_dive" },
    messages: [{
      role: "user",
      content: `"${name}" is a private tech company with almost no profile data on file yet. This is a TARGETED deep dive
using company-profile-specific sources (LinkedIn company page, Crunchbase organization page) rather than general news
search, since stealth/very-early-stage companies are more likely to have a profile stub on these platforms than press
coverage. Only return a fact you can verify from the research below — omit anything you cannot confirm, never guess.

Deep-dive research:
${context}`,
    }],
  });

  totalInputTokens  += msg.usage.input_tokens;
  totalOutputTokens += msg.usage.output_tokens;

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") return null;
  const out = tool.input as Partial<ExtractedProfile> & { reasoning?: string };
  const { reasoning, ...profile } = out;
  if (Object.keys(profile).length === 0) return null;
  return { profile, note: reasoning ?? "" };
}

// ── DB: insert new funding rounds (dedup: same type + date ±6 months) ─────────
async function insertNewRounds(
  startupId: string,
  newRounds: ExtractedRound[],
  existingRounds: FundingRoundRow[],
  fallbackSource?: string,
): Promise<{ inserted: number; skipped: number }> {
  const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
  let inserted = 0, skipped = 0;
  const seen = [...existingRounds];

  for (const round of newRounds) {
    const roundType     = normalizeRoundType(round.round_type);
    const announcedDate = round.date ?? null;
    const sourceUrl     = round.source_url ?? fallbackSource ?? null;

    // Privacy gate: never store IPO rounds
    if (roundType === "IPO") { skipped++; continue; }

    const isDup = seen.some((e) => {
      if (e.round_type !== roundType) return false;
      if (!e.announcement_date || !announcedDate) return true; // same type, no date → treat as dup
      return Math.abs(
        new Date(e.announcement_date).getTime() - new Date(announcedDate).getTime(),
      ) < SIX_MONTHS_MS;
    });

    if (isDup) { skipped++; continue; }

    const amt    = round.amount_raised ? `$${(round.amount_raised / 1e6).toFixed(0)}M` : "amt unknown";
    const lead   = round.lead_investor ?? null;
    const others = round.other_investors ?? [];
    const allInv = [...(lead ? [lead] : []), ...others].filter(Boolean) as string[];
    const isEst  = round.is_valuation_estimated ?? false;

    // Only keep per-investor amounts for names that are actually listed as
    // participants in this round — guards against a malformed/unlinked entry.
    const investorAmounts = (round.investor_amounts ?? [])
      .filter((a): a is InvestorAmount => !!a?.name && typeof a.amount === "number" && a.amount > 0)
      .filter((a) => allInv.some((n) => n.toLowerCase() === a.name.toLowerCase()));

    if (DRY_RUN) {
      const leadStr   = lead ? ` | ${lead}${others.length > 0 ? ` +${others.length}` : ""}` : "";
      const amountsStr = investorAmounts.length > 0
        ? ` | amounts: ${investorAmounts.map((a) => `${a.name} $${(a.amount / 1e6).toFixed(0)}M`).join(", ")}`
        : "";
      console.log(`    [DRY] ${roundType} | ${announcedDate ?? "no date"} | ${amt}${leadStr}${amountsStr}`);
      inserted++;
      seen.push({
        id: "dry", startup_id: startupId, round_type: roundType,
        amount_raised: null, valuation: null, is_valuation_estimated: null,
        announcement_date: announcedDate, source_url: null,
        lead_investor: null, investors: null, investor_amounts: null,
      });
      continue;
    }

    const { error } = await supabase.from("funding_rounds").insert({
      startup_id:             startupId,
      round_type:             roundType,
      amount_raised:          round.amount_raised ?? null,
      valuation:              round.valuation     ?? null,
      is_valuation_estimated: isEst,
      announcement_date:      announcedDate,
      source_url:             sourceUrl,
      lead_investor:          lead,
      investors:              allInv.length > 0 ? allInv : null,
      investor_amounts:       investorAmounts.length > 0 ? investorAmounts : null,
    });

    if (error) {
      console.warn(`    ⚠️  Round insert failed (${roundType}): ${error.message}`);
    } else {
      const leadStr   = lead ? ` | ${lead}${others.length > 0 ? ` +${others.length}` : ""}` : "";
      const amountsStr = investorAmounts.length > 0
        ? ` | amounts: ${investorAmounts.map((a) => `${a.name} $${(a.amount / 1e6).toFixed(0)}M`).join(", ")}`
        : "";
      console.log(`    💰  ${roundType} | ${announcedDate ?? "no date"} | ${amt}${leadStr}${amountsStr}`);
      inserted++;
      seen.push({
        id: "new", startup_id: startupId, round_type: roundType,
        amount_raised: round.amount_raised ?? null, valuation: round.valuation ?? null,
        is_valuation_estimated: isEst,
        announcement_date: announcedDate, source_url: null,
        lead_investor: lead, investors: allInv.length > 0 ? allInv : null,
        investor_amounts: investorAmounts.length > 0 ? investorAmounts : null,
      });
    }
  }

  return { inserted, skipped };
}

// Domain → startup lookup, used to cross-link a found competitor to one of
// our own tracked startups. Populated once in main() before the processing
// loop starts.
const startupByDomain = new Map<string, StartupRow>();

// ── DB: patch startup profile — fill NULLs + always refresh time-varying fields
async function patchStartupProfile(
  existing: StartupRow,
  result: EnrichmentResult,
): Promise<{ fieldsPatched: number; patchedKeys: string[] }> {
  const { profile, metrics, leadership } = result;
  const patch: Record<string, unknown> = {};

  // Profile fields: fill NULL slots only (safe for all tiers including Tier 3)
  if (!existing.website      && profile.website)      patch.website      = profile.website;
  if (!existing.description  && profile.description)  patch.description  = profile.description;
  if (!existing.industry     && profile.industry)     patch.industry     = profile.industry;
  if (!existing.founded_year && profile.founded_year) patch.founded_year = profile.founded_year;
  if (!existing.country      && profile.country)      patch.country      = profile.country;
  if (!existing.city         && profile.city)         patch.city         = profile.city;

  // Company social links: fill-null only, same as website.
  if (!existing.linkedin_url  && profile.linkedin_url)  patch.linkedin_url  = profile.linkedin_url;
  if (!existing.facebook_url  && profile.facebook_url)  patch.facebook_url  = profile.facebook_url;
  if (!existing.instagram_url && profile.instagram_url) patch.instagram_url = profile.instagram_url;

  // Sector / sub-sector: fill-null only. sector_name/sub_sector_name is
  // constrained to the real sectors table via the tool schema's enum, then
  // resolved to a uuid through sector_id_by_name() (defined alongside the
  // sectors table) — never written from arbitrary free text, so this can
  // never point at a sector that doesn't actually exist.
  if (!existing.sector_id && profile.sector_name) {
    const { data: sid } = await supabase.rpc("sector_id_by_name", { p_name: profile.sector_name });
    if (sid) patch.sector_id = sid;
  }
  if (!existing.sub_sector_id && profile.sub_sector_name) {
    const { data: subId } = await supabase.rpc("sector_id_by_name", { p_name: profile.sub_sector_name });
    if (subId) patch.sub_sector_id = subId;
  }

  // Founders: merge as union (additive, never destructive), deduped by name.
  // Also backfills linkedin_url and the quality tags onto an already-
  // recorded founder if this pass found one and a prior pass didn't —
  // never overwrites an existing (already-true) value.
  const cleanFounders = (profile.founders ?? [])
    .filter((f) => f && f.name && String(f.name).trim())
    .map((f) => ({
      name: String(f.name).trim(),
      linkedin_url: f.linkedin_url?.trim() || null,
      had_prior_exit: f.had_prior_exit,
      elite_background: f.elite_background,
      notable_pedigree: f.notable_pedigree,
    }));

  if (cleanFounders.length > 0) {
    const existingFounders = existing.founders ?? [];
    const byName = new Map(cleanFounders.map((f) => [f.name.toLowerCase(), f]));
    let foundersChanged = false;

    const updatedExisting = existingFounders.map((ef) => {
      const match = byName.get(ef.name.toLowerCase());
      if (!match) return ef;
      const personPatch: Record<string, unknown> = {};
      if (match.linkedin_url && !ef.linkedin_url) personPatch.linkedin_url = match.linkedin_url;
      for (const tag of ["had_prior_exit", "elite_background", "notable_pedigree"] as const) {
        if (match[tag] === true && ef[tag] !== true) personPatch[tag] = true;
      }
      if (Object.keys(personPatch).length === 0) return ef;
      foundersChanged = true;
      return { ...ef, ...personPatch };
    });

    const existingNames = new Set(existingFounders.map((f) => f.name.toLowerCase()));
    const newFounders = cleanFounders.filter((f) => !existingNames.has(f.name.toLowerCase()));
    if (newFounders.length > 0) foundersChanged = true;

    if (foundersChanged) patch.founders = [...updatedExisting, ...newFounders];
  }

  // Leadership: set only when currently NULL (Tier 3 strategy: no blind overwrites)
  if (leadership.length > 0 && (!existing.leadership || existing.leadership.length === 0)) {
    patch.leadership = leadership;
  }

  // Competitors: set only when currently empty — preserves any pre-existing
  // manually-curated entries untouched. Cross-links to our own tracked
  // startups by website domain when a match is found (never matches self).
  if (result.competitors.length > 0 && (!existing.competitors || existing.competitors.length === 0)) {
    patch.competitors = result.competitors.map((c): Competitor => {
      const domain = websiteDomain(c.website);
      const match  = domain ? startupByDomain.get(domain) : undefined;
      return {
        name: c.name,
        website: c.website ?? null,
        how_it_competes: c.how_it_competes,
        startup_id: match && match.id !== existing.id ? match.id : null,
      };
    });
  }

  // Acquisitions: set only when currently empty — same fill-null + domain
  // cross-link pattern as competitors. [] found by Claude is NOT written
  // here (only a non-empty result fills the slot); a genuinely-empty company
  // stays NULL rather than being stamped with an empty array, so it's still
  // picked up for review rather than looking like a verified "no acquisitions".
  if (result.acquisitions.length > 0 && (!existing.acquisitions || existing.acquisitions.length === 0)) {
    patch.acquisitions = result.acquisitions.map((a): Acquisition => {
      const domain = websiteDomain(a.website);
      const match  = domain ? startupByDomain.get(domain) : undefined;
      return {
        company_name: a.company_name,
        website: a.website ?? null,
        acquired_date: a.acquired_date ?? null,
        amount: a.amount ?? null,
        description: a.description ?? null,
        acquired_startup_id: match && match.id !== existing.id ? match.id : null,
      };
    });
  }

  // News: set only when currently empty — same fill-null-when-empty policy
  // as competitors/acquisitions, so a manually-curated news list is never
  // overwritten by the pipeline.
  if (result.news.length > 0 && (!existing.news || existing.news.length === 0)) {
    patch.news = result.news.map((n): NewsItem => ({
      title: n.title,
      url: n.url,
      source: n.source ?? null,
      published_date: n.published_date ?? null,
      summary: n.summary ?? null,
      image_url: n.image_url ?? null,
    }));
  }

  // Patent summary (count/fields): fill-null only, same as the rest of the profile block.
  if (existing.patent_count == null && result.patent_summary.patent_count != null) {
    patch.patent_count = result.patent_summary.patent_count;
  }
  if ((!existing.patent_fields || existing.patent_fields.length === 0) && result.patent_summary.patent_fields.length > 0) {
    patch.patent_fields = result.patent_summary.patent_fields;
  }

  // Individual patent records: set only when currently empty — same
  // fill-null-when-empty policy as competitors/acquisitions/news, so a
  // manually-curated patent list is never overwritten by the pipeline.
  if (result.patents.length > 0 && (!existing.patents || existing.patents.length === 0)) {
    patch.patents = result.patents.map((p): PatentRecord => ({
      title: p.title,
      patent_number: p.patent_number ?? null,
      filing_date: p.filing_date ?? null,
      url: p.url ?? null,
      summary: p.summary ?? null,
    }));
  }

  // Headcount + growth_trend: always refresh (time-varying — valid for all tiers)
  if (metrics.headcount    != null) patch.employee_count = metrics.headcount;
  if (metrics.growth_trend != null) patch.growth_trend   = metrics.growth_trend;

  // fieldsPatched / patchedKeys (the meaningful, user-facing view of what was
  // actually found) are captured BEFORE funding_history_complete is added
  // below — that flag always gets written and would otherwise inflate the
  // count for companies where nothing else was actually found.
  const patchedKeys   = Object.keys(patch);
  const fieldsPatched = patchedKeys.length;

  // Funding history completeness: always overwrite with the latest run's
  // assessment (not fill-null-only) — a later pass that finds the missing
  // early round should be able to flip false -> true, and vice versa if new
  // evidence of a gap surfaces. Written even when nothing else was — it's a
  // real (if minor) signal on its own.
  patch.funding_history_complete = result.funding_history_complete;

  if (DRY_RUN) {
    console.log(`    [DRY] Would patch: ${Object.keys(patch).join(", ")}`);
    return { fieldsPatched, patchedKeys };
  }

  const { error } = await supabase.from("startups").update(patch).eq("id", existing.id);
  if (error) {
    console.warn(`    ⚠️  Profile patch failed: ${error.message}`);
    return { fieldsPatched: 0, patchedKeys: [] };
  }

  const parts: string[] = [];
  if (patch.employee_count) parts.push(`~${metrics.headcount?.toLocaleString()} employees`);
  if (patch.growth_trend)   parts.push(`trend: ${metrics.growth_trend}`);
  if (patch.leadership)     parts.push(`${leadership.length} team members`);
  if (patch.competitors)    parts.push(`${(patch.competitors as Competitor[]).length} competitors`);
  if (patch.acquisitions)   parts.push(`${(patch.acquisitions as Acquisition[]).length} acquisitions`);
  if (patch.news)           parts.push(`${(patch.news as NewsItem[]).length} news articles`);
  if (patch.patents)        parts.push(`${(patch.patents as PatentRecord[]).length} patents`);
  else if (patch.patent_count != null) parts.push(`${patch.patent_count} patents (count only)`);
  if (patch.sector_id)      parts.push(`sector: ${profile.sector_name}`);
  if (patch.sub_sector_id)  parts.push(`sub-sector: ${profile.sub_sector_name}`);
  const profileKeys = [
    "website","description","industry","founded_year","country","city","founders",
    "linkedin_url","facebook_url","instagram_url",
  ].filter((k) => patch[k] !== undefined);
  if (profileKeys.length > 0) parts.push(`profile: ${profileKeys.join(", ")}`);
  if (parts.length > 0) console.log(`    👤  Patched: ${parts.join(" | ")}`);

  return { fieldsPatched, patchedKeys };
}

// ── Headcount history snapshot ────────────────────────────────────────────────
// Upserts one row per company per calendar day. Subsequent runs/points on the
// same day update the headcount value (latest wins), so re-runs are always
// safe. Pass an explicit snapshotDate to backfill a historical data point
// mined from research (e.g. a headcount mentioned in a 2021 Series A
// announcement) rather than today's date.
async function recordHeadcountSnapshot(
  startupId: string,
  employeeCount: number,
  snapshotDate?: string,
): Promise<void> {
  const date = snapshotDate ?? new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (DRY_RUN) {
    console.log(`    [DRY] Would upsert headcount_history: ${employeeCount} @ ${date}`);
    return;
  }
  const { error } = await supabase
    .from("headcount_history")
    .upsert(
      { startup_id: startupId, employee_count: employeeCount, snapshot_date: date },
      { onConflict: "startup_id,snapshot_date" },
    );
  if (error) {
    console.warn(`    ⚠️  headcount_history snapshot failed: ${error.message}`);
  } else {
    console.log(`    📈  headcount_history: ${employeeCount.toLocaleString()} recorded for ${date}`);
  }
}

// ── AlphaMap Score history snapshot ───────────────────────────────────────────
// calculate_alphamap_score() is a live, memoryless RPC — it has no concept of
// "yesterday's score" on its own. This is what gives the Overview tab's
// score-over-time chart something to plot: called once per company per run
// (after the profile/funding/headcount patches above, so the score reflects
// today's freshly-enriched data), upserted one row per company per calendar
// day exactly like recordHeadcountSnapshot.
async function recordScoreSnapshot(startupId: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`    [DRY] Would compute + upsert alphamap_score_history`);
    return;
  }
  const { data, error: rpcError } = await supabase.rpc("calculate_alphamap_score", { p_startup_id: startupId });
  if (rpcError) {
    console.warn(`    ⚠️  calculate_alphamap_score RPC failed: ${rpcError.message}`);
    return;
  }
  const score = data as { score?: number; tier?: string; error?: string } | null;
  if (!score || score.error || score.score == null) return; // not enough data to score yet — not an error

  const date = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from("alphamap_score_history")
    .upsert(
      { startup_id: startupId, score: Math.round(score.score), tier: score.tier ?? null, snapshot_date: date },
      { onConflict: "startup_id,snapshot_date" },
    );
  if (error) {
    console.warn(`    ⚠️  alphamap_score_history snapshot failed: ${error.message}`);
  } else {
    console.log(`    🧭  alphamap_score_history: ${Math.round(score.score)} (${score.tier ?? "—"}) recorded for ${date}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date().toISOString();
  const bar       = "═".repeat(62);

  console.log(`╔${"═".repeat(62)}╗`);
  console.log(`║${"  AlphaMap — Bulk Full-Database Enrichment Run".padEnd(62)}║`);
  console.log(`║  ${startedAt}${"".padEnd(62 - 2 - startedAt.length)}║`);
  console.log(`║  DRY_RUN=${String(DRY_RUN).padEnd(5)} | BATCH=${String(BATCH_SIZE).padEnd(6)} | OFFSET=${String(OFFSET).padEnd(5)} | DELAY=${DELAY_MS / 1000}s${" ".padEnd(62 - 58)}║`);
  console.log(`║  TAVILY_BUDGET=${String(TAVILY_BUDGET).padEnd(5)} | MIN_CONFIDENCE=${String(MIN_CONFIDENCE).padEnd(17)}║`);
  console.log(`║  MODEL=${MODEL}${" ".padEnd(Math.max(0, 62 - 9 - MODEL.length))}║`);
  console.log(`╚${"═".repeat(62)}╝\n`);

  if (DRY_RUN) console.log("ℹ️  DRY RUN — set DRY_RUN=false to apply writes to the database.\n");

  await loadSectorTaxonomy();
  console.log(`🗂️   Sector taxonomy: ${SECTOR_PARENT_NAMES.length} sectors, ${SUB_SECTOR_NAMES.length} sub-sectors loaded\n`);

  // ── 1. Fetch all startups + all rounds ────────────────────────────────────
  // Paginated: PostgREST caps any single response at its max-rows setting
  // (1000 by default), which would silently hide everything past the first
  // 1000 rows of a 5,000+-company table.
  async function fetchAllPaginated<T>(build: (from: number, to: number) => any): Promise<T[]> {
    const PAGE = 1000;
    const all: T[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await build(from, from + PAGE - 1);
      if (error) { console.error("❌  fetch failed:", error.message); process.exit(1); }
      const batch = (data ?? []) as T[];
      all.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
    return all;
  }

  const startups = await fetchAllPaginated<StartupRow>((from, to) =>
    supabase
      .from("startups")
      .select("id, name, website, description, industry, founded_year, employee_count, growth_trend, country, city, founders, leadership, competitors, acquisitions, patent_count, patent_fields, patents, funding_history_complete, updated_at, last_enriched_at, sector_id, sub_sector_id, linkedin_url, facebook_url, instagram_url, news")
      .order("name")
      .range(from, to),
  );
  const allRounds = await fetchAllPaginated<FundingRoundRow>((from, to) =>
    supabase
      .from("funding_rounds")
      .select("id, startup_id, round_type, amount_raised, valuation, is_valuation_estimated, announcement_date, source_url, lead_investor, investors, investor_amounts")
      .order("created_at")
      .range(from, to),
  );

  const roundsByStartup = new Map<string, FundingRoundRow[]>();
  for (const r of allRounds) {
    const arr = roundsByStartup.get(r.startup_id) ?? [];
    arr.push(r);
    roundsByStartup.set(r.startup_id, arr);
  }

  // Domain → startup map for cross-linking found competitors to our own
  // tracked startups (see patchStartupProfile).
  for (const s of startups) {
    const d = websiteDomain(s.website);
    if (d && !startupByDomain.has(d)) startupByDomain.set(d, s);
  }

  // ── 2. Classify every startup ─────────────────────────────────────────────
  const tier1: StartupRow[] = [];
  const tier2: StartupRow[] = [];
  const tier3: StartupRow[] = [];
  const tierById = new Map<string, 1 | 2 | 3>();

  for (const row of startups) {
    const rounds = roundsByStartup.get(row.id) ?? [];
    const t = classifyTier(row, rounds);
    tierById.set(row.id, t);
    if      (t === 1) tier1.push(row);
    else if (t === 2) tier2.push(row);
    else              tier3.push(row);
  }

  const tier3Skipped = MAX_TIER < 3 ? tier3.length : 0;

  console.log("── Database Classification " + "─".repeat(36));
  console.log(`  Total startups in DB:   ${startups.length}`);
  console.log(`  Total funding_rounds:   ${allRounds.length}`);
  console.log(`  Tier 1 — NO data:       ${tier1.length}  ← processed first`);
  console.log(`  Tier 2 — PARTIAL data:  ${tier2.length}  ← processed second`);
  console.log(`  Tier 3 — FULL data:     ${tier3.length}${MAX_TIER < 3 ? "  ← SKIPPED (MAX_TIER=2)" : "  ← processed last (refresh)"}`);

  // ── 3. Build ordered queue — apply MAX_TIER, then OFFSET + BATCH_SIZE ────
  const eligibleQueue = MAX_TIER >= 3
    ? [...tier1, ...tier2, ...tier3]
    : [...tier1, ...tier2];              // skip complete companies when MAX_TIER=2

  // Queue order: never-enriched companies first (tier-priority within them),
  // then previously-processed ones, oldest stamp first. This is what makes
  // repeated OFFSET=0 runs walk the whole database without skips or repeats:
  // each run stamps its batch, pushing those companies behind everything
  // still untouched.
  eligibleQueue.sort((a, b) => {
    const aNever = a.last_enriched_at == null;
    const bNever = b.last_enriched_at == null;
    if (aNever !== bNever) return aNever ? -1 : 1;
    if (!aNever && a.last_enriched_at !== b.last_enriched_at) {
      return a.last_enriched_at! < b.last_enriched_at! ? -1 : 1;
    }
    const tierDiff = (tierById.get(a.id) ?? 3) - (tierById.get(b.id) ?? 3);
    if (tierDiff !== 0) return tierDiff;
    return a.name.localeCompare(b.name);
  });

  const fullQueue = eligibleQueue;
  const queue     = fullQueue.slice(OFFSET, OFFSET + BATCH_SIZE);
  const queueEnd  = OFFSET + queue.length;

  if (queue.length === 0) {
    console.log("\n✅  Queue is empty after OFFSET/BATCH_SIZE/MAX_TIER filter. Nothing to process.\n");
    return;
  }

  const tavilyCompanies = Math.floor(TAVILY_BUDGET / 5);
  const fallbackLabel   = process.env.SERP_KEY ? "Serper (Google)" : "no fallback";
  console.log(`\n  Processing range:       [${OFFSET + 1}–${queueEnd}] of ${fullQueue.length}` +
    (tier3Skipped > 0 ? ` (${tier3Skipped} Tier 3 skipped)` : ""));
  console.log(`  Search:                 Tavily → ${fallbackLabel}`);
  console.log(`  Tavily covers ~${tavilyCompanies} companies, then ${fallbackLabel} for the remainder`);
  console.log("─".repeat(62) + "\n");

  // ── 4. Tally ──────────────────────────────────────────────────────────────
  const tally: Record<ProcessStatus, number> = {
    success: 0, partial: 0, low_confidence: 0, rejected: 0, removed_public: 0,
    no_data: 0, stealth_suspected: 0, error: 0,
  };
  let totalRoundsInserted = 0;
  let totalFieldsPatched  = 0;
  let totalRemovedPublic  = 0;

  const STATUS_ICON: Record<ProcessStatus, string> = {
    success:           "✅",
    partial:           "🟠",
    low_confidence:    "⚠️ ",
    rejected:          "🚫",
    removed_public:    "🗑️ ",
    no_data:           "🔍",
    stealth_suspected: "👻",
    error:             "❌",
  };

  // ── 5. Sequential processing loop ─────────────────────────────────────────
  for (let i = 0; i < queue.length; i++) {
    const row    = queue[i];
    const rounds = roundsByStartup.get(row.id) ?? [];
    const tier   = classifyTier(row, rounds);
    const idx    = OFFSET + i + 1;
    const engine = engineLabel();

    console.log(`\n[${idx}/${fullQueue.length}] "${row.name}" | Tier ${tier} | Engine: ${engine}`);

    const missingFields = [
      !row.description    && "description",
      !row.employee_count && "employees",
      !row.country        && "country",
      !hasRealRounds(rounds) && "real rounds",
      !hasCompetitors(row) && "competitors",
      !row.news?.length   && "news",
      !row.linkedin_url   && "LinkedIn",
      !row.facebook_url   && "Facebook",
      !row.instagram_url  && "Instagram",
      !row.sector_id      && "sector",
      !hasPatents(row)    && "patents",
    ].filter(Boolean);
    if (missingFields.length > 0) {
      console.log(`    Missing before this pass: ${missingFields.join(", ")}`);
    }

    let status: ProcessStatus = "error";
    let roundsInserted = 0;
    let fieldsPatched  = 0;
    let confidenceSeen: number | null = null;
    let rowDeleted = false;

    try {
      const result = await researchCompany(row.name, row.website, row.country);
      if (result) confidenceSeen = result.confidence_score;

      if (!result) {
        // All four searches failed
        console.log(`    🔍  All searches failed — no data retrieved`);
        status = "no_data";

      } else if (result.is_public_company) {
        // Publicly traded companies are out of scope for this private-market
        // tool — remove the row entirely rather than leave a dead, empty
        // entry sitting in the list forever. Never touch a manually-verified
        // row, even if the model (wrongly) flags it public.
        console.log(`    🗑️  REMOVED — publicly traded company (not tracked here)`);
        if (!DRY_RUN) {
          const { error: delErr, count } = await supabase
            .from("startups")
            .delete({ count: "exact" })
            .eq("id", row.id)
            .eq("is_manually_verified", false);
          if (delErr) console.warn(`    ⚠️  Delete failed: ${delErr.message}`);
          else if (!count) console.warn(`    ⚠️  Not deleted — row is manually verified, left in place`);
          else { totalRemovedPublic++; rowDeleted = true; }
        } else {
          console.log(`    [DRY] Would delete this row (publicly traded), unless manually verified`);
        }
        status = "removed_public";

      } else if (!result.is_tech_company) {
        console.log(`    🚫  REJECTED — not a technology-driven company`);
        status = "rejected";

      } else {
        // Profile fields (description, industry, founders, leadership,
        // competitors, acquisitions, patents, headcount) are written
        // regardless of the overall confidence score — each field already
        // carries its own "omit if unverifiable" instruction, so the risk
        // of fabrication is low. MIN_CONFIDENCE gates ONLY funding-round
        // dollar figures, which is what the confidence score is actually
        // scoring ("multiple sources agree on amounts and dates").
        const scoreIcon =
          result.confidence_score >= 90 ? "🟢" :
          result.confidence_score >= 70 ? "🟡" :
          result.confidence_score >= MIN_CONFIDENCE ? "🟠" : "🔴";
        console.log(`    ${scoreIcon}  Confidence: ${result.confidence_score}/100 | ${result.funding_rounds.length} round(s) found`);
        if (result.reasoning) console.log(`    📝  ${result.reasoning}`);

        const profileResult = await patchStartupProfile(row, result);
        fieldsPatched = profileResult.fieldsPatched;

        // Persist every dated historical headcount point mined from research
        // (e.g. figures found in older funding announcements/news articles),
        // then the current figure as of today — building a real lifespan
        // series across a single run instead of one point per calendar day.
        for (const point of result.metrics.headcount_history) {
          await recordHeadcountSnapshot(row.id, point.employee_count, point.date);
        }
        if (result.metrics.headcount != null) {
          await recordHeadcountSnapshot(row.id, result.metrics.headcount);
        }

        const confidentEnough = result.confidence_score >= MIN_CONFIDENCE;
        if (confidentEnough) {
          const roundResult = await insertNewRounds(
            row.id, result.funding_rounds, rounds, result.source_url || undefined,
          );
          roundsInserted = roundResult.inserted;
          totalRoundsInserted += roundsInserted;
        } else if (result.funding_rounds.length > 0) {
          console.log(`    🟠  ${result.funding_rounds.length} funding round(s) found but confidence ${result.confidence_score} < ${MIN_CONFIDENCE} — not inserted`);
        }

        // Snapshot the AlphaMap Score now that this pass's profile/funding/
        // headcount writes have landed, so the score-over-time chart reflects
        // today's freshly-enriched data rather than yesterday's.
        await recordScoreSnapshot(row.id);

        totalFieldsPatched += fieldsPatched;

        // Honest after-state: which of the pre-run gaps are STILL open after
        // this pass. The pre-run "Missing before this pass" line describes the
        // row as it stood going in — without this counterpart it reads like a
        // result and makes successful passes look like failures.
        const patched = new Set(profileResult.patchedKeys);
        const stillMissing = [
          !row.description       && !patched.has("description")    && "description",
          !row.employee_count    && !patched.has("employee_count") && "employees",
          !row.country           && !patched.has("country")        && "country",
          !hasRealRounds(rounds) && roundsInserted === 0           && "real rounds",
          !hasCompetitors(row)   && !patched.has("competitors")    && "competitors",
          !row.news?.length      && !patched.has("news")           && "news",
          !row.linkedin_url      && !patched.has("linkedin_url")   && "LinkedIn",
          !row.facebook_url      && !patched.has("facebook_url")   && "Facebook",
          !row.instagram_url     && !patched.has("instagram_url")  && "Instagram",
          !row.sector_id         && !patched.has("sector_id")      && "sector",
          !hasPatents(row)       && !patched.has("patents")        && "patents",
        ].filter(Boolean);
        if (stillMissing.length > 0) {
          console.log(`    ▫️  Still missing after this pass: ${stillMissing.join(", ")}`);
        } else if (missingFields.length > 0) {
          console.log(`    ✨  All pre-run gaps filled`);
        }

        status = (fieldsPatched === 0 && roundsInserted === 0)
          ? "low_confidence"                 // nothing usable was found or written at all
          : confidentEnough ? "success" : "partial"; // profile written; funding withheld pending confirmation
      }
    } catch (err) {
      console.error(`    ❌  Unhandled error: ${String(err)}`);
      status = "error";
    }

    // Reclassify a repeat miss: this is a Tier 1/2 row (genuinely still
    // missing core data, not a Tier 3 company just undergoing routine
    // re-verification) that already went through at least one prior full
    // pass (last_enriched_at is set) and STILL came back with nothing
    // usable. That's a different signal than a first attempt turning up
    // empty — it's the tail of companies unlikely to resolve on a plain
    // re-run (deep, truly stealth, or misnamed/mismatched in a way search
    // can't recover from) rather than ones that just haven't been searched
    // hard enough yet. Keeps "low_confidence"/"no_data" honest as "still
    // worth trying again" buckets.
    if ((status === "no_data" || status === "low_confidence") && tier !== 3 && row.last_enriched_at) {
      status = "stealth_suspected";
    }

    tally[status]++;

    // Stamp every processed company so the queue advances across runs.
    // Hard errors are left unstamped so a transient failure is retried at
    // the front of the next run instead of being buried. Deleted rows have
    // nothing left to stamp.
    if (status !== "error" && !rowDeleted && !DRY_RUN) {
      const stamp: Record<string, unknown> = { last_enriched_at: new Date().toISOString() };
      if (confidenceSeen != null) stamp.enrichment_confidence = confidenceSeen;
      const { error: stampErr } = await supabase.from("startups").update(stamp).eq("id", row.id);
      if (stampErr) console.warn(`    ⚠️  last_enriched_at stamp failed: ${stampErr.message}`);
    }

    // ── Summary line in the requested format ─────────────────────────────────
    const detail = status === "success" || status === "partial"
      ? ` | ${fieldsPatched} fields | ${roundsInserted} rounds${status === "partial" ? " | funding withheld (low confidence)" : ""}`
      : status === "low_confidence"
      ? ` | confidence < ${MIN_CONFIDENCE}`
      : "";

    console.log(
      `    → [${idx}/${fullQueue.length}] ${row.name} | Tier ${tier} | Engine: ${engineLabel()} | ${STATUS_ICON[status]} ${status.replace("_", " ")}${detail}`,
    );

    if (i < queue.length - 1) {
      console.log(`    ⏳  Waiting ${DELAY_MS / 1000}s…`);
      await sleep(DELAY_MS);
    }
  }

  // ── 6. Refresh the Startups Hub's materialized search view ─────────────────
  // startups_search (used by the Private Market page) is refreshed on a
  // 15-min pg_cron schedule; this call makes today's writes visible there
  // immediately instead of waiting for the next tick.
  if (!DRY_RUN && (totalFieldsPatched > 0 || totalRoundsInserted > 0 || totalRemovedPublic > 0)) {
    const { error: refreshErr } = await supabase.rpc("refresh_startups_search");
    if (refreshErr) console.warn(`⚠️  startups_search refresh failed: ${refreshErr.message}`);
    else console.log("🔄  startups_search refreshed");
  }

  // ── 7. Final summary ──────────────────────────────────────────────────────
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const mm = Math.floor(elapsedMs / 60_000);
  const ss = Math.floor((elapsedMs % 60_000) / 1000);

  console.log(`\n${bar}`);
  console.log("BULK ENRICHMENT SUMMARY");
  console.log(bar);
  console.log(`  Companies processed:    ${queue.length}  (range: [${OFFSET + 1}–${queueEnd}] of ${fullQueue.length})`);
  console.log(`  ✅  Success:             ${tally.success}`);
  console.log(`  🟠  Partial:             ${tally.partial}  (profile written, funding withheld — confidence < ${MIN_CONFIDENCE})`);
  console.log(`  ⚠️   Low confidence:     ${tally.low_confidence}  (nothing usable found — score < ${MIN_CONFIDENCE})`);
  console.log(`  🚫  Rejected:            ${tally.rejected}  (not a tech company)`);
  console.log(`  🗑️   Removed (public):   ${tally.removed_public}  (${totalRemovedPublic} row(s) actually deleted)`);
  console.log(`  🔍  No data:             ${tally.no_data}`);
  console.log(`  👻  Stealth suspected:   ${tally.stealth_suspected}  (repeat miss — already enriched once before, still nothing usable)`);
  console.log(`  ❌  Errors:              ${tally.error}`);
  console.log(`  💰  Rounds inserted:     ${totalRoundsInserted}`);
  console.log(`  📝  Profile fields set:  ${totalFieldsPatched}`);
  console.log(`  🔌  Tavily calls used:   ${tavilyCallCount} / ${TAVILY_BUDGET}`);
  if (serperCallCount > 0) {
    console.log(`  🔍  Serper calls used:   ${serperCallCount}`);
  }
  const claudeCost = totalInputTokens * PRICING.input + totalOutputTokens * PRICING.output;
  console.log(`  🧠  Claude tokens:       ${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out`);
  console.log(`  💵  Claude cost (est.):  $${claudeCost.toFixed(2)}  (${MODEL} @ $${(PRICING.input * 1_000_000).toFixed(2)}/$${(PRICING.output * 1_000_000).toFixed(2)} per MTok — search API cost is separate)`);
  if (queue.length > 0) {
    const perCompany = claudeCost / queue.length;
    console.log(`      → $${perCompany.toFixed(4)}/company → ~$${(perCompany * fullQueue.length).toFixed(0)} projected for all ${fullQueue.length} in the current queue`);
  }
  console.log(`  ⏱️   Elapsed:             ${mm}m ${ss}s`);

  if (DRY_RUN) {
    console.log(`\n  ℹ️  DRY RUN — rerun with DRY_RUN=false to apply writes.`);
  }

  if (queueEnd < fullQueue.length) {
    const remaining = fullQueue.length - queue.length;
    console.log(`\n  ▶️  ~${remaining} companies still waiting in the queue.`);
    console.log(`     Re-run with the SAME settings (keep OFFSET=0) — processed companies`);
    console.log(`     are stamped with last_enriched_at and move behind the untouched ones.`);
  } else {
    console.log(`\n  🏁  All ${fullQueue.length} companies in the full queue have been processed.`);
  }

  console.log(bar + "\n");

  if (tally.error > 0 && tally.success === 0 && tally.low_confidence === 0 && tally.stealth_suspected === 0) process.exit(1);
}

main().catch((e) => {
  console.error("💥  Fatal error:", e);
  process.exit(1);
});
