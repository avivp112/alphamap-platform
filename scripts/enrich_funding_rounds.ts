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
const DRY_RUN    = process.env.DRY_RUN !== "false";           // safe default: dry run

const supabase  = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Types ─────────────────────────────────────────────────────────────────────
interface StartupRow      { id: string; name: string }
interface FundingRoundRow {
  id: string; startup_id: string; round_type: string | null;
  amount_raised: number | null; valuation: number | null;
  announcement_date: string | null; source_url: string | null;
  investors: string[] | null;
}

// Shape Claude returns for each round (uses "date" per the JSON schema)
interface ClaudeRound {
  round_type: string;
  amount_raised?: number | null;
  valuation?: number | null;
  date?: string | null;        // YYYY-MM-DD — mapped to announcement_date on insert
  investors?: string[] | null; // lead investor first, then participants
  source_url?: string | null;
}

// Full structured response from Claude for one company
interface EnrichmentResult {
  funding_rounds: ClaudeRound[];
  confidence_score: number;    // 0–100
  reasoning: string;           // brief explanation of sources / certainty
  source_url: string;          // primary research source for this company
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

// ── Claude: extract ALL historical rounds + confidence metadata ───────────────
async function researchFundingRounds(name: string): Promise<EnrichmentResult> {
  // Three targeted searches: full history, recent rounds with amounts, investor names
  const [history, recent, backers] = await Promise.all([
    webSearch(`"${name}" complete funding history all rounds Seed "Series A" "Series B" Crunchbase PitchBook`),
    webSearch(`"${name}" funding round amount raised USD million billion announcement date 2020 2021 2022 2023 2024 2025`),
    webSearch(`"${name}" lead investor venture capital investors participated backed funding round`),
  ]);

  if (!history && !recent && !backers) {
    throw new Error("All three searches failed — skipping");
  }

  const context = [
    `## Complete Funding History (all rounds)\n${history  ?? "(search failed)"}`,
    `## Round Amounts & Dates\n${recent               ?? "(search failed)"}`,
    `## Investors & Backers\n${backers                ?? "(search failed)"}`,
  ].join("\n\n");

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    tools: [{
      name: "save_funding_history",
      description: "Save the complete funding analysis for a private tech startup",
      input_schema: {
        type: "object" as const,
        properties: {
          funding_rounds: {
            type: "array",
            description: [
              "EVERY verified funding round from inception to present, sorted OLDEST → NEWEST.",
              "If the company raised Seed, Series A, and Series B — return all three objects in the array.",
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
                  description: "Stage of this specific round.",
                },
                amount_raised: {
                  type: "number",
                  description: "Total USD raised IN THIS ROUND as a plain integer ($50M → 50000000). Omit if unknown.",
                },
                valuation: {
                  type: "number",
                  description: "Post-money valuation in USD as a plain integer. Omit if unknown.",
                },
                date: {
                  type: "string",
                  description: "Public announcement date as YYYY-MM-DD. If only the year is known use YYYY-01-01. Omit if completely unknown.",
                },
                investors: {
                  type: "array",
                  items: { type: "string" },
                  description: [
                    "All known investors for THIS round. Put the lead investor first.",
                    "Include full firm names (e.g. 'Sequoia Capital', 'Andreessen Horowitz').",
                    "Omit if no investor names are mentioned in the research.",
                  ].join(" "),
                },
                source_url: {
                  type: "string",
                  description: "Best direct URL for this specific round — press release, SEC filing, or Crunchbase round page.",
                },
              },
              required: ["round_type"],
            },
          },
          confidence_score: {
            type: "number",
            description: [
              "Integer 0–100 reflecting overall data confidence.",
              "90–100: multiple authoritative sources (Crunchbase + SEC filing + press release) fully agree on amounts and dates.",
              "70–89: one strong authoritative source, no contradictions found.",
              "50–69: limited data, only partial amounts or dates available, or minor source conflicts.",
              "0–49: mostly inferred or unverifiable — return fewer rounds, not more.",
            ].join(" "),
          },
          reasoning: {
            type: "string",
            description: "2–3 sentences: which sources were found, which round details (amounts, dates, investors) were confirmed, and why the confidence score was assigned.",
          },
          source_url: {
            type: "string",
            description: "Primary URL for this company's overall funding research (Crunchbase profile, PitchBook, or official investor announcement page).",
          },
        },
        required: ["funding_rounds", "confidence_score", "reasoning"],
      },
    }],
    tool_choice: { type: "tool", name: "save_funding_history" },
    messages: [{
      role: "user",
      content: `You are a financial data analyst. Extract the COMPLETE verified funding history for the private tech company "${name}".

CRITICAL RULES — read carefully:
1. RETURN ALL ROUNDS — if the company raised Pre-Seed, Seed, Series A, and Series B, the array MUST contain 4 objects. Never return only the most recent round.
2. AMOUNT RAISED — record the USD amount raised in each individual round as a plain integer ($1.5B → 1500000000, $50M → 50000000).
3. INVESTORS — for each round, list the lead investor first, followed by all known participants. Use full firm names.
4. DATE — use the public announcement date (YYYY-MM-DD). Approximate as YYYY-01-01 when only the year is known.
5. VERIFY BEFORE ADDING — omit any round or figure you cannot confirm from the research data. Return [] rather than guess.
6. CONFIDENCE — score honestly. Penalise for missing amounts, missing investor names, missing dates, or source conflicts.

RESPONSE SCHEMA:
{
  "funding_rounds": [
    {
      "round_type": "Seed",           // required — one of the allowed enum values
      "amount_raised": 5000000,       // optional — plain USD integer for THIS round only
      "valuation": 20000000,          // optional — post-money valuation in USD
      "date": "2019-03-12",           // optional — YYYY-MM-DD announcement date
      "investors": ["Accel", "Y Combinator", "Angel Investor Name"],  // optional — lead first
      "source_url": "https://..."     // optional — direct URL for this round
    },
    {
      "round_type": "Series A",
      "amount_raised": 25000000,
      "date": "2021-06-01",
      "investors": ["Sequoia Capital", "Andreessen Horowitz"],
      "source_url": "https://..."
    }
    // ... every additional round as a separate object
  ],
  "confidence_score": 82,
  "reasoning": "Crunchbase confirms Seed and Series A with amounts. Investor names sourced from TechCrunch announcement. Series B amount unconfirmed — omitted.",
  "source_url": "https://crunchbase.com/organization/example"
}

Research data:
${context}`,
    }],
  });

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") {
    return { funding_rounds: [], confidence_score: 0, reasoning: "Claude returned no structured output.", source_url: "" };
  }

  const input = tool.input as Partial<EnrichmentResult>;
  return {
    funding_rounds: (input.funding_rounds ?? []).filter((r) => r.round_type),
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

    const investors = (round.investors && round.investors.length > 0)
      ? round.investors
      : null;

    if (DRY_RUN) {
      const investorStr = investors ? ` | ${investors[0]}${investors.length > 1 ? ` +${investors.length - 1}` : ""}` : "";
      console.log(`    [DRY] ${roundType} | ${announcedDate ?? "no date"} | ${displayAmt}${investorStr}`);
      inserted++;
      seen.push({ id: "dry", startup_id: startupId, round_type: roundType,
        amount_raised: null, valuation: null,
        announcement_date: announcedDate, source_url: null, investors: null });
      continue;
    }

    const { error } = await supabase.from("funding_rounds").insert({
      startup_id:        startupId,
      round_type:        roundType,
      amount_raised:     round.amount_raised ?? null,
      valuation:         round.valuation     ?? null,
      announcement_date: announcedDate,
      source_url:        sourceUrl,
      investors:         investors,
    });

    if (error) {
      console.warn(`    ⚠️  Insert failed (${roundType}): ${error.message}`);
    } else {
      const investorStr = investors ? ` | ${investors[0]}${investors.length > 1 ? ` +${investors.length - 1}` : ""}` : "";
      console.log(`    💰  ${roundType} | ${announcedDate ?? "no date"} | ${displayAmt}${investorStr}`);
      inserted++;
      seen.push({ id: "new", startup_id: startupId, round_type: roundType,
        amount_raised: round.amount_raised ?? null, valuation: round.valuation ?? null,
        announcement_date: announcedDate, source_url: null, investors });
    }
  }

  return { inserted, skipped };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║    AlphaMap — Funding Rounds Sync & Enrichment       ║");
  console.log(`║    ${new Date().toISOString()}           ║`);
  console.log(`║    BATCH=${BATCH_SIZE}  DELAY=${DELAY_MS / 1000}s  DRY_RUN=${String(DRY_RUN).padEnd(27)}║`);
  console.log("╚══════════════════════════════════════════════════════╝\n");
  if (DRY_RUN) console.log("ℹ️  DRY RUN — set DRY_RUN=false to apply writes.\n");

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
        amount_raised: null, valuation: null,
        announcement_date: null, source_url: null,
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
        amount_raised: null, valuation: null,
        announcement_date: null, source_url: null,
      }]);
    }
    stubsInserted++;
  }
  console.log(`\n  Phase 1 complete — stubs: ${stubsInserted}\n`);

  // ── Phase 2: Financial enrichment ─────────────────────────────────────────
  console.log("── Phase 2: Financial Enrichment ───────────────────────");
  const toEnrich = startups
    .filter((s) => needsEnrichment(roundsByStartup.get(s.id) ?? []))
    .slice(0, BATCH_SIZE);

  console.log(`🔬  Startups needing round enrichment: ${toEnrich.length}`);
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
      result = await researchFundingRounds(s.name);
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
    console.log(`    📊 Claude found ${result.funding_rounds.length} verifiable round(s)`);

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
