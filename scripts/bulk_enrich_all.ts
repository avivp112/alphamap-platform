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
 *   needed, so both primary and fallback can fire 4 searches in parallel per company.
 *   Set SERP_KEY (Serper API key). TAVILY_API_KEY is optional; if absent, Serper is used
 *   for everything.
 *
 * Resume / skip logic:
 *   MAX_TIER (default 3) — set to 2 to skip Tier 3 (fully-complete) companies and focus
 *   only on companies that actually need enrichment. Use after a partial run to avoid
 *   spending credits re-researching companies already enriched.
 *   OFFSET + BATCH_SIZE still apply within the filtered queue.
 *
 * Write strategy (enforced by code, not just prompt):
 *   All tiers   — only fills NULL profile fields (never overwrites existing non-null values)
 *                 always refreshes employee_count + growth_trend (time-varying metrics)
 *                 merges founders as a union (additive, never destructive)
 *                 appends new funding rounds with dedup (same type + date ±6 months)
 *                 sets leadership only when currently NULL
 *   Tier 3      — identical rule: since profile is complete, only headcount/growth_trend
 *                 are refreshed; everything else is fill-NULL only
 *   Confidence  — SKIPS ALL WRITES if confidence_score < MIN_CONFIDENCE (default: 40)
 *                 Logged as "Low Confidence" for later manual review
 *
 * Usage:
 *   npx tsx scripts/bulk_enrich_all.ts                              # dry run (default)
 *   DRY_RUN=false npx tsx scripts/bulk_enrich_all.ts
 *   DRY_RUN=false BATCH_SIZE=300 OFFSET=0   npx tsx scripts/bulk_enrich_all.ts
 *   DRY_RUN=false BATCH_SIZE=300 OFFSET=300 npx tsx scripts/bulk_enrich_all.ts
 *   DRY_RUN=false BATCH_SIZE=300 OFFSET=600 npx tsx scripts/bulk_enrich_all.ts
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
  founders: string[] | null;
  leadership: Array<{ name: string; role: string }> | null;
  updated_at: string;
}

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
}

