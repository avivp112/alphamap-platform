/**
 * lib/enrichment/collect.ts — v2's collection stages for ONE company, with
 * no database writes: Stage 0 domain check -> Stage 1+2 website + searches
 * -> Stage 3 entity filter + full articles -> Stage 4 profile / funding /
 * market extraction -> Stage 9 deep dive -> Stage 9b founders' LinkedIn ->
 * round grounding -> Stage 6 validation -> Stage 7 round planning ->
 * Stage 8 confidence.
 *
 * Moved verbatim out of scripts/bulk_enrich_v2.ts enrichCompany() (2026-10-18)
 * so the bulk run and the "check a company" worker share one engine: the
 * bulk script writes the result to startups (Stage 10); the worker shows it
 * to the one user who asked, unverified, and writes nothing shared. The
 * script's globals became the explicit CollectContext; the stage logic and
 * its thresholds did not change. The only behaviour moved out: archiving a
 * public company (status='ipo') is now the caller's, on outcome "public".
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  verifyDomainMatch, webSearch, newsSearch, serperSearch, serperNewsSearch, fetchCompanyWebsitePages, fetchArticleTexts,
  searchMostlyFailed, type SearchProviderState,
} from "./searchProviders.ts";
import { filterByEntity, deriveIdentityKeywords, nameQualifiersOnOwnSite, type EntityAnchors } from "./entity.ts";
import { buildLabeledSources, mergeDuplicateResults, classifySourceType, type RawSearchResult, type LabeledSource } from "./sources.ts";
import { extractProfile, type SectorTaxonomy } from "./extractProfile.ts";
import { extractFunding, roundToRoundLike, type V2Round } from "./extractFunding.ts";
import { extractMarket, normalizeUrlForMatch } from "./extractMarket.ts";
import { lookupEpoPatents, type CompanyIdentity, type EpoPatentResult } from "./epoPatents.ts";
import { hintFromRound, hintQueries, confirmHint, hintKey, type RoundHint } from "./hints.ts";
import { detectGaps, buildDeepDiveQueries, hasNoFinancingRounds, type DeepDiveSection } from "./deepDive.ts";
import {
  groundRoundDetails, isUnstatedEvent, rejectRound, planRoundWrites, mergeProfileExtractions, mergeFundingExtractions, mergeMarketExtractions,
  type ExistingRoundRef,
} from "./assemble.ts";
import { buildSharedExtractionRequest, type ExtractionKind } from "./sharedExtraction.ts";
import { pickArticlesToRead } from "./articles.ts";
import { runTechGate, shouldSkipAsNonTech, type TechGateVerdict } from "./techGate.ts";
import { personMentionedIn, groundFounders, founderNamesNotExtracted } from "./people.ts";
import { findPersonResult, discoverFounders, founderTitleFromHeadline, samePersonName, parseLinkedInFacts, bioFromLinkedInFacts } from "./linkedin.ts";
import { findListingStatement, type ListingStatement } from "./listing.ts";
import { QUIET_DAYS, buildUpdateQueries, knownUrlSet, mentionsFunding, newResultsOnly, type SeenUrls } from "./update.ts";
import { validateEnrichment, checkNarratives } from "./validation.ts";
import type { VerifiedFact } from "./narrative.ts";
import { computeTotalRaised, normalizeRoundType, type RoundLike } from "./rounds.ts";
import { computeFieldConfidence } from "./confidence.ts";
import { websiteDomain } from "./websiteValidation.ts";
import type { SourceType } from "./sourceTypes.ts";

// ── Row shapes (the startups / funding_rounds columns v2 reads) ─────────────
export interface V2StartupRow {
  id: string; name: string; website: string | null;
  description: string | null; value_proposition: string | null; industry: string | null;
  founded_year: number | null; country: string | null; city: string | null;
  founding_country: string | null; israel_rnd_center: boolean | null;
  /** Fields to collect again even though they hold a value (migration 20261106000000). */
  refresh_fields: string[] | null;
  employee_count: number | null; employee_range: string | null; growth_trend: string | null;
  founders: Array<{ name: string; title?: string; bio?: string; linkedin_url?: string; had_prior_exit?: boolean; elite_background?: boolean; notable_pedigree?: boolean }> | null;
  leadership: Array<{ name: string; role: string; bio?: string; linkedin_url?: string; joined_date?: string; had_prior_exit?: boolean; elite_background?: boolean; notable_pedigree?: boolean }> | null;
  competitors: Array<{ name: string; website?: string | null; how_it_competes: string; startup_id?: string | null; source_url?: string | null; unverified?: boolean }> | null;
  acquisitions: Array<{ company_name: string; website?: string | null; acquired_date?: string | null; amount?: number | null; description?: string | null; acquired_startup_id?: string | null }> | null;
  news: Array<{ title: string; url: string; source?: string | null; published_date?: string | null; summary?: string | null; image_url?: string | null }> | null;
  patent_count: number | null; patent_fields: string[] | null;
  patents: Array<{ title: string; patent_number?: string | null; filing_date?: string | null; url?: string | null; summary?: string | null; source?: string | null }> | null;
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

