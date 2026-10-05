#!/usr/bin/env node
/**
 * scripts/bulk_enrich_v2.ts — the v2 orchestrator. Per
 * docs/enrichment_v2_spec.md Section 3's per-company pipeline, reusing
 * every lib/enrichment/ module built against that spec.
 *
 * ── WHAT THIS IS (and isn't) ─────────────────────────────────────────────
 * v1 (scripts/bulk_enrich_all.ts) stays untouched and runnable until this
 * passes the Phase 1 acceptance criteria (spec Section 7). This script
 * does NOT yet implement:
 *   - Stage 9 (conditional deep dives for early rounds / thin profiles) —
 *     the general-purpose pass below is the full pipeline for every
 *     company; the two targeted second-pass re-searches v1 has are
 *     deferred. A company that needs one will simply score lower / stay
 *     incomplete rather than get a wrong guess — consistent with ground
 *     rule 2, just less thorough than the final version should be.
 *   - News article OG-image fetching (cosmetic, v1's fetchArticleOgImage).
 *   - enrich_tech_signals.ts's GitHub/Hugging Face API signals (issue 11,
 *     explicitly a separate script per the target architecture).
 * Both are flagged here, not silently dropped, and are natural next
 * increments once this core pipeline is validated against real data.
 *
 * Reuses from v1 (already safely exported for exactly this, per the Phase
 * 0 refactor — v1 itself is not modified): initV1Context() for env
 * loading + the `supabase` client, so this script never duplicates
 * credential handling.
 *
 * Same CLI/env vars as v1 (ground rule 3), plus the new ones from the spec:
 *   DRY_RUN (default true), OFFSET (default 0), BATCH_SIZE (default 9999),
 *   DELAY_MS (default 20000), MAX_TIER (default 3), MIN_CONFIDENCE (kept
 *   for parity but UNUSED here — v2 gates per-field via
 *   MIN_PROFILE_CONFIDENCE/MIN_FUNDING_CONFIDENCE instead of one whole-
 *   company score, per issue 9), ENRICH_MODEL, PROFILE_MODEL,
 *   FUNDING_MODEL (both default to ENRICH_MODEL), MIN_PROFILE_CONFIDENCE
 *   (default 50), MIN_FUNDING_CONFIDENCE (default 60).
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
  createSearchProviderState, verifyDomainMatch, webSearch, fetchCompanyWebsitePages,
} from "../lib/enrichment/searchProviders.ts";
import { filterByEntity, type EntityAnchors } from "../lib/enrichment/entity.ts";
import { buildLabeledSources, type RawSearchResult } from "../lib/enrichment/sources.ts";
import { extractProfile, loadSectorTaxonomy, type SectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { extractFunding, roundToRoundLike } from "../lib/enrichment/extractFunding.ts";
import { validateEnrichment } from "../lib/enrichment/validation.ts";
import { dedupRounds, computeTotalRaised, type RoundLike } from "../lib/enrichment/rounds.ts";
import { computeFieldConfidence, meetsProfileThreshold, meetsFundingThreshold } from "../lib/enrichment/confidence.ts";
import {
  decideScalarWrite, decideHeadcountUpdate, mergePeople, appendDatedFigures,
  fillArrayIfEmpty, fillScalarIfNull, type CandidateValue,
} from "../lib/enrichment/write.ts";
import { validateWebsiteCandidate, websiteDomain, type DomainOwner } from "../lib/enrichment/websiteValidation.ts";
import type { SourceType } from "../lib/enrichment/sourceTypes.ts";

// ── Configuration (ground rule 3: same env vars as v1) ──────────────────
const BATCH_SIZE     = Number(process.env.BATCH_SIZE     ?? 9999);
const OFFSET         = Number(process.env.OFFSET         ?? 0);
const DELAY_MS       = Number(process.env.DELAY_MS       ?? 20_000);
const DRY_RUN        = process.env.DRY_RUN               !== "false";
const MAX_TIER       = Number(process.env.MAX_TIER       ?? 3);
// DRY_RUN's own "Would patch: <field names>" line only shows which fields
// would change, not what they'd change TO -- useless for actually checking
// accuracy against real data. VERBOSE=true additionally prints the full
// candidate value + evidence quote per field, so a human can sanity-check
// each claim before ever flipping DRY_RUN=false.
const VERBOSE         = process.env.VERBOSE               === "true";
// Kept for parity/visibility only -- v2 does not gate on a single whole-
// company confidence score (issue 9's entire point). Printed in the run
// header so anyone diffing v1/v2 output side by side isn't confused by its
// absence; never read for a decision anywhere below.
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE ?? 40);

const ENRICH_MODEL  = process.env.ENRICH_MODEL  ?? "claude-haiku-4-5-20251001";
const PROFILE_MODEL = process.env.PROFILE_MODEL ?? ENRICH_MODEL;
const FUNDING_MODEL = process.env.FUNDING_MODEL ?? ENRICH_MODEL;
const MIN_PROFILE_CONFIDENCE = Number(process.env.MIN_PROFILE_CONFIDENCE ?? 50);
const MIN_FUNDING_CONFIDENCE = Number(process.env.MIN_FUNDING_CONFIDENCE ?? 60);

let anthropic: Anthropic;

// ── Minimal row shapes this script actually reads/writes ─────────────────
// A deliberately narrower slice than v1's full StartupRow/FundingRoundRow —
// only the columns this pipeline's current scope (profile scalars, social
// links, founders/leadership, headcount, funding rounds, competitors/
// acquisitions/patents/tech/financials fill-once fields) touches. Anything
// this script doesn't yet write (news images, tech signals) isn't fetched
// either, keeping the query itself a source of truth for current scope.
interface V2StartupRow {
  id: string; name: string; website: string | null;
  description: string | null; value_proposition: string | null; industry: string | null;
  founded_year: number | null; country: string | null; city: string | null;
  employee_count: number | null; employee_range: string | null; growth_trend: string | null;
  founders: Array<{ name: string; title?: string; bio?: string; linkedin_url?: string; had_prior_exit?: boolean; elite_background?: boolean; notable_pedigree?: boolean }> | null;
  leadership: Array<{ name: string; role: string; bio?: string; linkedin_url?: string; joined_date?: string; had_prior_exit?: boolean; elite_background?: boolean; notable_pedigree?: boolean }> | null;
  competitors: Array<{ name: string; website?: string; how_it_competes: string }> | null;
  acquisitions: Array<{ company_name: string; website?: string; acquired_date?: string; amount?: number; description?: string }> | null;
  patent_count: number | null; patent_fields: string[] | null;
  patents: Array<{ title: string; patent_number?: string; filing_date?: string; url?: string; summary?: string }> | null;
  tech_stack: string[] | null; github_url: string | null; huggingface_url: string | null;
  arr_milestones: Array<{ arr: number; date?: string }> | null;
  revenue_estimate: { range_low?: number; range_high?: number; as_of_date?: string } | null;
  valuation_benchmarks: Array<{ valuation: number; date?: string }> | null;
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
}

type ProcessStatus =
  | "success" | "partial" | "rejected" | "removed_public" | "no_data"
  | "low_evidence" | "error" | "error_incomplete_extraction";

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

// The 9 search queries from v1's researchCompany(), unchanged (ground rule
// 4 / spec stage 1: "The same 9 Serper queries as v1"). Returns structured
// results per query instead of v1's joined-string-per-query, each tagged
// with its own query_label for sources.ts to carry through.
async function runAllSearches(
  name: string, anchor: string, state: ReturnType<typeof createSearchProviderState>,
): Promise<RawSearchResult[]> {
  const queries: Array<[string, string]> = [
    ["history",     `"${name}"${anchor} seed round "Series A" first funding earliest founding investors site:crunchbase.com OR site:techcrunch.com OR site:pitchbook.com`],
    ["amounts",     `"${name}"${anchor} total funding raised since founding all rounds USD million billion valuation announcement history`],
    ["backers",     `"${name}"${anchor} lead investor venture capital backed participated investors funded round investment amount check size`],
    ["profile",     `"${name}"${anchor} company founder CEO CTO description industry headquarters country city employees headcount acquired acquisition patents intellectual property linkedin.com/in profile linkedin.com/company facebook.com instagram.com 2025 2026`],
    ["competitors", `"${name}"${anchor} competitors alternatives vs rivals "compared to" market landscape`],
    ["news",        `"${name}"${anchor} news 2025 2026 site:techcrunch.com OR site:venturebeat.com OR site:prnewswire.com OR site:businesswire.com OR site:forbes.com OR site:sifted.eu launch funding announcement`],
    ["patents",     `"${name}"${anchor} patent OR patents OR site:patents.google.com`],
    ["financials",  `"${name}"${anchor} ARR "annual recurring revenue" OR revenue estimate OR valued at OR valuation milestone`],
    ["tech",        `"${name}"${anchor} tech stack built with OR site:github.com OR site:huggingface.co`],
  ];
  const batches = await Promise.all(queries.map(([label, q]) => webSearch(q, label, state)));
  return batches.flat();
}

interface RunSummary {
  tally: Record<ProcessStatus, number>;
  droppedByReason: Map<string, number>;
  totalRoundsInserted: number;
  totalFieldsPatched: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  // Aggregated across every company's own SearchProviderState -- answers
  // "is the website fetch actually working" with real numbers instead of
  // eyeballing per-company log lines across a whole batch.
  websitePagesFetched: number;
  websitePagesSkippedThin: number;
  tavilyCalls: number;
}

// $/token by model (ground rule 3: keep cost/token tracking). Computed per
// call against that call's OWN model, then accumulated as a running dollar
// total -- not reconstructed from aggregate token counts after the fact --
// since PROFILE_MODEL and FUNDING_MODEL can legitimately differ.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  "claude-haiku-4-5-20251001": { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  "claude-sonnet-5": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
};

function recordCost(summary: RunSummary, model: string, inputTokens: number, outputTokens: number): void {
  summary.totalInputTokens += inputTokens;
  summary.totalOutputTokens += outputTokens;
  const pricing = PRICING[model] ?? PRICING["claude-haiku-4-5-20251001"];
  summary.totalCostUsd += inputTokens * pricing.input + outputTokens * pricing.output;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
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

  // ── Stage 0: domain verification ──────────────────────────────────────
  const domainVerification = await verifyDomainMatch(row.name, row.website, searchState);
  const effectiveWebsite = domainVerification.verified === false ? null : row.website;
  if (domainVerification.verified === false) console.warn(`    ⚠️  Domain verification: ${domainVerification.note}`);
  else if (domainVerification.verified === true) console.log(`    ✅  Domain verified via Crunchbase/LinkedIn`);

  const domain = websiteDomain(effectiveWebsite);
  const anchor = domain ? ` "${domain}"` : row.country ? ` ${row.country} (startup OR tech company)` : "";

  // ── Stage 1 + 2: search + website fetch, in parallel ──────────────────
  const [searchResults, websitePages] = await Promise.all([
    runAllSearches(row.name, anchor, searchState),
    fetchCompanyWebsitePages(effectiveWebsite, searchState),
  ]);
  // Captured here, right after the only two stages that touch searchState,
  // so it's accounted for regardless of which exit path this company takes
  // below (rejected/archived/low_evidence/etc. all still searched real data).
  summary.websitePagesFetched += searchState.websitePagesFetched;
  summary.websitePagesSkippedThin += searchState.websitePagesSkippedThin;
  summary.tavilyCalls += searchState.tavilyCallCount;

  const allRaw: RawSearchResult[] = [
    ...searchResults,
    ...websitePages.map((p) => ({ url: p.url, content: p.content, provider: p.provider, query_label: "website" })),
  ];

  if (allRaw.length === 0) {
    console.log("    🔍  All searches failed — no data retrieved");
    summary.tally.no_data++;
    return;
  }

  // ── Stage 3: entity filter ─────────────────────────────────────────────
  const anchors: EntityAnchors = {
    domain: domain ?? undefined,
    founderNames: (row.founders ?? []).map((f) => f.name),
    trustedCountry: row.is_manually_verified ? (row.country ?? undefined) : undefined,
  };
  const searchOnlyResults = allRaw.filter((r) => r.provider !== "tavily_extract" && r.provider !== "cheerio");
  const kept = searchOnlyResults.filter((r) =>
    filterByEntity({ url: r.url, title: r.title, snippet: r.content }, anchors, row.name).kept,
  );
  const entityStatus = kept.length < 2 ? "low_evidence" : "ok";
  // Website pages are never entity-filtered -- they ARE the company's own
  // site by construction (we just fetched it from its own verified/on-file
  // domain), so there's no "wrong company" risk for entity.ts to catch.
  const websiteRaw = allRaw.filter((r) => r.provider === "tavily_extract" || r.provider === "cheerio");
  const usableResults = [...kept, ...websiteRaw];

  if (entityStatus === "low_evidence" && websiteRaw.length === 0) {
    console.log(`    🔍  low_evidence — fewer than 2 results survived entity filtering, and no website fetch. Skipping Claude calls.`);
    summary.tally.low_evidence++;
    return;
  }

  // ── Stage 4: labeled sources + two extraction calls ────────────────────
  const labeledSources = buildLabeledSources(usableResults, domain);
  const [profileOutcome, fundingOutcome] = await Promise.all([
    extractProfile(row.name, labeledSources, { client: anthropic, model: PROFILE_MODEL, taxonomy }),
    extractFunding(row.name, labeledSources, { client: anthropic, model: FUNDING_MODEL }),
  ]);

  if (!profileOutcome || !fundingOutcome) {
    console.log("    ❌  Extraction call(s) returned no tool_use block at all.");
    summary.tally.error++;
    return;
  }
  recordCost(summary, PROFILE_MODEL, profileOutcome.inputTokens, profileOutcome.outputTokens);
  recordCost(summary, FUNDING_MODEL, fundingOutcome.inputTokens, fundingOutcome.outputTokens);
  for (const [label, outcome] of [["profile", profileOutcome], ["funding", fundingOutcome]] as const) {
    console.log(`    🧠  ${label} extraction: stop_reason=${outcome.stopReason} output_tokens=${outcome.outputTokens}`);
    if (outcome.stopReason === "max_tokens") {
      console.warn(`    ⚠️  ${label} extraction TRUNCATED for "${row.name}" — fields after the cutoff are missing, not genuinely empty.`);
    }
  }

  const { result: profile, dropped: profileDropped } = profileOutcome.extraction;
  const { result: funding, dropped: fundingDropped } = fundingOutcome.extraction;
  for (const d of [...profileDropped, ...fundingDropped]) bump(summary.droppedByReason, d.reason);

  if (profile.is_public_company) {
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
  if (!profile.is_tech_company) {
    console.log("    🚫  REJECTED — not a technology-driven company");
    summary.tally.rejected++;
    return;
  }

  // ── Stage 6: validation (city/country/founded_year/headcount/rounds) ──
  const allRoundLikes: RoundLike[] = [
    ...existingRounds.map((r) => ({
      round_type: r.round_type ?? "Other", amount_raised: r.amount_raised, valuation: r.valuation,
      announcement_date: r.announcement_date, lead_investor: r.lead_investor,
      other_investors: r.investors, source_url: r.source_url,
    })),
    ...funding.funding_rounds.map(roundToRoundLike),
  ];
  const totalRaisedUsd = computeTotalRaised(allRoundLikes);

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
      country_source_type: profile.profile.country ? labeledSources.find((s) => s.source_id === profile.profile.country!.source_id)?.source_type : null,
      employee_count: profile.metrics.employee_count?.value ?? null,
    },
    rounds: allRoundLikes,
    totalRaisedUsd,
  });
  for (const issue of validation.issues) {
    console.log(`    ⚠️  [${issue.rule}] ${issue.message}`);
    bump(summary.droppedByReason, issue.rule);
  }

  // ── Stage 7: round dedup (existing + new, combined) ────────────────────
  const dedup = dedupRounds(allRoundLikes);
  for (const { a, b } of dedup.needsReview) {
    console.log(`    🔶  Possible duplicate rounds need human review: ${a.round_type} (${a.announcement_date}) vs ${b.round_type} (${b.announcement_date})`);
    bump(summary.droppedByReason, "possible_duplicate_needs_review");
  }
  // Only rounds that are genuinely NEW (not already one of existingRounds)
  // get inserted -- dedup.rounds includes both old and new, merged.
  const existingKey = (r: RoundLike) => `${r.round_type}|${r.announcement_date}|${r.amount_raised}`;
  const existingKeys = new Set(existingRounds.map((r) => existingKey({ round_type: r.round_type ?? "Other", announcement_date: r.announcement_date, amount_raised: r.amount_raised })));
  const newRoundsToInsert = dedup.rounds.filter((r) => !existingKeys.has(existingKey(r)) && r.round_type !== "IPO"); // IPO rounds never stored, matching v1

  // ── Stage 8: confidence ─────────────────────────────────────────────────
  function sourceTypeFor(sourceId: string | undefined): SourceType | undefined {
    if (!sourceId) return undefined;
    return labeledSources.find((s) => s.source_id === sourceId)?.source_type;
  }
  const cityConfidence = profile.profile.city ? computeFieldConfidence([{ source_type: sourceTypeFor(profile.profile.city.source_id) ?? "model_inferred" }]) : 0;
  const countryConfidence = profile.profile.country ? computeFieldConfidence([{ source_type: sourceTypeFor(profile.profile.country.source_id) ?? "model_inferred" }]) : 0;

  // ── Stage 10: write ──────────────────────────────────────────────────────
  const patch: Record<string, unknown> = {};
  const fieldWrites: Array<{ field: string; value: unknown; source_id: string; evidence_quote: string; source_type: SourceType }> = [];

  if (validation.accepted.city && meetsProfileThreshold(cityConfidence) && row.city == null) {
    patch.city = validation.accepted.city;
    if (profile.profile.city) fieldWrites.push({ field: "profile.city", value: validation.accepted.city, source_id: profile.profile.city.source_id, evidence_quote: profile.profile.city.evidence_quote, source_type: sourceTypeFor(profile.profile.city.source_id) ?? "model_inferred" });
  }
  if (validation.accepted.country && row.country == null && meetsProfileThreshold(countryConfidence)) {
    patch.country = validation.accepted.country;
    if (profile.profile.country) fieldWrites.push({ field: "profile.country", value: validation.accepted.country, source_id: profile.profile.country.source_id, evidence_quote: profile.profile.country.evidence_quote, source_type: sourceTypeFor(profile.profile.country.source_id) ?? "model_inferred" });
  } else if (validation.accepted.country && row.country != null) {
    // Existing value present -- issue 3's overwrite rule, not a plain fill.
    const decision = decideScalarWrite<string>(
      { value: row.country, provenance: row.is_manually_verified ? { source_type: "manual", is_manually_verified: true } : null },
      { value: validation.accepted.country, source_type: sourceTypeFor(profile.profile.country?.source_id) ?? "model_inferred", independentSourceCount: 1 },
    );
    // Outranking the existing source is necessary but not sufficient --
    // ground rule 2 means even a higher-ranked source still needs to clear
    // the normal confidence bar before it's allowed to overwrite a real
    // value (as opposed to filling a blank, where there's nothing to lose).
    if (decision.decision === "overwrite" && meetsProfileThreshold(countryConfidence)) {
      patch.country = validation.accepted.country;
      console.log(`    ✏️   Overwriting country: ${decision.reason}`);
    } else if (decision.decision === "overwrite") {
      console.log(`    ⚠️  Country overwrite candidate outranked the existing source but confidence (${countryConfidence}) is below the threshold -- kept existing value.`);
    }
  }
  if (validation.accepted.founded_year && row.founded_year == null) patch.founded_year = validation.accepted.founded_year;
  if (!row.description && profile.profile.description) patch.description = profile.profile.description;
  patch.value_proposition = fillScalarIfNull(row.value_proposition, profile.profile.value_proposition);
  if (!row.industry && profile.profile.industry) patch.industry = profile.profile.industry;
  if (!row.website && profile.profile.website) {
    const websiteResult = validateWebsiteCandidate(profile.profile.website.value, row.id, startupByDomain);
    patch.website = websiteResult.website;
    if (websiteResult.rejectedReason) console.warn(`    ⚠️  Rejected website "${profile.profile.website.value}" — ${websiteResult.rejectedReason}${websiteResult.rejectedOwnerName ? ` (${websiteResult.rejectedOwnerName})` : ""}.`);
  }
  if (!row.linkedin_url && profile.profile.linkedin_url) patch.linkedin_url = profile.profile.linkedin_url.value;
  if (!row.facebook_url && profile.profile.facebook_url) patch.facebook_url = profile.profile.facebook_url.value;
  if (!row.instagram_url && profile.profile.instagram_url) patch.instagram_url = profile.profile.instagram_url.value;

  if (!row.sector_id && profile.profile.sector_name) {
    const { data: sid } = await supabase.rpc("sector_id_by_name", { p_name: profile.profile.sector_name });
    if (sid) patch.sector_id = sid;
  }

  const cleanFounders = (profile.profile.founders ?? []).map((f) => ({
    name: f.name, title: f.title, bio: f.bio, linkedin_url: f.linkedin_url?.value,
    had_prior_exit: f.had_prior_exit, elite_background: f.elite_background, notable_pedigree: f.notable_pedigree,
  }));
  if (cleanFounders.length > 0) patch.founders = mergePeople(row.founders ?? [], cleanFounders);

  const cleanLeadership = (profile.leadership ?? []).map((l) => ({
    name: l.name, role: l.role, bio: l.bio, linkedin_url: l.linkedin_url?.value, joined_date: l.joined_date,
    had_prior_exit: l.had_prior_exit, elite_background: l.elite_background, notable_pedigree: l.notable_pedigree,
  }));
  if (cleanLeadership.length > 0) patch.leadership = mergePeople(row.leadership ?? [], cleanLeadership);

  patch.competitors = fillArrayIfEmpty(row.competitors ?? [], profile.competitors);
  patch.acquisitions = fillArrayIfEmpty(row.acquisitions ?? [], profile.acquisitions);
  patch.patent_count = fillScalarIfNull(row.patent_count, profile.patent_summary.patent_count);
  patch.patent_fields = fillArrayIfEmpty(row.patent_fields ?? [], profile.patent_summary.patent_fields);
  patch.patents = fillArrayIfEmpty(row.patents ?? [], profile.patents);
  patch.tech_stack = fillArrayIfEmpty(row.tech_stack ?? [], profile.technology.tech_stack ?? []);
  if (!row.github_url && profile.technology.github_url) patch.github_url = profile.technology.github_url.value;
  if (!row.huggingface_url && profile.technology.huggingface_url) patch.huggingface_url = profile.technology.huggingface_url.value;

  patch.arr_milestones = appendDatedFigures(row.arr_milestones ?? [], funding.arr_milestones, (m) => m.arr);
  if (funding.revenue_estimate) patch.revenue_estimate = fillScalarIfNull(row.revenue_estimate, funding.revenue_estimate);
  patch.valuation_benchmarks = appendDatedFigures(row.valuation_benchmarks ?? [], funding.valuation_benchmarks, (v) => v.valuation);

  // funding_history_complete: NEVER defaults to true when the model omitted
  // it (the Phase 0 lesson) -- null means genuinely unknown, not "complete".
  if (funding.funding_history_complete !== null) patch.funding_history_complete = funding.funding_history_complete;

  // Headcount: issue 6's guard, not a blind overwrite.
  let fieldsPatched = Object.values(patch).filter((v) => v !== null && v !== undefined).length;
  if (profile.metrics.employee_count) {
    const candidate: CandidateValue<number> = {
      value: profile.metrics.employee_count.value,
      source_type: sourceTypeFor(profile.metrics.employee_count.source_id) ?? "model_inferred",
      independentSourceCount: 1,
    };
    const headcountDecision = decideHeadcountUpdate(row.employee_count, candidate);
    if (headcountDecision.writeEmployeeCount) {
      patch.employee_count = candidate.value;
      fieldsPatched++;
    } else {
      console.log(`    ⚠️  Headcount change rejected (point_type=${headcountDecision.pointType}): ${row.employee_count} -> ${candidate.value} not strongly enough evidenced.`);
    }
    if (!DRY_RUN) {
      await supabase.from("headcount_history").upsert(
        { startup_id: row.id, employee_count: candidate.value, snapshot_date: new Date().toISOString().slice(0, 10) },
        { onConflict: "startup_id,snapshot_date" },
      );
    }
  }
  if (profile.metrics.employee_range) patch.employee_range = fillScalarIfNull(row.employee_range, profile.metrics.employee_range);
  if (profile.metrics.growth_trend) patch.growth_trend = profile.metrics.growth_trend;

  // VERBOSE used to be nested inside the DRY_RUN branch only -- useless for
  // exactly the case it matters most, reviewing what a REAL (DRY_RUN=false)
  // write actually contained, since that's the one case where the values
  // are about to become permanent. Runs regardless of DRY_RUN now.
  if (VERBOSE) {
    const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== undefined));
    console.log(`    [VERBOSE] Full patch values${DRY_RUN ? " (would write)" : " (writing now)"}:`);
    console.log(JSON.stringify(cleanPatch, null, 2).split("\n").map((l) => `      ${l}`).join("\n"));
    // Evidence quotes for the scalar material fields that carry one directly
    // (city/country/founded_year/website) -- the rest (arrays, merged
    // people) are reviewable straight from cleanPatch above.
    const evidenced: Array<[string, { value: unknown; source_id: string; evidence_quote: string } | undefined]> = [
      ["city", profile.profile.city], ["country", profile.profile.country],
      ["founded_year", profile.profile.founded_year], ["website", profile.profile.website],
    ];
    const withEvidence = evidenced.filter(([field, v]) => v && field in cleanPatch);
    if (withEvidence.length > 0) {
      console.log("    [VERBOSE] Evidence:");
      for (const [field, v] of withEvidence) {
        console.log(`      ${field}: "${v!.value}" <- [${v!.source_id}] "${v!.evidence_quote}"`);
      }
    }
    if (newRoundsToInsert.length > 0) {
      console.log(`    [VERBOSE] New round details${DRY_RUN ? " (would insert)" : " (inserting now)"}:`);
      console.log(JSON.stringify(newRoundsToInsert, null, 2).split("\n").map((l) => `      ${l}`).join("\n"));
    }
  }

  if (DRY_RUN) {
    console.log(`    [DRY] Would patch: ${Object.keys(patch).filter((k) => patch[k] !== null && patch[k] !== undefined).join(", ") || "(nothing)"}`);
    console.log(`    [DRY] Would insert ${newRoundsToInsert.length} new round(s): ${newRoundsToInsert.map((r) => r.round_type).join(", ") || "none"}`);
  } else {
    const { error } = await supabase.from("startups").update(patch).eq("id", row.id);
    if (error) console.warn(`    ⚠️  Profile patch failed: ${error.message}`);

    // NOTE: field_provenance is currently populated only for city/country,
    // the two fields this first version's overwrite logic actually acts on
    // (see decideScalarWrite calls above). Extending this to every material
    // field (founded_year, website, social/GitHub/Hugging Face URLs,
    // founders[].linkedin_url) is the natural next increment -- they're
    // still fill-null-only writes below, just not yet provenance-tracked.
    for (const fw of fieldWrites) {
      const { error: provenanceErr } = await supabase.from("field_provenance").insert({
        startup_id: row.id, field: fw.field, value: fw.value, source_url: labeledSources.find((s) => s.source_id === fw.source_id)?.url,
        source_type: fw.source_type, evidence_quote: fw.evidence_quote,
        confidence: computeFieldConfidence([{ source_type: fw.source_type }]),
      });
      // A real run against production caught this swallowing a genuine
      // failure (the field_provenance/field_changes migration had never
      // actually been applied there -- see docs/enrichment_v2_spec.md's
      // provenance migration) with zero indication anything had gone
      // wrong: the startups patch succeeded, so the run reported success,
      // while every provenance row silently failed to write.
      if (provenanceErr) console.warn(`    ⚠️  field_provenance insert failed (${fw.field}): ${provenanceErr.message}`);
    }

    for (const round of newRoundsToInsert) {
      if (round.round_type === "IPO") continue;
      const roundConfidence = computeFieldConfidence([{ source_type: "news" }]); // conservative default absent a per-round source trace
      if (!meetsFundingThreshold(roundConfidence) && round.amount_raised != null) {
        console.log(`    🟠  Round ${round.round_type} below funding confidence threshold -- inserted anyway, flagged needs_review (Phase 1 doesn't yet withhold, only flags).`);
      }
      const { error: roundErr } = await supabase.from("funding_rounds").insert({
        startup_id: row.id, round_type: round.round_type,
        amount_raised: round.amount_raised ?? null, valuation: round.valuation ?? null,
        announcement_date: round.announcement_date ?? null, source_url: round.source_url ?? null,
        lead_investor: round.lead_investor ?? null,
        investors: round.other_investors && round.other_investors.length > 0 ? round.other_investors : null,
      });
      if (roundErr) console.warn(`    ⚠️  Round insert failed (${round.round_type}): ${roundErr.message}`);
      else summary.totalRoundsInserted++;
    }

    await supabase.from("startups").update({ last_enriched_at: new Date().toISOString() }).eq("id", row.id);

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
  summary.tally[fieldsPatched > 0 || newRoundsToInsert.length > 0 ? "success" : "partial"]++;
  console.log(`    ${fieldsPatched > 0 ? "✅" : "🟠"} ${fieldsPatched} field(s) patched | ${newRoundsToInsert.length} round(s) inserted | ${dedup.needsReview.length} pair(s) flagged for review`);
}

async function main() {
  await initV1Context();
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const taxonomy = await loadSectorTaxonomy(supabase);

  const startedAt = new Date().toISOString();
  console.log(`╔${"═".repeat(62)}╗`);
  console.log(`║${"  AlphaMap — v2 Enrichment Run".padEnd(62)}║`);
  console.log(`║  ${startedAt}${"".padEnd(Math.max(0, 62 - 2 - startedAt.length))}║`);
  console.log(`║  DRY_RUN=${String(DRY_RUN).padEnd(5)} | BATCH=${String(BATCH_SIZE).padEnd(6)} | OFFSET=${String(OFFSET).padEnd(5)} | DELAY=${DELAY_MS / 1000}s${" ".padEnd(Math.max(0, 62 - 58))}║`);
  console.log(`║  PROFILE_MODEL=${PROFILE_MODEL}${" ".padEnd(Math.max(0, 62 - 16 - PROFILE_MODEL.length))}║`);
  console.log(`║  FUNDING_MODEL=${FUNDING_MODEL}${" ".padEnd(Math.max(0, 62 - 16 - FUNDING_MODEL.length))}║`);
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
      "id, name, website, description, value_proposition, industry, founded_year, country, city, employee_count, employee_range, growth_trend, founders, leadership, competitors, acquisitions, patent_count, patent_fields, patents, tech_stack, github_url, huggingface_url, arr_milestones, revenue_estimate, valuation_benchmarks, linkedin_url, facebook_url, instagram_url, sector_id, funding_history_complete, status, last_enriched_at, is_manually_verified",
    ).order("name").range(from, to),
  );
  const allRounds = await fetchAllPaginated<V2FundingRoundRow>((from, to) =>
    supabase.from("funding_rounds").select(
      "id, startup_id, round_type, amount_raised, valuation, is_valuation_estimated, announcement_date, source_url, lead_investor, investors",
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

  const queue = eligibleQueue.slice(OFFSET, OFFSET + BATCH_SIZE);
  if (queue.length === 0) {
    console.log("✅  Queue is empty after OFFSET/BATCH_SIZE/MAX_TIER filter. Nothing to process.");
    return;
  }
  console.log(`Processing ${queue.length} of ${eligibleQueue.length} eligible companies (Tier 1: ${tier1.length}, Tier 2: ${tier2.length}, Tier 3: ${tier3.length}).\n`);

  const summary: RunSummary = {
    tally: { success: 0, partial: 0, rejected: 0, removed_public: 0, no_data: 0, low_evidence: 0, error: 0, error_incomplete_extraction: 0 },
    droppedByReason: new Map(),
    totalRoundsInserted: 0, totalFieldsPatched: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0,
    websitePagesFetched: 0, websitePagesSkippedThin: 0, tavilyCalls: 0,
  };

  for (let i = 0; i < queue.length; i++) {
    const row = queue[i];
    try {
      await processCompany(row, roundsByStartup.get(row.id) ?? [], taxonomy, startupByDomain, summary);
    } catch (err) {
      console.error(`    💥  Unhandled error processing "${row.name}": ${String(err)}`);
      summary.tally.error++;
    }
    if (i < queue.length - 1) {
      console.log(`    ⏳  Waiting ${DELAY_MS / 1000}s…\n`);
      await sleep(DELAY_MS);
    }
  }

  if (!DRY_RUN && (summary.totalFieldsPatched > 0 || summary.totalRoundsInserted > 0)) {
    const { error } = await supabase.rpc("refresh_startups_search");
    if (error) console.warn(`⚠️  startups_search refresh failed: ${error.message}`);
    else console.log("🔄  startups_search refreshed");
  }

  console.log(`\n${"═".repeat(62)}`);
  console.log("V2 ENRICHMENT RUN SUMMARY");
  console.log("═".repeat(62));
  for (const [status, count] of Object.entries(summary.tally)) {
    console.log(`  ${status.padEnd(28)} ${count}`);
  }
  console.log(`  rounds inserted              ${summary.totalRoundsInserted}`);
  console.log(`  fields patched               ${summary.totalFieldsPatched}`);
  console.log(`  tokens (in/out)              ${summary.totalInputTokens.toLocaleString()} / ${summary.totalOutputTokens.toLocaleString()}`);
  console.log(`  claude cost (est.)           $${summary.totalCostUsd.toFixed(2)}  (search API cost is separate)`);
  console.log(`  website pages: ${summary.websitePagesFetched} real / ${summary.websitePagesSkippedThin} thin-404 skipped  |  tavily calls: ${summary.tavilyCalls}`);
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