interface ExtractedRound {
  round_type: string;
  amount_raised?: number | null;
  valuation?: number | null;
  is_valuation_estimated?: boolean;
  date?: string | null;
  lead_investor?: string | null;
  other_investors?: string[] | null;
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

interface EnrichmentResult {
  is_public_company: boolean;
  is_tech_company: boolean;
  profile: ExtractedProfile;
  funding_rounds: ExtractedRound[];
  leadership: ExtractedLeader[];
  metrics: { headcount: number | null; growth_trend: string | null };
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

function classifyTier(row: StartupRow, rounds: FundingRoundRow[]): 1 | 2 | 3 {
  const realRounds = hasRealRounds(rounds);
  // Tier 1: no profile data AND no real funding round history
  if (!row.description && !row.employee_count && !realRounds) return 1;
  // Tier 3: has description + employee_count + at least one real round
  if (row.description && row.employee_count && realRounds) return 3;
  // Tier 2: has some data but key fields are missing
  return 2;
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
  const [historyRaw, amountsRaw, backersRaw, profileRaw] = await Promise.all([
    webSearch(`"${name}" complete funding history all rounds Seed "Series A" "Series B" site:crunchbase.com OR site:techcrunch.com OR site:pitchbook.com`),
    webSearch(`"${name}" funding raised USD million billion amount valuation announcement date 2019 2020 2021 2022 2023 2024 2025`),
    webSearch(`"${name}" lead investor venture capital backed participated investors funded round`),
    webSearch(`"${name}" company founder CEO CTO description industry headquarters country city employees headcount 2024 2025`),
  ]);

  if (![historyRaw, amountsRaw, backersRaw, profileRaw].some(Boolean)) return null;

  const context = [
    `## Funding History (all rounds)\n${historyRaw  ?? "(search failed)"}`,
    `## Round Amounts & Valuations\n${amountsRaw    ?? "(search failed)"}`,
    `## Investors & Backers\n${backersRaw            ?? "(search failed)"}`,
    `## Company Profile & Headcount\n${profileRaw   ?? "(search failed)"}`,
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
              description:  { type: "string",  description: "3-4 sentences: what it does, who it serves, key differentiator." },
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
                description: "Best available total employee count as a plain integer. Omit if unknown.",
              },
              growth_trend: {
                type: "string",
                enum: ["rapid growth","moderate growth","stable","reduction","unknown"],
                description: "12-month headcount trend based on LinkedIn / job-posting signals.",
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
7. HEADCOUNT — most recent available figure. growth_trend reflects 12-month direction.
8. VERIFY BEFORE ADDING — omit anything unconfirmable. Return [] for rounds rather than guess.
9. CONFIDENCE — score honestly and conservatively. Penalise for missing amounts, dates, investor names, or conflicting sources.
10. PRIVACY — if this company has IPO'd or is publicly traded, set is_public_company: true.

Research data:
${context}`,
    }],
  });

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") return null;

  const i = tool.input as Partial<EnrichmentResult> & {
    profile?: Partial<ExtractedProfile>;
    metrics?: { headcount?: number; growth_trend?: string };
  };

  return {
    is_public_company: i.is_public_company ?? false,
    is_tech_company:   i.is_tech_company   ?? true,
    profile:           i.profile           ?? {},
    funding_rounds:    (i.funding_rounds   ?? []).filter((r) => r.round_type),
    leadership:        i.leadership        ?? [],
    metrics: {
      headcount:    i.metrics?.headcount    ?? null,
      growth_trend: i.metrics?.growth_trend ?? null,
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

    if (DRY_RUN) {
      const leadStr = lead ? ` | ${lead}${others.length > 0 ? ` +${others.length}` : ""}` : "";
      console.log(`    [DRY] ${roundType} | ${announcedDate ?? "no date"} | ${amt}${leadStr}`);
      inserted++;
      seen.push({
        id: "dry", startup_id: startupId, round_type: roundType,
        amount_raised: null, valuation: null, is_valuation_estimated: null,
        announcement_date: announcedDate, source_url: null,
        lead_investor: null, investors: null,
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
    });

    if (error) {
      console.warn(`    ⚠️  Round insert failed (${roundType}): ${error.message}`);
    } else {
      const leadStr = lead ? ` | ${lead}${others.length > 0 ? ` +${others.length}` : ""}` : "";
      console.log(`    💰  ${roundType} | ${announcedDate ?? "no date"} | ${amt}${leadStr}`);
      inserted++;
      seen.push({
        id: "new", startup_id: startupId, round_type: roundType,
        amount_raised: round.amount_raised ?? null, valuation: round.valuation ?? null,
        is_valuation_estimated: isEst,
        announcement_date: announcedDate, source_url: null,
        lead_investor: lead, investors: allInv.length > 0 ? allInv : null,
      });
    }
  }

  return { inserted, skipped };
}

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

  // Founders: merge as union (additive, never destructive)
  const cleanFounders = (profile.founders ?? []).map(String).filter((f) => f.trim());
  if (cleanFounders.length > 0) {
    const merged = [...new Set([...(existing.founders ?? []), ...cleanFounders])];
    if (merged.length > (existing.founders?.length ?? 0)) patch.founders = merged;
  }

  // Leadership: set only when currently NULL (Tier 3 strategy: no blind overwrites)
  if (leadership.length > 0 && (!existing.leadership || existing.leadership.length === 0)) {
    patch.leadership = leadership;
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
  const profileKeys = ["website","description","industry","founded_year","country","city","founders"]
    .filter((k) => patch[k] !== undefined);
  if (profileKeys.length > 0) parts.push(`profile: ${profileKeys.join(", ")}`);
  if (parts.length > 0) console.log(`    👤  Patched: ${parts.join(" | ")}`);

  return { fieldsPatched: Object.keys(patch).length };
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

  // ── 1. Fetch all startups + all rounds in one shot ────────────────────────
  const [{ data: startupData, error: sErr }, { data: roundData, error: rErr }] =
    await Promise.all([
      supabase
        .from("startups")
        .select("id, name, website, description, industry, founded_year, employee_count, growth_trend, country, city, founders, leadership, updated_at")
        .order("name"),
      supabase
        .from("funding_rounds")
        .select("id, startup_id, round_type, amount_raised, valuation, is_valuation_estimated, announcement_date, source_url, lead_investor, investors"),
    ]);

  if (sErr) { console.error("❌  startups fetch failed:", sErr.message); process.exit(1); }
  if (rErr) { console.error("❌  funding_rounds fetch failed:", rErr.message); process.exit(1); }

  const startups  = (startupData ?? []) as StartupRow[];
  const allRounds = (roundData   ?? []) as FundingRoundRow[];

  const roundsByStartup = new Map<string, FundingRoundRow[]>();
  for (const r of allRounds) {
    const arr = roundsByStartup.get(r.startup_id) ?? [];
    arr.push(r);
    roundsByStartup.set(r.startup_id, arr);
  }

  // ── 2. Classify every startup ─────────────────────────────────────────────
  const tier1: StartupRow[] = [];
  const tier2: StartupRow[] = [];
  const tier3: StartupRow[] = [];

  for (const row of startups) {
    const rounds = roundsByStartup.get(row.id) ?? [];
    const t = classifyTier(row, rounds);
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

  const fullQueue = eligibleQueue;
  const queue     = fullQueue.slice(OFFSET, OFFSET + BATCH_SIZE);
  const queueEnd  = OFFSET + queue.length;

  if (queue.length === 0) {
    console.log("\n✅  Queue is empty after OFFSET/BATCH_SIZE/MAX_TIER filter. Nothing to process.\n");
    return;
  }

  const tavilyCompanies = Math.floor(TAVILY_BUDGET / 4);
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
    ].filter(Boolean);
    if (missingFields.length > 0) {
      console.log(`    Missing: ${missingFields.join(", ")}`);
    }

    let status: ProcessStatus = "error";
    let roundsInserted = 0;
    let fieldsPatched  = 0;

    try {
      const result = await researchCompany(row.name);

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
    const nextOffset = queueEnd;
    console.log(`\n  ▶️  To continue:  OFFSET=${nextOffset} BATCH_SIZE=${BATCH_SIZE <= 9999 ? BATCH_SIZE : 300}`);
    console.log(`                   DRY_RUN=false OFFSET=${nextOffset} BATCH_SIZE=${BATCH_SIZE <= 9999 ? BATCH_SIZE : 300} npx tsx scripts/bulk_enrich_all.ts`);
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
