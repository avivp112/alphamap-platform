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
 *   needed, so both primary and fallback can fire 5 searches in parallel per company
 *   (funding history, amounts, investors, profile/headcount, competitors).
 *   Set SERP_KEY (Serper API key). TAVILY_API_KEY is optional; if absent, Serper is used
 *   for everything.
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
 *   Confidence  — SKIPS ALL WRITES if confidence_score < MIN_CONFIDENCE (default: 40)
 *                 Logged as "Low Confidence" for later manual review
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
  founders: Array<{ name: string; linkedin_url: string | null }> | null;
  leadership: Array<{ name: string; role: string; linkedin_url?: string | null }> | null;
  competitors: Competitor[] | null;
  acquisitions: Acquisition[] | null;
  patent_count: number | null;
  patent_fields: string[] | null;
  updated_at: string;
  last_enriched_at: string | null;
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

interface ExtractedProfile {
  website?: string;
  description?: string;
  industry?: string;
  founded_year?: number;
  country?: string;
  city?: string;
  founders?: string[];
}

interface ExtractedLeader { name: string; role: string }

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
  funding_rounds: ExtractedRound[];
  leadership: ExtractedLeader[];
  metrics: {
    headcount: number | null;
    growth_trend: string | null;
    headcount_history: ExtractedHeadcountPoint[];
  };
  competitors: ExtractedCompetitor[];
  acquisitions: ExtractedAcquisition[];
  patents: { patent_count: number | null; patent_fields: string[] };
  confidence_score: number;
  reasoning: string;
  source_url: string;
}

type ProcessStatus = "success" | "low_confidence" | "rejected" | "no_data" | "error";

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
  if (/bootstrap/.test(s))                                        return "Bootstrapped";
  if (/\bgrant\b/.test(s))                                        return "Grant";
  if (/acqui|merg/.test(s))                                       return "Acquired";
  if (/\bipo\b|\bpublic\b|nyse|nasdaq/.test(s))                   return "IPO";
  return "Other";
}

function hasRealRounds(rounds: Pick<FundingRoundRow, "round_type">[]): boolean {
  return rounds.some((r) => r.round_type && r.round_type !== "Other");
}

