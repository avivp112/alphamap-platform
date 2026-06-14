#!/usr/bin/env node
/**
 * enrich_funding_rounds.ts — two-phase funding rounds sync & enrichment
 *
 * Phase 1 · Integrity Sync
 *   Every startup with zero funding_rounds rows gets a single stub row
 *   { round_type: "Other" } so no company is orphaned in the UI.
 *
 * Phase 2 · Financial Enrichment
 *   Startups whose only rounds are "Other" stubs (no named Seed / Series /
 *   Growth rounds) are researched via Tavily → DuckDuckGo → Claude Haiku.
 *   Claude returns ALL discovered rounds as a structured array.
 *   Each round is inserted after a deduplication check (same round_type +
 *   announcement_date within ±6 months = duplicate, skip).
 *
 * Usage:
 *   npx tsx scripts/enrich_funding_rounds.ts            # dry run (default)
 *   DRY_RUN=false npx tsx scripts/enrich_funding_rounds.ts
 *
 * GitHub Actions: see .github/workflows/enrich-funding-rounds.yml
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { search as duckSearch } from "duck-duck-scrape";
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"]) {
  if (!process.env[key]) { console.error(`❌  Missing: ${key}`); process.exit(1); }
}
if (!process.env.TAVILY_API_KEY) {
  console.warn("⚠️  TAVILY_API_KEY not set — DuckDuckGo will be used for all searches.\n");
}

let BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 50);
let DELAY_MS   = Number(process.env.DELAY_MS   ?? 15_000);
const DRY_RUN         = process.env.DRY_RUN !== "false";      // safe default: dry run
const TARGET_COMPANY  = process.env.TARGET_COMPANY?.trim() ?? null; // force a single company

const supabase  = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Types ─────────────────────────────────────────────────────────────────────
interface StartupRow      { id: string; name: string }
interface FundingRoundRow {
  id: string; startup_id: string; round_type: string | null;
  amount_raised: number | null; valuation: number | null;
  is_valuation_estimated: boolean | null;
  announcement_date: string | null; source_url: string | null;
  lead_investor: string | null; investors: string[] | null;
}

interface ClaudeRound {
  round_type: string;
  amount_raised?: number | null;
  valuation?: number | null;
  is_valuation_estimated?: boolean;
  date?: string | null;              // YYYY-MM-DD → announcement_date on insert
  lead_investor?: string | null;
  other_investors?: string[] | null;
  source_url?: string | null;
}

interface ClaudeLeader {
  name: string;
  role: string;
}

interface ClaudeMetrics {
  headcount: number | null;
  growth_trend: string | null;
}

interface EnrichmentResult {
  funding_rounds: ClaudeRound[];
  leadership: ClaudeLeader[];
  metrics: ClaudeMetrics;
  confidence_score: number;
  reasoning: string;
  source_url: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function normalizeRoundType(raw: string): string {
  if (!raw) return "Other";
  const s = raw.toLowerCase().trim();
  if (/pre.?seed/.test(s))                              return "Pre-Seed";
  if (/\bseed\b/.test(s) && !/series/.test(s))          return "Seed";
  if (/series\s*a\b/.test(s))                           return "Series A";
  if (/series\s*b\b/.test(s))                           return "Series B";
  if (/series\s*c\b/.test(s))                           return "Series C";
  if (/series\s*d\b/.test(s))                           return "Series D";
  if (/series\s*[e-z+]/.test(s) || /late.?stage/.test(s)) return "Series E+";
  if (/\bgrowth\b/.test(s) || /expansion/.test(s))      return "Growth";
  if (/bridge/.test(s))                                 return "Bridge";
  if (/convertible|safe\b|\bnote\b/.test(s))            return "Convertible Note";
  if (/bootstrap/.test(s))                              return "Bootstrapped";
  if (/\bgrant\b/.test(s))                              return "Grant";
  if (/acqui|merg/.test(s))                             return "Acquired";
  if (/\bipo\b|\bpublic\b|nyse|nasdaq/.test(s))         return "IPO";
  return "Other";
}

// Returns true if rounds contain no named series (only "Other" stubs)
function needsEnrichment(rounds: Pick<FundingRoundRow, "round_type">[]): boolean {
  return rounds.every((r) => !r.round_type || r.round_type === "Other");
}

// ── Search stack (Tavily → DuckDuckGo) ───────────────────────────────────────
let tavilyExhausted = !process.env.TAVILY_API_KEY;

async function tavilySearch(query: string, attempt = 0): Promise<string | null> {
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
    if (res.status === 401 || res.status === 402 || res.status === 432) {
      console.warn(`    ⚠️  Tavily HTTP ${res.status} — switching to DuckDuckGo.`);
      tavilyExhausted = true;
      return null;
    }
    if (res.status === 429 && attempt < 3) {
      await sleep(15_000 * 2 ** attempt);
      return tavilySearch(query, attempt + 1);
    }
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    const parts: string[] = [];
    if (data.answer) parts.push(`Summary: ${data.answer}`);
    for (const r of (data.results as Array<Record<string, string>> ?? []))
      parts.push(`[${r.title}]\n${r.url}\n${String(r.content ?? "").slice(0, 600)}`);
    return parts.length ? parts.join("\n---\n") : null;
  } catch { return null; }
}

const DDG_INTERVAL_MS = 12_000;
let _ddgLock = Promise.resolve<void>(undefined);

async function fallbackSearch(query: string): Promise<string | null> {
  const waitFor = _ddgLock;
  let releaseNext!: () => void;
  _ddgLock = new Promise<void>((r) => (releaseNext = r));
  await waitFor;
  try {
    const results = await duckSearch(query, { safeSearch: -2 });
    if (!results?.results?.length) return null;
    return results.results.slice(0, 6)
      .map((r) => `[${r.title}]\n${r.url}\n${(r.description ?? "").slice(0, 500)}`)
      .join("\n---\n") || null;
  } catch (err) {
    console.warn(`    ⚠️  DuckDuckGo failed: ${String(err)}`);
    return null;
  } finally {
    await sleep(DDG_INTERVAL_MS);
    releaseNext();
  }
}

async function webSearch(query: string): Promise<string | null> {
  if (!tavilyExhausted) {
    const r = await tavilySearch(query);
    if (r !== null) return r;
  }
  console.warn(`    ↩️  DDG: "${query.slice(0, 60)}…"`);
  return fallbackSearch(query);
}

// ── Claude: extract complete company profile (funding + leadership + HR) ──────
async function researchCompanyProfile(name: string): Promise<EnrichmentResult> {
  // Four parallel searches: funding history, round amounts/dates, investors, leadership/HR
  const [history, recent, backers, people] = await Promise.all([
    webSearch(`"${name}" complete funding history all rounds Seed "Series A" "Series B" Crunchbase PitchBook`),
    webSearch(`"${name}" funding round amount raised USD million billion announcement date 2020 2021 2022 2023 2024 2025`),
    webSearch(`"${name}" lead investor venture capital investors participated backed funding round`),
    webSearch(`"${name}" CEO CTO founder leadership team executives employees headcount 2024 2025`),
  ]);

  if (!history && !recent && !backers && !people) {
    throw new Error("All four searches failed — skipping");
  }

  const context = [
    `## Complete Funding History (all rounds)\n${history  ?? "(search failed)"}`,
    `## Round Amounts & Dates\n${recent                  ?? "(search failed)"}`,
    `## Investors & Backers\n${backers                   ?? "(search failed)"}`,
    `## Leadership & Headcount\n${people                 ?? "(search failed)"}`,
  ].join("\n\n");

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 3072,
    tools: [{
      name: "save_company_profile",
      description: "Save the complete financial and organisational profile for a private tech startup",
      input_schema: {
        type: "object" as const,
        properties: {
          funding_rounds: {
            type: "array",
            description: [
              "EVERY verified funding round from inception to present, sorted OLDEST → NEWEST.",
              "Never return only the latest round. Never collapse multiple rounds into one.",
              "Return an empty array only if zero rounds can be verified.",
            ].join(" "),
            items: {
              type: "object" as const,
              properties: {
                round_type: {
                  type: "string",
                  enum: [
                    "Pre-Seed", "Seed", "Series A", "Series B", "Series C",
                    "Series D", "Series E+", "Growth", "Bridge",
                    "Convertible Note", "Bootstrapped", "Grant", "Acquired", "Other",
                  ],
                },
                amount_raised: {
                  type: "number",
                  description: "Total USD raised IN THIS ROUND as a plain integer ($50M → 50000000). Omit if unknown.",
                },
                valuation: {
                  type: "number",
                  description: "Post-money valuation in USD as a plain integer. Omit if unknown.",
                },
                is_valuation_estimated: {
                  type: "boolean",
                  description: "true if the valuation was estimated or inferred rather than officially disclosed.",
                },
                date: {
                  type: "string",
                  description: "Public announcement date as YYYY-MM-DD. Use YYYY-01-01 if only the year is known.",
                },
                lead_investor: {
                  type: "string",
                  description: "Full name of the lead investor for this specific round (e.g. 'Sequoia Capital'). Omit if unknown.",
                },
                other_investors: {
                  type: "array",
                  items: { type: "string" },
                  description: "All other participating investors (not the lead). Full firm names. Omit if none known.",
                },
                source_url: {
                  type: "string",
                  description: "Best direct URL for this round — press release, SEC filing, or Crunchbase round page.",
                },
              },
              required: ["round_type"],
            },
          },
          leadership: {
            type: "array",
            description: "Current C-level executives and founders. Include only named, verifiable individuals.",
            items: {
              type: "object" as const,
              properties: {
                name: { type: "string", description: "Full name." },
                role: { type: "string", description: "Current title (e.g. 'CEO', 'CTO', 'Co-Founder')." },
              },
              required: ["name", "role"],
            },
          },
          metrics: {
            type: "object" as const,
            description: "Current HR snapshot.",
            properties: {
              headcount: {
                type: "number",
                description: "Best available total employee count as a plain integer. Omit if unknown.",
              },
              growth_trend: {
                type: "string",
                enum: ["rapid growth", "moderate growth", "stable", "reduction", "unknown"],
                description: "12-month headcount trend based on LinkedIn / job-posting signals.",
              },
            },
          },
          confidence_score: {
            type: "number",
            description: [
              "Integer 0–100 reflecting overall data confidence.",
              "90–100: multiple authoritative sources fully agree on amounts and dates.",
              "70–89: one strong source, no contradictions.",
              "50–69: partial data or minor conflicts.",
              "0–49: mostly inferred — return fewer rounds, not more.",
            ].join(" "),
          },
          reasoning: {
            type: "string",
            description: "2–3 sentences: sources found, details confirmed, why the confidence score was assigned.",
          },
          source_url: {
            type: "string",
            description: "Primary URL for this company's overall funding research.",
          },
        },
        required: ["funding_rounds", "leadership", "metrics", "confidence_score", "reasoning"],
      },
    }],
    tool_choice: { type: "tool", name: "save_company_profile" },
    messages: [{
      role: "user",
      content: `You are a financial data analyst. Extract the COMPLETE verified company profile for the private tech company "${name}".

CRITICAL RULES:
1. RETURN ALL ROUNDS — if the company raised Pre-Seed, Seed, Series A, and Series B, the array MUST contain 4 objects.
2. AMOUNT RAISED — record the USD raised in each individual round as a plain integer ($1.5B → 1500000000, $50M → 50000000).
3. LEAD INVESTOR — identify the primary lead investor per round in lead_investor; put all others in other_investors.
4. VALUATION — set is_valuation_estimated: true if the figure was inferred or not officially disclosed.
5. DATE — public announcement date (YYYY-MM-DD). Use YYYY-01-01 when only the year is known.
6. LEADERSHIP — include current CEO, CTO, CPO, CFO, and founders. Full names and current titles only.
7. HEADCOUNT — use the most recent available figure. growth_trend reflects the 12-month direction.
8. VERIFY BEFORE ADDING — omit anything unconfirmable. Return [] rather than guess funding rounds.
9. CONFIDENCE — score honestly. Penalise for missing amounts, dates, investor names, or source conflicts.

RESPONSE SCHEMA:
{
  "funding_rounds": [
    {
      "round_type": "Seed",
      "amount_raised": 5000000,
      "valuation": 20000000,
      "is_valuation_estimated": false,
      "date": "2019-03-12",
      "lead_investor": "Y Combinator",
      "other_investors": ["Accel", "SV Angel"],
      "source_url": "https://..."
    }
  ],
  "leadership": [
    { "name": "Jane Smith", "role": "CEO" },
    { "name": "Bob Lee",    "role": "CTO" }
  ],
  "metrics": { "headcount": 850, "growth_trend": "moderate growth" },
  "confidence_score": 82,
  "reasoning": "Crunchbase confirms Seed and Series A with amounts and dates. Leadership sourced from LinkedIn. Headcount from LinkedIn badge.",
  "source_url": "https://crunchbase.com/organization/example"
}

Research data:
${context}`,
    }],
  });

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") {
    return {
      funding_rounds: [], leadership: [],
      metrics: { headcount: null, growth_trend: null },
      confidence_score: 0, reasoning: "Claude returned no structured output.", source_url: "",
    };
  }

  const input = tool.input as Partial<EnrichmentResult> & { metrics?: Partial<ClaudeMetrics> };
  return {
    funding_rounds: (input.funding_rounds ?? []).filter((r) => r.round_type),
    leadership:      input.leadership    ?? [],
    metrics: {
      headcount:    input.metrics?.headcount    ?? null,
      growth_trend: input.metrics?.growth_trend ?? null,
    },
    confidence_score: input.confidence_score ?? 0,
    reasoning:        input.reasoning        ?? "(no reasoning provided)",
    source_url:       input.source_url       ?? "",
  };
}

// ── Deduplicate + insert rounds for one startup ───────────────────────────────
async function insertNewRounds(
  startupId: string,
  newRounds: ClaudeRound[],
  existingRounds: FundingRoundRow[],
  fallbackSourceUrl?: string,
): Promise<{ inserted: number; skipped: number }> {
  const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
  let inserted = 0;
  let skipped  = 0;

  const seen = [...existingRounds];

  for (const round of newRounds) {
    const roundType      = normalizeRoundType(round.round_type);
    const announcedDate  = round.date ?? null;              // "date" in schema → announcement_date in DB
    const sourceUrl      = round.source_url ?? fallbackSourceUrl ?? null;

    const isDup = seen.some((e) => {
      if (e.round_type !== roundType) return false;
      if (!e.announcement_date || !announcedDate) return true;
      return Math.abs(
        new Date(e.announcement_date).getTime() -
        new Date(announcedDate).getTime(),
      ) < SIX_MONTHS_MS;
    });

    if (isDup) { skipped++; continue; }

    const displayAmt = round.amount_raised
      ? `$${(round.amount_raised / 1e6).toFixed(0)}M`
      : "amt unknown";

    const leadInvestor   = round.lead_investor ?? null;
    const otherInvestors = round.other_investors ?? [];
    const investors      = [
      ...(leadInvestor ? [leadInvestor] : []),
      ...otherInvestors,
    ].filter(Boolean) as string[];
    const investorsArr      = investors.length > 0 ? investors : null;
    const isValuationEst    = round.is_valuation_estimated ?? false;

    if (DRY_RUN) {
      const leadStr = leadInvestor ? ` | ${leadInvestor}${otherInvestors.length > 0 ? ` +${otherInvestors.length}` : ""}` : "";
      console.log(`    [DRY] ${roundType} | ${announcedDate ?? "no date"} | ${displayAmt}${leadStr}`);
      inserted++;
      seen.push({ id: "dry", startup_id: startupId, round_type: roundType,
        amount_raised: null, valuation: null, is_valuation_estimated: null,
        announcement_date: announcedDate, source_url: null,
        lead_investor: null, investors: null });
      continue;
    }

    const { error } = await supabase.from("funding_rounds").insert({
      startup_id:              startupId,
      round_type:              roundType,
      amount_raised:           round.amount_raised ?? null,
      valuation:               round.valuation     ?? null,
      is_valuation_estimated:  isValuationEst,
      announcement_date:       announcedDate,
      source_url:              sourceUrl,
      lead_investor:           leadInvestor,
      investors:               investorsArr,
    });

    if (error) {
      console.warn(`    ⚠️  Insert failed (${roundType}): ${error.message}`);
    } else {
      const leadStr = leadInvestor ? ` | ${leadInvestor}${otherInvestors.length > 0 ? ` +${otherInvestors.length}` : ""}` : "";
      console.log(`    💰  ${roundType} | ${announcedDate ?? "no date"} | ${displayAmt}${leadStr}`);
      inserted++;
      seen.push({ id: "new", startup_id: startupId, round_type: roundType,
        amount_raised: round.amount_raised ?? null, valuation: round.valuation ?? null,
        is_valuation_estimated: isValuationEst,
        announcement_date: announcedDate, source_url: null,
        lead_investor: leadInvestor, investors: investorsArr });
    }
  }

  return { inserted, skipped };
}

// ── Write leadership + HR metrics back to the startups row ───────────────────
async function upsertStartupProfile(
  startupId: string,
  leadership: ClaudeLeader[],
  metrics: ClaudeMetrics,
): Promise<void> {
  if (DRY_RUN) {
    if (leadership.length > 0) {
      const preview = leadership.slice(0, 3).map((l) => `${l.name} (${l.role})`).join(", ");
      console.log(`    [DRY] Leadership (${leadership.length}): ${preview}${leadership.length > 3 ? " …" : ""}`);
    }
    if (metrics.headcount !== null) {
      console.log(`    [DRY] Headcount: ~${metrics.headcount.toLocaleString()} | Trend: ${metrics.growth_trend ?? "unknown"}`);
    }
    return;
  }

  const updates: Record<string, unknown> = {};
  if (leadership.length > 0)     updates.leadership     = leadership;
  if (metrics.headcount !== null) updates.employee_count = metrics.headcount;
  if (metrics.growth_trend)       updates.growth_trend   = metrics.growth_trend;

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase.from("startups").update(updates).eq("id", startupId);
  if (error) {
    console.warn(`    ⚠️  Profile update failed: ${error.message}`);
  } else {
    const parts: string[] = [];
    if (leadership.length > 0)     parts.push(`${leadership.length} leaders`);
    if (metrics.headcount !== null) parts.push(`~${metrics.headcount.toLocaleString()} employees`);
    console.log(`    👥  Profile updated: ${parts.join(", ")}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║    AlphaMap — Company Profile Sync & Enrichment      ║");
  console.log(`║    ${new Date().toISOString()}           ║`);
  console.log(`║    BATCH=${BATCH_SIZE}  DELAY=${DELAY_MS / 1000}s  DRY_RUN=${String(DRY_RUN).padEnd(27)}║`);
  if (TARGET_COMPANY) {
    console.log(`║    TARGET=${TARGET_COMPANY.padEnd(46)}║`);
  }
  console.log("╚══════════════════════════════════════════════════════╝\n");
  if (DRY_RUN) console.log("ℹ️  DRY RUN — set DRY_RUN=false to apply writes.\n");
  if (TARGET_COMPANY) console.log(`🎯  Targeting single company: "${TARGET_COMPANY}"\n`);

  // ── 1. Fetch all startups + all existing rounds ────────────────────────────
  const [{ data: startupData, error: sErr }, { data: roundData, error: rErr }] =
    await Promise.all([
      supabase.from("startups").select("id, name").order("name"),
      supabase.from("funding_rounds")
              .select("id, startup_id, round_type, amount_raised, valuation, announcement_date, source_url"),
    ]);

  if (sErr) { console.error("❌  startups fetch:", sErr.message); process.exit(1); }
  if (rErr) { console.error("❌  funding_rounds fetch:", rErr.message); process.exit(1); }

  const startups  = (startupData ?? []) as StartupRow[];
  const allRounds = (roundData   ?? []) as FundingRoundRow[];

  // Build lookup: startup_id → its rounds
  const roundsByStartup = new Map<string, FundingRoundRow[]>();
  for (const r of allRounds) {
    const arr = roundsByStartup.get(r.startup_id) ?? [];
    arr.push(r);
    roundsByStartup.set(r.startup_id, arr);
  }

  // ── Diagnostic phase ──────────────────────────────────────────────────────
  const noRounds = startups.filter((s) => !roundsByStartup.has(s.id));
  const needsEnrichCount = startups.filter(
    (s) => needsEnrichment(roundsByStartup.get(s.id) ?? []),
  ).length;

  console.log("── Diagnostic ──────────────────────────────────────────────");
  console.log(`  Total startups:             ${startups.length}`);
  console.log(`  Total funding_rounds rows:  ${allRounds.length}`);
  console.log(`  Startups with 0 rounds:     ${noRounds.length}  ← Phase 1 target`);
  console.log(`  Startups with only stubs:   ${needsEnrichCount}  ← Phase 2 target`);

  if (noRounds.length > 0) {
    console.log("\n  Companies missing from funding_rounds:");
    for (const s of noRounds) {
      console.log(`    • ${s.name}`);
    }
    console.log();
  }

  // Auto-throttle when backlog is large to avoid DDG/Tavily rate-limit blocks
  const LARGE_THRESHOLD = 10;
  if (noRounds.length > LARGE_THRESHOLD) {
    const cappedBatch = Math.min(BATCH_SIZE, 10);
    const cappedDelay = Math.max(DELAY_MS, 10_000);
    if (cappedBatch < BATCH_SIZE || cappedDelay > DELAY_MS) {
      console.log(`⚠️  Large backlog detected (${noRounds.length} companies have no rounds).`);
      console.log(`    Auto-throttling to prevent search API rate-limit blocks:`);
      if (cappedBatch < BATCH_SIZE) console.log(`    BATCH_SIZE: ${BATCH_SIZE} → ${cappedBatch}`);
      if (cappedDelay > DELAY_MS)   console.log(`    DELAY_MS:   ${DELAY_MS / 1000}s → ${cappedDelay / 1000}s`);
      BATCH_SIZE = cappedBatch;
      DELAY_MS   = cappedDelay;
      console.log();
    }
  }
  console.log("─".repeat(58) + "\n");

  // ── Phase 1: Integrity sync ────────────────────────────────────────────────
  console.log("── Phase 1: Integrity Sync ─────────────────────────────");
  console.log(`🔍  Startups with 0 rounds: ${noRounds.length}`);

  let stubsInserted = 0;
  for (const s of noRounds) {
    if (DRY_RUN) {
      console.log(`  [DRY] stub → ${s.name}`);
      roundsByStartup.set(s.id, [{
        id: "stub", startup_id: s.id, round_type: "Other",
        amount_raised: null, valuation: null, is_valuation_estimated: null,
        announcement_date: null, source_url: null,
        lead_investor: null, investors: null,
      }]);
    } else {
      const { error } = await supabase.from("funding_rounds")
        .insert({ startup_id: s.id, round_type: "Other" });
      if (error) {
        console.warn(`  ⚠️  Stub failed for ${s.name}: ${error.message}`);
        continue;
      }
      console.log(`  ✅  Stub inserted: ${s.name}`);
      roundsByStartup.set(s.id, [{
        id: "stub", startup_id: s.id, round_type: "Other",
        amount_raised: null, valuation: null, is_valuation_estimated: null,
        announcement_date: null, source_url: null,
        lead_investor: null, investors: null,
      }]);
    }
    stubsInserted++;
  }
  console.log(`\n  Phase 1 complete — stubs: ${stubsInserted}\n`);

  // ── Phase 2: Company profile enrichment ───────────────────────────────────
  console.log("── Phase 2: Company Profile Enrichment ─────────────────");
  const toEnrich = startups
    .filter((s) => {
      // When a specific company is targeted, bypass the needsEnrichment check
      // so we always run a fresh research pass (good for testing / forced refresh)
      if (TARGET_COMPANY) return s.name.toLowerCase() === TARGET_COMPANY.toLowerCase();
      return needsEnrichment(roundsByStartup.get(s.id) ?? []);
    })
    .slice(0, BATCH_SIZE);

  console.log(`🔬  Startups queued for enrichment: ${toEnrich.length}`);
  if (toEnrich.length === 0) {
    console.log("✅  All startups already have named funding rounds.\n");
  }

  const tally = { enriched: 0, roundsInserted: 0, roundsSkipped: 0, failed: 0 };

  for (let i = 0; i < toEnrich.length; i++) {
    const s = toEnrich[i];
    const existingRounds = roundsByStartup.get(s.id) ?? [];
    console.log(`\n[${i + 1}/${toEnrich.length}] "${s.name}"`);

    let result: EnrichmentResult;
    try {
      result = await researchCompanyProfile(s.name);
    } catch (err) {
      console.warn(`    ⚠️  Research failed: ${String(err)}`);
      tally.failed++;
      if (i < toEnrich.length - 1) await sleep(DELAY_MS);
      continue;
    }

    // ── Management-by-Exception log ──────────────────────────────────────────
    const scoreLabel =
      result.confidence_score >= 90 ? "🟢" :
      result.confidence_score >= 70 ? "🟡" :
      result.confidence_score >= 50 ? "🟠" : "🔴";
    console.log(`    ${scoreLabel} Confidence: ${result.confidence_score}/100`);
    console.log(`    📝 Reasoning: ${result.reasoning}`);
    if (result.source_url) console.log(`    🔗 Source: ${result.source_url}`);
    console.log(`    📊 Funding rounds: ${result.funding_rounds.length} verifiable`);
    if (result.leadership.length > 0) {
      console.log(`    👤 Leadership: ${result.leadership.length} executive(s) found`);
    }
    if (result.metrics.headcount !== null) {
      console.log(`    📈 Headcount: ~${result.metrics.headcount.toLocaleString()} (${result.metrics.growth_trend ?? "trend unknown"})`);
    }

    if (result.funding_rounds.length === 0) {
      console.log("    ℹ️  No verifiable rounds found — stub remains.");
    } else {
      const { inserted, skipped } = await insertNewRounds(
        s.id, result.funding_rounds, existingRounds, result.source_url || undefined,
      );
      tally.roundsInserted += inserted;
      tally.roundsSkipped  += skipped;
      if (inserted > 0) tally.enriched++;
    }

    // Write leadership + headcount back to the startups row
    await upsertStartupProfile(s.id, result.leadership, result.metrics);

    if (i < toEnrich.length - 1) {
      console.log(`    ⏳  Waiting ${DELAY_MS / 1000}s…`);
      await sleep(DELAY_MS);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(58));
  console.log("SUMMARY");
  console.log("═".repeat(58));
  console.log(`  Phase 1 — stubs inserted:       ${stubsInserted}`);
  console.log(`  Phase 2 — companies enriched:   ${tally.enriched}`);
  console.log(`  Phase 2 — new rounds inserted:  ${tally.roundsInserted}`);
  console.log(`  Phase 2 — duplicates skipped:   ${tally.roundsSkipped}`);
  console.log(`  Phase 2 — research failures:    ${tally.failed}`);
  if (DRY_RUN) console.log("\n  Run with DRY_RUN=false to apply all writes.");
  console.log("═".repeat(58) + "\n");

  if (tally.failed > 0 && tally.enriched === 0) process.exit(1);
}

main().catch((e) => { console.error("💥  Fatal error:", e); process.exit(1); });
