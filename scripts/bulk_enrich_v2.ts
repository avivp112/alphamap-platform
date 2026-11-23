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

import { whyNotEnriched, notEnrichedReport, type NotEnrichedRow } from "../lib/enrichment/notEnriched.ts";
import { makePeerLookup } from "../lib/enrichment/peerLookup.ts";
import { maxArticles } from "../lib/enrichment/articleBudget.ts";
import { callCostUsd, UsageMeter, LONG_PROMPT_TOKENS } from "../lib/enrichment/models.ts";
import Anthropic from "@anthropic-ai/sdk";
import { pathToFileURL } from "url";

import { initV1Context, supabase } from "./bulk_enrich_all.ts";
import { collectCompany, V2_STARTUP_COLUMNS, V2_ROUND_COLUMNS, type V2StartupRow, type V2FundingRoundRow, type CollectResult } from "../lib/enrichment/collect.ts";
import { saveCollected, loadCollected } from "../lib/enrichment/collectedStore.ts";
import { writeCollected, BULK_THRESHOLDS } from "../lib/enrichment/writeCompany.ts";

import { classifyTier, type TierRow, type TierRound } from "../lib/enrichment/queue.ts";
import { createSearchProviderState, jinaDisabled, readPageCached, type SearchProviderState } from "../lib/enrichment/searchProviders.ts";
import { techOverride } from "../lib/enrichment/techOverrides.ts";
import { classifyDescription, mainTag } from "../lib/enrichment/postClassify.ts";
import { acceptanceReport, specPathsFor } from "./acceptance_check.ts";
import { parseCsv as parseReportCsv } from "../lib/enrichment/acceptance.ts";
import { traceTable } from "../lib/enrichment/runTrace.ts";
import { rowProblem, applyRowRules, acquiredFromNews, brandAsWritten, brandFromTexts, closedFromNews } from "../lib/enrichment/rowRules.ts";
import { loadKnown, saveKnown, remember, applyKnown, markKey, NOT_REMEMBERED, KNOWN_PATH, type KnownStore, type KnownEntry } from "../lib/enrichment/knownSources.ts";
import { injectKnown } from "../lib/enrichment/knownInject.ts";
import { readMarks } from "../lib/enrichment/fieldReview.ts";
import { loadSectorTaxonomy, type SectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { openSearchCache } from "../lib/enrichment/searchCache.ts";
import { ACTIVE_DAYS, QUIET_DAYS, SeenUrls, isUpdateDue } from "../lib/enrichment/update.ts";
import { websiteDomain, type DomainOwner } from "../lib/enrichment/websiteValidation.ts";

import { assertEnrichmentWritesAllowed, PILOT_FIELDS } from "../lib/enrichment/writeGate.ts";
import { CORE_FIELDS, isCoreField } from "../lib/enrichment/tiers.ts";
import { writeFileSync as realWriteFileSync, appendFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "fs";
import { passFor, headCommit, headTree, addWrittenBatch, saveBaseline, watched, loadBaseline, writtenBatches } from "../lib/enrichment/regressionGate.ts";
import { parseVerifyMissing, quarantinable, dropRowsFromCsv } from "../lib/enrichment/postWrite.ts";
import { pendingExcludes, heldFieldsOf, addHeldFields, readMarks as readSampleMarks, markKey as sampleMarkKey } from "../lib/enrichment/batchProcess.ts";
// The regression gate (owner, 2026-11-19): REGRESSION=1 runs a written batch again as a dry pass on a clean slate (the database's own values left out, the memory off) and its files go to REGRESSION_DIR.
const REGRESSION = process.env.REGRESSION === "1";
const REG_DIR = REGRESSION ? (process.env.REGRESSION_DIR ?? "regression/out") : "";
const writeFileSync = (p: string, d: string): void => realWriteFileSync(REG_DIR && !/[\\/]/.test(p) && /\.(csv|md)$/.test(p) ? `${REG_DIR}/${p}` : p, d);
import { rejectedDomains, rejectedDomainsCsv } from "../lib/enrichment/rejectedDomains.ts";
import { wrapAnthropic, installHttpRecorder, quietOffline, installFetchTimeout, recorderSummary, replayMode } from "../lib/enrichment/recorder.ts";
import { parseRejections, sampleRejections, rejectionsCsv, type Rejection } from "../lib/enrichment/rejections.ts";
import { installCompanyLog, installLineTap, gathered, withCompany, companyLines } from "../lib/enrichment/companyLog.ts";
import { loadGaps, saveGaps, recordGaps, purgeWrong, ownerWrongTest, missingRows, missingCsv, GAPS_PATH, type GapStore } from "../lib/enrichment/knownGaps.ts";
import { domainClasses, domainClassesCsv } from "../lib/enrichment/domainClass.ts";
import { checkFresh } from "../lib/enrichment/gitFresh.ts";
import { numberValues, renderBatchReport, batchCsv } from "../lib/enrichment/batchReport.ts";
import type { RoundHint } from "../lib/enrichment/hints.ts";
// ── Configuration (ground rule 3: same env vars as v1) ──────────────────
const BATCH_SIZE     = Number(process.env.BATCH_SIZE     ?? 9999);
const OFFSET         = Number(process.env.OFFSET         ?? 0);
// With CONCURRENCY above 1 the pace is kept per domain (recorder.ts), not per company: no wait between companies unless DELAY_MS is given.
const DELAY_MS       = Number(process.env.DELAY_MS       ?? (replayMode() !== "off" || Number(process.env.CONCURRENCY ?? 1) > 1 ? 0 : 20_000));
const DRY_RUN        = process.env.DRY_RUN               !== "false";
// PILOT=true: the partial wet run (writeGate.ts) — only PILOT_FIELDS, only the companies in ONLY=<ids>.
const PILOT          = process.env.PILOT                 === "true";
const MAX_TIER       = Number(process.env.MAX_TIER       ?? 3);
// VERBOSE=true prints the full candidate value + evidence per field, not
// just the field names, in both dry and real runs.
const VERBOSE         = process.env.VERBOSE               === "true";
// Stage 9 (targeted second search for thin sections). On by default.
const DEEP_DIVE       = process.env.DEEP_DIVE             !== "false";
// Cheap homepage-based "is this tech?" check before any searching (techGate.ts).
const TECH_GATE       = process.env.TECH_GATE             !== "false";
// How many third-party articles to read in full via Jina (free) per company.
const ARTICLES_TO_READ = maxArticles();
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
// Under CONCURRENCY the errors of OTHER companies running at the same time must not count against this one (batch 7: "5, 6, 7, 8 companies in a row failed" while ten ran together):
// a company failed when its own run says so (failedNames), and the limit is at least the number running together.
const MAX_CONSECUTIVE_ERRORS = Math.max(Number(process.env.MAX_CONSECUTIVE_ERRORS ?? 5), Number(process.env.CONCURRENCY ?? 1) > 1 ? Number(process.env.CONCURRENCY) : 0);
const failedNames = new Set<string>();
const ONLY = (process.env.ONLY ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
assertEnrichmentWritesAllowed("bulk_enrich_v2", !DRY_RUN, PILOT ? { fields: PILOT_FIELDS, companies: ONLY.length } : undefined);
// The tracker is the gate (owner, 2026-11-05). A field is written only when it is open in
// eval/field_review_tracker.csv — at least 20 values marked, at least 90% correct against the
// current rules — in a pilot and in a wide run alike; PHASE1_PASSED does not lift it, and a field
// with no marks is never written. A dry run shows what a wet run would write (the open fields);
// ALL_FIELDS=true shows everything it found. FIELDS=news,competitor narrows any run to those fields.
// A name that is not a field of the review is mapped when it is a plural or a short form (owner, round 10: FIELDS=…,city,country,founders,employees asked for no field at all, so batch 6
// had no headquarters and no founders in its report), and named when it is not known.
const FIELD_ALIASES: Record<string, string[]> = {
  city: ["hq_city"], country: ["hq_country"], headquarters: ["hq_city", "hq_country"], hq: ["hq_city", "hq_country"], founders: ["founder"], employees: ["employee_range", "employee_count"], headcount: ["employee_count"],
  leaders: ["leader"], competitors: ["competitor_declared", "competitor_market"], competitor: ["competitor_declared"], patents: ["patent"], rounds: ["round"], offices: ["office"], founded: ["founded_year", "founding_country"],
  registers: ["legal_name", "registered_address", "incorporation_date", "incorporation_jurisdiction", "company_number"], register: ["legal_name", "registered_address", "incorporation_date", "incorporation_jurisdiction", "company_number"],
};
const FIELDS_RAW = (process.env.FIELDS ?? "").split(",").map((f) => f.trim()).filter(Boolean);
const FIELDS_ASKED = [...new Set(FIELDS_RAW.flatMap((f) => (PILOT_FIELDS.includes(f) ? [f] : FIELD_ALIASES[f.toLowerCase()] ?? [])))];
{
  const unknown = FIELDS_RAW.filter((f) => !PILOT_FIELDS.includes(f) && !FIELD_ALIASES[f.toLowerCase()]);
  const mapped = FIELDS_RAW.filter((f) => !PILOT_FIELDS.includes(f) && FIELD_ALIASES[f.toLowerCase()]);
  if (mapped.length) console.log(`ℹ️   FIELDS: ${mapped.map((f) => `${f} → ${FIELD_ALIASES[f.toLowerCase()].join("+")}`).join(", ")}`);
  if (unknown.length) { console.error(`⛔  FIELDS names that are no field of the review: ${unknown.join(", ")}.\n    The fields are: ${PILOT_FIELDS.join(", ")}`); process.exit(1); }
}
const ASKED: string[] = FIELDS_ASKED.length ? PILOT_FIELDS.filter((f) => FIELDS_ASKED.includes(f)) : [...PILOT_FIELDS];
// The old tracker (20 marks, 90%) is gone (owner, 2026-11-20): the core fields (tiers.ts) are written, the candidate fields are not written to startups.
const OPEN_NOW: string[] = process.env.VITEST && process.env.OPEN_FIELDS_OVERRIDE ? process.env.OPEN_FIELDS_OVERRIDE.split(",") : [...CORE_FIELDS];   // the override is for tests only
const SHOW_ALL = DRY_RUN && process.env.ALL_FIELDS === "true";
if (REGRESSION) {
  if (!DRY_RUN) { console.error("⛔  REGRESSION=1 is a dry pass only."); process.exit(1); }
  if (process.env.KNOWN_SOURCES !== "off") { console.error("⛔  REGRESSION=1 needs KNOWN_SOURCES=off (the memory would carry values the code no longer finds)."); process.exit(1); }
  mkdirSync(REG_DIR, { recursive: true });
}
// A wet run needs the regression gate passed for the code it runs on (owner, 2026-11-19): the first thing it checks, before the tracker, the preflight, the database.
if (!DRY_RUN && !process.env.VITEST) {
  const commit = headCommit(), pass = passFor(commit, headTree());
  if (!pass) {
    console.error(`⛔  The regression gate has not passed for this code (${commit ? commit.slice(0, 10) : "no git commit found"}): a wet run is refused.\n    Run it: npx tsx scripts/regression.ts   — it writes regression_pass_${commit.slice(0, 12)}.json when every written batch still gives its good values.`);
    process.exit(1);
  }
  console.log(`🚦  Regression gate passed at ${pass.at} for ${pass.batches.length} batch(es), ${pass.values} value(s).`);
}
/** Fields a batch holds back (held_fields.csv, the sample check or a failed acceptance): written for no company of the batch. */
const HELD_ALL = new Set<string>();
/** Values a failed check pointed at, by company (folded name) → the fields not written for it this run; "*" = the whole company. */
const BLOCKED = new Map<string, Set<string>>();
const foldName = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
/** The open fields minus the ones a failed check held back for this company ("*": none). A row field such as founder_bio belongs to the open field it starts with. */
function openFieldsFor(company: string): string[] {
  const open = HELD_ALL.size ? OPEN_FIELDS.filter((f) => !HELD_ALL.has(f) && !(HELD_ALL.has("hq_city") && f === "hq_country") && !(HELD_ALL.has("hq_country") && f === "hq_city")) : OPEN_FIELDS;
  const held = BLOCKED.get(foldName(company));
  if (!held || !held.size) return open;
  if (held.has("*")) return [];
  if (held.has("hq_city") || held.has("hq_country")) { held.add("hq_city"); held.add("hq_country"); }   // a city and its country stand or fall together
  // A row field that is itself an open field (founder_background) holds that one only; one that is not (founder_bio, description_what_only) holds the open field it is a part of.
  return open.filter((f) => ![...held].some((h) => h === f || (h.startsWith(`${f}_`) && !OPEN_FIELDS.includes(h))));
}
/** A report row of a field held back for its company (EXCLUDE, a failed check): it is not written, and the memory must not bring it back into the report either. */
function heldRow(company: string, field: string): boolean {
  if (HELD_ALL.size && ([...HELD_ALL].some((x) => field === x || field.startsWith(`${x}_`)) || (field === "hq_city" && HELD_ALL.has("hq_country")) || (field === "hq_country" && HELD_ALL.has("hq_city")))) return true;
  const hs = BLOCKED.get(foldName(company));
  if (!hs) return false;
  if (hs.has("*")) return true;
  const pair = (f: string) => (f === "hq_city" ? "hq_country" : f === "hq_country" ? "hq_city" : f);   // a city and its country stand or fall together
  return [...hs].some((x) => field === x || field === pair(x) || field.startsWith(`${x}_`));
}
const OPEN_FIELDS: string[] = SHOW_ALL ? ASKED : ASKED.filter((f) => OPEN_NOW.includes(f));
{
  const closed = ASKED.filter((f) => !OPEN_FIELDS.includes(f));
  console.log(`🔓  ${DRY_RUN ? "Would be written" : "Open for writing"}: ${OPEN_FIELDS.join(", ") || "none"}${closed.length ? ` · closed (fewer than 20 marked or under 90%): ${closed.join(", ")} — npx tsx scripts/field_review_status.ts` : ""}`);
  if (!DRY_RUN && !OPEN_FIELDS.length) { console.error("⛔  No field is open for writing — nothing to write."); process.exit(1); }
}
if (PILOT && ONLY.length === 0) { console.error("⛔  PILOT=true needs ONLY=<company ids> (scripts/pilot_sample.ts writes them)."); process.exit(1); }
// Every pilot field written — or, dry, that would be — before and after (the owner's report).
const PILOT_REPORT = process.env.PILOT_REPORT ?? `${PILOT ? "pilot" : "run"}_report_${DRY_RUN ? "dry" : "write"}.csv`;
const pilotRows: Array<Record<string, string>> = [];
// Memory of verified sources (lib/enrichment/knownSources.ts): KNOWN_SOURCES=off switches it off.
const KNOWN_ON = process.env.KNOWN_SOURCES !== "off";
const knownStore: KnownStore = KNOWN_ON ? loadKnown() : {};
const markList = KNOWN_ON ? readMarks() : [];
const wrongMarks = new Set(markList.filter((m) => m.verdict === "wrong").map((m) => markKey(m.company, m.field, m.value)));
const ownerWrong = KNOWN_ON ? ownerWrongTest(loadGaps()) : () => false;   // also what the owner removed with scripts/known_sources_fix.ts
const isWrongValue = (c: string, f: string, v: string) => wrongMarks.has(markKey(c, f, v)) || ownerWrong(c, f, v);
const lockedMarks = new Set(markList.filter((m) => m.verdict === "correct").map((m) => markKey(m.company, m.field, m.value)));
for (const list of Object.values(knownStore)) for (let i = list.length - 1; i >= 0; i--) if (NOT_REMEMBERED.has(list[i].field)) list.splice(i, 1);   // proposals are not remembered
// Companies the owner decided are not technology: everything remembered about them goes (round 10: noo.ma, Plott).
for (const [id, list] of Object.entries(knownStore)) if (list.length && techOverride(list[0].company)) { console.log(`🧹  ${list[0].company}: ${list.length} remembered value(s) removed — tech_overrides.`); delete knownStore[id]; }
const gapStore: GapStore = KNOWN_ON ? loadGaps() : {};
if (KNOWN_ON) {
  // What the owner marked wrong leaves the memory and stays as a refused candidate (owner, round 10).
  const wrongSet = isWrongValue;
  const removed = purgeWrong(knownStore, gapStore, wrongSet, new Date().toISOString().slice(0, 10));
  if (removed.length) console.log(`🧹  ${removed.length} value(s) marked wrong removed from the memory of verified sources: ${removed.slice(0, 8).join(" | ")}`);
}
// What the memory carries must pass today's rules too (owner, round 10: a round of fixes changed nothing in the report because the memory brought the old values back).
{
  const today = new Date().toISOString().slice(0, 10);
  let purged = 0;
  for (const list of Object.values(knownStore)) for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    const why = rowProblem({ field: e.field, after: e.value, source_url: e.source_url, quote: e.quote, payload: e.payload }, e.company, today, 7);
    if (why) {
      console.log(`🧹  memory: ${e.company} ${e.field} "${e.value.slice(0, 50)}" removed — ${why}`); list.splice(i, 1); purged++;
      // Recorded as a refused candidate with the reason (owner, round 10).
      if (KNOWN_ON) {
        const c = gapStore[e.company_id] ?? (gapStore[e.company_id] = { company: e.company, fields: {} });
        const f = c.fields[e.field] ?? (c.fields[e.field] = { field: e.field, searched: [], rejected_candidates: [], last_run: today, run_id: "memory rules" });
        const note = `rejected by today's rules (${why}): ${e.value.slice(0, 80)} (${e.source_url})`;
        if (!f.rejected_candidates.includes(note)) f.rejected_candidates.push(note);
      }
    }
  }
  if (purged) console.log(`🧹  ${purged} remembered value(s) removed: they break today's rules.`);
}
const unreadableSites = new Set<string>();
const knownReadState = createSearchProviderState();
const knownPageMemo = new Map<string, Promise<string | null>>();
const readKnownPage = (url: string): Promise<string | null> => knownPageMemo.get(url) ?? (knownPageMemo.set(url, (async () => { try { return (await readPageCached(url, knownReadState))?.text ?? null; } catch { return null; } })()), knownPageMemo.get(url)!);
const RUN_DATE = new Date().toISOString().slice(0, 10);
// Websites to fix (owner, 2026-11-02): another business on the site, or none of it readable.
// Always in website_review.csv; noted in the website_review table on a wet run.
const websiteRows: Array<Record<string, string>> = [];
// Addresses whose pages no longer name the company (domain_repurposed): a file for the owner's review, no database note.
const repurposedRows: Array<Record<string, string>> = [];
// Everything the rules turned away, with its reason code (owner, batch 7): rejected_all.csv, and a stratified sample of 30 for the owner to mark.
const rejectedAll: Rejection[] = [];
// Remembered values this run did not write (not in the report): carried_not_written.csv.
const carriedNotWritten: Array<Record<string, string>> = [];
// Kept for parity/visibility only -- v2 gates per field (issue 9), never on
// one whole-company score. Printed in the run header, never read.
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE ?? 40);

const ENRICH_MODEL  = process.env.ENRICH_MODEL  ?? "claude-haiku-5-5"; // owner, 2026-11-02 (was claude-haiku-4-5-20251001)
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
  jinaSearchCalls: number;
  serperScrapes: number;
  totalCacheReadTokens: number;
  searchCacheHits: number;
  articlesRead: number;
  websitePagesDuplicate: number;
  earlyRejected: number;
  duplicateResultsMerged: number;
}