export interface V2FundingRoundRow {
  id: string; startup_id: string; round_type: string | null;
  amount_raised: number | null; valuation: number | null; is_valuation_estimated: boolean | null;
  announcement_date: string | null; source_url: string | null;
  lead_investor: string | null; investors: string[] | null;
  investor_amounts: Array<{ name: string; amount: number }> | null;
}


export interface ExtractionUsage { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number }

/** What the bulk script's globals were, passed in. */
/** The columns of startups / funding_rounds a collection reads (V2StartupRow, V2FundingRoundRow). */
export const V2_STARTUP_COLUMNS =
  "id, name, website, description, value_proposition, industry, founded_year, country, city, founding_country, israel_rnd_center, refresh_fields, employee_count, employee_range, growth_trend, founders, leadership, competitors, acquisitions, news, patent_count, patent_fields, patents, tech_stack, github_url, huggingface_url, arr_milestones, revenue_estimate, valuation_benchmarks, linkedin_url, facebook_url, instagram_url, sector_id, funding_history_complete, status, last_enriched_at, is_manually_verified";
export const V2_ROUND_COLUMNS =
  "id, startup_id, round_type, amount_raised, valuation, is_valuation_estimated, announcement_date, source_url, lead_investor, investors, investor_amounts";

/** Every value this run verified against a quote, with the quote: profile, rounds, ARR, valuations. */
export function collectVerifiedFacts(
  profile: { profile: object; metrics: object },
  funding: { funding_rounds: object[]; arr_milestones: Array<{ arr: number; evidence_quote?: string }>; valuation_benchmarks: Array<{ valuation: number; evidence_quote?: string }> },
): VerifiedFact[] {
  const facts: VerifiedFact[] = [];
  const add = (ev: unknown) => {
    const e = ev as { value?: unknown; evidence_quote?: string } | undefined;
    if (e && e.evidence_quote) facts.push({ value: e.value, quote: e.evidence_quote });
  };
  for (const v of Object.values(profile.profile)) add(v);
  for (const v of Object.values(profile.metrics)) add(v);
  for (const r of funding.funding_rounds as Array<Record<string, unknown>>) for (const k of ["amount_raised", "valuation", "announcement_date", "lead_investor"]) add(r[k]);
  for (const m of funding.arr_milestones) facts.push({ value: m.arr, quote: m.evidence_quote ?? null });
  for (const v of funding.valuation_benchmarks) facts.push({ value: v.valuation, quote: v.evidence_quote ?? null });
  return facts;
}

/** The rounds on file, as Stage 7 plans against them. */
export function roundRefs(existingRounds: V2FundingRoundRow[]): ExistingRoundRef[] {
  return existingRounds.map((r) => ({
    id: r.id, round_type: r.round_type ?? "Other", amount_raised: r.amount_raised, valuation: r.valuation,
    is_valuation_estimated: r.is_valuation_estimated, announcement_date: r.announcement_date,
    lead_investor: r.lead_investor, other_investors: r.investors, source_url: r.source_url,
    investor_amounts: r.investor_amounts,
  }));
}

/** A round validation saw, marked when this run found it (not one on file). */
type TaggedRound = RoundLike & { _new?: true };

/** The validated rounds this run found (not the ones on file it re-read). */
export function newAcceptedRounds(validation: { acceptedRounds: RoundLike[] }): RoundLike[] {
  return validation.acceptedRounds
    .filter((r) => (r as TaggedRound)._new)
    .map((r) => { const { _new, ...rest } = r as TaggedRound; void _new; return rest; });
}

export interface CollectContext {
  anthropic: Anthropic;
  models: { enrich: string; profile: string; funding: string; market: string };
  /** MODE=update: only what is new since the last check. */
  update: boolean;
  deepDive: boolean;
  techGate: boolean;
  articlesToRead: number;
  verbose: boolean;
  /** URLs earlier runs already sent to Claude (bulk only; null = none). */
  seen: SeenUrls | null;
  /** Update mode: source URLs already in field_provenance for this company. */
  knownProvenanceUrls?: () => Promise<Array<string | null>>;
  /** Called once per model call with its token usage (the caller prices it). */
  recordCost: (model: string, usage: ExtractionUsage) => void;
  /** Progress, for a user watching one company (the check worker). */
  onStage?: (stage: CollectStage, detail?: Record<string, unknown>) => void;
  /** The company's patents from the EPO register (epoPatents.ts); tests pass a stand-in. */
  patentLookup?: (company: CompanyIdentity) => Promise<EpoPatentResult | null>;
  /** Hints earlier runs stored for this company (data_hints, status open): searched for again (hints.ts). */
  openHints?: () => Promise<RoundHint[]>;
  /** Search for a primary source of each platform-only round (default on; three searches per hint at most). */
  hintSearch?: boolean;
}

