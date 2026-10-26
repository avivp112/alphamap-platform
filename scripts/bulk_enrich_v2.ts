#!/usr/bin/env node
/**
 * scripts/bulk_enrich_v2.ts — the v2 orchestrator. Per
 * docs/enrichment_v2_spec.md Section 3's per-company pipeline, reusing
 * every lib/enrichment/ module built against that spec.
 *
 * What it collects per company (every value traced to a fetched source):
 *   1. Overview — description, founding year, HQ city/country, headcount,
 *      sector + sub-sector tags.
 *   2. Founders and leadership (bios, LinkedIn, quality tags).
 *   3. Funding & valuation — every round (type, amount, date, valuation,
 *      lead, participants, per-investor amounts when disclosed, source
 *      URL), ARR milestones, revenue range, valuation benchmarks.
 *   4. Talent & growth — current headcount plus dated historical points
 *      (headcount_history, which drives Growth Velocity / Trend).
 *   5. Competitors (4-6, each with a short overview), cross-linked to our
 *      own startups by domain.
 *   6. Acquisitions and patents.
 *   7. News articles with links and og:image.
 *
 * Pipeline: Stage 0 domain check -> Stage 1+2 search + website fetch ->
 * Stage 3 entity filter -> Stage 4 three extraction calls in parallel
 * (profile / funding / market) -> Stage 9 deep dive for whichever
 * sections came back thin (targeted second search + the same evidence-
 * gated extraction) -> Stage 6 validation -> Stage 7 round planning
 * (fill / insert / contradiction) -> Stage 10 write.
 *
 * v1 (scripts/bulk_enrich_all.ts) stays untouched and runnable. Reuses
 * initV1Context() for env loading + the `supabase` client.
 *
 * Same CLI/env vars as v1 (ground rule 3), plus:
 *   PROFILE_MODEL / FUNDING_MODEL / MARKET_MODEL (default ENRICH_MODEL),
 *   MIN_PROFILE_CONFIDENCE (40), MIN_FUNDING_CONFIDENCE (60),
 *   DEEP_DIVE (default true; false skips Stage 9), VERBOSE.
 *
 * Usage:
 *   npx tsx scripts/bulk_enrich_v2.ts                              # dry run (default)
 *   DRY_RUN=false BATCH_SIZE=10 npx tsx scripts/bulk_enrich_v2.ts   # apply writes, small batch
 */

import Anthropic from "@anthropic-ai/sdk";
import { pathToFileURL } from "url";

import { initV1Context, supabase } from "./bulk_enrich_all.ts";
import { collectCompany, V2_STARTUP_COLUMNS, V2_ROUND_COLUMNS, type V2StartupRow, type V2FundingRoundRow } from "../lib/enrichment/collect.ts";
import { writeCollected, BULK_THRESHOLDS } from "../lib/enrichment/writeCompany.ts";