// Claude's cost from the tokens each call reports, by model (lib/enrichment/models.ts:
// Haiku 4.5, and Haiku 5.5's two rate cards — 100K-token prompts and under, and longer).
const LLM = new UsageMeter();
let costCapHit = false;
function recordCost(
  summary: RunSummary, model: string,
  usage: { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number },
): void {
  const write = usage.cacheWriteTokens ?? 0, read = usage.cacheReadTokens ?? 0;
  summary.totalInputTokens += usage.inputTokens + write + read;
  summary.totalOutputTokens += usage.outputTokens;
  summary.totalCacheReadTokens += read;
  summary.totalCostUsd += callCostUsd(model, usage);
  LLM.add(model, usage);
  // A hard stop (owner, 2026-11-19: MAX_COST=3 on the one-time recording run): the model cost of this run is over the cap — nothing more is asked, nothing is lost (replies are recorded as they come).
  // At the cap no new company is started; the ones running finish, the reports are written, and the run ends with exit code 3 (owner, 2026-11-21: what was collected is written, not lost).
  if (process.env.MAX_COST && summary.totalCostUsd > Number(process.env.MAX_COST) && !costCapHit) { costCapHit = true; console.error(`⛔  MAX_COST=$${process.env.MAX_COST} reached (model cost $${summary.totalCostUsd.toFixed(2)}) — no new company is started; the ones running finish and the reports are written.`); }
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
      summary.tally.error++; failedNames.add(row.name);
    }
    // Every outcome moves the company to the back of the queue (the queue
    // is ordered by last_enriched_at). Without this, a company that is
    // rejected — or that fails the same way every time — stays first in
    // line and is re-processed at the start of every run. A failed company
    // comes back in the next full cycle; a systemic failure (bad key,
    // provider outage) stops the run instead, see MAX_CONSECUTIVE_ERRORS.
    const settled = (["rejected", "low_evidence", "no_data", "removed_public", "error", "error_incomplete_extraction", "no_change"] as const)
      .some((k) => summary.tally[k] > before[k]);
    if (settled && !DRY_RUN && !PILOT) {
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
    summary.jinaSearchCalls += searchState.jinaSearchCallCount ?? 0;
    summary.serperScrapes += searchState.serperScrapeCount ?? 0;
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
  // FROM_COLLECTED=<dir> (owner, 2026-11-23, stage 3): the write reads what the live run collected for this company (SAVE_COLLECTED=<dir>) instead of collecting again — no model, no search, no replay of recordings.
  // A company with no file, or whose rounds in the database changed since, is not written and is listed as not enriched (collected_missing / collected_stale).
  const loaded = process.env.FROM_COLLECTED ? loadCollected(process.env.FROM_COLLECTED, row.id, existingRounds) : null;
  const collected: CollectResult = loaded
    ? (loaded.ok ? loaded.collected as unknown as CollectResult : { outcome: "error", reason: `collected_${loaded.reason}: ${loaded.detail}` })
    : await collectCompany(row, existingRounds, taxonomy, {
    anthropic,
    models: { enrich: ENRICH_MODEL, profile: PROFILE_MODEL, funding: FUNDING_MODEL, market: MARKET_MODEL },
    update: UPDATE, deepDive: DEEP_DIVE, techGate: TECH_GATE, articlesToRead: ARTICLES_TO_READ, verbose: VERBOSE,
    seen,
    knownProvenanceUrls: async () => {
      const { data: prov } = await supabase.from("field_provenance").select("source_url").eq("startup_id", row.id).limit(2000);
      return ((prov ?? []) as Array<{ source_url: string | null }>).map((p) => p.source_url);
    },
    recordCost: (model, usage) => recordCost(summary, model, usage),
    peerLookup: makePeerLookup(supabase),
    onDomainRepurposed: (detail) => { repurposedRows.push({ company_id: row.id, company: row.name, website: row.website ?? "", reason: "domain_repurposed", detail }); },
    onWebsiteIssue: (reason, detail) => {
      websiteIssueOf.set(row.id, reason);
      websiteRows.push({ company_id: row.id, company: row.name, website: row.website ?? "", reason, detail });
      if (!DRY_RUN) void supabase.rpc("note_website_issue", { p_startup_id: row.id, p_website: row.website, p_reason: reason, p_detail: detail })
        .then(({ error }) => { if (error) console.warn(`    ⚠️  website_review not noted (${error.message}) — run migration 20261116000000`); });
    },
    // Hints earlier runs kept for this company: searched for again (lib/enrichment/hints.ts).
    openHints: async () => {
      const { data } = await supabase.from("data_hints").select("id, value, source_url").eq("startup_id", row.id).eq("kind", "funding_round").eq("status", "open");
      return ((data ?? []) as Array<{ id: string; value: Omit<RoundHint, "source_url" | "id">; source_url: string | null }>).map((h) => ({ ...h.value, source_url: h.source_url, id: h.id }));
    },
  }, summary, searchState);
  if (process.env.SAVE_COLLECTED && !loaded) {
    try { saveCollected(process.env.SAVE_COLLECTED, row.id, collected, existingRounds); }
    catch (e) { console.warn(`    ⚠️  collected not saved for ${row.name}: ${String(e)} — this company cannot be written from the live run`); }
  }

  if (collected.outcome === "public") {
    summary.tally.removed_public++;
    notEnrich(row, "public", undefined);
    if (PILOT) { console.log("    [PILOT] Public company — not archived in a pilot (status is not a pilot field)."); return; }
    if (!DRY_RUN) {
      const { error: changeErr } = await supabase.from("field_changes").insert({
        startup_id: row.id, field: "status", old_value: row.status, new_value: "ipo", source_url: null, run_id: runId,
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
    if (!DRY_RUN && !PILOT) seen.save();
    return;
  }
  // An outage is not a verdict on the company: not stamped (see "settled"), so it is tried again.
  if (collected.outcome === "error" && collected.reason === "search_unavailable") {
    summary.tally.search_unavailable++; failedNames.add(row.name);
    return;   // an outage is not a verdict on the company: not counted as "not enriched"
  }
  if (collected.outcome !== "collected") {
    summary.tally[collected.outcome]++;
    if (collected.outcome === "error") failedNames.add(row.name);
    notEnrich(row, collected.outcome, (collected as { reason?: string }).reason, (collected as { detail?: string }).detail);
    return;
  }

  // What kind of company this was, kept for the stratified sample of the precision check (scripts/report_lint.ts).
  {
    const bare = row.name.toLowerCase().replace(/\b(inc|ltd|llc|gmbh|corp|co)\b\.?/g, "").trim();
    const generic = !/\s/.test(bare) && /^[\p{L}]{3,8}$/u.test(bare);
    let all: Record<string, { generic: boolean; translated: boolean; sources: number; techBorderline: boolean }> = {};
    try { all = JSON.parse(readFileSync("cache/company_flags.json", "utf8")); } catch { /* first run */ }
    const f = (collected as { flags?: { translated: boolean; sources: number; techBorderline: boolean } }).flags;
    all[row.name] = { generic, translated: !!f?.translated, sources: f?.sources ?? 0, techBorderline: !!f?.techBorderline };
    try { mkdirSync("cache", { recursive: true }); writeFileSync("cache/company_flags.json", JSON.stringify(all, null, 1)); } catch { /* a convenience */ }
  }

  // The memory of verified sources first (dry and wet alike): a verified value whose quote is still on its page, and that this run did not find, enters the
  // collected company with its source, so the write stage gates, fills and records it like a found value (lib/enrichment/knownInject.ts).
  let injectedNow: string[] = [];
  if (KNOWN_ON) {
    const carry = await applyKnown(knownStore, row.id, [], RUN_DATE, readKnownPage, lockedMarks);
    const confirmed: KnownEntry[] = carry.carried.filter((r) => r.origin === "known_source").map((r) => ({ company_id: r.company_id, company: r.company, field: r.field, value: r.after, source_url: r.source_url, quote: r.quote, verified_at: RUN_DATE, run_id: "memory", ...(r.payload ? { payload: r.payload } : {}) }));
    let host: string | null = null; try { host = row.website ? new URL(/^https?:/.test(row.website) ? row.website : `https://${row.website}`).hostname.replace(/^www\./, "") : null; } catch { /* no site */ }
    const injected = injectKnown(collected, confirmed, host);
    injectedNow = injected;
    console.log(`    🧠  From the memory into the write stage: ${injected.length ? injected.join(", ") : "nothing (this run found the fields, or the memory has none)"}${carry.recheck.length ? ` · back to review (quote gone): ${carry.recheck.join(" | ")}` : ""}`);
  }

  // ── Stage 10: write (lib/enrichment/writeCompany.ts) ───────────────────
  const outcome = await writeCollected(row, collected, {
    db: supabase, dryRun: DRY_RUN || (BLOCKED.size > 0 && openFieldsFor(row.name).length === 0), update: UPDATE, verbose: VERBOSE, thresholds: THRESHOLDS,
    taxonomy, startupByDomain, seen: PILOT ? null : seen, runId,
    openFields: openFieldsFor(row.name), pilot: PILOT,
  }, summary);
  let companyRows = (outcome?.pilot ?? []).map((c) => ({ company_id: row.id, company: row.name, field: c.field, before: c.before == null ? "" : String(c.before), after: String(c.after), source_url: c.source_url ?? "", quote: c.quote ?? "", origin: "new", rule: c.rule ?? "", quote_original: c.quote_original ?? "", quote_translated: c.quote_translated ?? "", ...(c.payload ? { payload: JSON.stringify(c.payload) } : {}) }));
  let carry: Awaited<ReturnType<typeof applyKnown>> | null = null;
  let freshFound = new Set<string>();
  let before = 0;
  if (KNOWN_ON) {
    // A value the owner marked wrong does not come back in the report, however it was found again.
    const back = companyRows.filter((r) => ownerWrong(r.company, r.field, r.after));
    if (back.length) { console.log(`    🚫  Marked wrong by the owner, not reported again: ${back.map((r) => `${r.field}: ${r.after.slice(0, 60)}`).join(" | ")}`); companyRows = companyRows.filter((r) => !back.includes(r)); }
    // What this run found is remembered; what was verified before and is still confirmed is carried (no model, no search for it).
    { const g = applyRowRules(companyRows, row.name, RUN_DATE, { domain: row.website }); companyRows = g.rows; for (const d of g.dropped) console.log(`    🧹  ${d}`); }
    freshFound = new Set(companyRows.map((r) => r.field));
    before = Object.keys(knownStore[row.id] ?? []).length;
    carry = await applyKnown(knownStore, row.id, companyRows, RUN_DATE, readKnownPage, lockedMarks);
    remember(knownStore, companyRows, runId ?? "dry", RUN_DATE, isWrongValue);
    // The report is what the writer writes (owner, batch 6: seven values of the reviewed report were not in the database — remembered rows the write stage cannot take, office, headcount,
    // a second founder, a competitor, a round). A remembered row that this run did not write is not a value of the report: it is listed apart, with its source, for the owner to see.
    for (const r of carry.rows.filter((x) => String(x.origin ?? "").startsWith("known_source"))) carriedNotWritten.push({ company_id: r.company_id, company: r.company, field: r.field, value: r.after, source_url: r.source_url, quote: r.quote ?? "" });
    companyRows = carry.rows.filter((x) => !String(x.origin ?? "").startsWith("known_source")).map((r) => ({ ...r, origin: r.origin ?? "new" })) as typeof companyRows;
  }
  // The rest does not depend on the memory (the regression gate runs with KNOWN_SOURCES=off and must walk the same road a real run walks: acquired, brand, name proposal, tags).
    { const g = applyRowRules(companyRows, row.name, RUN_DATE, { domain: row.website }); companyRows = g.rows; for (const d of g.dropped) console.log(`    🧹  ${d}`);
      // What was held back stays out of the report even when the memory still has it (owner, batch 6: the excluded values came back as remembered rows).
      if (BLOCKED.size) { const kept = companyRows.filter((r) => !heldRow(r.company, r.field)); if (kept.length !== companyRows.length) console.log(`    🚧  Held back, not reported: ${companyRows.filter((r) => heldRow(r.company, r.field)).map((r) => `${r.field}: ${r.after.slice(0, 40)}`).join(" | ")}`); companyRows = kept; }
      // acquired comes only from the accepted news (owner, round 10): any acquired row found another way (a profile page, a blog) is dropped.
      companyRows = companyRows.filter((r) => r.field !== "acquired");
      // Only when the acquired field is open: a row the write cannot take is not a row of the report (owner, batch 6: Okra's "closed" was reported and not written).
      const acquiredOpen = openFieldsFor(row.name).includes("acquired");
      const acq = acquiredOpen ? acquiredFromNews(companyRows, row.name, row.id, ((collected as { market?: { news?: Array<{ title: string; url: string }> } }).market?.news ?? []) as never) : null;
      const closed = acq || !acquiredOpen ? null : closedFromNews(companyRows, row.name, row.id);
      if (closed) { companyRows.push({ ...(closed as object), rule: "closed_from_news" } as (typeof companyRows)[number]); console.log(`    🏁  closed — read from the company's news: ${closed.after}`); }
      if (acq) {
        companyRows.push({ ...(acq as object), rule: "acquired_from_news" } as (typeof companyRows)[number]); console.log(`    🏁  acquired — read from the company's news: ${acq.after}`);
        // A rename after a purchase is a purchase: the new name is the brand after the acquisition, written as the company's own pages write it, never a name proposal.
        const texts = companyRows.flatMap((x) => [x.after, x.quote ?? ""]);
        const written = brandFromTexts(row.name, texts);
        const prop = companyRows.find((x) => x.field === "name_proposal");
        const brand = written ?? (prop ? brandAsWritten(prop.after.match(/name = "([^"]+)"/)?.[1] ?? "", texts) : null);
        if (brand) {
          const from = companyRows.find((x) => (x.field === "description" || x.field === "description_what_only") && x.after.includes(brand)) ?? prop;
          companyRows.push({ company_id: row.id, company: row.name, field: "brand_after_acquisition", before: "", after: `brand after the acquisition: ${brand}`, source_url: from?.source_url ?? "", quote: from?.field === "name_proposal" ? "" : from?.quote ?? "", origin: "text" } as (typeof companyRows)[number]);
        }
        companyRows = companyRows.filter((x) => x.field !== "name_proposal");
      }
      // A description with no tag: classified here, from the verified description (the memory carried it, so this run's classification never saw it).
      const desc = companyRows.find((r) => r.field === "description" || r.field === "description_what_only");
      if (desc && !companyRows.some((r) => r.field === "tags") && anthropic && !heldRow(row.name, "tags")) {
        try {
          const choice = await classifyDescription({ anthropic, model: ENRICH_MODEL, taxonomy, name: row.name, description: desc.after, complete: desc.field === "description" });
          const tag = mainTag(choice, taxonomy);
          const sectorRow = companyRows.find((r) => r.field === "sector");
          if (tag && choice && (!sectorRow || sectorRow.after.replace(/\s*\(industry:[^)]*\)\s*$/, "").trim() === choice.sector_name)) {
            companyRows.push({ ...desc, field: "tags", before: "", after: tag, origin: "classified", rule: "tag_classified_from_description" } as (typeof companyRows)[number]);
            console.log(`    🏷️   Tag ${tag} — the main sub-sector of the verified description (classified now: ${choice.sector_name} › ${tag}).`);
          }
        } catch (e) { console.log(`    ⚠️  tag classification skipped: ${(e as Error).message}`); }
      } }
    // Nothing held back reaches the report by another road (a tag classified just now, a remembered value).
    if (BLOCKED.size) companyRows = companyRows.filter((r) => !heldRow(r.company, r.field));
    // A field that is not open is never in the report, whatever road its value came by (owner, batch 7: competitor_market was reported for Yomoni and written never).
    { const allowed = SHOW_ALL ? ASKED : openFieldsFor(row.name);
      const closedRows = companyRows.filter((r) => { const f = r.field === "description_what_only" ? "description" : r.field; return PILOT_FIELDS.includes(f) && !allowed.includes(f); });
      if (closedRows.length) { console.log(`    🔒  Field not open, not reported: ${[...new Set(closedRows.map((r) => r.field))].join(", ")}`); companyRows = companyRows.filter((r) => !closedRows.includes(r)); } }
    const missing = ASKED.filter((f) => OPEN_FIELDS.includes(f) && !companyRows.some((r) => r.field === f || r.field.startsWith(f)));
    if (!REGRESSION) recordGaps(gapStore, row.id, row.name, missing, companyLines(), runId ?? "dry", RUN_DATE);
    rejectedAll.push(...parseRejections(companyLines(), row.name, row.id));
    if (KNOWN_ON && carry) console.log(`    📚  Known sources (${row.name}): from memory ${[...new Set([...injectedNow, ...carry.carried.map((r) => r.field)])].join(", ") || "none"}${injectedNow.length ? ` (${injectedNow.join(", ")} entered the write stage)` : ""}${carry.carried.length ? ` (${carry.carried.length} more value(s) carried in the report)` : ""}; from this run's search ${[...freshFound].filter((f) => !injectedNow.includes(f)).join(", ") || "none"}; still missing ${missing.join(", ") || "none"}${carry.recheck.length ? `; back to review (quote gone): ${carry.recheck.join(" | ")}` : ""}${carry.refreshDue.length ? `; older than the refresh time, searched again: ${carry.refreshDue.join(" | ")}` : ""}${carry.locked.length ? `; locked (marked correct) kept: ${carry.locked.join(" | ")}` : ""}${before ? "" : " [no memory yet]"}`);
  for (const c of companyRows) {
    pilotRows.push({ company_id: c.company_id, company: c.company, field: c.field, before: c.before, after: c.after, source_url: c.source_url, quote: c.quote, origin: c.origin, rule: (c as { rule?: string }).rule ?? "", quote_original: (c as { quote_original?: string }).quote_original ?? "", quote_translated: (c as { quote_translated?: string }).quote_translated ?? "" });
  }
  if (PILOT && !companyRows.length) pilotRows.push({ company_id: row.id, company: row.name, field: "(nothing)", before: "", after: "", source_url: "", quote: "" });
}

// Why a company was not enriched (lib/enrichment/notEnriched.ts), for the batch report.
const notEnrichedRows: NotEnrichedRow[] = [];
const websiteIssueOf = new Map<string, "content_mismatch" | "unreadable">();
function notEnrich(row: V2StartupRow, outcome: string, reason: string | undefined, detail?: string) {
  const why = whyNotEnriched(outcome, reason, websiteIssueOf.get(row.id), row.website);
  if (why) notEnrichedRows.push({ company: row.name, website: row.website ?? "", why, detail: detail ?? [outcome, reason].filter(Boolean).join(": ") });
}

// This run's enrichment_runs row: every write is recorded under it in
// field_changes, so the run can be undone as a whole (scripts/undo_run.ts).
let runId: string | null = null;

// The number of this batch (owner, round 10: batch 5 was written as batch_4.csv, "w4.x"): BATCH_NO=<n>, else the pilot_batch_<n>.json that holds every id of ONLY=, else the count of files + 1.
function batchNumber(): number {
  if (process.env.BATCH_NO && Number(process.env.BATCH_NO) > 0) return Number(process.env.BATCH_NO);
  if (ONLY.length) {
    for (const f of readdirSync(".").filter((x) => /^pilot_batch_\d+\.json$/.test(x))) {
      try {
        const b = JSON.parse(readFileSync(f, "utf8")) as unknown;
        const ids = new Set((Array.isArray(b) ? b : (b as { companies?: unknown[]; batch?: unknown[] }).companies ?? (b as { batch?: unknown[] }).batch ?? []).map((c) => String((c as { id?: string }).id ?? c).toLowerCase()));
        if (ids.size && ONLY.every((o) => ids.has(o))) return Number(f.match(/\d+/)![0]);
      } catch { /* not a batch file */ }
    }
  }
  try { return readdirSync(process.env.BATCH_DIR ?? "field_review").filter((f) => /^batch_\d+\.csv$/.test(f)).length + 1; } catch { return 1; }
}
const BATCH_NO = batchNumber();

async function registerRun(): Promise<string> {
  // A network error against the database (owner, 2026-11-21: "fetch failed" on a batch of 500) is tried again, waiting between the tries; any other error stops at once.
  const waits = [3_000, 10_000, 30_000];
  let last = "no row";
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    try {
      const { data, error } = await supabase.from("enrichment_runs").insert({
        pipeline: "v2", run_kind: "bulk", dry_run: false, git_sha: process.env.GIT_SHA ?? null,
        profile_model: PROFILE_MODEL, funding_model: FUNDING_MODEL,
        thresholds: { batch: BATCH_NO, MIN_PROFILE_CONFIDENCE, MIN_FUNDING_CONFIDENCE, MARKET_MODEL, MODE: PILOT ? "pilot" : UPDATE ? "update" : "full", ...(PILOT ? { PILOT_FIELDS, companies: ONLY.length } : {}) },
      }).select("run_id").single();
      if (!error && data) return (data as { run_id: string }).run_id;
      last = error?.message ?? "no row";
    } catch (e) { last = (e as Error).message; }
    const network = /fetch failed|network|timeout|timed out|ECONN|ETIMEDOUT|EAI_AGAIN|socket|502|503|504|ENOTFOUND/i.test(last);
    if (!network || attempt === waits.length) break;
    console.log(`⚠️  enrichment_runs: ${last} — trying again in ${waits[attempt] / 1000} s (${attempt + 1}/${waits.length})`);
    await new Promise((r) => setTimeout(r, waits[attempt]));
  }
  throw new Error(`could not register the run in enrichment_runs (${last}) — nothing written, since the run could not be undone`);
}

async function main() {
  // A run starts only on current code, and says which (owner, batch 6).
  if (process.env.GIT_CHECK !== "off" && !process.env.VITEST) {
    const f = checkFresh();
    console.log(`🔖  Running on commit ${f.commit} — ${f.subject}`);
    for (const w of f.warnings) console.log(`    ⚠️  ${w}`);
    if (!f.ok) { for (const p of f.problems) console.error(`⛔  ${p}`); console.error("⛔  Nothing was run. (GIT_CHECK=off skips this check.)"); process.exit(1); }
  }
  if (!DRY_RUN && !process.env.VITEST) {
    // Fields this batch holds back (held_fields.csv): not written, whatever else is.
    const heldFields = heldFieldsOf(BATCH_NO).filter(isCoreField);   // held fields concern core fields only
    if (heldFields.length) { for (const f of heldFields) HELD_ALL.add(f); console.log(`⏸️   Held fields of batch ${BATCH_NO} (held_fields.csv) — not written: ${heldFields.join(", ")}`); }
  }
  await initV1Context();
  installFetchTimeout();
  installHttpRecorder();   // every web response is recorded (live), or answered from the recording (REPLAY)
  quietOffline();
  anthropic = wrapAnthropic(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: Number(process.env.MODEL_TIMEOUT_MS ?? 120_000), maxRetries: 2 }));
  if (replayMode() !== "off") console.log(`🔁  REPLAY=${replayMode()}: the web is not fetched (only what is in cache/enrich_v2), the model is asked only what it was never asked.\n`);
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
  // A wet run is written only after its own dry pass has passed acceptance (owner, round 10: acceptance ran after the writing and a duplicate round was written). The pass runs
  // here, before anything is written; with the recordings of the earlier runs it costs nothing, and the writing pass then uses the same recordings (REPLAY), so it writes what was checked.
  if (!DRY_RUN && process.env.PREFLIGHT !== "off") {
    const { spawnSync } = await import("child_process");
    const { openSync } = await import("fs");
    console.log("🛂  Preflight: a dry pass of the same companies, then the acceptance checks — nothing is written until they pass.");
    const out = openSync("preflight.log", "w");
    const child = spawnSync("npx", ["tsx", "scripts/bulk_enrich_v2.ts"], { env: { ...process.env, GIT_CHECK: "off", DRY_RUN: "true", REPLAY: process.env.REPLAY ?? "1", PILOT_REPORT: "pilot_report_preflight.csv", PREFLIGHT: "off", BATCH_NO: String(BATCH_NO) }, stdio: ["ignore", out, out] });
    if (child.status !== 0) { console.error(`⛔  The preflight dry pass failed (exit ${child.status}) — nothing written. See preflight.log.`); process.exit(1); }
    const a = acceptanceReport("pilot_report_preflight.csv", specPathsFor(BATCH_NO));
    console.log(`\n── Preflight acceptance ──\n${a.text}\n`);
    // An ERROR no longer stops the whole run (owner, batch 6): the values that broke a check are not written and are listed in blocked_values.csv; everything else is written.
    if (a.failed) {
      const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      writeFileSync("blocked_values.csv", "\uFEFF" + [["company", "field", "value", "source_url", "check", "why"].join(","), ...a.blocked.map((b) => [b.company, b.field, b.after, b.source_url, b.check, b.why].map(q).join(","))].join("\r\n") + "\r\n");
      // A field that fails its own acceptance checks is not written for the batch; every other field is (owner, 2026-11-19). A whole-company block ("*") stays with the company.
      const heldNow = new Map<string, { checks: Set<string>; n: number }>();
      for (const b of a.blocked) {
        if (b.field === "*") { const k = foldName(b.company); (BLOCKED.get(k) ?? BLOCKED.set(k, new Set()).get(k)!).add("*"); continue; }
        HELD_ALL.add(b.field);
        const e = heldNow.get(b.field) ?? heldNow.set(b.field, { checks: new Set(), n: 0 }).get(b.field)!; e.checks.add(b.check); e.n++;
      }
      addHeldFields([...heldNow].map(([field, e]) => ({ batch: BATCH_NO, field, source: `acceptance: ${[...e.checks].join("+")}`, detail: `${e.n} value(s) broke the check(s)` })));
      console.log(`🚧  ${a.failed} acceptance ERROR(s): ${a.blocked.length} value(s) broke a check; ${heldNow.size ? `the field(s) ${[...heldNow.keys()].join(", ")} are held for the whole batch (held_fields.csv); ` : ""}everything else is written.`);
      for (const u of a.unblockable) console.log(`    ⚠️  not blockable (no value to hold back): ${u}`);
    }
    process.env.REPLAY ??= "1";
  }
  // EXCLUDE=<report numbers> (owner, batch 6): values of the reviewed dry report that are not written. The numbers are those of the report ("d6.17" or "17"); they are read from the preflight pass's
  // rows with the same numbering as the dry report. The writer works by field, so every other value of the same company and field is held back with them — listed, never silent.
  // pending_fixes.csv: a wrong value found in a check of this batch is excluded by its content, and the rest is written (owner, 2026-11-19).
  const pendingTokens = !DRY_RUN ? pendingExcludes(BATCH_NO).map((f) => f.token) : [];
  // UNMARKED_FIELDS=tags,news (owner, 2026-11-19, batch 8): of these fields only the values the sample checked and marked correct are written; every other value of them is excluded by its content
  // (the writer then holds that company's field back whole, as for any excluded value). Read from EXCLUDE_FROM (the reviewed dry report).
  if (!DRY_RUN && (process.env.UNMARKED_FIELDS ?? "").trim()) {
    const fields = process.env.UNMARKED_FIELDS!.split(",").map((x) => x.trim()).filter(Boolean);
    const from = process.env.EXCLUDE_FROM ?? "pilot_report_preflight.csv";
    if (!existsSync(from)) { console.error(`⛔  UNMARKED_FIELDS needs the reviewed dry report (${from} is missing): EXCLUDE_FROM=pilot_report_dry.csv.`); process.exit(1); }
    const [h, ...b] = parseReportCsv(readFileSync(from, "utf8"));
    const marks = readSampleMarks(); let n = 0;
    for (const r of b) {
      const co = r[h.indexOf("company")] ?? "", f = r[h.indexOf("field")] ?? "", v = r[h.indexOf("after")] ?? "";
      if (!fields.includes(f) || !v) continue;
      if (marks[sampleMarkKey(co, f, v)]?.verdict === "correct") continue;
      pendingTokens.push(`${co}:${f}:${v.slice(0, 80)}`); n++;
    }
    console.log(`🧪  UNMARKED_FIELDS=${fields.join(",")}: ${n} value(s) the sample did not mark correct are not written.`);
  }
  if (pendingTokens.length) console.log(`📋  pending_fixes.csv: ${pendingTokens.length} value(s) of batch ${BATCH_NO} excluded by content: ${pendingTokens.map((t) => t.slice(0, 50)).join(" | ")}`);
  if (!DRY_RUN && ((process.env.EXCLUDE ?? "").trim() || (process.env.EXCLUDE_RULE ?? "").trim() || pendingTokens.length)) {
    const from = process.env.EXCLUDE_FROM ?? "pilot_report_preflight.csv";
    if (!existsSync(from)) { console.error(`⛔  EXCLUDE needs the rows of the reviewed report (${from} is missing) — run with the preflight, or give EXCLUDE_FROM=<a dry report csv>.`); process.exit(1); }
    const [head, ...body] = parseReportCsv(readFileSync(from, "utf8"));
    const ix = (n: string) => head.indexOf(n);
    const rows = body.map((r) => ({ company_id: r[ix("company_id")] ?? "", company: r[ix("company")] ?? "", field: r[ix("field")] ?? "", value: r[ix("after")] ?? "", source_url: r[ix("source_url")] ?? "", quote: r[ix("quote")] ?? "", rule: ix("rule") >= 0 ? r[ix("rule")] ?? "" : "" })).filter((r) => r.company && r.field && r.field !== "(nothing)");
    const numbered = numberValues(rows, BATCH_NO, "d") as Array<ReturnType<typeof numberValues>[number] & { rule?: string }>;
    if (process.env.EXPECT_TOTAL && Number(process.env.EXPECT_TOTAL) !== numbered.length) { console.error(`⛔  The rows to number are ${numbered.length}, the reviewed report had ${process.env.EXPECT_TOTAL} — the numbers would point at other values. Nothing written.`); process.exit(1); }
    // Entries are report numbers ("17", "d6.17") or "<Company>:<field>" (stable when the report is numbered again after a rule change: "Ripio:tags").
    const tokens = (process.env.EXCLUDE ?? "").split(/,/).map((x) => x.trim()).filter(Boolean);
    const named = [...tokens.filter((t) => t.includes(":")), ...pendingTokens];
    const wanted = tokens.filter((t) => !t.includes(":")).flatMap((t) => t.split(/\s+/)).map((x) => x.trim().replace(/^[dw]\d+\./i, "")).filter(Boolean).map(Number);
    const bad = wanted.filter((n) => !Number.isInteger(n) || n < 1 || n > numbered.length);
    if (bad.length) { console.error(`⛔  EXCLUDE has numbers that are not in the report (1–${numbered.length}): ${bad.join(", ")}`); process.exit(1); }
    const noMatch: string[] = [];
    const byName = named.flatMap((t) => {
      // "<Company>:<field>" or "<Company>:<field>:<part of the value>" (the value narrows which of the field's rows is meant; the writer still holds the whole field).
      const [co, field = "", ...v] = t.split(":"); const value = v.join(":").trim();
      const foldV = (z: string) => z.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const hit = numbered.filter((x) => foldName(x.company) === foldName(co) && (field.trim() === "*" || x.field === field.trim() || x.field.startsWith(field.trim())) && (!value || foldV(x.value).includes(foldV(value))));
      if (!hit.length) noMatch.push(t);
      return hit;
    });
    // EXCLUDE_RULE=<code>[,<code>]: every value a rule made (ruleRegistry.ts) — for a rule found to be wrong.
    const ruleCodes = (process.env.EXCLUDE_RULE ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const byRule = ruleCodes.length ? numbered.filter((x) => ruleCodes.includes(x.rule ?? "")) : [];
    for (const c of ruleCodes) if (!numbered.some((x) => x.rule === c)) console.log(`    ℹ️  EXCLUDE_RULE=${c}: no value of this run was made by that rule.`);
    if (noMatch.length) console.log(`    ℹ️  EXCLUDE entries that match no value of the dry pass (nothing to hold back): ${noMatch.join(", ")}`);
    const chosen = [...new Set([...wanted.map((n) => numbered[n - 1]), ...byName, ...byRule])];
    const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines: string[][] = [];
    for (const c of chosen) {
      (BLOCKED.get(foldName(c.company)) ?? BLOCKED.set(foldName(c.company), new Set()).get(foldName(c.company))!).add(c.field);
      lines.push([c.id, c.company, c.field, c.value, byRule.includes(c) && !byName.includes(c) ? `excluded: rule ${c.rule}` : "excluded by the owner"]);
      for (const o of numbered.filter((x) => x.company_id === c.company_id && x.field === c.field && x.id !== c.id && !chosen.includes(x))) lines.push([o.id, o.company, o.field, o.value, `held back with ${c.id} (the writer works by field)`]);
    }
    writeFileSync("excluded_values.csv", "\uFEFF" + [["id", "company", "field", "value", "why"].join(","), ...lines.map((l) => l.map(q).join(","))].join("\r\n") + "\r\n");
    console.log(`🚧  EXCLUDE: ${chosen.length} value(s) not written (excluded_values.csv):`);
    for (const l of lines) console.log(`    ${l[0]}  ${l[1]} · ${l[2]}: ${l[3].slice(0, 70)} — ${l[4]}`);
  }
  if (!DRY_RUN) {
    runId = await registerRun();
    console.log(`🧾  run_id ${runId} — undo everything this run writes: RUN_ID=${runId} npx tsx scripts/undo_run.ts`);
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
  // REGRESSION=1: the companies run as if nothing were on file (what the database holds does not hide what the code finds), only the identity kept.
  if (REGRESSION) {
    const blank = ["description", "value_proposition", "industry", "founded_year", "country", "city", "founding_country", "employee_count", "employee_range", "growth_trend", "founders", "leadership", "competitors", "acquisitions", "news", "patent_count", "patent_fields", "patents", "tech_stack", "arr_milestones", "revenue_estimate", "valuation_benchmarks", "sector_id", "last_enriched_at"];
    for (const s of startups) if (ONLY.includes(s.id.toLowerCase())) { for (const c of blank) (s as unknown as Record<string, unknown>)[c] = null; roundsByStartup.delete(s.id); }
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
    websitePagesFetched: 0, websitePagesSkippedThin: 0, serperCalls: 0, tavilyCalls: 0, jinaSearchCalls: 0, serperScrapes: 0,
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

  // CONCURRENCY=5: five companies at once, each one's log gathered into one block, each held to COMPANY_TIMEOUT_MS (10 minutes) so a dead site cannot stall the run.
  const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? 1));
  const COMPANY_TIMEOUT_MS = Number(process.env.COMPANY_TIMEOUT_MS ?? 600_000);
  if (CONCURRENCY > 1) installCompanyLog();
  installLineTap();   // after the gathering patch: every line is also kept for the company's gaps
  let next = 0, finished = 0, stopSystemic = false;
  const running = new Set<string>();
  const heartbeat = CONCURRENCY > 1 ? setInterval(() => console.log(`⏳ ${finished}/${queue.length} done · running: ${[...running].join(", ") || "—"}`), 60_000) : null;
  const worker = async (w: number) => {
    while (!stopRequested && !stopSystemic && !costCapHit) {
      const i = next++;
      if (i >= queue.length) return;
      const row = queue[i];
      const elapsedMin = (Date.now() - runStartedAt) / 60_000;
      const t = summary.tally;
      console.log(`📍 [${i + 1}/${queue.length}] ${elapsedMin.toFixed(0)} min | $${summary.totalCostUsd.toFixed(2)} so far | ✅ ${t.success} 🟠 ${t.partial} 🚫 ${t.rejected} 🔍 ${t.low_evidence + t.no_data} 💥 ${t.error}${t.search_unavailable ? ` 📡 ${t.search_unavailable}` : ""}${UPDATE ? ` 💤 ${t.no_change}` : ""}  → ${row.name}`);
      const errorsBefore = summary.tally.error + summary.tally.error_incomplete_extraction + summary.tally.search_unavailable;
      const noChangeBefore = summary.tally.no_change;
      running.add(row.name);
      const job = () => withCompany(row.name, () => processCompany(row, roundsByStartup.get(row.id) ?? [], taxonomy, startupByDomain, summary));
      let timedOut = false;
      const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), COMPANY_TIMEOUT_MS));
      if (CONCURRENCY > 1) {
        const g = gathered(job);
        const first = await Promise.race([g, timeout]);
        if (first === "timeout") { timedOut = true; console.log(`⏱️  ${row.name}: still running after ${COMPANY_TIMEOUT_MS / 60_000} min — given up (counted as an error); its work is abandoned.`); summary.tally.error++; failedNames.add(row.name); notEnrich(row, "error", "timeout", `the company took longer than ${COMPANY_TIMEOUT_MS / 60_000} minutes`); }
        else { console.log(`┌── ${row.name}\n${first.lines.join("\n")}\n└── ${row.name} done`); if (first.error) { console.error(`💥  ${row.name}: ${String(first.error)}`); summary.tally.error++; failedNames.add(row.name); } }
      } else {
        const first = await Promise.race([job().then(() => "ok" as const), timeout]);
        if (first === "timeout") { timedOut = true; console.log(`⏱️  ${row.name}: still running after ${COMPANY_TIMEOUT_MS / 60_000} min — given up (counted as an error).`); summary.tally.error++; failedNames.add(row.name); notEnrich(row, "error", "timeout", `the company took longer than ${COMPANY_TIMEOUT_MS / 60_000} minutes`); }
      }
      running.delete(row.name); finished++;
      consecutiveErrors = failedNames.has(row.name) ? consecutiveErrors + 1 : 0;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`\n⛔  ${consecutiveErrors} companies in a row failed — this looks systemic (API key, credits, provider outage), not company-specific. Stopping so the rest of the queue isn't burned.`);
        stopSystemic = true; return;
      }
      if (!DRY_RUN && REFRESH_EVERY > 0 && finished % REFRESH_EVERY === 0) await refreshSearch();
      if (next < queue.length && !stopRequested && !timedOut) {
        const wait = summary.tally.no_change > noChangeBefore ? Math.min(DELAY_MS, 2_000) : DELAY_MS;
        if (CONCURRENCY === 1) console.log(`    ⏳  Waiting ${wait / 1000}s…\n`);
        await interruptibleSleep(wait);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => worker(w)));
  if (heartbeat) clearInterval(heartbeat);
  // The cost cap was reached (MAX_COST): the companies not started are listed, the reports below are written for the others, and the run ends with exit code 3 (scripts/run_batch.ts goes on with what was collected).
  if (costCapHit) {
    const left = queue.slice(next).map((c) => c.id);
    try { writeFileSync(`unprocessed_batch_${BATCH_NO}.json`, JSON.stringify({ reason: "MAX_COST", cost: summary.totalCostUsd, ids: left }, null, 1)); } catch { /* a convenience */ }
    console.log(`💸  MAX_COST reached: ${left.length} compan(ies) were not started (unprocessed_batch_${BATCH_NO}.json); the others are reported and written as usual.`);
    process.exitCode = 3;
  }
  if (stopRequested) console.log("🛑  Stopped by request. Re-running continues from the companies not yet processed (queue is ordered by last_enriched_at).");

  if (!DRY_RUN && (summary.totalFieldsPatched > 0 || summary.totalRoundsInserted > 0 || summary.totalRoundsUpdated > 0)) {
    await refreshSearch();
  }

  if (runId) {
    const { error } = await supabase.from("enrichment_runs").update({
      finished_at: new Date().toISOString(), companies_count: Object.values(summary.tally).reduce((n, c) => n + c, 0), total_cost_usd: summary.totalCostUsd,
    }).eq("run_id", runId);
    if (error) console.warn(`⚠️  enrichment_runs not closed: ${error.message}`);
  }

  console.log(`\n${"═".repeat(62)}`);
  console.log("V2 ENRICHMENT RUN SUMMARY");
  console.log("═".repeat(62));
  for (const [status, count] of Object.entries(summary.tally)) {
    console.log(`  ${status.padEnd(28)} ${count}`);
  }
  for (const l of recorderSummary()) console.log(l);
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
  console.log(`  claude cost                  $${summary.totalCostUsd.toFixed(2)}  (from the tokens each call reported; search API cost is separate)`);
  console.log(`  longest prompt               ${LLM.maxPromptTokens.toLocaleString()} tokens · calls over ${LONG_PROMPT_TOKENS.toLocaleString()}: ${LLM.callsOverLong}${LLM.callsOverLong ? "  ⚠️  billed at Haiku 5.5's long-prompt rate" : ""}`);
  if (jinaDisabled()) console.log(`  ⛔ Jina Reader was switched off mid-run (${jinaDisabled()}) — top up Jina and re-run the affected companies for full articles.`);
  console.log(`  website pages: ${summary.websitePagesFetched} real / ${summary.websitePagesSkippedThin} thin-404 / ${summary.websitePagesDuplicate} duplicate skipped  |  serper calls: ${summary.serperCalls}  |  jina search (Serper backup): ${summary.jinaSearchCalls}  |  serper scrape (Jina backup): ${summary.serperScrapes}  |  tavily calls: ${summary.tavilyCalls}`);
  for (const l of notEnrichedReport(notEnrichedRows, Object.values(summary.tally).reduce((n, c) => n + c, 0))) console.log(`  ${l}`);
  console.log("  dropped/flagged by reason code:");
  for (const [reason, count] of summary.droppedByReason) {
    console.log(`    ${reason.padEnd(32)} ${count}`);
  }
  console.log("═".repeat(62));
  if (notEnrichedRows.length && !process.env.VITEST) {
    const ncell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    writeFileSync("not_enriched.csv", "\uFEFF" + ["company,website,why,detail", ...notEnrichedRows.map((r) => [r.company, r.website, r.why, r.detail].map(ncell).join(","))].join("\r\n") + "\r\n");
    console.log(`📋  ${notEnrichedRows.length} company(ies) not enriched, with the reason, in not_enriched.csv.`);
    { const tt = traceTable(); if (tt) console.log(`\n${tt}\n`); }
    // Companies whose address on file is another business or unreadable and whose own site was not found: a list of their own (owner, round 10).
    const unresolved = notEnrichedRows.filter((r) => r.why === "domain_unresolved");
    if (unresolved.length) {
      writeFileSync("domain_unresolved.csv", "\uFEFF" + ["company,website,detail", ...unresolved.map((r) => [r.company, r.website, r.detail].map(ncell).join(","))].join("\r\n") + "\r\n");
      console.log(`🧭  ${unresolved.length} company(ies) with no usable website (domain_unresolved) in domain_unresolved.csv.`);
    }
  }
  if (rejectedDomains.size && !process.env.VITEST) {
    writeFileSync("rejected_domains.csv", rejectedDomainsCsv(rejectedDomains.rows_()));
    console.log(`📋  ${rejectedDomains.size} source domain/field pair(s) turned away as not on the allowed list, in rejected_domains.csv.`);
  }
  if (domainClasses.newThisRun().length && !process.env.VITEST) {
    writeFileSync("domain_classes_new.csv", domainClassesCsv(domainClasses.newThisRun()));
    console.log(`📋  ${domainClasses.newThisRun().length} source domain(s) classified for the first time, for your check, in domain_classes_new.csv.`);
  }
  if (carriedNotWritten.length && !process.env.VITEST) {
    const cols = ["company_id", "company", "field", "value", "source_url", "quote"];
    const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    writeFileSync("carried_not_written.csv", "\uFEFF" + [cols.join(","), ...carriedNotWritten.map((r) => cols.map((c) => cell(r[c] ?? "")).join(","))].join("\r\n") + "\r\n");
    console.log(`📎  ${carriedNotWritten.length} remembered value(s) are not in the report: this run did not write them — carried_not_written.csv (${[...new Set(carriedNotWritten.map((r) => r.field))].join(", ")}).`);
  }
  const allWebsiteRows = [...websiteRows, ...repurposedRows];
  if (allWebsiteRows.length && !process.env.VITEST) {
    const wcols = ["company_id", "company", "website", "reason", "detail"];
    const wcell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    writeFileSync("website_review.csv", "\uFEFF" + [wcols.join(","), ...allWebsiteRows.map((r) => wcols.map((c) => wcell(r[c] ?? "")).join(","))].join("\r\n") + "\r\n");
    console.log(`🛠️   ${allWebsiteRows.length} website(s) to fix in website_review.csv${DRY_RUN ? "" : " (and the website_review table)"}.`);
  }
  if (rejectedAll.length) {
    writeFileSync("rejected_all.csv", rejectionsCsv(rejectedAll, false));
    const sample = sampleRejections(rejectedAll, Number(process.env.REJECTED_SAMPLE ?? 30));
    writeFileSync("rejected_sample_30.csv", rejectionsCsv(sample, true));
    const byCode = new Map<string, number>(); for (const r of rejectedAll) byCode.set(r.reason_code, (byCode.get(r.reason_code) ?? 0) + 1);
    console.log(`🚫  ${rejectedAll.length} rejected value(s) (rejected_all.csv) — ${[...byCode].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c}×${n}`).join(", ")}; ${sample.length} of them, stratified by reason, in rejected_sample_30.csv — mark right/wrong, then: npx tsx scripts/rejected_stats.ts`);
  }
  if (KNOWN_ON) {
    saveGaps(gapStore);
    const ids = [...new Set(pilotRows.map((r) => r.company_id))];
    const rowsMissing = missingRows(gapStore, ids, new Set(websiteRows.filter((w) => /unreadable/i.test(w.reason ?? "")).map((w) => w.company)));
    writeFileSync("missing_by_field.csv", missingCsv(rowsMissing));
    const byField = new Map<string, number>(); for (const r of rowsMissing) byField.set(r.field, (byField.get(r.field) ?? 0) + 1);
    console.log(`🕳️   missing_by_field.csv: ${rowsMissing.length} missing value(s) — ${[...byField].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}×${n}`).join(", ")}  (gaps kept in ${GAPS_PATH})`);
  }
  if (KNOWN_ON && Object.keys(knownStore).length) { saveKnown(knownStore); console.log(`📚  Known sources saved: ${KNOWN_PATH} (${Object.values(knownStore).reduce((n, l) => n + l.length, 0)} value(s) of ${Object.keys(knownStore).length} compan(ies)).`); }
  if (PILOT || pilotRows.length > 0) {
    const cols = ["company_id", "company", "field", "before", "after", "source_url", "quote", "origin", "quote_original", "quote_translated", "rule"];
    const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    writeFileSync(PILOT_REPORT, "\uFEFF" + [cols.join(","), ...pilotRows.map((r) => cols.map((c) => cell(r[c] ?? "")).join(","))].join("\r\n") + "\r\n");
    // The numbered report of this batch (owner, 2026-11-05): the owner answers with the wrong numbers.
    const batchDir = process.env.BATCH_DIR ?? "field_review";
    mkdirSync(batchDir, { recursive: true });
    const batchNo = BATCH_NO;
    const numbered = numberValues(pilotRows.filter((r) => r.field !== "(nothing)").map((r) => ({ company_id: r.company_id, company: r.company, field: r.field, value: r.after, source_url: r.source_url, quote: r.quote })), batchNo, DRY_RUN ? "d" : "w");
    const batchPath = `${batchDir}/batch_${batchNo}.csv`;
    if (!DRY_RUN && numbered.length) writeFileSync(batchPath, batchCsv(numbered));
    if (numbered.length) console.log("\n" + renderBatchReport(numbered, { batchNo, runId, dry: DRY_RUN, csvPath: DRY_RUN ? undefined : batchPath }));
    if (specPathsFor(BATCH_NO).length) { try { const a = acceptanceReport(PILOT_REPORT, specPathsFor(BATCH_NO)); console.log(`\n── Acceptance checks (${specPathsFor(BATCH_NO).join(" + ")}) ──\n${a.text}\n`); } catch (e) { console.log(`⚠️  acceptance checks not run: ${(e as Error).message}`); } }
    console.log(`📝  Pilot report: ${PILOT_REPORT} — ${pilotRows.filter((r) => r.field !== "(nothing)").length} field(s) ${DRY_RUN ? "that would be written" : "written"} for ${new Set(pilotRows.map((r) => r.company_id)).size} compan(ies).${runId ? ` Undo: RUN_ID=${runId} npx tsx scripts/undo_run.ts` : ""}`);
    // The short report of a batch (owner, batch 7): who was enriched, who was turned away and why, the coverage per field, what was held back, the run.
    {
      const enrichedIds = new Set(pilotRows.filter((r) => r.field !== "(nothing)").map((r) => r.company_id));
      const byWhy = new Map<string, number>();
      for (const n of notEnrichedRows) byWhy.set(n.why, (byWhy.get(n.why) ?? 0) + 1);
      const total = queue.length, enrichedN = enrichedIds.size;
      const fieldsShown = (SHOW_ALL ? ASKED : OPEN_FIELDS);
      const fam = (f: string) => (f === "description_what_only" ? "description" : f);
      const cover = fieldsShown.map((f) => {
        const n = new Set(pilotRows.filter((r) => fam(r.field) === f || (f === "round" && r.field === "round")).map((r) => r.company_id)).size;
        return `${f} ${n}/${enrichedN || 0}`;
      });
      const held = [...BLOCKED.entries()].map(([c, fs]) => `${c}: ${[...fs].join("+")}`);
      const mins = ((Date.now() - runStartedAt) / 60_000).toFixed(1);
      const lines = [
        `# Batch ${BATCH_NO} — ${DRY_RUN ? "dry" : "wet"} run`,
        "",
        `- companies in the batch: ${total}`,
        `- enriched (with values in the report): ${enrichedN}`,
        `- not enriched: ${notEnrichedRows.length}${notEnrichedRows.length ? ` — ${[...byWhy].map(([w, n]) => `${w} ${n}`).join(", ")}` : ""}`,
        `- coverage by field (companies with a value / enriched companies): ${cover.join(" · ")}`,
        `- held back (excluded or blocked): ${held.length ? held.join(" | ") : "none"}${existsSync("blocked_values.csv") && !DRY_RUN ? " (blocked_values.csv)" : ""}${existsSync("excluded_values.csv") && !DRY_RUN ? " (excluded_values.csv)" : ""}`,
        `- remembered values not written: ${carriedNotWritten.length}${carriedNotWritten.length ? " (carried_not_written.csv)" : ""}`,
        `- time ${mins} min · model cost $${summary.totalCostUsd.toFixed(2)}`,
        `- run_id: ${runId ?? "— (dry)"}${runId ? ` · undo: RUN_ID=${runId} DRY_RUN=false npx tsx scripts/undo_run.ts` : ""}`,
      ];
      console.log("\n" + lines.join("\n"));
      if (!process.env.VITEST) { try { writeFileSync(`batch_${BATCH_NO}_summary.md`, lines.join("\n") + "\n"); } catch { /* a convenience */ } }
    }
    // After a wet run: every value of the report is in the database (owner, batch 6: seven reported values were not). A missing one undoes the run.
    if (!DRY_RUN && runId && process.exitCode !== 1) {
      const { spawnSync } = await import("child_process");
      const v = spawnSync("npx", ["tsx", "scripts/verify_written.ts"], { env: { ...process.env, REPORT: PILOT_REPORT }, encoding: "utf8" });
      const out = `${v.stdout ?? ""}${v.stderr ?? ""}`.split("\n").filter((l) => /Database vs|✗|✅|Error|error/.test(l)).join("\n");
      console.log(`🗄️   ${out || "database check gave no output"}`);
      // A few values missing from the database do not undo the batch (owner, 2026-11-22): they are taken out of it (unwritten_values.csv, candidate_values). Many missing (more than 2% of the values, or 10) is a systematic
      // fault — the batch is undone as before.
      let systemic = v.status !== 0;
      if (v.status === 1) {
        const lines = parseVerifyMissing(`${v.stdout ?? ""}`);
        const checked = Number(`${v.stdout ?? ""}`.match(/(\d+) value\(s\) checked/)?.[1] ?? 0);
        const missingRows = lines.flatMap((m) => { const hit = pilotRows.find((r) => r.company === m.company && r.field === m.field && r.after.startsWith(m.valueStart.slice(0, 40))); return hit ? [{ company_id: hit.company_id, company: hit.company, field: hit.field, after: hit.after, source_url: hit.source_url, quote: hit.quote }] : []; });
        if (missingRows.length === lines.length && quarantinable(lines.length, checked)) {
          await quarantineUnwritten(missingRows, "not in the database after the write");
          // The report, the baseline and the audit see only what was written: the values taken out leave pilotRows and the report file (verify_written then passes on the same file).
          for (const m of missingRows) { const i = pilotRows.findIndex((r) => r.company === m.company && r.field === m.field && r.after === m.after); if (i >= 0) pilotRows.splice(i, 1); }
          try { const cut = dropRowsFromCsv(readFileSync(PILOT_REPORT, "utf8"), missingRows); realWriteFileSync(PILOT_REPORT, cut.text); console.log(`    ✂️  ${cut.removed} row(s) taken out of ${PILOT_REPORT}`); } catch (e) { console.log(`    ⚠️  ${PILOT_REPORT} could not be cleaned: ${(e as Error).message}`); }
          systemic = false;
        }
      }
      if (v.status !== 0 && systemic) {
        console.error(v.status === 1 ? "⛔  A value of the report is not in the database." : "⚠️  The database check could not run.");
        if (v.status === 1 && process.env.AUTO_UNDO !== "false") {
          console.error("⛔  Undoing this run.");
          const u = spawnSync("npx", ["tsx", "scripts/undo_run.ts"], { env: { ...process.env, RUN_ID: runId, DRY_RUN: "false" }, stdio: "inherit" });
          console.error(u.status === 0 ? `↩️   Run ${runId} undone.` : `⚠️  The automatic undo failed (exit ${u.status}) — run: RUN_ID=${runId} DRY_RUN=false npx tsx scripts/undo_run.ts`);
          process.exitCode = 1;
        }
      }
    }
    // The values this wet run wrote are the baseline of the batch from now on, and the batch joins the regression gate (owner, 2026-11-19).
    const registerWritten = () => {
      if (DRY_RUN || !runId || process.exitCode === 1 || process.env.VITEST) return;
      try {
        const values = watched(pilotRows.filter((r) => r.field !== "(nothing)").map((r) => ({ company: r.company, field: r.field, value: r.after })));
        const had = loadBaseline(BATCH_NO);
        // Another wet run of the same batch (a completion of its held fields) adds to its baseline.
        const merged = watched([...(had?.values ?? []), ...values].map((v) => ({ company: v.company, field: v.field, value: v.value })));
        saveBaseline({ batch: BATCH_NO, commit: headCommit(), created_at: new Date().toISOString(), companies: new Set(pilotRows.map((r) => r.company_id)).size, source: `wet run ${runId}`, values: merged, acceptance: had?.acceptance ?? [] });
        addWrittenBatch(BATCH_NO);
        console.log(`🚦  Batch ${BATCH_NO} joins the regression gate: baseline/batch_${BATCH_NO}.json (${merged.length} value(s)); written batches: ${writtenBatches().join(", ")}`);
      } catch (e) { console.log(`⚠️  the batch could not be added to the regression gate: ${(e as Error).message}`); }
    };
    // After a wet run: what was written must be what the dry pass reported, row against row (owner, batch 6). Any difference undoes the run.
    if (!DRY_RUN && runId && process.exitCode !== 1 && existsSync("pilot_report_preflight.csv") && process.env.PREFLIGHT !== "off") {
      const [h, ...b] = parseReportCsv(readFileSync("pilot_report_preflight.csv", "utf8"));
      const at = (n: string) => h.indexOf(n);
      const keyOf = (c: string, f: string, a: string) => `${foldName(c)}|${f}|${a.replace(/\s+/g, " ").trim()}`;
      const held = heldRow;
      const expected = new Map(b.filter((r) => r[at("field")] && r[at("field")] !== "(nothing)" && !held(r[at("company")], r[at("field")])).map((r) => [keyOf(r[at("company")], r[at("field")], r[at("after")]), `${r[at("company")]} · ${r[at("field")]}: ${r[at("after")].slice(0, 70)}`]));
      const written = new Map(pilotRows.filter((r) => r.field !== "(nothing)").map((r) => [keyOf(r.company, r.field, r.after), `${r.company} · ${r.field}: ${r.after.slice(0, 70)}`]));
      const extra = [...written].filter(([k]) => !expected.has(k)).map(([, v]) => v);
      const missing = [...expected].filter(([k]) => !written.has(k)).map(([, v]) => v);
      console.log(`🔎  Written vs the dry pass: ${written.size} written, ${expected.size} expected — ${extra.length} not in the dry pass, ${missing.length} in it but not written.`);
      if (extra.length || missing.length) {
        for (const e of extra) console.log(`    ➕ written, not in the dry report: ${e}`);
        for (const m of missing) console.log(`    ➖ in the dry report, not written: ${m}`);
        // Values the dry pass proposed and the write did not make are nothing wrong in the database: they are taken out of the batch and the rest stays (owner, 2026-11-22). Only a value written that nobody reviewed
        // (extra) is a reason to undo — it cannot be taken out one by one.
        if (missing.length) {
          const missKeys = new Set([...expected].filter(([k]) => !written.has(k)).map(([k]) => k));
          const rowsMissing = b.filter((r) => missKeys.has(keyOf(r[at("company")], r[at("field")], r[at("after")]))).map((r) => ({ company_id: r[at("company_id")] ?? "", company: r[at("company")], field: r[at("field")], after: r[at("after")], source_url: r[at("source_url")] ?? "", quote: r[at("quote")] ?? "" }));
          await quarantineUnwritten(rowsMissing, "in the dry report, not written by the write");
        }
      }
      if (extra.length) {
        if (process.env.AUTO_UNDO !== "false") {
          console.error("⛔  The database differs from the reviewed report — undoing this run.");
          const { spawnSync } = await import("child_process");
          const u = spawnSync("npx", ["tsx", "scripts/undo_run.ts"], { env: { ...process.env, RUN_ID: runId, DRY_RUN: "false" }, stdio: "inherit" });
          console.error(u.status === 0 ? `↩️   Run ${runId} undone.` : `⚠️  The automatic undo failed (exit ${u.status}) — run: RUN_ID=${runId} DRY_RUN=false npx tsx scripts/undo_run.ts`);
          process.exitCode = 1;
        }
      }
    }
    registerWritten();
  }
}