export type CollectStage = "searching" | "reading" | "extracting" | "deep_dive" | "people" | "validating";

/** Counters the bulk run reports; the worker passes its own and ignores most. */
export interface CollectStats {
  droppedByReason: Map<string, number>;
  deepDives: number;
  articlesRead: number;
  earlyRejected: number;
  duplicateResultsMerged: number;
}

export const newCollectStats = (): CollectStats => ({ droppedByReason: new Map(), deepDives: 0, articlesRead: 0, earlyRejected: 0, duplicateResultsMerged: 0 });

type ProfileResult = NonNullable<Awaited<ReturnType<typeof extractProfile>>>["extraction"]["result"];
type FundingResult = NonNullable<Awaited<ReturnType<typeof extractFunding>>>["extraction"]["result"];
type MarketResult = Awaited<ReturnType<typeof extractMarket>>["extraction"]["result"];
export type LinkedInPersonPatch = { name: string; title?: string; role?: string; linkedin_url?: string; bio?: string; elite_background?: boolean; notable_pedigree?: boolean };

export interface CollectedCompany {
  outcome: "collected";
  profile: ProfileResult;
  funding: FundingResult;
  market: MarketResult;
  allSources: LabeledSource[];
  sourceById: Map<string, LabeledSource>;
  sourceTypeFor: (sourceId: string | undefined) => SourceType | undefined;
  sourceUrlFor: (sourceId: string | undefined) => string | null;
  linkedinFounders: LinkedInPersonPatch[];
  linkedinLeaders: LinkedInPersonPatch[];
  existingRefs: ExistingRoundRef[];
  validation: ReturnType<typeof validateEnrichment>;
  plan: ReturnType<typeof planRoundWrites>;
  cityConfidence: number;
  countryConfidence: number;
  domain: string | null;
  /** This run's verified values and quotes: what a weakly attributed claim must match (narrative.ts). */
  verifiedFacts?: VerifiedFact[];
  /** True when market.patents is the EPO register's list for the company (possibly empty); false = not looked up. */
  patentsFromRegister?: boolean;
  /** Rounds only a data platform states that no primary source confirmed: stored as hints, never written (hints.ts). */
  roundHints?: RoundHint[];
  /** Hints a primary source confirmed this run: written as rounds with that source; earlier ones get status confirmed. */
  confirmedHints?: Array<RoundHint & { confirmed_source_url: string }>;
}

export type CollectResult =
  | CollectedCompany
  | { outcome: "rejected" | "no_change" | "no_data" | "low_evidence" }
  | { outcome: "public"; listing: ListingStatement | null }
  | { outcome: "error"; reason: string };

// Stand-in for a funding call an update skipped (no money words in its pages).
const EMPTY_FUNDING_OUTCOME: NonNullable<Awaited<ReturnType<typeof extractFunding>>> = {
  extraction: { result: { funding_rounds: [], funding_history_complete: null, arr_milestones: [], revenue_estimate: null, valuation_benchmarks: [] }, dropped: [] },
  stopReason: "skipped", inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0,
};

// First-pass searches (10 web + 1 news): v1's query set, with its one overloaded "profile"
// query (founders + HQ + headcount + acquisitions + patents + social links
// in a single Google query) split into focused ones, one per section the
// company page shows. Each result keeps its query_label for evidence dumps.
/** Hints searched per company and run (three searches each at most); the rest wait for the next run. */
const MAX_HINTS_SEARCHED = 3;