import { classifyTier, type TierRow, type TierRound } from "../lib/enrichment/queue.ts";
import { createSearchProviderState, jinaDisabled, type SearchProviderState } from "../lib/enrichment/searchProviders.ts";
import { loadSectorTaxonomy, type SectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { openSearchCache } from "../lib/enrichment/searchCache.ts";
import { ACTIVE_DAYS, QUIET_DAYS, SeenUrls, isUpdateDue } from "../lib/enrichment/update.ts";
import { websiteDomain, type DomainOwner } from "../lib/enrichment/websiteValidation.ts";

// ── Configuration (ground rule 3: same env vars as v1) ──────────────────
const BATCH_SIZE     = Number(process.env.BATCH_SIZE     ?? 9999);
const OFFSET         = Number(process.env.OFFSET         ?? 0);
const DELAY_MS       = Number(process.env.DELAY_MS       ?? 20_000);
const DRY_RUN        = process.env.DRY_RUN               !== "false";
const MAX_TIER       = Number(process.env.MAX_TIER       ?? 3);
// VERBOSE=true prints the full candidate value + evidence per field, not
// just the field names, in both dry and real runs.
const VERBOSE         = process.env.VERBOSE               === "true";
// Stage 9 (targeted second search for thin sections). On by default.
const DEEP_DIVE       = process.env.DEEP_DIVE             !== "false";
// Cheap homepage-based "is this tech?" check before any searching (techGate.ts).
const TECH_GATE       = process.env.TECH_GATE             !== "false";
// How many third-party articles to read in full via Jina (free) per company.
const ARTICLES_TO_READ = Number(process.env.ARTICLES_TO_READ ?? 4);
// ONLY=<id or exact name>[,...] re-runs specific companies, ignoring the
// queue order, OFFSET and BATCH_SIZE (e.g. ONLY=Gladia after a fix).
// startups_search refresh cadence during a long run (companies); 0 = only at the end.
const REFRESH_EVERY = Number(process.env.REFRESH_EVERY ?? 25);
// MODE=update re-checks companies already enriched: only what is new since
// the last check (lib/enrichment/update.ts). Default: a full enrichment.
const UPDATE = process.env.MODE === "update";
const UPDATE_ACTIVE_DAYS = Number(process.env.UPDATE_ACTIVE_DAYS ?? ACTIVE_DAYS);
const UPDATE_QUIET_DAYS = Number(process.env.UPDATE_QUIET_DAYS ?? QUIET_DAYS);
// Stop the run after this many failures in a row (systemic problem guard).
const MAX_CONSECUTIVE_ERRORS = Number(process.env.MAX_CONSECUTIVE_ERRORS ?? 5);
const ONLY = (process.env.ONLY ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
// Kept for parity/visibility only -- v2 gates per field (issue 9), never on
// one whole-company score. Printed in the run header, never read.
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE ?? 40);

const ENRICH_MODEL  = process.env.ENRICH_MODEL  ?? "claude-haiku-4-5-20251001";
const PROFILE_MODEL = process.env.PROFILE_MODEL ?? ENRICH_MODEL;
const FUNDING_MODEL = process.env.FUNDING_MODEL ?? ENRICH_MODEL;
const MARKET_MODEL  = process.env.MARKET_MODEL  ?? ENRICH_MODEL;
// 40 = a city/country quoted verbatim from a Crunchbase/LinkedIn-type
// profile is enough; a value with no source at all (0) never is.
const MIN_PROFILE_CONFIDENCE = Number(process.env.MIN_PROFILE_CONFIDENCE ?? BULK_THRESHOLDS.minProfileConfidence);
const MIN_FUNDING_CONFIDENCE = Number(process.env.MIN_FUNDING_CONFIDENCE ?? BULK_THRESHOLDS.minFundingConfidence);
const THRESHOLDS = { minProfileConfidence: MIN_PROFILE_CONFIDENCE, minFundingConfidence: MIN_FUNDING_CONFIDENCE };

let anthropic: Anthropic;

type ProcessStatus =
  | "success" | "partial" | "rejected" | "removed_public" | "no_data"
  | "low_evidence" | "error" | "error_incomplete_extraction" | "no_change" | "search_unavailable";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchAllPaginated<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
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

interface RunSummary {
  tally: Record<ProcessStatus, number>;
  droppedByReason: Map<string, number>;
  totalRoundsInserted: number;
  totalRoundsUpdated: number;
  totalFieldsPatched: number;
  totalNewsAdded: number;
  totalCompetitorsAdded: number;
  deepDives: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  websitePagesFetched: number;
  websitePagesSkippedThin: number;
  serperCalls: number;
  tavilyCalls: number;
  totalCacheReadTokens: number;
  searchCacheHits: number;
  articlesRead: number;
  websitePagesDuplicate: number;
  earlyRejected: number;
  duplicateResultsMerged: number;
}

// $/token by model (ground rule 3: keep cost/token tracking), per call.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  "claude-haiku-4-5-20251001": { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  "claude-sonnet-5": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  "claude-sonnet-5-5": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
};

// Prompt-cache pricing: a cache write bills 1.25x the input rate (5-minute
// TTL), a cache read 0.1x — see lib/enrichment/sharedExtraction.ts.
function recordCost(
  summary: RunSummary, model: string,
  usage: { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number },
): void {
  const write = usage.cacheWriteTokens ?? 0, read = usage.cacheReadTokens ?? 0;
  summary.totalInputTokens += usage.inputTokens + write + read;
  summary.totalOutputTokens += usage.outputTokens;
  summary.totalCacheReadTokens += read;
  const pricing = PRICING[model] ?? PRICING["claude-haiku-4-5-20251001"];
  summary.totalCostUsd += (usage.inputTokens + write * 1.25 + read * 0.1) * pricing.input + usage.outputTokens * pricing.output;
}