/**
 * A core value that was not written, or is not in the database after the write, does not undo the batch (owner, 2026-11-22: two values of one company undid 500). It is taken out of the batch: listed in
 * unwritten_values.csv and kept in candidate_values (rule "unwritten_core") with its source and quote, so nothing found is lost; everything else stays written.
 */
const quarantinedKeys = new Set<string>();
async function quarantineUnwritten(rows0: Array<{ company_id: string; company: string; field: string; after: string; source_url?: string; quote?: string }>, why: string): Promise<void> {
  // a value is taken out once, whichever check finds it first
  const rows = rows0.filter((r) => { const k = `${foldName(r.company)}|${r.field}|${r.after.replace(/\s+/g, " ").trim()}`; if (quarantinedKeys.has(k)) return false; quarantinedKeys.add(k); return true; });
  if (!rows.length) return;
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  try {
    const had = existsSync("unwritten_values.csv");
    appendFileSync("unwritten_values.csv", (had ? "" : "\uFEFF" + ["batch", "company", "field", "value", "why"].join(",") + "\r\n") + rows.map((r) => [BATCH_NO, r.company, r.field, r.after, why].map((c) => q(String(c))).join(",")).join("\r\n") + "\r\n");
  } catch { /* a convenience */ }
  try {
    const { error } = await supabase.from("candidate_values").upsert(rows.filter((r) => r.company_id).map((r) => ({ startup_id: r.company_id, field: r.field, value: r.after, source_url: r.source_url || null, evidence_quote: r.quote || null, rule: "unwritten_core", batch: BATCH_NO, run_label: `batch_${BATCH_NO}` })), { onConflict: "startup_id,field,value_hash,batch", ignoreDuplicates: true });
    if (error) console.log(`    ⚠️  candidate_values: ${error.message} (the values are in unwritten_values.csv)`);
  } catch (e) { console.log(`    ⚠️  candidate_values: ${(e as Error).message} (the values are in unwritten_values.csv)`); }
  console.log(`📤  ${rows.length} value(s) taken out of the batch (${why}): unwritten_values.csv and candidate_values; the rest stays written: ${rows.slice(0, 6).map((r) => `${r.company} · ${r.field}`).join(" | ")}${rows.length > 6 ? " …" : ""}`);
}

const isDirectlyInvoked = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectlyInvoked) {
  main().then(() => {
    // Everything is written: a connection or timer left open (a page read for the memory of verified sources) must not keep the process alive for minutes (owner, round 10).
    setTimeout(() => process.exit(0), 5000).unref();
  }).catch((e) => {
    console.error("💥  Fatal error:", e);
    process.exit(1);
  });
}

export { main, processCompany };
