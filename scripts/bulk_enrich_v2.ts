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

import { classifyTier, type TierRow, type TierRound } from "../lib/enrichment/queue.ts";
import {
  createSearchProviderState, verifyDomainMatch, webSearch, newsSearch, serperSearch, serperNewsSearch, fetchCompanyWebsitePages, fetchArticleText,
  type SearchProviderState,
} from "../lib/enrichment/searchProviders.ts";
import { filterByEntity, deriveIdentityKeywords, nameQualifiersOnOwnSite, type EntityAnchors } from "../lib/enrichment/entity.ts";
import { buildLabeledSources, mergeDuplicateResults, type RawSearchResult, type LabeledSource } from "../lib/enrichment/sources.ts";
import { extractProfile, loadSectorTaxonomy, filterCrossSectorTags, type SectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { extractFunding, roundToRoundLike } from "../lib/enrichment/extractFunding.ts";
import { extractMarket, normalizeUrlForMatch } from "../lib/enrichment/extractMarket.ts";
import { detectGaps, buildDeepDiveQueries, hasNoFinancingRounds, type DeepDiveSection } from "../lib/enrichment/deepDive.ts";
import {
  groundRoundDetails, planRoundWrites, mergeProfileExtractions, mergeFundingExtractions, mergeMarketExtractions,
  normalizeIsoDate, appendNew, reconcileOnFile, type ExistingRoundRef,
} from "../lib/enrichment/assemble.ts";
import { fetchArticleOgImage } from "../lib/enrichment/ogImage.ts";
import { buildSharedExtractionRequest, type ExtractionKind } from "../lib/enrichment/sharedExtraction.ts";
import { openSearchCache } from "../lib/enrichment/searchCache.ts";
import { pickArticlesToRead } from "../lib/enrichment/articles.ts";
import { runTechGate, shouldSkipAsNonTech, type TechGateVerdict } from "../lib/enrichment/techGate.ts";
import { namesCompany } from "../lib/enrichment/headcount.ts";
import { foundersFromText, personMentionedIn, cleanPeople, isFounderEntry } from "../lib/enrichment/people.ts";
import { findPersonResult, discoverFounders, founderTitleFromHeadline, samePersonName, parseLinkedInFacts, bioFromLinkedInFacts } from "../lib/enrichment/linkedin.ts";
import { checkHeadcountOutlier } from "../lib/enrichment/validation.ts";
import { countryFromLocationQuote } from "../lib/enrichment/location.ts";
import { findListingStatement } from "../lib/enrichment/listing.ts";
import {
  ACTIVE_DAYS, QUIET_DAYS, SeenUrls, buildUpdateQueries, isUpdateDue, knownUrlSet, mentionsFunding, newResultsOnly,
  retireReplacedExecutives,
} from "../lib/enrichment/update.ts";
import { MAJOR_CITIES } from "../lib/enrichment/majorCities.ts";
import { normalizeForMatch } from "../lib/enrichment/evidence.ts";
import { validateEnrichment } from "../lib/enrichment/validation.ts";
import { computeTotalRaised, normalizeRoundType, type RoundLike } from "../lib/enrichment/rounds.ts";
import { computeFieldConfidence, meetsProfileThreshold } from "../lib/enrichment/confidence.ts";
import {
  decideScalarWrite, decideHeadcountUpdate, mergePeople, appendDatedFigures,
  fillScalarIfNull, type CandidateValue,
} from "../lib/enrichment/write.ts";
import { validateWebsiteCandidate, websiteDomain, type DomainOwner } from "../lib/enrichment/websiteValidation.ts";
import { sourceTypeRank, type SourceType } from "../lib/enrichment/sourceTypes.ts";

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
let warnedNoEnrichedV2Column = false;
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
const MIN_PROFILE_CONFIDENCE = Number(process.env.MIN_PROFILE_CONFIDENCE ?? 40);
const MIN_FUNDING_CONFIDENCE = Number(process.env.MIN_FUNDING_CONFIDENCE ?? 60);
const THRESHOLDS = { minProfileConfidence: MIN_PROFILE_CONFIDENCE, minFundingConfidence: MIN_FUNDING_CONFIDENCE };

// Upper bounds on the additive list sections, so repeated runs can't grow
// them without limit. Entries already on file are never removed.
const MAX_COMPETITORS = 8;
const MAX_NEWS = 15;

let anthropic: Anthropic;

// Stand-in for a funding call an update skipped (no money words in its pages).
const EMPTY_FUNDING_OUTCOME: NonNullable<Awaited<ReturnType<typeof extractFunding>>> = {
  extraction: { result: { funding_rounds: [], funding_history_complete: null, arr_milestones: [], revenue_estimate: null, valuation_benchmarks: [] }, dropped: [] },
  stopReason: "skipped", inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0,
};

// ── Row shapes this script reads/writes ──────────────────────────────────
interface V2StartupRow {
  id: string; name: string; website: string | null;
  description: string | null; value_proposition: string | null; industry: string | null;
  founded_year: number | null; country: string | null; city: string | null;
  employee_count: number | null; employee_range: string | null; growth_trend: string | null;
  founders: Array<{ name: string; title?: string; bio?: string; linkedin_url?: string; had_prior_exit?: boolean; elite_background?: boolean; notable_pedigree?: boolean }> | null;
  leadership: Array<{ name: string; role: string; bio?: string; linkedin_url?: string; joined_date?: string; had_prior_exit?: boolean; elite_background?: boolean; notable_pedigree?: boolean }> | null;
  competitors: Array<{ name: string; website?: string | null; how_it_competes: string; startup_id?: string | null }> | null;
  acquisitions: Array<{ company_name: string; website?: string | null; acquired_date?: string | null; amount?: number | null; description?: string | null; acquired_startup_id?: string | null }> | null;
  news: Array<{ title: string; url: string; source?: string | null; published_date?: string | null; summary?: string | null; image_url?: string | null }> | null;
  patent_count: number | null; patent_fields: string[] | null;
  patents: Array<{ title: string; patent_number?: string | null; filing_date?: string | null; url?: string | null; summary?: string | null }> | null;
  tech_stack: string[] | null; github_url: string | null; huggingface_url: string | null;
  arr_milestones: Array<{ arr: number; date?: string | null; source?: string | null; confidence?: string | null }> | null;
  revenue_estimate: { range_low?: number | null; range_high?: number | null; as_of_date?: string | null; source?: string | null; confidence?: string | null } | null;
  valuation_benchmarks: Array<{ valuation: number; date?: string | null; source?: string | null; is_estimated?: boolean | null }> | null;
  linkedin_url: string | null; facebook_url: string | null; instagram_url: string | null;
  sector_id: string | null;
  funding_history_complete: boolean | null;
  status: string;
  last_enriched_at: string | null;
  is_manually_verified: boolean;
}

interface V2FundingRoundRow {
  id: string; startup_id: string; round_type: string | null;
  amount_raised: number | null; valuation: number | null; is_valuation_estimated: boolean | null;
  announcement_date: string | null; source_url: string | null;
  lead_investor: string | null; investors: string[] | null;
  investor_amounts: Array<{ name: string; amount: number }> | null;
}

type ProcessStatus =
  | "success" | "partial" | "rejected" | "removed_public" | "no_data"
  | "low_evidence" | "error" | "error_incomplete_extraction" | "no_change";

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

// First-pass searches (10 web + 1 news): v1's query set, with its one overloaded "profile"
// query (founders + HQ + headcount + acquisitions + patents + social links
// in a single Google query) split into focused ones, one per section the
// company page shows. Each result keeps its query_label for evidence dumps.
async function runAllSearches(name: string, anchor: string, state: SearchProviderState): Promise<RawSearchResult[]> {
  const queries: Array<[string, string]> = [
    // history/amounts/backers (three overlapping funding queries) merged
    // into one general query plus one aimed at the funding databases.
    ["funding",      `"${name}"${anchor} raised funding round seed "Series A" million investors "led by"`],
    ["funding_db",   `"${name}" funding rounds investors site:crunchbase.com OR site:tracxn.com OR site:dealroom.co OR site:pitchbook.com OR site:cbinsights.com`],
    ["overview",     `"${name}"${anchor} company overview headquarters founded`],
    ["founders",     `"${name}"${anchor} founder CEO co-founder CTO`],
    ["team",         `"${name}"${anchor} employees team size headcount hiring`],
    ["linkedin",     `site:linkedin.com/company "${name}"`],
    ["competitors",  `"${name}"${anchor} competitors alternatives vs rivals "compared to" market landscape`],
    ["acquisitions", `"${name}"${anchor} acquires OR acquired OR acquisition`],
    ["patents",      `"${name}"${anchor} patent OR patents OR site:patents.google.com`],
    ["financials",   `"${name}"${anchor} ARR "annual recurring revenue" OR revenue estimate OR valued at OR valuation milestone`],
    // (the separate "tech stack" query was dropped: careers/engineering
    // pages fetched from the company's own site carry that, for free)
  ];
  const [searchBatches, newsResults] = await Promise.all([
    Promise.all(queries.map(([label, q]) => webSearch(q, label, state))),
    // Serper's News endpoint is primary for news; the site:-heavy query is
    // only used if Tavily has to supplement (see newsSearch()).
    newsSearch(
      `"${name}"${anchor} news`,
      `"${name}"${anchor} news 2025 2026 site:techcrunch.com OR site:venturebeat.com OR site:prnewswire.com OR site:businesswire.com OR site:forbes.com OR site:sifted.eu launch funding announcement`,
      "news", state,
    ),
  ]);
  return [...searchBatches.flat(), ...newsResults];
}

// MODE=update: news and change searches limited to pages published since
// the last check, plus one search per missing core field when due
// (lib/enrichment/update.ts). Serper only — Tavily can't filter by date.
async function runUpdateSearches(
  row: V2StartupRow, anchor: string, hasRounds: boolean, gapFillDue: boolean, state: SearchProviderState,
): Promise<RawSearchResult[]> {
  const since = (row.last_enriched_at ?? new Date(Date.now() - QUIET_DAYS * 86_400_000).toISOString()).slice(0, 10);
  const queries = buildUpdateQueries(row.name, anchor, since, gapFillDue ? { row, hasRounds } : null);
  const batches = await Promise.all(queries.map((q) =>
    q.kind === "news" ? serperNewsSearch(q.query, q.label, state) : serperSearch(q.query, q.label, state)));
  return batches.flat();
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

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

const WEBSITE_PROVIDERS = new Set(["jina", "tavily_extract", "cheerio"]);
const isWebsiteResult = (r: RawSearchResult) => WEBSITE_PROVIDERS.has(r.provider);

function logExtraction(label: string, companyName: string, outcome: { stopReason: string | null; outputTokens: number }): void {
  console.log(`    🧠  ${label} extraction: stop_reason=${outcome.stopReason} output_tokens=${outcome.outputTokens}`);
  if (outcome.stopReason === "max_tokens") {
    console.warn(`    ⚠️  ${label} extraction TRUNCATED for "${companyName}" — fields after the cutoff are missing, not genuinely empty.`);
  }
}

function confidenceLabel(t: SourceType | undefined): "high" | "medium" | "low" {
  if (!t) return "low";
  const rank = sourceTypeRank(t);
  return rank >= sourceTypeRank("press_release") ? "high" : rank >= sourceTypeRank("news") ? "medium" : "low";
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

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
  // URLs this company's earlier runs already sent to Claude (update mode
  // skips them; both modes record what they send).
  const seen = new SeenUrls(row.id);
  const gapFillDue = UPDATE && seen.gapFillDue();

  // ── Stage 0: domain verification ──────────────────────────────────────
  // (an update trusts the website already checked by the full run)
  const domainVerification = UPDATE ? { verified: undefined, note: "" } : await verifyDomainMatch(row.name, row.website, searchState);
  const effectiveWebsite = domainVerification.verified === false ? null : row.website;
  if (domainVerification.verified === false) console.warn(`    ⚠️  Domain verification: ${domainVerification.note}`);
  else if (domainVerification.verified === true) console.log(`    ✅  Domain verified via Crunchbase/LinkedIn`);

  const domain = websiteDomain(effectiveWebsite);
  const anchor = domain ? ` "${domain}"` : row.country ? ` ${row.country} (startup OR tech company)` : "";

  // ── Stage 1: website (Jina, free) → tech pre-check → searches ─────────
  // The homepage is fetched first so a clearly non-tech company is
  // rejected before paying for ~11 searches and three extraction calls.
  const websitePages = UPDATE ? [] : await fetchCompanyWebsitePages(effectiveWebsite, searchState);
  if (TECH_GATE && !UPDATE) {
    // The verdict is cached with the search results, so seeing the same
    // company again (a re-run, the next cycle) costs nothing.
    const cachedVerdict = searchState.cache?.get<TechGateVerdict>("techgate");
    const gate = cachedVerdict
      ? { verdict: cachedVerdict, inputTokens: 0, outputTokens: 0 }
      : await runTechGate(row.name, websitePages[0]?.content ?? "", row.description, row.industry, { client: anthropic, model: ENRICH_MODEL });
    if (!cachedVerdict) searchState.cache?.set("techgate", gate.verdict);
    recordCost(summary, ENRICH_MODEL, gate);
    if (shouldSkipAsNonTech(gate.verdict)) {
      console.log(`    🚫  REJECTED before searching — not a technology company: ${gate.verdict!.reason}`);
      summary.tally.rejected++;
      summary.earlyRejected++;
      return;
    }
  }
  const rawSearchResults = UPDATE
    ? await runUpdateSearches(row, anchor, existingRounds.length > 0, gapFillDue, searchState)
    : await runAllSearches(row.name, anchor, searchState);
  // One source per URL — the same page returned by several queries used to
  // reach Claude several times (billed as input on every call).
  const { results: mergedResults, merged: duplicateResults } = mergeDuplicateResults(rawSearchResults);
  // An update only looks at pages this company has never been checked against.
  let searchResults = mergedResults;
  if (UPDATE) {
    const { data: prov } = await supabase.from("field_provenance").select("source_url").eq("startup_id", row.id).limit(2000);
    const known = knownUrlSet({
      news: row.news,
      roundSourceUrls: existingRounds.map((r) => r.source_url),
      provenanceUrls: ((prov ?? []) as Array<{ source_url: string | null }>).map((p) => p.source_url),
      seen: seen.urls,
    });
    searchResults = newResultsOnly(mergedResults, known);
    console.log(`    🔁  Update since ${row.last_enriched_at?.slice(0, 10)}: ${searchResults.length} new result(s) of ${mergedResults.length}${gapFillDue ? " (incl. searches for missing fields)" : ""}`);
    if (gapFillDue) seen.markGapFill();
  }
  summary.duplicateResultsMerged += duplicateResults;
  if (VERBOSE && duplicateResults > 0) console.log(`    🧹  ${duplicateResults} duplicate search result(s) merged (same URL from several queries)`);

  const allRaw: RawSearchResult[] = [
    ...searchResults,
    ...websitePages.map((p) => ({ url: p.url, content: p.content, provider: p.provider, query_label: "website" })),
  ];

  if (allRaw.length === 0 && UPDATE) {
    console.log("    💤  Nothing new since the last check — no Claude call.");
    summary.tally.no_change++;
    if (!DRY_RUN) seen.save();
    return;
  }
  if (allRaw.length === 0) {
    console.log("    🔍  All searches failed — no data retrieved");
    summary.tally.no_data++;
    return;
  }

  // ── Stage 3: entity filter ─────────────────────────────────────────────
  // Identity keywords come from the company's OWN site (trusted by
  // construction): they let a result naming a non-distinctive company
  // ("Ghost", "Foundry") through only when it also talks about what this
  // company actually does.
  const identityKeywords = deriveIdentityKeywords(
    [...websitePages.map((p) => p.content), row.description ?? "", row.value_proposition ?? "", row.industry ?? ""],
    row.name,
  );
  const anchors: EntityAnchors = {
    domain: domain ?? undefined,
    founderNames: [...(row.founders ?? []), ...(row.leadership ?? [])].map((p) => p?.name).filter((n): n is string => !!n && n.trim().length > 3),
    trustedCountry: row.is_manually_verified ? (row.country ?? undefined) : undefined,
    identityKeywords,
    companyLinkedinUrl: row.linkedin_url,
    ownQualifiers: nameQualifiersOnOwnSite([...websitePages.map((p) => p.content), row.description ?? ""], row.name),
  };
  const passesEntity = (r: RawSearchResult, a: EntityAnchors) =>
    filterByEntity({ url: r.url, title: r.title, snippet: r.content }, a, row.name).kept;

  const searchOnly = allRaw.filter((r) => !isWebsiteResult(r));
  const kept = searchOnly.filter((r) => passesEntity(r, anchors));
  // Website pages are never entity-filtered — fetched from the company's
  // own domain, so there's no "wrong company" risk.
  const websiteRaw = allRaw.filter(isWebsiteResult);
  let usableResults = [...kept, ...websiteRaw];
  console.log(`    🧭  Entity filter: kept ${kept.length}/${searchOnly.length} search results + ${websiteRaw.length} website page(s)${VERBOSE && identityKeywords.length ? ` | identity keywords: ${identityKeywords.join(", ")}` : ""}`);

  if (UPDATE && kept.length === 0) {
    console.log("    💤  Nothing new about this company since the last check — no Claude call.");
    summary.tally.no_change++;
    if (!DRY_RUN) seen.save();
    return;
  }
  if (!UPDATE && kept.length < 2 && websiteRaw.length === 0) {
    console.log(`    🔍  low_evidence — fewer than 2 results survived entity filtering, and no website fetch. Skipping Claude calls.`);
    summary.tally.low_evidence++;
    return;
  }

  // ── Stage 3b: read the most useful articles in full (Jina, free) ──────
  // A snippet stops at ~600 characters; the full funding announcement has
  // the exact date, every investor, headcount and the "About" boilerplate.
  if (ARTICLES_TO_READ > 0) {
    const toRead = pickArticlesToRead(kept, row.name, domain, ARTICLES_TO_READ);
    const texts = await Promise.all(toRead.map((r) => fetchArticleText(r.url, searchState)));
    let read = 0;
    const namesakeArticles = new Set<RawSearchResult>();
    toRead.forEach((r, i) => {
      const text = texts[i];
      if (!text) return;
      // The snippet passed the entity filter, but the full article can show
      // it is about a namesake (Glean AI kept reading Glean's telosi page).
      const verdict = filterByEntity({ url: r.url, title: r.title, snippet: text }, anchors, row.name);
      if (!verdict.kept && (verdict.drop_reason === "namesake_domain" || verdict.drop_reason === "namesake_profile")) {
        namesakeArticles.add(r);
        console.log(`    🧭  ${r.url} is about a namesake (full text) — dropped.`);
        bump(summary.droppedByReason, "article_about_namesake");
        return;
      }
      r.content = `${r.content}\n[Full article text]\n${text}`;
      read++;
    });
    if (namesakeArticles.size > 0) usableResults = usableResults.filter((r) => !namesakeArticles.has(r));
    summary.articlesRead += read;
    if (toRead.length > 0) console.log(`    📰  Read ${read}/${toRead.length} full article(s) via Jina${VERBOSE ? `: ${toRead.map((r) => r.url).join(", ")}` : ""}`);
  }

  // ── Stage 4: labeled sources + three extraction calls ──────────────────
  // All three share one prompt-cached prefix (sharedExtraction.ts). The
  // profile call goes first: it writes the cache, and it decides
  // public / non-tech — in which case the other two calls are never made.
  let allSources: LabeledSource[] = buildLabeledSources(usableResults, domain);
  const shared = (kind: ExtractionKind) => buildSharedExtractionRequest(kind, row.name, allSources, { taxonomy });
  const profileOutcome = await extractProfile(row.name, allSources, { client: anthropic, model: PROFILE_MODEL, taxonomy, request: shared("profile") });
  if (!profileOutcome) {
    console.log("    ❌  Profile extraction returned no tool_use block at all.");
    summary.tally.error++;
    return;
  }
  recordCost(summary, PROFILE_MODEL, profileOutcome);
  logExtraction("profile", row.name, profileOutcome);
  let profile = profileOutcome.extraction.result;
  for (const d of profileOutcome.extraction.dropped) bump(summary.droppedByReason, d.reason);

  // Backstop for the model's flag: "<Name>, Inc. (Nasdaq: XYZ)" in a source.
  const listing = profile.is_public_company ? null : findListingStatement(row.name, allSources, domain);
  if (listing) console.log(`    🏛️   Listed on an exchange per ${listing.url}: "${listing.quote}"`);
  if (profile.is_public_company || listing) {
    console.log(`    🏛️   PUBLIC COMPANY — archiving (status='ipo') rather than deleting (issue 7)`);
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
  // An update reads a few news items, not the company's whole footprint —
  // the tech/non-tech decision from the full run stands.
  if (!profile.is_tech_company && !UPDATE) {
    console.log("    🚫  REJECTED — not a technology-driven company");
    summary.tally.rejected++;
    return;
  }

  // An update whose new pages say nothing about money skips the funding call.
  const skipFunding = UPDATE && !mentionsFunding(allSources.map((src) => `${src.title ?? ""} ${src.content}`));
  if (skipFunding) console.log("    ⏭️   No funding/M&A words in the new pages — funding extraction skipped.");
  const [fundingOutcome, marketOutcome] = await Promise.all([
    skipFunding ? Promise.resolve(EMPTY_FUNDING_OUTCOME) : extractFunding(row.name, allSources, { client: anthropic, model: FUNDING_MODEL, request: shared("funding") }),
    extractMarket(row.name, allSources, { client: anthropic, model: MARKET_MODEL, request: shared("market") }),
  ]);
  if (!fundingOutcome) {
    console.log("    ❌  Funding extraction returned no tool_use block at all.");
    summary.tally.error++;
    return;
  }
  recordCost(summary, FUNDING_MODEL, fundingOutcome);
  recordCost(summary, MARKET_MODEL, marketOutcome);
  logExtraction("funding", row.name, fundingOutcome);
  logExtraction("market", row.name, marketOutcome);
  if (VERBOSE) {
    const read = fundingOutcome.cacheReadTokens + marketOutcome.cacheReadTokens;
    console.log(`    💾  Prompt cache: ${profileOutcome.cacheWriteTokens} tokens written, ${read} read back (${read > 0 ? "hit" : "MISS — check that all three calls use the same model"})`);
  }
  let funding = fundingOutcome.extraction.result;
  let market = marketOutcome.extraction.result;
  for (const d of [...fundingOutcome.extraction.dropped, ...marketOutcome.extraction.dropped]) bump(summary.droppedByReason, d.reason);

  const existingRefs: ExistingRoundRef[] = existingRounds.map((r) => ({
    id: r.id, round_type: r.round_type ?? "Other", amount_raised: r.amount_raised, valuation: r.valuation,
    is_valuation_estimated: r.is_valuation_estimated, announcement_date: r.announcement_date,
    lead_investor: r.lead_investor, other_investors: r.investors, source_url: r.source_url,
    investor_amounts: r.investor_amounts,
  }));

  // ── Stage 9: deep dive into whichever sections came back thin ──────────
  // (an update fills gaps with its own few searches instead)
  if (DEEP_DIVE && !UPDATE) {
    const firstPassRounds: RoundLike[] = [...existingRefs, ...funding.funding_rounds.map(roundToRoundLike)];
    const gaps = detectGaps({
      rounds: firstPassRounds,
      bootstrapped: firstPassRounds.some((r) => normalizeRoundType(r.round_type) === "Bootstrapped"),
      hasDescription: !!(row.description || profile.profile.description),
      hasLocation: !!((row.city || profile.profile.city) && (row.country || profile.profile.country)),
      hasHeadcount: row.employee_count != null || !!profile.metrics.employee_count || !!profile.metrics.employee_range,
      // Founders are covered by the "founded by" scan and the LinkedIn step
      // below; a whole profile deep dive just for them added nothing in a
      // 20-company run (+0 founders in every one).
      hasFounders: true,
      competitorCount: (row.competitors?.length ?? 0) + market.competitors.length,
      // Fresh news is worth a second look even when older articles are on file.
      newsCount: market.news.length,
      hasFoundedYear: row.founded_year != null || !!profile.profile.founded_year,
      // Patent deep dive only when some source ties a patent to this company
      // — most startups have none, and searching for them anyway found
      // nothing in every real run while costing two searches + a call.
      // No patent deep dive: the first pass already searches Google Patents,
      // and the second search returned +0 patents in every real run.
      patentCount: undefined,
    });
    // Funding deep dive only when NO financing round is known at all: with
    // rounds already found, the extra searches returned +0 rounds in 12 of
    // 13 companies of a real run (the model's "history incomplete" flag is
    // set far too often to be a useful trigger on its own).
    if (gaps.includes("funding") && !hasNoFinancingRounds(firstPassRounds)) gaps.splice(gaps.indexOf("funding"), 1);

    if (gaps.length > 0) {
      summary.deepDives++;
      const extractedPeople = [...(profile.profile.founders ?? []), ...profile.leadership].map((p) => p.name).filter(Boolean);
      const founderNames = [...new Set([...extractedPeople, ...(anchors.founderNames ?? [])])];
      const queries = gaps.flatMap((section) =>
        buildDeepDiveQueries(section, { name: row.name, anchor, domain, rounds: firstPassRounds, founderNames })
          .map((q) => ({ ...q, section })),
      );
      console.log(`    🔎  Deep dive: ${gaps.join(", ")} (${queries.length} targeted searches)`);
      const batches = await Promise.all(queries.map(async (q) => ({
        section: q.section,
        results: q.kind === "news" ? await newsSearch(q.query, q.query, q.label, searchState) : await webSearch(q.query, q.label, searchState),
      })));

      // Newly found people are anchors too: an article naming a founder
      // the first pass just verified is about this company.
      const deepAnchors: EntityAnchors = { ...anchors, founderNames: founderNames.filter((n) => n.trim().length > 3) };
      const firstPassUrls = new Set(allRaw.map((r) => normalizeUrlForMatch(r.url)));
      const sectionsByUrl = new Map<string, Set<DeepDiveSection>>();
      const deepUnique: RawSearchResult[] = [];
      let deepSeen = 0;
      for (const { section, results } of batches) {
        for (const r of results) {
          deepSeen++;
          const key = normalizeUrlForMatch(r.url);
          if (firstPassUrls.has(key)) continue;
          if (!sectionsByUrl.has(key)) {
            if (!passesEntity(r, deepAnchors)) continue;
            sectionsByUrl.set(key, new Set());
            deepUnique.push(r);
          }
          sectionsByUrl.get(key)!.add(section);
        }
      }
      console.log(`    🔎  Deep dive: ${deepUnique.length} new source(s) kept of ${deepSeen} result(s)`);

      if (deepUnique.length > 0) {
        // Appended after the first-pass sources, so every first-pass S#/W#
        // id stays exactly the same and the new ones continue the sequence.
        allSources = buildLabeledSources([...usableResults, ...deepUnique], domain);
        const deepSources = allSources.slice(usableResults.length);
        const forSections = (...sections: DeepDiveSection[]) =>
          deepSources.filter((s) => sections.some((sec) => sectionsByUrl.get(normalizeUrlForMatch(s.url))?.has(sec)));

        const fundingSrc = gaps.includes("funding") ? forSections("funding") : [];
        const profileSrc = gaps.includes("profile") ? forSections("profile") : [];
        const marketSrc = gaps.some((g) => g === "competitors" || g === "news" || g === "patents") ? forSections("competitors", "news", "patents") : [];

        const [dFunding, dProfile, dMarket] = await Promise.all([
          fundingSrc.length ? extractFunding(row.name, fundingSrc, { client: anthropic, model: FUNDING_MODEL }) : null,
          profileSrc.length ? extractProfile(row.name, profileSrc, { client: anthropic, model: PROFILE_MODEL, taxonomy }) : null,
          marketSrc.length ? extractMarket(row.name, marketSrc, { client: anthropic, model: MARKET_MODEL }) : null,
        ]);

        const before = { rounds: funding.funding_rounds.length, competitors: market.competitors.length, news: market.news.length, founders: profile.profile.founders?.length ?? 0, patents: market.patents.length, founded: !!profile.profile.founded_year };
        if (dFunding) {
          recordCost(summary, FUNDING_MODEL, dFunding);
          logExtraction("deep funding", row.name, dFunding);
          for (const d of dFunding.extraction.dropped) bump(summary.droppedByReason, d.reason);
          funding = mergeFundingExtractions(funding, dFunding.extraction.result);
        }
        if (dProfile) {
          recordCost(summary, PROFILE_MODEL, dProfile);
          logExtraction("deep profile", row.name, dProfile);
          for (const d of dProfile.extraction.dropped) bump(summary.droppedByReason, d.reason);
          profile = mergeProfileExtractions(profile, dProfile.extraction.result);
        }
        if (dMarket) {
          recordCost(summary, MARKET_MODEL, dMarket);
          logExtraction("deep market", row.name, dMarket);
          for (const d of dMarket.extraction.dropped) bump(summary.droppedByReason, d.reason);
          market = mergeMarketExtractions(market, dMarket.extraction.result);
        }
        console.log(`    🔎  Deep dive added: +${funding.funding_rounds.length - before.rounds} round(s), +${market.competitors.length - before.competitors} competitor(s), +${market.news.length - before.news} news, +${(profile.profile.founders?.length ?? 0) - before.founders} founder(s), +${market.patents.length - before.patents} patent(s)${!before.founded && profile.profile.founded_year ? `, founded ${profile.profile.founded_year.value}` : ""}`);
      }
    }
  }

  // ── Stage 9b: founders' personal LinkedIn profiles ──────────────────────
  // Read mechanically from `site:linkedin.com/in` results: a profile is
  // attached only when its own title is the founder's name and the result
  // names the company (lib/enrichment/linkedin.ts) — never a Crunchbase
  // person page, never a URL a model constructed.
  // A leader whose own role says Founder/Co-founder ("Chief Creative
  // Officer & Founder") is a founder too — never "Founding Marketing".
  for (const l of profile.leadership) {
    if (!l?.name || !/\b(co-?\s?founder|founder)\b/i.test(l.role ?? "")) continue;
    const founders = profile.profile.founders ?? [];
    if (!founders.some((f) => f?.name && samePersonName(f.name, l.name))) {
      profile.profile.founders = [...founders, { name: l.name, title: l.role, bio: l.bio, linkedin_url: l.linkedin_url }];
    }
  }

  // Founders stated outright in the research — "GoCo.io, Inc. was founded
  // in 2015 by Jason J. Wang, Michael Gugel, and Nir Leibovich." — with the
  // company as the sentence's subject (lib/enrichment/people.ts).
  const textFounders: string[] = [];
  for (const src of allSources) {
    for (const f of foundersFromText(src.content, row.name, { url: src.url, title: src.title })) {
      const founders = profile.profile.founders ?? [];
      if (founders.some((x) => x?.name && samePersonName(x.name, f.name))) continue;
      profile.profile.founders = [...founders, { name: f.name, title: f.title }];
      textFounders.push(`${f.name} [${src.source_id}]`);
    }
  }
  if (textFounders.length > 0) console.log(`    👥  Founders from "founded by" sentences: ${textFounders.join(", ")}`);

  // People found or enriched from LinkedIn search results: profile URL, plus
  // education / prior employers / elite unit read from the public snippet
  // (lib/enrichment/linkedin.ts parseLinkedInFacts) — never from the
  // login-walled profile page itself.
  type LinkedInPersonPatch = { name: string; title?: string; role?: string; linkedin_url?: string; bio?: string; elite_background?: boolean; notable_pedigree?: boolean };
  const linkedinFounders: LinkedInPersonPatch[] = [];
  const linkedinLeaders: LinkedInPersonPatch[] = [];
  const factsPatch = (snippet: string): Pick<LinkedInPersonPatch, "bio" | "elite_background" | "notable_pedigree"> => {
    const facts = parseLinkedInFacts(snippet);
    return {
      bio: bioFromLinkedInFacts(facts, row.name) ?? undefined,
      elite_background: facts.eliteUnit ? true : undefined,
      notable_pedigree: facts.eliteSchool ? true : undefined,
    };
  };
  if (DEEP_DIVE && (!UPDATE || gapFillDue)) {
    const knownFounders = [
      ...(profile.profile.founders ?? []).map((f) => ({ name: f.name, linkedin_url: f.linkedin_url?.value, bio: f.bio })),
      ...(row.founders ?? []),
    ].filter((f, i, all) => f?.name && all.findIndex((g) => g?.name && samePersonName(g.name, f.name)) === i);
    // Looked up: founders missing a link OR a bio, and a CEO/CTO/President
    // from leadership missing a bio — at most 4 people per company.
    const knownLeaders = [...(profile.leadership ?? []), ...(row.leadership ?? [])]
      .filter((l) => l?.name && /\b(ceo|chief executive|cto|chief technology|president)\b/i.test(l.role ?? ""))
      .filter((l, i, all) => all.findIndex((g) => samePersonName(g.name, l.name)) === i)
      .filter((l) => !knownFounders.some((f) => samePersonName(f.name, l.name)));
    const lookups = [
      ...knownFounders.filter((f) => !f.linkedin_url || !f.bio).map((f) => ({ name: f.name, kind: "founder" as const })),
      ...knownLeaders.filter((l) => !l.bio).map((l) => ({ name: l.name, role: l.role, kind: "leader" as const })),
    ].slice(0, 4);
    const queries = [
      ...lookups.map((p) => `site:linkedin.com/in "${p.name}" "${row.name}"`),
      // Discovery also runs when only one founder is known — most startups
      // have two or three, and the second is often missing.
      ...(knownFounders.length < 2 ? [
        `site:linkedin.com/in "${row.name}" founder OR co-founder`,
        `site:linkedin.com/in "co-founder" "${row.name}"${domain ? ` OR "${domain}"` : ""}`,
      ] : []),
    ];
    if (queries.length > 0) {
      const results = (await Promise.all(queries.map((q, i) => serperSearch(q, `linkedin_people_${i}`, searchState)))).flat();
      for (const person of lookups) {
        const hit = findPersonResult(person.name, results, row.name);
        if (!hit) continue;
        const patch = { name: person.name, linkedin_url: hit.url, ...factsPatch(hit.snippet) };
        if (person.kind === "founder") linkedinFounders.push(patch);
        else linkedinLeaders.push({ ...patch, role: person.role });
      }
      if (knownFounders.length < 2) {
        // Discovery: a self-declared founder must ALSO pass the entity
        // filter, so "Founder at Ghost" from a different Ghost is dropped.
        const anchored = results.filter((r) => passesEntity(r, anchors) || (domain ? `${r.title ?? ""} ${r.content}`.toLowerCase().includes(domain) : false));
        // ...and must be named somewhere in the research outside LinkedIn —
        // a self-description alone isn't enough to call someone a founder.
        const researchText = allSources.filter((src) => !/linkedin\.com/i.test(src.url)).map((src) => `${src.title ?? ""} ${src.content}`);
        for (const p of discoverFounders(anchored, row.name)) {
          if (knownFounders.some((f) => samePersonName(f.name, p.name)) || linkedinFounders.some((f) => samePersonName(f.name, p.name))) continue;
          if (!researchText.some((t) => personMentionedIn(p.name, t))) {
            console.log(`    🔗  LinkedIn: ${p.name} ("${p.headline}") not named anywhere in the research — not added as a founder.`);
            bump(summary.droppedByReason, "linkedin_founder_uncorroborated");
            continue;
          }
          linkedinFounders.push({ name: p.name, title: founderTitleFromHeadline(`${p.headline}`, row.name), linkedin_url: p.url, ...factsPatch(p.snippet) });
        }
      }
      const withBio = [...linkedinFounders, ...linkedinLeaders].filter((p) => p.bio);
      console.log(`    🔗  LinkedIn: ${linkedinFounders.length + linkedinLeaders.length} profile(s) matched, ${withBio.length} with education/experience from the snippet${VERBOSE && withBio.length ? ` — ${withBio.map((p) => `${p.name}: ${p.bio}`).join(" | ")}` : ""}`);
    }
  }

  const sourceById = new Map(allSources.map((s) => [s.source_id, s]));
  const sourceTypeFor = (sourceId: string | undefined): SourceType | undefined => (sourceId ? sourceById.get(sourceId)?.source_type : undefined);
  const sourceUrlFor = (sourceId: string | undefined): string | null => (sourceId ? sourceById.get(sourceId)?.url ?? null : null);

  // ── Round grounding: co-investors / per-investor amounts / source URL ──
  const newRoundLikes: RoundLike[] = funding.funding_rounds.map((r) => {
    const grounded = groundRoundDetails(r, allSources);
    for (const reason of grounded.dropped) bump(summary.droppedByReason, reason);
    return roundToRoundLike(grounded.round);
  });

  // ── Stage 6: validation (city/country/founded_year/headcount/rounds) ──
  type TaggedRound = RoundLike & { _new?: true };
  const roughPlan = planRoundWrites(existingRefs, newRoundLikes);
  const validation = validateEnrichment({
    existing: {
      founded_year: row.founded_year,
      country: { value: row.country, is_manually_verified: row.is_manually_verified },
      employee_count: row.employee_count,
    },
    extracted: {
      founded_year: profile.profile.founded_year?.value ?? null,
      city: profile.profile.city?.value ?? null,
      country: profile.profile.country?.value ?? null,
      country_source_type: sourceTypeFor(profile.profile.country?.source_id) ?? null,
      employee_count: profile.metrics.employee_count?.value ?? null,
      city_quote: profile.profile.city?.evidence_quote ?? null,
      country_quote: profile.profile.country?.evidence_quote ?? null,
    },
    rounds: [...existingRefs, ...newRoundLikes.map((r): TaggedRound => ({ ...r, _new: true }))],
    totalRaisedUsd: computeTotalRaised([...existingRefs, ...roughPlan.inserts]),
  });
  for (const issue of validation.issues) {
    console.log(`    ⚠️  [${issue.rule}] ${issue.message}`);
    bump(summary.droppedByReason, issue.rule);
  }
  const acceptedNewRounds: RoundLike[] = validation.acceptedRounds
    .filter((r) => (r as TaggedRound)._new)
    .map((r) => { const { _new, ...rest } = r as TaggedRound; void _new; return rest; });

  // ── Stage 7: round planning (fill existing / insert new / contradiction)
  const plan = planRoundWrites(existingRefs, acceptedNewRounds);
  for (const c of plan.conflicts) {
    console.log(`    ⚔️   Contradiction on ${c.round_type}: ${c.message} — kept the round on file, nothing written for it`);
    bump(summary.droppedByReason, "round_conflict_with_existing");
  }

  // ── Stage 8: confidence ─────────────────────────────────────────────────
  const cityConfidence = profile.profile.city ? computeFieldConfidence([{ source_type: sourceTypeFor(profile.profile.city.source_id) ?? "model_inferred" }]) : 0;
  const countryConfidence = profile.profile.country ? computeFieldConfidence([{ source_type: sourceTypeFor(profile.profile.country.source_id) ?? "model_inferred" }]) : 0;

  // ── Stage 10: write ──────────────────────────────────────────────────────
  const patch: Record<string, unknown> = {};
  const fieldWrites: Array<{ field: string; value: unknown; source_id: string; evidence_quote: string; source_type: SourceType }> = [];
  const provenance = (field: string, value: unknown, ev: { source_id: string; evidence_quote: string } | undefined) => {
    if (ev) fieldWrites.push({ field, value, source_id: ev.source_id, evidence_quote: ev.evidence_quote, source_type: sourceTypeFor(ev.source_id) ?? "model_inferred" });
  };
  /** Sets a patch key only when it actually changes what's on file. */
  const setIfChanged = (key: string, next: unknown, prev: unknown) => {
    if (next === null || next === undefined) return;
    if (Array.isArray(next) && next.length === 0) return;
    if (!sameJson(next, prev)) patch[key] = next;
  };

  // Overview
  if (validation.accepted.city && row.city == null && !meetsProfileThreshold(cityConfidence, THRESHOLDS)) {
    console.log(`    ℹ️   City "${validation.accepted.city}" withheld — its only evidence is a ${sourceTypeFor(profile.profile.city?.source_id) ?? "unknown"} source (confidence ${cityConfidence} < ${MIN_PROFILE_CONFIDENCE}).`);
    bump(summary.droppedByReason, "below_profile_confidence");
  }
  if (validation.accepted.city && meetsProfileThreshold(cityConfidence, THRESHOLDS) && row.city == null) {
    patch.city = validation.accepted.city;
    provenance("profile.city", validation.accepted.city, profile.profile.city);
  }
  if (validation.accepted.country && row.country == null && meetsProfileThreshold(countryConfidence, THRESHOLDS)) {
    patch.country = validation.accepted.country;
    provenance("profile.country", validation.accepted.country, profile.profile.country);
  } else if (validation.accepted.country && row.country != null && normalizeForMatch(row.country) !== normalizeForMatch(validation.accepted.country)) {
    // Existing value present -- issue 3's overwrite rule, not a plain fill.
    const decision = decideScalarWrite<string>(
      { value: row.country, provenance: row.is_manually_verified ? { source_type: "manual", is_manually_verified: true } : null },
      { value: validation.accepted.country, source_type: sourceTypeFor(profile.profile.country?.source_id) ?? "model_inferred", independentSourceCount: 1 },
    );
    if (decision.decision === "overwrite" && meetsProfileThreshold(countryConfidence, THRESHOLDS)) {
      patch.country = validation.accepted.country;
      provenance("profile.country", validation.accepted.country, profile.profile.country);
      console.log(`    ✏️   Overwriting country: ${decision.reason}`);
    } else if (decision.decision === "overwrite") {
      console.log(`    ⚠️  Country overwrite candidate outranked the existing source but confidence (${countryConfidence}) is below the threshold -- kept existing value.`);
    }
  }
  // A city with no country (a "PARIS, Oct. 15 /PRNewswire/" dateline): the
  // country is filled only when the city maps to exactly one country in
  // the curated city list — never for an ambiguous name.
  if (patch.city && !patch.country && row.country == null) {
    const countries = MAJOR_CITIES.get(String(patch.city).trim().toLowerCase());
    const fromQuote = countryFromLocationQuote(profile.profile.city?.evidence_quote, String(patch.city));
    if (fromQuote) {
      // "Poway, Calif.-based", "2970 Hørsholm Denmark": the city's own quote names the country.
      patch.country = fromQuote;
      provenance("profile.country", fromQuote, profile.profile.city);
      console.log(`    🧭  Country "${fromQuote}" read from the city's own evidence quote.`);
    } else if (countries && countries.size === 1) {
      patch.country = [...countries][0];
      console.log(`    🧭  Country "${patch.country}" derived from city "${patch.city}" (unambiguous in the city list).`);
    } else {
      console.log(`    ℹ️   City "${patch.city}" written without a country — no source states one and the city is not unambiguous.`);
    }
  }
  if (validation.accepted.founded_year && row.founded_year == null) {
    patch.founded_year = validation.accepted.founded_year;
    provenance("profile.founded_year", validation.accepted.founded_year, profile.profile.founded_year);
  }
  if (!row.description && profile.profile.description) patch.description = profile.profile.description;
  if (!row.value_proposition && profile.profile.value_proposition) patch.value_proposition = profile.profile.value_proposition;
  if (!row.industry && profile.profile.industry) patch.industry = profile.profile.industry;
  if (!row.website && profile.profile.website) {
    const websiteResult = validateWebsiteCandidate(profile.profile.website.value, row.id, startupByDomain);
    if (websiteResult.website) {
      patch.website = websiteResult.website;
      provenance("profile.website", websiteResult.website, profile.profile.website);
    }
    if (websiteResult.rejectedReason) console.warn(`    ⚠️  Rejected website "${profile.profile.website.value}" — ${websiteResult.rejectedReason}${websiteResult.rejectedOwnerName ? ` (${websiteResult.rejectedOwnerName})` : ""}.`);
  }
  if (!row.linkedin_url && profile.profile.linkedin_url) patch.linkedin_url = profile.profile.linkedin_url.value;
  if (!row.facebook_url && profile.profile.facebook_url) patch.facebook_url = profile.profile.facebook_url.value;
  if (!row.instagram_url && profile.profile.instagram_url) patch.instagram_url = profile.profile.instagram_url.value;

  if (!row.sector_id && profile.profile.sector_name) {
    const { data: sid } = await supabase.rpc("sector_id_by_name", { p_name: profile.profile.sector_name });
    if (sid) patch.sector_id = sid;
  }
  // Sub-sector tags (startup_sub_sectors): additive across runs, like v1.
  const proposedTags = [...new Set([
    ...(profile.profile.sub_sector_name ? [profile.profile.sub_sector_name] : []),
    ...(profile.profile.sub_sector_names ?? []),
  ])];
  const tagFilter = filterCrossSectorTags(
    proposedTags, profile.profile.sector_name, taxonomy,
    [profile.profile.description, profile.profile.value_proposition, profile.profile.industry, row.description].filter(Boolean).join(" "),
  );
  for (const t of tagFilter.dropped) {
    console.log(`    🏷️   Tag "${t}" dropped — it belongs to another sector and nothing in the description is about it.`);
    bump(summary.droppedByReason, "tag_outside_sector_unsupported");
  }
  const tagNames = tagFilter.kept;
  const tagSectorIds: string[] = [];
  for (const tagName of tagNames) {
    const { data: tagId } = await supabase.rpc("sector_id_by_name", { p_name: tagName });
    if (tagId) tagSectorIds.push(tagId as string);
  }

  // Leadership & founders (additive merge, never destructive)
  const founderCandidates = cleanPeople((profile.profile.founders ?? []).map((f) => ({
    name: f.name, title: f.title, bio: f.bio, linkedin_url: f.linkedin_url?.value,
    had_prior_exit: f.had_prior_exit, elite_background: f.elite_background, notable_pedigree: f.notable_pedigree,
  })));
  const cleanFounders = founderCandidates.filter(isFounderEntry);
  // A hired executive the model listed as a founder stays in leadership.
  const demotedFounders = founderCandidates.filter((f) => !isFounderEntry(f));
  for (const f of demotedFounders) {
    console.log(`    👤  ${f.name} ("${f.title}") is not stated to be a founder — kept in leadership only.`);
    bump(summary.droppedByReason, "founder_not_stated_as_founder");
  }
  const allFounderInputs = [...cleanFounders, ...linkedinFounders];
  if (allFounderInputs.length > 0) {
    // mergePeople matches exact names; align LinkedIn names (accents,
    // middle names) to the spelling already in use before merging.
    const knownNames = [...(row.founders ?? []).map((f) => f?.name), ...cleanFounders.map((f) => f.name)].filter((n): n is string => !!n);
    const aligned = allFounderInputs.map((f) => ({ ...f, name: knownNames.find((n) => samePersonName(n, f.name)) ?? f.name }));
    // cleanPeople also folds duplicates already on file ("Mitch"/"Mitchell Stewart").
    setIfChanged("founders", cleanPeople(mergePeople(row.founders ?? [], aligned)), row.founders);
  }
  const cleanLeadership = cleanPeople((profile.leadership ?? []).map((l) => ({
    name: l.name, role: l.role, bio: l.bio, linkedin_url: l.linkedin_url?.value, joined_date: l.joined_date,
    had_prior_exit: l.had_prior_exit, elite_background: l.elite_background, notable_pedigree: l.notable_pedigree,
  })));
  const allLeaderInputs = [
    ...cleanLeadership,
    ...linkedinLeaders.map((l) => ({ ...l, role: l.role ?? "" })),
    ...demotedFounders.filter((f) => !cleanLeadership.some((l) => samePersonName(l.name, f.name)))
      .map((f) => ({ name: f.name, role: f.title ?? "", bio: f.bio, linkedin_url: f.linkedin_url })),
  ];
  if (allLeaderInputs.length > 0) {
    const knownLeaderNames = [...(row.leadership ?? []).map((l) => l?.name), ...cleanLeadership.map((l) => l.name)].filter((n): n is string => !!n);
    const alignedLeaders = allLeaderInputs.map((l) => ({ ...l, name: knownLeaderNames.find((n) => samePersonName(n, l.name)) ?? l.name }));
    // An update that reads "X appointed CEO" keeps the previous CEO as
    // "Former CEO" instead of listing two current CEOs.
    let leadershipOnFile = row.leadership ?? [];
    if (UPDATE) {
      const { leaders, retired } = retireReplacedExecutives(leadershipOnFile, cleanLeadership);
      leadershipOnFile = leaders;
      for (const r of retired) console.log(`    👔  ${r} replaced by a newly announced leader — kept as "Former".`);
    }
    setIfChanged("leadership", cleanPeople(mergePeople(leadershipOnFile, alignedLeaders)), row.leadership);
  }

  // Competitors & market (additive: entries on file are never removed)
  const crossLink = (website: string | undefined) => {
    const d = websiteDomain(website);
    const match = d ? startupByDomain.get(d) : undefined;
    return match && match.id !== row.id ? match.id : null;
  };
  // Contradictions already on file (written by earlier runs) are cleaned
  // with the same rules applied to new data — see reconcileOnFile().
  const reconciled = reconcileOnFile({
    companyName: row.name,
    foundedYear: (patch.founded_year as number | undefined) ?? row.founded_year,
    competitors: row.competitors ?? [],
    acquisitions: [...(row.acquisitions ?? []), ...market.acquisitions.map((a) => ({ company_name: a.company_name }))],
    news: row.news ?? [],
  });
  for (const note of reconciled.notes) {
    console.log(`    🧹  On file: ${note}`);
    bump(summary.droppedByReason, "on_file_contradiction_fixed");
  }
  const selfKey = normalizeForMatch(row.name);
  const acquisitionsOnFile = (row.acquisitions ?? []).filter((a) => !a?.company_name || normalizeForMatch(a.company_name) !== selfKey);
  const existingCompetitors = reconciled.competitors as NonNullable<V2StartupRow["competitors"]>;
  const competitors = appendNew(
    existingCompetitors,
    market.competitors.map((c) => ({ name: c.name, website: c.website ?? null, how_it_competes: c.how_it_competes, startup_id: crossLink(c.website) })),
    (c) => normalizeForMatch(c.name ?? ""), MAX_COMPETITORS,
  );
  const competitorsAdded = competitors.length - existingCompetitors.length;
  if (!sameJson(competitors, row.competitors ?? [])) patch.competitors = competitors;

  // Acquisitions & IP
  const acquisitions = appendNew(
    acquisitionsOnFile,
    market.acquisitions.map((a) => ({
      company_name: a.company_name, website: a.website ?? null, acquired_date: normalizeIsoDate(a.acquired_date) ?? a.acquired_date ?? null,
      amount: a.amount ?? null, description: a.description ?? null, acquired_startup_id: crossLink(a.website),
    })),
    (a) => normalizeForMatch(a.company_name ?? ""),
  );
  if (acquisitions.length !== (row.acquisitions?.length ?? 0)) patch.acquisitions = acquisitions;
  if (row.patent_count == null && market.patent_summary.patent_count != null) patch.patent_count = market.patent_summary.patent_count;
  if (!row.patent_fields?.length && market.patent_summary.patent_fields.length) patch.patent_fields = market.patent_summary.patent_fields;
  const patentKey = (p: { title: string; patent_number?: string | null }) => (p.patent_number ? `#${p.patent_number}` : normalizeForMatch(p.title ?? ""));
  const patents = appendNew(
    row.patents ?? [],
    market.patents.map((p) => ({ title: p.title, patent_number: p.patent_number ?? null, filing_date: p.filing_date ?? null, url: p.url ?? null, summary: p.summary ?? null })),
    patentKey,
  );
  if (patents.length > (row.patents?.length ?? 0)) patch.patents = patents;
  const techStack = [...new Set([...(row.tech_stack ?? []), ...(market.technology.tech_stack ?? [])])];
  if (techStack.length > (row.tech_stack?.length ?? 0)) patch.tech_stack = techStack;
  if (!row.github_url && market.technology.github_url) patch.github_url = market.technology.github_url.value;
  if (!row.huggingface_url && market.technology.huggingface_url) patch.huggingface_url = market.technology.huggingface_url.value;

  // News: new articles appended (deduped by URL), newest first; each new
  // one gets its own og:image (v1's technique), never a guessed image.
  const existingNews = reconciled.news as NonNullable<V2StartupRow["news"]>;
  if (reconciled.notes.some((n) => n.startsWith("cleared news date"))) patch.news = existingNews;
  const existingNewsKeys = new Set(existingNews.map((n) => normalizeUrlForMatch(n.url ?? "")));
  const freshNews = market.news.filter((n) => !existingNewsKeys.has(normalizeUrlForMatch(n.url)));
  let newsAdded = 0;
  if (freshNews.length > 0 && existingNews.length < MAX_NEWS) {
    const toAdd = freshNews.slice(0, MAX_NEWS - existingNews.length);
    const withImages = await Promise.all(toAdd.map(async (n) => ({
      title: n.title, url: n.url, source: n.source ?? null,
      // An article dated before the company existed is a wrong date, not
      // a time-travelling article — the date is dropped, the article kept.
      published_date: (() => {
        const d = normalizeIsoDate(n.published_date);
        const founded = (patch.founded_year as number | undefined) ?? row.founded_year;
        return d && founded && Number(d.slice(0, 4)) < founded - 1 ? null : d;
      })(),
      summary: n.summary ?? null,
      image_url: (await fetchArticleOgImage(n.url)) ?? n.image_url ?? null,
    })));
    newsAdded = withImages.length;
    patch.news = [...existingNews, ...withImages].sort((a, b) => (b.published_date ?? "").localeCompare(a.published_date ?? ""));
  }

  // Funding & valuation (dated series: appended, deduped)
  const arr = appendDatedFigures(
    row.arr_milestones ?? [],
    funding.arr_milestones.map((m) => ({ arr: m.arr, date: normalizeIsoDate(m.date) ?? m.date ?? "unknown", source: sourceUrlFor(m.source_id), confidence: confidenceLabel(sourceTypeFor(m.source_id)) })),
    (m) => m.arr,
  );
  if (arr.length > (row.arr_milestones?.length ?? 0)) patch.arr_milestones = arr;
  const valuations = appendDatedFigures(
    row.valuation_benchmarks ?? [],
    funding.valuation_benchmarks.map((v) => ({ valuation: v.valuation, date: normalizeIsoDate(v.date) ?? v.date ?? null, source: sourceUrlFor(v.source_id), is_estimated: v.is_estimated ?? null })),
    (v) => v.valuation,
  );
  if (valuations.length > (row.valuation_benchmarks?.length ?? 0)) patch.valuation_benchmarks = valuations;
  if (!row.revenue_estimate && funding.revenue_estimate) {
    const re = funding.revenue_estimate;
    patch.revenue_estimate = {
      range_low: re.range_low ?? null, range_high: re.range_high ?? null, as_of_date: normalizeIsoDate(re.as_of_date) ?? re.as_of_date ?? null,
      source: sourceUrlFor(re.source_id), confidence: confidenceLabel(sourceTypeFor(re.source_id)),
    };
  }
  // NEVER defaults to true when the model omitted it -- null is "unknown".
  // A handful of new articles can't judge whether the whole history is known.
  if (!UPDATE && funding.funding_history_complete !== null && funding.funding_history_complete !== row.funding_history_complete) {
    patch.funding_history_complete = funding.funding_history_complete;
  }

  // Talent & growth: headcount (issue 6's guard + validation's outlier check)
  const totalRaisedEstimate = computeTotalRaised([...existingRefs, ...plan.inserts]);
  const headcountPoints: Array<{ date: string; count: number }> = [];
  for (const h of profile.metrics.headcount_history ?? []) {
    const date = normalizeIsoDate(h.date);
    if (date && h.employee_count > 0 && !headcountPoints.some((p) => p.date === date)) headcountPoints.push({ date, count: h.employee_count });
  }
  const acceptedHeadcount = validation.accepted.employee_count;
  if (acceptedHeadcount != null && profile.metrics.employee_count) {
    const candidate: CandidateValue<number> = {
      value: acceptedHeadcount,
      source_type: sourceTypeFor(profile.metrics.employee_count.source_id) ?? "model_inferred",
      independentSourceCount: 1,
    };
    const headcountDecision = decideHeadcountUpdate(row.employee_count, candidate);
    if (headcountDecision.writeEmployeeCount) {
      if (candidate.value !== row.employee_count) {
        patch.employee_count = candidate.value;
        provenance("metrics.employee_count", candidate.value, profile.metrics.employee_count);
      }
      // A figure that is really an old article's dated count (e.g. "the
      // 45-person startup" in a 2023 Series A story) is recorded at that
      // date only — never re-stamped as today's headcount.
      const today = new Date().toISOString().slice(0, 10);
      const staleDuplicate = headcountPoints.some((p) => p.count === candidate.value && (Date.now() - new Date(p.date).getTime()) / 86_400_000 > 180);
      if (!staleDuplicate && !headcountPoints.some((p) => p.date === today)) headcountPoints.push({ date: today, count: candidate.value });
    } else {
      console.log(`    ⚠️  Headcount change rejected (point_type=${headcountDecision.pointType}): ${row.employee_count} -> ${candidate.value} not strongly enough evidenced.`);
    }
  }
  // Series sanity: a point implausible for this company's size and funding
  // (the 70,000-employee Gladia point) never reaches the growth chart.
  const reference = acceptedHeadcount ?? row.employee_count;
  const foundedForChecks = validation.accepted.founded_year ?? row.founded_year ?? null;
  for (let i = headcountPoints.length - 1; i >= 0; i--) {
    const p = headcountPoints[i];
    const outlier = checkHeadcountOutlier(p.count, totalRaisedEstimate, foundedForChecks);
    // Only the upward direction: real companies grow 50x over a decade,
    // but one that is 10x smaller today than at a past point is a bad point.
    const offScale = reference != null && reference > 0 && p.count > reference * 10;
    if (outlier || offScale) {
      console.log(`    ⚠️  Headcount point ${p.count}@${p.date} dropped — ${outlier ? outlier.message : `inconsistent with the current ${reference}`}.`);
      bump(summary.droppedByReason, "headcount_point_outlier");
      headcountPoints.splice(i, 1);
    }
  }
  // The same check on points already on file — an earlier run wrote
  // Gladia's 70,000 point; it shouldn't stay on the growth chart forever.
  const finalHeadcount = (patch.employee_count as number | undefined) ?? row.employee_count;
  const { data: hcOnFile } = await supabase.from("headcount_history").select("id, employee_count, snapshot_date").eq("startup_id", row.id);
  const badHeadcountOnFile = ((hcOnFile ?? []) as Array<{ id: string; employee_count: number; snapshot_date: string }>).filter((h) =>
    !!checkHeadcountOutlier(h.employee_count, totalRaisedEstimate, foundedForChecks) || (finalHeadcount != null && finalHeadcount > 0 && h.employee_count > finalHeadcount * 10),
  );
  for (const h of badHeadcountOnFile) {
    console.log(`    🧹  On file: headcount point ${h.employee_count}@${h.snapshot_date} is implausible next to ${finalHeadcount ?? "the funding"} — ${DRY_RUN ? "would remove" : "removing"}.`);
    bump(summary.droppedByReason, "on_file_contradiction_fixed");
  }

  if (profile.metrics.employee_range) setIfChanged("employee_range", fillScalarIfNull(row.employee_range, profile.metrics.employee_range), row.employee_range);
  if (profile.metrics.growth_trend) setIfChanged("growth_trend", profile.metrics.growth_trend, row.growth_trend);

  const fieldsPatched = Object.keys(patch).length;

  if (VERBOSE) {
    console.log(`    [VERBOSE] Full patch values${DRY_RUN ? " (would write)" : " (writing now)"}:`);
    console.log(JSON.stringify(patch, null, 2).split("\n").map((l) => `      ${l}`).join("\n"));
    if (fieldWrites.length > 0) {
      console.log("    [VERBOSE] Evidence:");
      for (const fw of fieldWrites) console.log(`      ${fw.field}: "${fw.value}" <- [${fw.source_id}] ${sourceById.get(fw.source_id)?.url ?? ""} "${fw.evidence_quote}"`);
    }
    if (plan.inserts.length > 0) {
      console.log(`    [VERBOSE] New rounds${DRY_RUN ? " (would insert)" : " (inserting now)"}:`);
      console.log(JSON.stringify(plan.inserts, null, 2).split("\n").map((l) => `      ${l}`).join("\n"));
    }
    if (plan.updates.length > 0) {
      console.log(`    [VERBOSE] Existing rounds filled${DRY_RUN ? " (would update)" : " (updating now)"}:`);
      for (const u of plan.updates) console.log(`      ${u.round_type} (${u.id}): ${JSON.stringify(u.patch)}`);
    }
    if (headcountPoints.length > 0) console.log(`    [VERBOSE] Headcount points: ${headcountPoints.map((p) => `${p.count}@${p.date}`).join(", ")}`);
    if (tagNames.length > 0) console.log(`    [VERBOSE] Sub-sector tags: ${tagNames.join(", ")}`);
  }

  if (DRY_RUN) {
    console.log(`    [DRY] Would patch: ${Object.keys(patch).join(", ") || "(nothing)"}`);
    console.log(`    [DRY] Would insert ${plan.inserts.length} new round(s): ${plan.inserts.map((r) => r.round_type).join(", ") || "none"} | fill ${plan.updates.length} existing round(s)`);
    if (headcountPoints.length > 0) console.log(`    [DRY] Would upsert headcount_history: ${headcountPoints.map((p) => `${p.count}@${p.date}`).join(", ")}`);
    if (tagSectorIds.length > 0) console.log(`    [DRY] Would tag sub-sectors: ${tagNames.join(", ")}`);
  } else {
    if (fieldsPatched > 0) {
      let { error } = await supabase.from("startups").update(patch).eq("id", row.id);
      // Another startup already holds this website (unique index): retry
      // without it rather than lose the rest of the patch.
      if (error && (error as { code?: string }).code === "23505" && patch.website) {
        console.warn(`    ⚠️  Website "${patch.website}" already belongs to another startup — retrying without it.`);
        delete patch.website;
        ({ error } = await supabase.from("startups").update(patch).eq("id", row.id));
      }
      if (error) console.warn(`    ⚠️  Profile patch failed: ${error.message}`);
      else if (typeof patch.website === "string") {
        const d = websiteDomain(patch.website);
        if (d) startupByDomain.set(d, { id: row.id, name: row.name });
      }
    }

    if (tagSectorIds.length > 0) {
      const { error: tagErr } = await supabase.from("startup_sub_sectors").upsert(
        tagSectorIds.map((sector_id) => ({ startup_id: row.id, sector_id })),
        { onConflict: "startup_id,sector_id", ignoreDuplicates: true },
      );
      if (tagErr) console.warn(`    ⚠️  Sub-sector tag write failed: ${tagErr.message}`);
    }

    for (const fw of fieldWrites) {
      const { error: provenanceErr } = await supabase.from("field_provenance").insert({
        startup_id: row.id, field: fw.field, value: fw.value, source_url: sourceById.get(fw.source_id)?.url,
        source_type: fw.source_type, evidence_quote: fw.evidence_quote,
        confidence: computeFieldConfidence([{ source_type: fw.source_type }]),
      });
      if (provenanceErr) console.warn(`    ⚠️  field_provenance insert failed (${fw.field}): ${provenanceErr.message}`);
    }

    for (const h of badHeadcountOnFile) {
      const { error: delErr } = await supabase.from("headcount_history").delete().eq("id", h.id);
      if (delErr) console.warn(`    ⚠️  headcount_history delete failed (${h.snapshot_date}): ${delErr.message}`);
    }

    // recorded_date is what the Talent & Growth chart and the score read,
    // so a backfilled point carries its own date there too, not "now".
    for (const p of headcountPoints) {
      const { error: hcErr } = await supabase.from("headcount_history").upsert(
        { startup_id: row.id, employee_count: p.count, snapshot_date: p.date, recorded_date: `${p.date}T00:00:00Z` },
        { onConflict: "startup_id,snapshot_date" },
      );
      if (hcErr) console.warn(`    ⚠️  headcount_history upsert failed (${p.date}): ${hcErr.message}`);
    }

    for (const round of plan.inserts) {
      const { error: roundErr } = await supabase.from("funding_rounds").insert({
        startup_id: row.id, round_type: round.round_type,
        amount_raised: round.amount_raised ?? null, valuation: round.valuation ?? null,
        is_valuation_estimated: round.valuation != null ? (round.is_valuation_estimated ?? null) : null,
        announcement_date: round.announcement_date ?? null, source_url: round.source_url ?? null,
        lead_investor: round.lead_investor ?? null,
        investors: round.other_investors && round.other_investors.length > 0 ? round.other_investors : null,
        investor_amounts: round.investor_amounts && round.investor_amounts.length > 0 ? round.investor_amounts : null,
      });
      if (roundErr) console.warn(`    ⚠️  Round insert failed (${round.round_type}): ${roundErr.message}`);
      else summary.totalRoundsInserted++;
    }
    for (const u of plan.updates) {
      const { error: updErr } = await supabase.from("funding_rounds").update(u.patch).eq("id", u.id);
      if (updErr) console.warn(`    ⚠️  Round update failed (${u.round_type}): ${updErr.message}`);
      else summary.totalRoundsUpdated++;
    }

    await supabase.from("startups").update({ last_enriched_at: new Date().toISOString() }).eq("id", row.id);
    // Every page this run sent to Claude: a later update skips them.
    seen.add(allSources.map((src) => src.url));
    seen.save();
    // Marks the company as written by v2; the Private Market page always
    // lists such companies (migration 20261010000000). A separate update,
    // so a database without that column yet still gets last_enriched_at.
    if (Object.keys(patch).length > 0 || plan.inserts.length > 0 || plan.updates.length > 0) {
      const { error: markErr } = await supabase.from("startups").update({ enriched_v2_at: new Date().toISOString() }).eq("id", row.id);
      if (markErr && !warnedNoEnrichedV2Column) {
        warnedNoEnrichedV2Column = true;
        console.warn(`    ⚠️  enriched_v2_at not set (${markErr.message}) — apply migration 20261010000000.`);
      }
    }

    const { data: scoreData } = await supabase.rpc("calculate_alphamap_score", { p_startup_id: row.id });
    const score = scoreData as { score?: number; tier?: string } | null;
    if (score?.score != null) {
      await supabase.from("alphamap_score_history").upsert(
        { startup_id: row.id, score: Math.round(score.score), tier: score.tier ?? null, snapshot_date: new Date().toISOString().slice(0, 10) },
        { onConflict: "startup_id,snapshot_date" },
      );
    }
  }

  summary.totalFieldsPatched += fieldsPatched;
  summary.totalNewsAdded += newsAdded;
  summary.totalCompetitorsAdded += Math.max(0, competitorsAdded);
  const anyWrite = fieldsPatched > 0 || plan.inserts.length > 0 || plan.updates.length > 0 || headcountPoints.length > 0;
  summary.tally[anyWrite ? "success" : "partial"]++;

  const totalRaised = computeTotalRaised([...existingRefs, ...plan.inserts]);
  const parts = [
    `${fieldsPatched} field(s)`,
    `rounds +${plan.inserts.length} new / ${plan.updates.length} filled${plan.conflicts.length ? ` / ${plan.conflicts.length} conflict(s)` : ""}`,
    totalRaised > 0 ? `total raised $${(totalRaised / 1e6).toFixed(1)}M` : null,
    `${competitorsAdded > 0 ? `+${competitorsAdded}` : 0} competitor(s)`,
    `${newsAdded > 0 ? `+${newsAdded}` : 0} news`,
    headcountPoints.length ? `${headcountPoints.length} headcount point(s)` : null,
    tagNames.length ? `tags: ${tagNames.join(", ")}` : null,
  ].filter(Boolean);
  console.log(`    ${anyWrite ? "✅" : "🟠"} ${parts.join(" | ")}`);
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
      "id, name, website, description, value_proposition, industry, founded_year, country, city, employee_count, employee_range, growth_trend, founders, leadership, competitors, acquisitions, news, patent_count, patent_fields, patents, tech_stack, github_url, huggingface_url, arr_milestones, revenue_estimate, valuation_benchmarks, linkedin_url, facebook_url, instagram_url, sector_id, funding_history_complete, status, last_enriched_at, is_manually_verified",
    ).order("name").range(from, to),
  );
  const allRounds = await fetchAllPaginated<V2FundingRoundRow>((from, to) =>
    supabase.from("funding_rounds").select(
      "id, startup_id, round_type, amount_raised, valuation, is_valuation_estimated, announcement_date, source_url, lead_investor, investors, investor_amounts",
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
    .filter((s) => !!s.description && s.status !== "ipo" &&
      isUpdateDue(s, (roundsByStartup.get(s.id) ?? []).map((r) => r.announcement_date), { activeDays: UPDATE_ACTIVE_DAYS, quietDays: UPDATE_QUIET_DAYS }))
    .sort((a, b) => (a.last_enriched_at ?? "").localeCompare(b.last_enriched_at ?? ""));
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
    tally: { success: 0, partial: 0, rejected: 0, removed_public: 0, no_data: 0, low_evidence: 0, error: 0, error_incomplete_extraction: 0, no_change: 0 },
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
    console.log(`📍 [${i + 1}/${queue.length}] ${elapsedMin.toFixed(0)} min | $${summary.totalCostUsd.toFixed(2)} so far | ✅ ${t.success} 🟠 ${t.partial} 🚫 ${t.rejected} 🔍 ${t.low_evidence + t.no_data} 💥 ${t.error}${UPDATE ? ` 💤 ${t.no_change}` : ""}`);
    const errorsBefore = summary.tally.error + summary.tally.error_incomplete_extraction;
    await processCompany(row, roundsByStartup.get(row.id) ?? [], taxonomy, startupByDomain, summary);
    consecutiveErrors = summary.tally.error + summary.tally.error_incomplete_extraction > errorsBefore ? consecutiveErrors + 1 : 0;
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error(`\n⛔  ${consecutiveErrors} companies in a row failed — this looks systemic (API key, credits, provider outage), not company-specific. Stopping so the rest of the queue isn't burned. Fix the cause and re-run; it continues from here.`);
      break;
    }
    // The company page reads startups_search — refresh it periodically on a
    // long run, not only at the very end.
    if (!DRY_RUN && REFRESH_EVERY > 0 && (i + 1) % REFRESH_EVERY === 0) await refreshSearch();
    if (i < queue.length - 1 && !stopRequested) {
      console.log(`    ⏳  Waiting ${DELAY_MS / 1000}s…\n`);
      await interruptibleSleep(DELAY_MS);
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