export async function runAllSearches(name: string, anchor: string, state: SearchProviderState): Promise<RawSearchResult[]> {
  const queries: Array<[string, string]> = [
    // history/amounts/backers (three overlapping funding queries) merged
    // into one general query plus one aimed at the funding databases.
    ["funding",      `"${name}"${anchor} raised funding round seed "Series A" million investors "led by"`],
    ["funding_db",   `"${name}" funding rounds investors site:crunchbase.com OR site:tracxn.com OR site:dealroom.co OR site:pitchbook.com OR site:cbinsights.com`],
    ["overview",     `"${name}"${anchor} company overview headquarters founded`],
    ["founders",     `"${name}"${anchor} founder CEO co-founder CTO`],
    ["team",         `"${name}"${anchor} employees team size headcount hiring`],
    ["linkedin",     `site:linkedin.com/company "${name}"`],
    // Sentences that say who it competes with — not "alternatives" lists (competitorEvidence.ts).
    ["competitors",  `"${name}"${anchor} "competes with" OR "competitors include" OR "rival" OR "competing with"`],
    ["acquisitions", `"${name}"${anchor} acquires OR acquired OR acquisition`],
    ["financials",   `"${name}"${anchor} ARR "annual recurring revenue" OR revenue estimate OR valued at OR valuation milestone`],
    // (the separate "tech stack" query was dropped: careers/engineering
    // pages fetched from the company's own site carry that, for free)
  ];
  const [searchBatches, newsResults] = await Promise.all([
    Promise.all(queries.map(([label, q]) => webSearch(q, label, state))),
    // Serper's News endpoint is primary for news; the site:-heavy query is
    // only used if Jina Search has to back it up (see newsSearch()).
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

const WEBSITE_PROVIDERS = new Set(["jina", "tavily_extract", "cheerio", "serper_scrape"]);
const isWebsiteResult = (r: RawSearchResult) => WEBSITE_PROVIDERS.has(r.provider);

function logExtraction(label: string, companyName: string, outcome: { stopReason: string | null; outputTokens: number }): void {
  console.log(`    🧠  ${label} extraction: stop_reason=${outcome.stopReason} output_tokens=${outcome.outputTokens}`);
  if (outcome.stopReason === "max_tokens") {
    console.warn(`    ⚠️  ${label} extraction TRUNCATED for "${companyName}" — fields after the cutoff are missing, not genuinely empty.`);
  }
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Stages 0-9 for one company. Never writes to the database. */
export async function collectCompany(
  row: V2StartupRow,
  existingRounds: V2FundingRoundRow[],
  taxonomy: SectorTaxonomy,
  ctx: CollectContext,
  stats: CollectStats,
  searchState: SearchProviderState,
): Promise<CollectResult> {
  // URLs this company's earlier runs already sent to Claude (update mode
  // skips them; both modes record what they send).
  const seen = ctx.seen;
  const gapFillDue = ctx.update && !!seen?.gapFillDue();

  // ── Stage 0: domain verification ──────────────────────────────────────
  // (an update trusts the website already checked by the full run)
  const domainVerification = ctx.update ? { verified: undefined, note: "" } : await verifyDomainMatch(row.name, row.website, searchState);
  const effectiveWebsite = domainVerification.verified === false ? null : row.website;
  if (domainVerification.verified === false) console.warn(`    ⚠️  Domain verification: ${domainVerification.note}`);
  else if (domainVerification.verified === true) console.log(`    ✅  Domain verified via Crunchbase/LinkedIn`);

  const domain = websiteDomain(effectiveWebsite);
  const anchor = domain ? ` "${domain}"` : row.country ? ` ${row.country} (startup OR tech company)` : "";

  // ── Stage 1: website (Jina, free) → tech pre-check → searches ─────────
  // The homepage is fetched first so a clearly non-tech company is
  // rejected before paying for ~11 searches and three extraction calls.
  const websitePages = ctx.update ? [] : await fetchCompanyWebsitePages(effectiveWebsite, searchState);
  if (ctx.techGate && !ctx.update) {
    // The verdict is cached with the search results, so seeing the same
    // company again (a re-run, the next cycle) costs nothing.
    const cachedVerdict = searchState.cache?.get<TechGateVerdict>("techgate");
    const gate = cachedVerdict
      ? { verdict: cachedVerdict, inputTokens: 0, outputTokens: 0 }
      : await runTechGate(row.name, websitePages[0]?.content ?? "", row.description, row.industry, { client: ctx.anthropic, model: ctx.models.enrich });
    if (!cachedVerdict) searchState.cache?.set("techgate", gate.verdict);
    ctx.recordCost(ctx.models.enrich, gate);
    if (shouldSkipAsNonTech(gate.verdict)) {
      console.log(`    🚫  REJECTED before searching — not a technology company: ${gate.verdict!.reason}`);
      stats.earlyRejected++;
      return { outcome: "rejected" };
    }
  }
  ctx.onStage?.("searching");
  const rawSearchResults = ctx.update
    ? await runUpdateSearches(row, anchor, existingRounds.length > 0, gapFillDue, searchState)
    : await runAllSearches(row.name, anchor, searchState);
  // One source per URL — the same page returned by several queries used to
  // reach Claude several times (billed as input on every call).
  const { results: mergedResults, merged: duplicateResults } = mergeDuplicateResults(rawSearchResults);
  // An update only looks at pages this company has never been checked against.
  let searchResults = mergedResults;
  if (ctx.update) {
    const known = knownUrlSet({
      news: row.news,
      roundSourceUrls: existingRounds.map((r) => r.source_url),
      provenanceUrls: ctx.knownProvenanceUrls ? await ctx.knownProvenanceUrls() : [],
      seen: seen?.urls ?? [],
    });
    searchResults = newResultsOnly(mergedResults, known);
    console.log(`    🔁  Update since ${row.last_enriched_at?.slice(0, 10)}: ${searchResults.length} new result(s) of ${mergedResults.length}${gapFillDue ? " (incl. searches for missing fields)" : ""}`);
    if (gapFillDue) seen?.markGapFill();
  }
  stats.duplicateResultsMerged += duplicateResults;
  if (ctx.verbose && duplicateResults > 0) console.log(`    🧹  ${duplicateResults} duplicate search result(s) merged (same URL from several queries)`);

  const allRaw: RawSearchResult[] = [
    ...searchResults,
    ...websitePages.map((p) => ({ url: p.url, content: p.content, provider: p.provider, query_label: "website" })),
  ];

  if (allRaw.length === 0 && ctx.update) {
    console.log("    💤  Nothing new since the last check — no Claude call.");
    return { outcome: "no_change" };
  }
  if (allRaw.length === 0) {
    console.log("    🔍  All searches failed — no data retrieved");
    return { outcome: "no_data" };
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
  console.log(`    🧭  Entity filter: kept ${kept.length}/${searchOnly.length} search results + ${websiteRaw.length} website page(s)${ctx.verbose && identityKeywords.length ? ` | identity keywords: ${identityKeywords.join(", ")}` : ""}`);

  ctx.onStage?.("reading", { sources: kept.length + websiteRaw.length });
  if (ctx.update && kept.length === 0) {
    console.log("    💤  Nothing new about this company since the last check — no Claude call.");
    return { outcome: "no_change" };
  }
  // Most searches failed (network, timeouts, 5xx): an outage, not "nothing
  // about this company" — reported as such, so the run tries it again.
  if (searchMostlyFailed(searchState) && kept.length < 2 && websiteRaw.length === 0) {
    console.log(`    📡  search_unavailable — ${searchState.searchFailures}/${searchState.searchAttempts} searches failed (network). Not judged; it will be tried again.`);
    return { outcome: "error", reason: "search_unavailable" };
  }
  if (!ctx.update && kept.length < 2 && websiteRaw.length === 0) {
    console.log(`    🔍  low_evidence — fewer than 2 results survived entity filtering, and no website fetch. Skipping Claude calls.`);
    return { outcome: "low_evidence" };
  }

  // ── Stage 3b: read the most useful articles in full (Jina; Tavily when Jina cannot) ──
  // A snippet stops at ~600 characters; the full funding announcement has
  // the exact date, every investor, headcount and the "About" boilerplate.
  if (ctx.articlesToRead > 0) {
    const toRead = pickArticlesToRead(kept, row.name, domain, ctx.articlesToRead);
    const texts = (await fetchArticleTexts(toRead.map((r) => r.url), searchState)).map((t) => t.text);
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
        bump(stats.droppedByReason, "article_about_namesake");
        return;
      }
      r.content = `${r.content}\n[Full article text]\n${text}`;
      read++;
    });
    if (namesakeArticles.size > 0) usableResults = usableResults.filter((r) => !namesakeArticles.has(r));
    stats.articlesRead += read;
    if (toRead.length > 0) console.log(`    📰  Read ${read}/${toRead.length} full article(s)${ctx.verbose ? `: ${toRead.map((r) => r.url).join(", ")}` : ""}`);
  }

  // ── Stage 4: labeled sources + three extraction calls ──────────────────
  // All three share one prompt-cached prefix (sharedExtraction.ts). The
  // profile call goes first: it writes the cache, and it decides
  // public / non-tech — in which case the other two calls are never made.
  ctx.onStage?.("extracting");
  let allSources: LabeledSource[] = buildLabeledSources(usableResults, domain);
  const shared = (kind: ExtractionKind) => buildSharedExtractionRequest(kind, row.name, allSources, { taxonomy });
  const profileOutcome = await extractProfile(row.name, allSources, { client: ctx.anthropic, model: ctx.models.profile, taxonomy, request: shared("profile") });
  if (!profileOutcome) {
    console.log("    ❌  Profile extraction returned no tool_use block at all.");
    return { outcome: "error", reason: "profile extraction returned no tool_use block" };
  }
  ctx.recordCost(ctx.models.profile, profileOutcome);
  logExtraction("profile", row.name, profileOutcome);
  let profile = profileOutcome.extraction.result;
  for (const d of profileOutcome.extraction.dropped) bump(stats.droppedByReason, d.reason);

  // Backstop for the model's flag: "<Name>, Inc. (Nasdaq: XYZ)" in a source.
  const listing = profile.is_public_company ? null : findListingStatement(row.name, allSources, domain);
  if (listing) console.log(`    🏛️   Listed on an exchange per ${listing.url}: "${listing.quote}"`);
  if (profile.is_public_company || listing) {
    console.log(`    🏛️   PUBLIC COMPANY — archiving (status='ipo') rather than deleting (issue 7)`);
    return { outcome: "public", listing };
  }
  // An update reads a few news items, not the company's whole footprint —
  // the tech/non-tech decision from the full run stands.
  if (!profile.is_tech_company && !ctx.update) {
    console.log("    🚫  REJECTED — not a technology-driven company");
    return { outcome: "rejected" };
  }

  // An update whose new pages say nothing about money skips the funding call.
  const skipFunding = ctx.update && !mentionsFunding(allSources.map((src) => `${src.title ?? ""} ${src.content}`));
  if (skipFunding) console.log("    ⏭️   No funding/M&A words in the new pages — funding extraction skipped.");
  const [fundingOutcome, marketOutcome] = await Promise.all([
    skipFunding ? Promise.resolve(EMPTY_FUNDING_OUTCOME) : extractFunding(row.name, allSources, { client: ctx.anthropic, model: ctx.models.funding, request: shared("funding") }),
    extractMarket(row.name, allSources, { client: ctx.anthropic, model: ctx.models.market, request: shared("market") }),
  ]);
  if (!fundingOutcome) {
    console.log("    ❌  Funding extraction returned no tool_use block at all.");
    return { outcome: "error", reason: "funding extraction returned no tool_use block" };
  }
  ctx.recordCost(ctx.models.funding, fundingOutcome);
  ctx.recordCost(ctx.models.market, marketOutcome);
  logExtraction("funding", row.name, fundingOutcome);
  logExtraction("market", row.name, marketOutcome);
  if (ctx.verbose) {
    const read = fundingOutcome.cacheReadTokens + marketOutcome.cacheReadTokens;
    console.log(`    💾  Prompt cache: ${profileOutcome.cacheWriteTokens} tokens written, ${read} read back (${read > 0 ? "hit" : "MISS — check that all three calls use the same model"})`);
  }
  let funding = fundingOutcome.extraction.result;
  let market = marketOutcome.extraction.result;
  for (const d of [...fundingOutcome.extraction.dropped, ...marketOutcome.extraction.dropped]) bump(stats.droppedByReason, d.reason);

  const existingRefs = roundRefs(existingRounds);

  // ── Stage 9: deep dive into whichever sections came back thin ──────────
  // (an update fills gaps with its own few searches instead)
  if (ctx.deepDive && !ctx.update) {
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
      stats.deepDives++;
      ctx.onStage?.("deep_dive", { sections: gaps });
      const extractedPeople = [...(profile.profile.founders ?? []), ...profile.leadership].map((p) => p.name).filter(Boolean);
      const founderNames = [...new Set([...extractedPeople, ...(anchors.founderNames ?? [])])];
      const queries = gaps.flatMap((section) =>
        buildDeepDiveQueries(section, { name: row.name, anchor, domain, rounds: firstPassRounds, founderNames })
          .map((q) => ({ ...q, section })),
      );
      console.log(`    🔎  Deep dive: ${gaps.join(", ")} (${queries.length} targeted searches)`);
      const batches = await Promise.all(queries.map(async (q) => ({
        section: q.section,
        // Going deeper: Tavily joins Serper (searchProviders.ts header).
        results: q.kind === "news"
          ? await newsSearch(q.query, q.query, q.label, searchState, { deep: true })
          : await webSearch(q.query, q.label, searchState, { deep: true }),
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
          fundingSrc.length ? extractFunding(row.name, fundingSrc, { client: ctx.anthropic, model: ctx.models.funding }) : null,
          profileSrc.length ? extractProfile(row.name, profileSrc, { client: ctx.anthropic, model: ctx.models.profile, taxonomy }) : null,
          marketSrc.length ? extractMarket(row.name, marketSrc, { client: ctx.anthropic, model: ctx.models.market }) : null,
        ]);

        const before = { rounds: funding.funding_rounds.length, competitors: market.competitors.length, news: market.news.length, founders: profile.profile.founders?.length ?? 0, patents: market.patents.length, founded: !!profile.profile.founded_year };
        if (dFunding) {
          ctx.recordCost(ctx.models.funding, dFunding);
          logExtraction("deep funding", row.name, dFunding);
          for (const d of dFunding.extraction.dropped) bump(stats.droppedByReason, d.reason);
          funding = mergeFundingExtractions(funding, dFunding.extraction.result);
        }
        if (dProfile) {
          ctx.recordCost(ctx.models.profile, dProfile);
          logExtraction("deep profile", row.name, dProfile);
          for (const d of dProfile.extraction.dropped) bump(stats.droppedByReason, d.reason);
          profile = mergeProfileExtractions(profile, dProfile.extraction.result);
        }
        if (dMarket) {
          ctx.recordCost(ctx.models.market, dMarket);
          logExtraction("deep market", row.name, dMarket);
          for (const d of dMarket.extraction.dropped) bump(stats.droppedByReason, d.reason);
          market = mergeMarketExtractions(market, dMarket.extraction.result);
        }
        console.log(`    🔎  Deep dive added: +${funding.funding_rounds.length - before.rounds} round(s), +${market.competitors.length - before.competitors} competitor(s), +${market.news.length - before.news} news, +${(profile.profile.founders?.length ?? 0) - before.founders} founder(s), +${market.patents.length - before.patents} patent(s)${!before.founded && profile.profile.founded_year ? `, founded ${profile.profile.founded_year.value}` : ""}`);
      }
    }
  }

  ctx.onStage?.("people");
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

  // A founder comes only from the extraction, with its evidence, like every
  // field (owner, 2026-10-29) — a "founded by" sentence alone no longer adds
  // one: in snippets it caught "Los Angeles" and "Cyberstarts' Gili Raanan".
  // Such sentences still ground an extracted founder (groundFounders) and are
  // reported here as names the extraction did not give.
  const textOnly = founderNamesNotExtracted(profile.profile.founders ?? [], allSources, row.name);
  if (textOnly.length > 0) console.log(`    👥  Named as founder in a sentence but not extracted with evidence — not added: ${textOnly.join(", ")}`);

  // People found or enriched from LinkedIn search results: profile URL, plus
  // education / prior employers / elite unit read from the public snippet
  // (lib/enrichment/linkedin.ts parseLinkedInFacts) — never from the
  // login-walled profile page itself.
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
  if (ctx.deepDive && (!ctx.update || gapFillDue)) {
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
            bump(stats.droppedByReason, "linkedin_founder_uncorroborated");
            continue;
          }
          linkedinFounders.push({ name: p.name, title: founderTitleFromHeadline(`${p.headline}`, row.name), linkedin_url: p.url, ...factsPatch(p.snippet) });
        }
      }
      const withBio = [...linkedinFounders, ...linkedinLeaders].filter((p) => p.bio);
      console.log(`    🔗  LinkedIn: ${linkedinFounders.length + linkedinLeaders.length} profile(s) matched, ${withBio.length} with education/experience from the snippet${ctx.verbose && withBio.length ? ` — ${withBio.map((p) => `${p.name}: ${p.bio}`).join(" | ")}` : ""}`);
    }
  }

  // ── Founders must be grounded (lib/enrichment/people.ts groundFounders) ─
  // A founder stays only when a source states they founded THIS company;
  // anyone named among the round's investors never is (huskeys.io: six
  // angels, each introduced as "co-founder of <another company>").
  const roundInvestors = funding.funding_rounds.flatMap((r) => {
    const like = roundToRoundLike(r);
    return [like.lead_investor, ...(like.other_investors ?? [])].filter((n): n is string => !!n);
  });
  const grounded = groundFounders(profile.profile.founders ?? [], allSources, row.name, roundInvestors);
  for (const d of grounded.dropped) {
    console.log(`    👤  ${d.name} not kept as a founder (${d.reason === "founder_is_investor" ? "named among the investors" : "no source says they founded this company"}).`);
    bump(stats.droppedByReason, d.reason);
  }
  profile.profile.founders = grounded.kept;
  for (let i = linkedinFounders.length - 1; i >= 0; i--) {
    if (roundInvestors.some((n) => samePersonName(n, linkedinFounders[i].name))) {
      bump(stats.droppedByReason, "founder_is_investor");
      linkedinFounders.splice(i, 1);
    }
  }

  // ── Round grounding: co-investors / per-investor amounts / source URL ──
  const platformOnly: V2Round[] = [];
  const keptRounds = funding.funding_rounds.filter((r) => {
    const why = rejectRound(r, row.name, allSources);
    if (!why) return true;
    if (why === "round_only_from_data_platform") { platformOnly.push(r); return false; }
    console.log(`    🚫  ${r.round_type} not written (${why})`);
    bump(stats.droppedByReason, why);
    return false;
  });

  // ── Stage 5b: hints — a round only a data platform states (hints.ts) ──
  // Searched for in primary sources; confirmed → written with that source
  // alone; not found → kept as a hint (data_hints), never written.
  const hints = new Map<string, RoundHint>();
  for (const r of platformOnly) { const h = hintFromRound(r, allSources); hints.set(hintKey(h), h); }
  for (const h of (await ctx.openHints?.().catch(() => [] as RoundHint[])) ?? []) if (!hints.has(hintKey(h))) hints.set(hintKey(h), h);
  const roundHints: RoundHint[] = [];
  const confirmedHints: Array<RoundHint & { confirmed_source_url: string }> = [];
  let hintSourceCount = 0;
  for (const h of [...hints.values()].slice(0, MAX_HINTS_SEARCHED)) {
    if (ctx.hintSearch === false || h.amount_raised == null) { roundHints.push(h); continue; }
    const found: RawSearchResult[] = [];
    for (const [label, q] of hintQueries(row.name, h)) found.push(...await webSearch(q, label, searchState));
    const labelled: LabeledSource[] = mergeDuplicateResults(found).results.map((raw) => ({ ...raw, source_id: `H${++hintSourceCount}`, source_type: classifySourceType(raw.url, domain) }));
    const candidate = confirmHint(h, labelled, row.name);
    // A confirmed round still passes every rule a round passes (raiser named, not a job post ...).
    const confirmed = candidate && !rejectRound(candidate, row.name, [...allSources, ...labelled]) ? candidate : null;
    if (!confirmed) {
      roundHints.push(h);
      console.log(`    💡  Hint kept, not written: ${h.round_type ?? "round"} ${h.amount_raised ?? ""} — only ${h.source_url ?? "a data platform"} states it`);
      bump(stats.droppedByReason, "round_kept_as_hint");
      continue;
    }
    const src = labelled.find((x) => x.source_id === confirmed.amount_raised?.source_id)!;
    allSources = [...allSources, src];
    keptRounds.push(confirmed);
    confirmedHints.push({ ...h, confirmed_source_url: src.url });
    console.log(`    ✅  Hint confirmed by a primary source: ${h.round_type ?? "round"} ${h.amount_raised} — ${src.url}`);
    bump(stats.droppedByReason, "round_confirmed_from_hint");
  }
  for (const h of [...hints.values()].slice(MAX_HINTS_SEARCHED)) roundHints.push(h);

  const sourceById = new Map(allSources.map((s) => [s.source_id, s]));
  const sourceTypeFor = (sourceId: string | undefined): SourceType | undefined => (sourceId ? sourceById.get(sourceId)?.source_type : undefined);
  const sourceUrlFor = (sourceId: string | undefined): string | null => (sourceId ? sourceById.get(sourceId)?.url ?? null : null);
  const newRoundLikes: RoundLike[] = keptRounds.flatMap((r) => {
    const grounded = groundRoundDetails(r, allSources);
    for (const reason of grounded.dropped) bump(stats.droppedByReason, reason);
    // An acquisition / secondary / buyout no source states is not written as an "Unknown" round (assemble.ts).
    if (isUnstatedEvent(r.round_type, grounded.round.round_type)) {
      console.log(`    🚫  ${r.round_type} not written (round_event_not_stated)`);
      bump(stats.droppedByReason, "round_event_not_stated");
      return [];
    }
    return [roundToRoundLike(grounded.round)];
  });

  ctx.onStage?.("validating");
  // ── Stage 6: validation (city/country/founded_year/headcount/rounds) ──
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
  // Written text says what the company does: no data platform, no weakly
  // attributed claim this run did not verify (owner's rule 2026-10-25) —
  // here, so a check, a deepen and every run apply it.
  const verifiedFacts = collectVerifiedFacts(profile, funding);
  const narratives = checkNarratives({
    description: profile.profile.description, value_proposition: profile.profile.value_proposition,
    founders: profile.profile.founders, leadership: profile.leadership, competitors: market.competitors,
  }, row.name, verifiedFacts);
  profile.profile.description = narratives.texts.description;
  profile.profile.value_proposition = narratives.texts.value_proposition;
  profile.profile.founders = narratives.texts.founders as typeof profile.profile.founders;
  profile.leadership = narratives.texts.leadership as typeof profile.leadership;
  market.competitors = narratives.texts.competitors as typeof market.competitors;
  validation.issues.push(...narratives.issues);
  for (const issue of validation.issues) {
    console.log(`    ⚠️  [${issue.rule}] ${issue.message}`);
    bump(stats.droppedByReason, issue.rule);
  }
  const acceptedNewRounds = newAcceptedRounds(validation);

  // ── Stage 7: round planning (fill existing / insert new / contradiction)
  const plan = planRoundWrites(existingRefs, acceptedNewRounds);
  for (const c of plan.conflicts) {
    console.log(`    ⚔️   Contradiction on ${c.round_type}: ${c.message} — kept the round on file, nothing written for it`);
    bump(stats.droppedByReason, "round_conflict_with_existing");
  }

  // ── Stage 8: confidence ─────────────────────────────────────────────────
  const cityConfidence = profile.profile.city ? computeFieldConfidence([{ source_type: sourceTypeFor(profile.profile.city.source_id) ?? "model_inferred" }]) : 0;
  const countryConfidence = profile.profile.country ? computeFieldConfidence([{ source_type: sourceTypeFor(profile.profile.country.source_id) ?? "model_inferred" }]) : 0;

  // ── Stage 8b: patents — the EPO register only (epoPatents.ts) ───────────
  let patentsFromRegister = false;
  try {
    const register = await (ctx.patentLookup ?? lookupEpoPatents)({
      name: row.name,
      countries: [validation.accepted.country ?? row.country, profile.profile.founding_country?.value ?? row.founding_country],
    });
    if (register) {
      patentsFromRegister = true;
      market.patents = register.patents;
      market.patent_summary = { patent_count: register.familyCount, patent_fields: [] };
      for (const r of register.rejected) bump(stats.droppedByReason, r.reason);
      console.log(`    📜  EPO register: ${register.patents.length} patent famil(ies) with ${row.name} as applicant${register.rejected.length ? `, ${register.rejected.length} publication(s) of other applicants set aside` : ""}.`);
    }
  } catch (e) {
    console.warn(`    ⚠️  EPO register lookup failed (${e instanceof Error ? e.message : String(e)}) — patents left as they are.`);
  }

  return {
    outcome: "collected",
    profile, funding, market, allSources, sourceById, sourceTypeFor, sourceUrlFor,
    linkedinFounders, linkedinLeaders, existingRefs, validation, plan,
    cityConfidence, countryConfidence, domain, verifiedFacts, patentsFromRegister, roundHints, confirmedHints,
  };
}