async function processCompany(
  row: V2StartupRow,
  existingRounds: V2FundingRoundRow[],
  taxonomy: SectorTaxonomy,
  startupByDomain: Map<string, DomainOwner>,
  summary: RunSummary,
): Promise<void> {
  console.log(`── ${row.name} (${row.id}) ──`);
  const searchState = createSearchProviderState();
  searchState.cache = openSearchCache(row.id);
  const before = { ...summary.tally };
  try {
    try {
      await enrichCompany(row, existingRounds, taxonomy, startupByDomain, summary, searchState);
    } catch (err) {
      console.error(`    💥  Unhandled error processing "${row.name}": ${String(err)}`);
      summary.tally.error++;
    }
    // Every outcome moves the company to the back of the queue (the queue
    // is ordered by last_enriched_at). Without this, a company that is
    // rejected — or that fails the same way every time — stays first in
    // line and is re-processed at the start of every run. A failed company
    // comes back in the next full cycle; a systemic failure (bad key,
    // provider outage) stops the run instead, see MAX_CONSECUTIVE_ERRORS.
    const settled = (["rejected", "low_evidence", "no_data", "removed_public", "error", "error_incomplete_extraction", "no_change"] as const)
      .some((k) => summary.tally[k] > before[k]);
    if (settled && !DRY_RUN) {
      const { error } = await supabase.from("startups").update({ last_enriched_at: new Date().toISOString() }).eq("id", row.id);
      if (error) console.warn(`    ⚠️  last_enriched_at update failed: ${error.message}`);
    }
  } finally {
    // Every exit path (rejected / archived / low_evidence / success) still
    // spent real search calls, so they're counted here, once.
    summary.websitePagesFetched += searchState.websitePagesFetched;
    summary.websitePagesSkippedThin += searchState.websitePagesSkippedThin;
    summary.serperCalls += searchState.serperCallCount;
    summary.tavilyCalls += searchState.tavilyCallCount;
    summary.websitePagesDuplicate += searchState.websitePagesDuplicate;
    summary.searchCacheHits += searchState.cache?.hits ?? 0;
    if (searchState.cache?.hits) console.log(`    ♻️   ${searchState.cache.hits} search/page result(s) reused from the local cache (no API cost)`);
    searchState.cache?.save();
  }
}

async function enrichCompany(
  row: V2StartupRow,
  existingRounds: V2FundingRoundRow[],
  taxonomy: SectorTaxonomy,
  startupByDomain: Map<string, DomainOwner>,
  summary: RunSummary,
  searchState: SearchProviderState,
): Promise<void> {
  // ── Stages 0-9: collect (lib/enrichment/collect.ts; no writes) ─────────
  const seen = new SeenUrls(row.id);
  const collected = await collectCompany(row, existingRounds, taxonomy, {
    anthropic,
    models: { enrich: ENRICH_MODEL, profile: PROFILE_MODEL, funding: FUNDING_MODEL, market: MARKET_MODEL },
    update: UPDATE, deepDive: DEEP_DIVE, techGate: TECH_GATE, articlesToRead: ARTICLES_TO_READ, verbose: VERBOSE,
    seen,
    knownProvenanceUrls: async () => {
      const { data: prov } = await supabase.from("field_provenance").select("source_url").eq("startup_id", row.id).limit(2000);
      return ((prov ?? []) as Array<{ source_url: string | null }>).map((p) => p.source_url);
    },
    recordCost: (model, usage) => recordCost(summary, model, usage),
  }, summary, searchState);

  if (collected.outcome === "public") {
    summary.tally.removed_public++;
    if (!DRY_RUN) {
      const { error: changeErr } = await supabase.from("field_changes").insert({
        startup_id: row.id, field: "status", old_value: row.status, new_value: "ipo", source_url: null,
      });
      if (changeErr) console.warn(`    ⚠️  field_changes insert failed: ${changeErr.message}`);
      const { error } = await supabase.from("startups").update({ status: "ipo" }).eq("id", row.id);
      if (error) console.warn(`    ⚠️  status update failed: ${error.message}`);
    } else {
      console.log("    [DRY] Would set status='ipo'");
    }
    return;
  }
  if (collected.outcome === "no_change") {
    summary.tally.no_change++;
    if (!DRY_RUN) seen.save();
    return;
  }
  // An outage is not a verdict on the company: not stamped (see "settled"), so it is tried again.
  if (collected.outcome === "error" && collected.reason === "search_unavailable") {
    summary.tally.search_unavailable++;
    return;
  }
  if (collected.outcome !== "collected") {
    summary.tally[collected.outcome]++;
    return;
  }

  // ── Stage 10: write (lib/enrichment/writeCompany.ts) ───────────────────
  await writeCollected(row, collected, {
    db: supabase, dryRun: DRY_RUN, update: UPDATE, verbose: VERBOSE, thresholds: THRESHOLDS,
    taxonomy, startupByDomain, seen,
  }, summary);
}