function hasCompetitors(row: Pick<StartupRow, "competitors">): boolean {
  return Array.isArray(row.competitors) && row.competitors.length > 0;
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
      console.warn(`    ⚠️  Serper HTTP ${res.status}`);
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

// ── Claude: extract complete company profile in one call ──────────────────────
async function researchCompany(name: string): Promise<EnrichmentResult | null> {
  const [historyRaw, amountsRaw, backersRaw, profileRaw, competitorsRaw] = await Promise.all([
    webSearch(`"${name}" complete funding history all rounds Seed "Series A" "Series B" site:crunchbase.com OR site:techcrunch.com OR site:pitchbook.com`),
    webSearch(`"${name}" funding raised USD million billion amount valuation announcement date 2019 2020 2021 2022 2023 2024 2025`),
    webSearch(`"${name}" lead investor venture capital backed participated investors funded round investment amount check size`),
    webSearch(`"${name}" company founder CEO CTO description industry headquarters country city employees headcount acquired acquisition patents intellectual property 2024 2025`),
    webSearch(`"${name}" competitors alternatives vs rivals "compared to" market landscape`),
  ]);

  if (![historyRaw, amountsRaw, backersRaw, profileRaw, competitorsRaw].some(Boolean)) return null;

  const context = [
    `## Funding History (all rounds)\n${historyRaw  ?? "(search failed)"}`,
    `## Round Amounts & Valuations\n${amountsRaw    ?? "(search failed)"}`,
    `## Investors & Backers\n${backersRaw            ?? "(search failed)"}`,
    `## Company Profile & Headcount\n${profileRaw   ?? "(search failed)"}`,
    `## Competitors & Alternatives\n${competitorsRaw ?? "(search failed)"}`,
  ].join("\n\n");

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
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
            description: "TRUE for Software, SaaS, AI/ML, Cybersecurity, FinTech, Biotech, Hardware, EdTech, CleanTech, etc.",
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
                items: { type: "string" },
                description: "Full legal names of ALL founders/co-founders.",
              },
            },
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
                    "Convertible Note","Bootstrapped","Grant","Acquired","Other",
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
            description: "Current C-level executives and founders. Named, verifiable individuals only.",
            items: {
              type: "object" as const,
              properties: {
                name: { type: "string", description: "Full name." },
                role: { type: "string", description: "Current title (CEO, CTO, Co-Founder, etc.)." },
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
          patents: {
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
2. AMOUNTS — plain USD integers ($1.5B → 1500000000, $50M → 50000000). Omit if unverifiable.
3. LEAD INVESTOR — one lead per round in lead_investor; all others in other_investors.
4. VALUATION — set is_valuation_estimated: true if inferred or not officially disclosed.
5. DATES — YYYY-MM-DD; use YYYY-01-01 when only the year is known.
6. FOUNDERS — full legal names only. Distinguish founders from hired executives.
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
14. PATENTS — best-effort only. Omit patent_count/patent_fields entirely unless you find real evidence
    (an IP page, a news article, Google Patents). Never default patent_count to 0.

Research data:
${context}`,
    }],
  });

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") return null;

  const i = tool.input as Partial<EnrichmentResult> & {
    profile?: Partial<ExtractedProfile>;
    metrics?: { headcount?: number; growth_trend?: string; headcount_history?: ExtractedHeadcountPoint[] };
    competitors?: ExtractedCompetitor[];
    acquisitions?: ExtractedAcquisition[];
    patents?: { patent_count?: number; patent_fields?: string[] };
  };

  return {
    is_public_company: i.is_public_company ?? false,
    is_tech_company:   i.is_tech_company   ?? true,
    profile:           i.profile           ?? {},
    funding_rounds:    (i.funding_rounds   ?? []).filter((r) => r.round_type),
    leadership:        i.leadership        ?? [],
    metrics: {
      headcount:         i.metrics?.headcount         ?? null,
      growth_trend:      i.metrics?.growth_trend      ?? null,
      headcount_history: (i.metrics?.headcount_history ?? []).filter((p) => p.date && p.employee_count != null),
    },
    competitors:      (i.competitors  ?? []).filter((c) => c.name && c.how_it_competes),
    acquisitions:     (i.acquisitions ?? []).filter((a) => a.company_name),
    patents: {
      patent_count:  typeof i.patents?.patent_count === "number" ? i.patents.patent_count : null,
      patent_fields: (i.patents?.patent_fields ?? []).filter(Boolean),
    },
    confidence_score: typeof i.confidence_score === "number" ? i.confidence_score : 0,
    reasoning:        i.reasoning  ?? "",
    source_url:       i.source_url ?? "",
  };
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
): Promise<{ fieldsPatched: number }> {
  const { profile, metrics, leadership } = result;
  const patch: Record<string, unknown> = {};

  // Profile fields: fill NULL slots only (safe for all tiers including Tier 3)
  if (!existing.website      && profile.website)      patch.website      = profile.website;
  if (!existing.description  && profile.description)  patch.description  = profile.description;
  if (!existing.industry     && profile.industry)     patch.industry     = profile.industry;
  if (!existing.founded_year && profile.founded_year) patch.founded_year = profile.founded_year;
  if (!existing.country      && profile.country)      patch.country      = profile.country;
  if (!existing.city         && profile.city)         patch.city         = profile.city;

  // Founders: merge as union (additive, never destructive), deduped by name.
  // Newly-extracted founders have no linkedin_url source yet, so it's null
  // until a future enrichment pass fills it in.
  const cleanFounderNames = (profile.founders ?? []).map(String).filter((f) => f.trim());
  if (cleanFounderNames.length > 0) {
    const existingFounders = existing.founders ?? [];
    const existingNames = new Set(existingFounders.map((f) => f.name.toLowerCase()));
    const newFounders = cleanFounderNames
      .filter((name) => !existingNames.has(name.toLowerCase()))
      .map((name) => ({ name, linkedin_url: null }));
    if (newFounders.length > 0) patch.founders = [...existingFounders, ...newFounders];
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

  // Patents: fill-null only, same as the rest of the profile block.
  if (existing.patent_count == null && result.patents.patent_count != null) {
    patch.patent_count = result.patents.patent_count;
  }
  if ((!existing.patent_fields || existing.patent_fields.length === 0) && result.patents.patent_fields.length > 0) {
    patch.patent_fields = result.patents.patent_fields;
  }

  // Headcount + growth_trend: always refresh (time-varying — valid for all tiers)
  if (metrics.headcount    != null) patch.employee_count = metrics.headcount;
  if (metrics.growth_trend != null) patch.growth_trend   = metrics.growth_trend;

  if (Object.keys(patch).length === 0) return { fieldsPatched: 0 };

  if (DRY_RUN) {
    console.log(`    [DRY] Would patch: ${Object.keys(patch).join(", ")}`);
    return { fieldsPatched: Object.keys(patch).length };
  }

  const { error } = await supabase.from("startups").update(patch).eq("id", existing.id);
  if (error) {
    console.warn(`    ⚠️  Profile patch failed: ${error.message}`);
    return { fieldsPatched: 0 };
  }

  const parts: string[] = [];
  if (patch.employee_count) parts.push(`~${metrics.headcount?.toLocaleString()} employees`);
  if (patch.growth_trend)   parts.push(`trend: ${metrics.growth_trend}`);
  if (patch.leadership)     parts.push(`${leadership.length} leaders`);
  if (patch.competitors)    parts.push(`${(patch.competitors as Competitor[]).length} competitors`);
  if (patch.acquisitions)   parts.push(`${(patch.acquisitions as Acquisition[]).length} acquisitions`);
  if (patch.patent_count != null) parts.push(`${patch.patent_count} patents`);
  const profileKeys = ["website","description","industry","founded_year","country","city","founders"]
    .filter((k) => patch[k] !== undefined);
  if (profileKeys.length > 0) parts.push(`profile: ${profileKeys.join(", ")}`);
  if (parts.length > 0) console.log(`    👤  Patched: ${parts.join(" | ")}`);

  return { fieldsPatched: Object.keys(patch).length };
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
// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date().toISOString();
  const bar       = "═".repeat(62);

  console.log(`╔${"═".repeat(62)}╗`);
  console.log(`║${"  AlphaMap — Bulk Full-Database Enrichment Run".padEnd(62)}║`);
  console.log(`║  ${startedAt}${"".padEnd(62 - 2 - startedAt.length)}║`);
  console.log(`║  DRY_RUN=${String(DRY_RUN).padEnd(5)} | BATCH=${String(BATCH_SIZE).padEnd(6)} | OFFSET=${String(OFFSET).padEnd(5)} | DELAY=${DELAY_MS / 1000}s${" ".padEnd(62 - 58)}║`);
  console.log(`║  TAVILY_BUDGET=${String(TAVILY_BUDGET).padEnd(5)} | MIN_CONFIDENCE=${String(MIN_CONFIDENCE).padEnd(17)}║`);
  console.log(`╚${"═".repeat(62)}╝\n`);

  if (DRY_RUN) console.log("ℹ️  DRY RUN — set DRY_RUN=false to apply writes to the database.\n");

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
      .select("id, name, website, description, industry, founded_year, employee_count, growth_trend, country, city, founders, leadership, competitors, acquisitions, patent_count, patent_fields, updated_at, last_enriched_at")
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
    success: 0, low_confidence: 0, rejected: 0, no_data: 0, error: 0,
  };
  let totalRoundsInserted = 0;
  let totalFieldsPatched  = 0;

  const STATUS_ICON: Record<ProcessStatus, string> = {
    success:        "✅",
    low_confidence: "⚠️ ",
    rejected:       "🚫",
    no_data:        "🔍",
    error:          "❌",
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
    ].filter(Boolean);
    if (missingFields.length > 0) {
      console.log(`    Missing: ${missingFields.join(", ")}`);
    }

    let status: ProcessStatus = "error";
    let roundsInserted = 0;
    let fieldsPatched  = 0;
    let confidenceSeen: number | null = null;

    try {
      const result = await researchCompany(row.name);
      if (result) confidenceSeen = result.confidence_score;

      if (!result) {
        // All four searches failed
        console.log(`    🔍  All searches failed — no data retrieved`);
        status = "no_data";

      } else if (result.is_public_company) {
        console.log(`    🚫  REJECTED — publicly traded company (privacy rule)`);
        status = "rejected";

      } else if (!result.is_tech_company) {
        console.log(`    🚫  REJECTED — not a tech company`);
        status = "rejected";

      } else if (result.confidence_score < MIN_CONFIDENCE) {
        const icon = result.confidence_score >= 30 ? "🟠" : "🔴";
        console.log(`    ${icon}  LOW CONFIDENCE ${result.confidence_score}/100 — skipping writes`);
        console.log(`    📝  ${result.reasoning}`);
        status = "low_confidence";

      } else {
        // ── Confident result: apply writes ──────────────────────────────────
        const scoreIcon =
          result.confidence_score >= 90 ? "🟢" :
          result.confidence_score >= 70 ? "🟡" : "🟠";
        console.log(`    ${scoreIcon}  Confidence: ${result.confidence_score}/100 | ${result.funding_rounds.length} round(s) found`);
        if (result.reasoning) console.log(`    📝  ${result.reasoning}`);

        const profileResult = await patchStartupProfile(row, result);
        fieldsPatched  = profileResult.fieldsPatched;

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


        const roundResult = await insertNewRounds(
          row.id, result.funding_rounds, rounds, result.source_url || undefined,
        );
        roundsInserted = roundResult.inserted;

        totalRoundsInserted += roundsInserted;
        totalFieldsPatched  += fieldsPatched;
        status = "success";
      }
    } catch (err) {
      console.error(`    ❌  Unhandled error: ${String(err)}`);
      status = "error";
    }

    tally[status]++;

    // Stamp every processed company so the queue advances across runs.
    // Hard errors are left unstamped so a transient failure is retried at
    // the front of the next run instead of being buried.
    if (status !== "error" && !DRY_RUN) {
      const stamp: Record<string, unknown> = { last_enriched_at: new Date().toISOString() };
      if (confidenceSeen != null) stamp.enrichment_confidence = confidenceSeen;
      const { error: stampErr } = await supabase.from("startups").update(stamp).eq("id", row.id);
      if (stampErr) console.warn(`    ⚠️  last_enriched_at stamp failed: ${stampErr.message}`);
    }

    // ── Summary line in the requested format ─────────────────────────────────
    const detail = status === "success"
      ? ` | ${fieldsPatched} fields | ${roundsInserted} rounds`
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

  // ── 6. Final summary ──────────────────────────────────────────────────────
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const mm = Math.floor(elapsedMs / 60_000);
  const ss = Math.floor((elapsedMs % 60_000) / 1000);

  console.log(`\n${bar}`);
  console.log("BULK ENRICHMENT SUMMARY");
  console.log(bar);
  console.log(`  Companies processed:    ${queue.length}  (range: [${OFFSET + 1}–${queueEnd}] of ${fullQueue.length})`);
  console.log(`  ✅  Success:             ${tally.success}`);
  console.log(`  ⚠️   Low confidence:     ${tally.low_confidence}  (score < ${MIN_CONFIDENCE} — skipped)`);
  console.log(`  🚫  Rejected:            ${tally.rejected}  (public company / non-tech)`);
  console.log(`  🔍  No data:             ${tally.no_data}`);
  console.log(`  ❌  Errors:              ${tally.error}`);
  console.log(`  💰  Rounds inserted:     ${totalRoundsInserted}`);
  console.log(`  📝  Profile fields set:  ${totalFieldsPatched}`);
  console.log(`  🔌  Tavily calls used:   ${tavilyCallCount} / ${TAVILY_BUDGET}`);
  if (serperCallCount > 0) {
    console.log(`  🔍  Serper calls used:   ${serperCallCount}`);
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

  if (tally.error > 0 && tally.success === 0 && tally.low_confidence === 0) process.exit(1);
}

main().catch((e) => {
  console.error("💥  Fatal error:", e);
  process.exit(1);
});