async function main() {
  await initV1Context();
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const taxonomy = await loadSectorTaxonomy(supabase);

  const startedAt = new Date().toISOString();
  console.log(`╔${"═".repeat(62)}╗`);
  console.log(`║${"  AlphaMap — v2 Enrichment Run".padEnd(62)}║`);
  console.log(`║  ${startedAt}${"".padEnd(Math.max(0, 62 - 2 - startedAt.length))}║`);
  console.log(`║  MODE=${UPDATE ? "update (only what is new since the last check)" : "full"}`.padEnd(63) + "║");
  console.log(`║  DRY_RUN=${String(DRY_RUN).padEnd(5)} | BATCH=${String(BATCH_SIZE).padEnd(6)} | OFFSET=${String(OFFSET).padEnd(5)} | DELAY=${DELAY_MS / 1000}s${" ".padEnd(Math.max(0, 62 - 58))}║`);
  console.log(`║  PROFILE_MODEL=${PROFILE_MODEL}${" ".padEnd(Math.max(0, 62 - 16 - PROFILE_MODEL.length))}║`);
  console.log(`║  FUNDING_MODEL=${FUNDING_MODEL}${" ".padEnd(Math.max(0, 62 - 16 - FUNDING_MODEL.length))}║`);
  console.log(`║  MARKET_MODEL=${MARKET_MODEL}${" ".padEnd(Math.max(0, 62 - 15 - MARKET_MODEL.length))}║`);
  console.log(`║  DEEP_DIVE=${String(DEEP_DIVE).padEnd(5)} TECH_GATE=${String(TECH_GATE).padEnd(5)} ARTICLES_TO_READ=${ARTICLES_TO_READ}`.padEnd(63) + "║");
  console.log(`║  SEARCH_CACHE=${process.env.SEARCH_CACHE === "false" ? "off" : `on (${process.env.SEARCH_CACHE_DAYS ?? 30} days)`}`.padEnd(63) + "║");
  console.log(`║  MIN_PROFILE_CONFIDENCE=${MIN_PROFILE_CONFIDENCE} MIN_FUNDING_CONFIDENCE=${MIN_FUNDING_CONFIDENCE}${" ".padEnd(Math.max(0, 10))}║`);
  console.log(`║  (MIN_CONFIDENCE=${MIN_CONFIDENCE} kept for parity, unused by v2)${" ".padEnd(Math.max(0, 10))}║`);
  console.log(`╚${"═".repeat(62)}╝`);
  if (DRY_RUN) console.log(`ℹ️  DRY RUN — set DRY_RUN=false to apply writes to the database.${VERBOSE ? " (VERBOSE=true: full values + evidence printed per company.)" : " Set VERBOSE=true to see actual field values, not just names."}\n`);
  else if (VERBOSE) console.log("ℹ️  VERBOSE=true: full values + evidence printed per company (in addition to the real writes).\n");
  // Both missing/invalid keys fail silently otherwise: serperSearch() just
  // returns [] on every call with no log line distinguishing "no key" from
  // "no results", and TAVILY_API_KEY missing sets tavilyExhausted=true from
  // the very first company with NO log line at all (its one early-return
  // branch was never meant to explain a permanently-dead key, only an
  // exhausted one mid-run) -- a real run with no Tavily key and Serper out
  // of credits would search literally nothing for an entire batch and the
  // logs would give no indication why.
  if (!process.env.SERP_KEY) console.warn("⚠️  SERP_KEY is not set — Serper search is disabled for this entire run.");
  if (!process.env.TAVILY_API_KEY) console.warn("⚠️  TAVILY_API_KEY is not set — Tavily search/fallback is disabled for this entire run.");
  if (!process.env.SERP_KEY && !process.env.TAVILY_API_KEY) {
    console.warn("⚠️  Neither search provider is configured — every company will run on website-page content ONLY (no funding/news/competitor search results at all).");
  }
  console.log(`🗂️   Sector taxonomy: ${taxonomy.parentNames.length} sectors, ${taxonomy.subNames.length} sub-sectors loaded\n`);

  const startups = await fetchAllPaginated<V2StartupRow>((from, to) =>
    supabase.from("startups").select(
      V2_STARTUP_COLUMNS,
    ).order("name").range(from, to),
  );
  const allRounds = await fetchAllPaginated<V2FundingRoundRow>((from, to) =>
    supabase.from("funding_rounds").select(
      V2_ROUND_COLUMNS,
    ).order("created_at").range(from, to),
  );

  const roundsByStartup = new Map<string, V2FundingRoundRow[]>();
  for (const r of allRounds) {
    const arr = roundsByStartup.get(r.startup_id) ?? [];
    arr.push(r);
    roundsByStartup.set(r.startup_id, arr);
  }
  const startupByDomain = new Map<string, DomainOwner>();
  for (const s of startups) {
    const d = websiteDomain(s.website);
    if (d && !startupByDomain.has(d)) startupByDomain.set(d, { id: s.id, name: s.name });
  }

  const tier1: V2StartupRow[] = [], tier2: V2StartupRow[] = [], tier3: V2StartupRow[] = [];
  const tierById = new Map<string, 1 | 2 | 3>();
  for (const row of startups) {
    const rounds: TierRound[] = (roundsByStartup.get(row.id) ?? []).map((r) => ({ round_type: r.round_type }));
    const tierRow: TierRow = { description: row.description, employee_count: row.employee_count, competitors: row.competitors };
    const t = classifyTier(tierRow, rounds);
    tierById.set(row.id, t);
    (t === 1 ? tier1 : t === 2 ? tier2 : tier3).push(row);
  }

  const eligibleQueue = MAX_TIER >= 3 ? [...tier1, ...tier2, ...tier3] : [...tier1, ...tier2];
  eligibleQueue.sort((a, b) => {
    // Fields marked to collect again (refresh_fields) go first.
    const aRefresh = (a.refresh_fields?.length ?? 0) > 0, bRefresh = (b.refresh_fields?.length ?? 0) > 0;
    if (aRefresh !== bRefresh) return aRefresh ? -1 : 1;
    const aNever = a.last_enriched_at == null, bNever = b.last_enriched_at == null;
    if (aNever !== bNever) return aNever ? -1 : 1;
    if (!aNever && a.last_enriched_at !== b.last_enriched_at) return a.last_enriched_at! < b.last_enriched_at! ? -1 : 1;
    const tierDiff = (tierById.get(a.id) ?? 3) - (tierById.get(b.id) ?? 3);
    return tierDiff !== 0 ? tierDiff : a.name.localeCompare(b.name);
  });

  // MODE=update: only companies already enriched (with a description, not
  // archived as public) whose re-check is due — active ones every
  // UPDATE_ACTIVE_DAYS, quiet ones every UPDATE_QUIET_DAYS — oldest check first.
  const updateQueue = startups
    .filter((s) => !!s.description && s.status !== "ipo" && ((s.refresh_fields?.length ?? 0) > 0 ||
      isUpdateDue(s, (roundsByStartup.get(s.id) ?? []).map((r) => r.announcement_date), { activeDays: UPDATE_ACTIVE_DAYS, quietDays: UPDATE_QUIET_DAYS })))
    .sort((a, b) => Number((b.refresh_fields?.length ?? 0) > 0) - Number((a.refresh_fields?.length ?? 0) > 0)
      || (a.last_enriched_at ?? "").localeCompare(b.last_enriched_at ?? ""));
  const queue = ONLY.length > 0
    ? startups.filter((s) => ONLY.includes(s.id.toLowerCase()) || ONLY.includes(s.name.trim().toLowerCase()))
    : (UPDATE ? updateQueue : eligibleQueue).slice(OFFSET, OFFSET + BATCH_SIZE);
  if (ONLY.length > 0) console.log(`ONLY=${ONLY.join(",")} — ${queue.length} matching compan${queue.length === 1 ? "y" : "ies"}.`);
  if (queue.length === 0) {
    console.log("✅  Queue is empty after OFFSET/BATCH_SIZE/MAX_TIER filter. Nothing to process.");
    return;
  }
  if (UPDATE) console.log(`🔁  MODE=update — processing ${queue.length} of ${updateQueue.length} companies due for a re-check (active every ${UPDATE_ACTIVE_DAYS} days, quiet every ${UPDATE_QUIET_DAYS}).\n`);
  else console.log(`Processing ${queue.length} of ${eligibleQueue.length} eligible companies (Tier 1: ${tier1.length}, Tier 2: ${tier2.length}, Tier 3: ${tier3.length}).\n`);

  const summary: RunSummary = {
    tally: { success: 0, partial: 0, rejected: 0, removed_public: 0, no_data: 0, low_evidence: 0, error: 0, error_incomplete_extraction: 0, no_change: 0, search_unavailable: 0 },
    droppedByReason: new Map(),
    totalRoundsInserted: 0, totalRoundsUpdated: 0, totalFieldsPatched: 0, totalNewsAdded: 0, totalCompetitorsAdded: 0, deepDives: 0,
    totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0,
    websitePagesFetched: 0, websitePagesSkippedThin: 0, serperCalls: 0, tavilyCalls: 0,
    totalCacheReadTokens: 0, searchCacheHits: 0, articlesRead: 0, websitePagesDuplicate: 0, earlyRejected: 0, duplicateResultsMerged: 0,
  };

  // Ctrl+C once: finish the current company (its writes are never left
  // half-done), print the summary, stop. Ctrl+C twice: exit immediately.
  let stopRequested = false;
  process.on("SIGINT", () => {
    if (stopRequested) { console.log("\n⛔  Second Ctrl+C — exiting immediately."); process.exit(130); }
    stopRequested = true;
    console.log("\n🛑  Stop requested — finishing the current company, then stopping. Ctrl+C again to exit immediately.");
  });
  const interruptibleSleep = async (ms: number) => {
    for (let waited = 0; waited < ms && !stopRequested; waited += 500) await sleep(Math.min(500, ms - waited));
  };
  const refreshSearch = async () => {
    const { error } = await supabase.rpc("refresh_startups_search");
    if (error) console.warn(`⚠️  startups_search refresh failed: ${error.message} — the 15-minute pg_cron refresh will pick the changes up; if this repeats, check that migration 20261009000000 (service_role statement_timeout) is applied.`);
    else console.log("🔄  startups_search refreshed");
  };
  const runStartedAt = Date.now();
  let consecutiveErrors = 0;
  if (DRY_RUN) console.log("ℹ️  DRY_RUN: nothing is written, so the queue does not advance between dry runs — the same companies come first every time (use OFFSET=… or ONLY=… to look at others).\n");

  for (let i = 0; i < queue.length && !stopRequested; i++) {
    const row = queue[i];
    const elapsedMin = (Date.now() - runStartedAt) / 60_000;
    const t = summary.tally;
    console.log(`📍 [${i + 1}/${queue.length}] ${elapsedMin.toFixed(0)} min | $${summary.totalCostUsd.toFixed(2)} so far | ✅ ${t.success} 🟠 ${t.partial} 🚫 ${t.rejected} 🔍 ${t.low_evidence + t.no_data} 💥 ${t.error}${t.search_unavailable ? ` 📡 ${t.search_unavailable}` : ""}${UPDATE ? ` 💤 ${t.no_change}` : ""}`);
    const errorsBefore = summary.tally.error + summary.tally.error_incomplete_extraction + summary.tally.search_unavailable;
    const noChangeBefore = summary.tally.no_change;
    await processCompany(row, roundsByStartup.get(row.id) ?? [], taxonomy, startupByDomain, summary);
    consecutiveErrors = summary.tally.error + summary.tally.error_incomplete_extraction + summary.tally.search_unavailable > errorsBefore ? consecutiveErrors + 1 : 0;
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error(`\n⛔  ${consecutiveErrors} companies in a row failed — this looks systemic (API key, credits, provider outage), not company-specific. Stopping so the rest of the queue isn't burned. Fix the cause and re-run; it continues from here.`);
      break;
    }
    // The company page reads startups_search — refresh it periodically on a
    // long run, not only at the very end.
    if (!DRY_RUN && REFRESH_EVERY > 0 && (i + 1) % REFRESH_EVERY === 0) await refreshSearch();
    if (i < queue.length - 1 && !stopRequested) {
      // The pause protects the Claude rate limit; a company with nothing new
      // made no Claude call, so the next one can follow almost at once.
      const wait = summary.tally.no_change > noChangeBefore ? Math.min(DELAY_MS, 2_000) : DELAY_MS;
      console.log(`    ⏳  Waiting ${wait / 1000}s…\n`);
      await interruptibleSleep(wait);
    }
  }
  if (stopRequested) console.log("🛑  Stopped by request. Re-running continues from the companies not yet processed (queue is ordered by last_enriched_at).");

  if (!DRY_RUN && (summary.totalFieldsPatched > 0 || summary.totalRoundsInserted > 0 || summary.totalRoundsUpdated > 0)) {
    await refreshSearch();
  }

  console.log(`\n${"═".repeat(62)}`);
  console.log("V2 ENRICHMENT RUN SUMMARY");
  console.log("═".repeat(62));
  for (const [status, count] of Object.entries(summary.tally)) {
    console.log(`  ${status.padEnd(28)} ${count}`);
  }
  console.log(`  rounds inserted              ${summary.totalRoundsInserted}`);
  console.log(`  existing rounds filled       ${summary.totalRoundsUpdated}`);
  console.log(`  news articles added          ${summary.totalNewsAdded}`);
  console.log(`  competitors added            ${summary.totalCompetitorsAdded}`);
  console.log(`  companies deep-dived         ${summary.deepDives}`);
  console.log(`  rejected before searching    ${summary.earlyRejected}  (tech pre-check)`);
  console.log(`  full articles read (Jina)    ${summary.articlesRead}`);
  console.log(`  prompt-cache tokens read     ${summary.totalCacheReadTokens.toLocaleString()}  (billed at 10%)`);
  console.log(`  search results from cache    ${summary.searchCacheHits}  (no API cost)`);
  console.log(`  duplicate results merged     ${summary.duplicateResultsMerged}  (not sent to Claude twice)`);
  console.log(`  fields patched               ${summary.totalFieldsPatched}`);
  console.log(`  tokens (in/out)              ${summary.totalInputTokens.toLocaleString()} / ${summary.totalOutputTokens.toLocaleString()}`);
  console.log(`  claude cost (est.)           $${summary.totalCostUsd.toFixed(2)}  (search API cost is separate)`);
  if (jinaDisabled()) console.log(`  ⛔ Jina Reader was switched off mid-run (${jinaDisabled()}) — top up Jina and re-run the affected companies for full articles.`);
  console.log(`  website pages: ${summary.websitePagesFetched} real / ${summary.websitePagesSkippedThin} thin-404 / ${summary.websitePagesDuplicate} duplicate skipped  |  serper calls: ${summary.serperCalls}  |  tavily calls: ${summary.tavilyCalls}`);
  console.log("  dropped/flagged by reason code:");
  for (const [reason, count] of summary.droppedByReason) {
    console.log(`    ${reason.padEnd(32)} ${count}`);
  }
  console.log("═".repeat(62));
}

const isDirectlyInvoked = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectlyInvoked) {
  main().catch((e) => {
    console.error("💥  Fatal error:", e);
    process.exit(1);
  });
}

export { main, processCompany };
