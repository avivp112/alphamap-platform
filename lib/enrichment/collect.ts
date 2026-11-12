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

import { pickDevLinks } from "./devLinks";
import Anthropic from "@anthropic-ai/sdk";
import {
  verifyDomainMatch, webSearch, readPageCached, fetchPageHtml, newsSearch, serperSearch, serperNewsSearch, fetchCompanyWebsitePages, fetchArticleTexts,
  searchMostlyFailed, type SearchProviderState,
} from "./searchProviders.ts";
import { filterByEntity, deriveIdentityKeywords, nameQualifiersOnOwnSite, isNamesakeDrop, type EntityAnchors } from "./entity.ts";
import { buildLabeledSources, markCompanyLinkedFiles, mergeDuplicateResults, classifySourceType, type RawSearchResult, type LabeledSource } from "./sources.ts";
import { extractProfile, type SectorTaxonomy } from "./extractProfile.ts";
import { extractFunding, roundToRoundLike, type V2Round } from "./extractFunding.ts";
import { extractMarket, normalizeUrlForMatch } from "./extractMarket.ts";
import { normalizeForMatch } from "./evidence.ts";
import { competitorTierClaims, type TieredClaim } from "./competitorTiers.ts";
import { websiteLooksLikeAnotherCompany } from "./websiteIdentity.ts";
import { judgeNews, finishNews } from "./newsGate.ts";
import { reconcileSector, subSectorUnsupported } from "./sectors.ts";
import { siteBelongsToAnotherCompany } from "./siteOwner.ts";
import { buildSectorRequest, parseSectorChoice, classifyWithRetry, type SectorChoice } from "./classifySector.ts";
import { pressOnlyDate, originalReleaseQuery, resolveRoundDate } from "./roundDates.ts";
import { buildDescriptionRequest, descriptionSources, processDescription } from "./descriptionBuilder.ts";
import { buildBackgroundRequest, processBackgroundResponse, backgroundSearchQuery, founderSearchQuery } from "./founderBackground.ts";
import { requestFor } from "./models.ts";
import { lookupEpoPatents, type CompanyIdentity, type EpoPatentResult } from "./epoPatents.ts";
import { hintFromRound, hintQueries, confirmHint, hintKey, recoverMissingAmount, type RoundHint } from "./hints.ts";
import { detectGaps, buildDeepDiveQueries, hasNoFinancingRounds, type DeepDiveSection } from "./deepDive.ts";
import {
  groundRoundDetails, isUnstatedEvent, incompleteRound, absorbAmountlessRounds, rejectRound, roundSourceStandings, planRoundWrites, mergeProfileExtractions, mergeFundingExtractions, mergeMarketExtractions,
  type ExistingRoundRef,
} from "./assemble.ts";
import { buildSharedExtractionRequest, type ExtractionKind } from "./sharedExtraction.ts";
import { pickArticlesToRead } from "./articles.ts";
import { runTechGate, shouldSkipAsNonTech, type TechGateVerdict } from "./techGate.ts";
import { foundersFromText, personMentionedIn, groundFounders, founderNamesNotExtracted, supportedBio, roleSupported, supportedRoleSubset, personCardsInHtml, bioFromCard, roleAtCompany, titleFromCard, isLeadershipRole } from "./people.ts";
import { componentOn } from "./components.ts";
import { findPersonResult, discoverFounders, founderTitleFromHeadline, samePersonName, parseLinkedInFacts, bioFromLinkedInFacts } from "./linkedin.ts";
import { findListingStatement, type ListingStatement } from "./listing.ts";
import { QUIET_DAYS, buildUpdateQueries, knownUrlSet, mentionsFunding, newResultsOnly, type SeenUrls } from "./update.ts";
import { validateEnrichment, checkNarratives } from "./validation.ts";
import { hqStatementsIn, decideHeadquarters, statementKind, isLegalPageUrl, articleDate, countryOfCity, contactPageAddresses, diagnoseHq, quoteSaysHqOf, hqBelongsToAnother, canonicalCity, type HqStatement } from "./headquarters.ts";
import { profileSourceAllowed, roundSourceStanding, unwrapRedirect, corroboratedInvestors } from "./roundSources.ts";
import { aboutParagraph, aboutIsOf, factsFromAbout, legalFacts, releasePointsTo, type LegalFacts } from "./companyFacts.ts";
import { checkFoundingCountry } from "./origin.ts";
import { namesCompany } from "./headcount.ts";
import { companiesHouseHeadcount, brregHeadcount, waybackHeadcount, type HeadcountIo } from "./headcountCollect.ts";
import type { HistoryPoint } from "./headcountHistory.ts";
import { lookupRegisters, nodeRegisterIo, registerDecides, type RegisterContext, type RegisterFinding } from "./registers.ts";
import { stripHonorific } from "./people.ts";
import { countryFromLocationQuote } from "./location.ts";
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
/** Two headlines of the same story: most of the shorter one's content words are in the other. */
export function sameHeadline(a: string, b: string): boolean {
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}$ ]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
  const [x, y] = [words(a), words(b)];
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  if (small.size < 3) return false;
  let hit = 0;
  for (const w of small) if (big.has(w)) hit++;
  return hit / small.size >= 0.7;
}
const hostOfUrl = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

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
  /** The website on file shows another business, or none of it could be read (owner, 2026-11-02: "website to fix" list). */
  onWebsiteIssue?: (reason: "content_mismatch" | "unreadable", detail: string) => void;
  /** Company registers (registers.ts); tests pass a stand-in. */
  registerLookup?: (ctx: RegisterContext) => Promise<RegisterFinding[]>;
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
  /** Leaders the title rule touched (owner, 2026-11-03): dropped, or kept without a title. */
  roleChecks?: Array<{ company: string; name: string; title: string; outcome: "verified_card" | "verified_text" | "kept_without_title" | "dropped"; page?: string; card?: string }>;
}

export const newCollectStats = (): CollectStats => ({ droppedByReason: new Map(), deepDives: 0, articlesRead: 0, earlyRejected: 0, duplicateResultsMerged: 0, roleChecks: [] });

type ProfileResult = NonNullable<Awaited<ReturnType<typeof extractProfile>>>["extraction"]["result"];
type FundingResult = NonNullable<Awaited<ReturnType<typeof extractFunding>>>["extraction"]["result"];
type MarketResult = Awaited<ReturnType<typeof extractMarket>>["extraction"]["result"];
export type LinkedInPersonPatch = { name: string; title?: string; role?: string; linkedin_url?: string; bio?: string; elite_background?: boolean; notable_pedigree?: boolean };

export interface CollectedCompany {
  outcome: "collected";
  /** Headcount points from registers, plans and archived pages (headcountHistory.ts); each with its source and type. */
  headcountExtra?: import("./headcountHistory.ts").HistoryPoint[];
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
  /** Domains on no list (roundSources.ts) that a round came from: for the owner's review list. */
  unlistedDomains?: Array<{ domain: string; url: string }>;
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
    // The press's own HQ phrase ("Tel Aviv-based Hailo") — without the domain
    // anchor, which news articles rarely carry (owner, 2026-11-01; headquarters.ts).
    ...(componentOn("hq_search") ? [["headquarters", `"${name}" "headquartered in" OR "based in" OR "-based" startup`] as [string, string]] : []),
    // (the separate "tech stack" query was dropped: careers/engineering
    // pages fetched from the company's own site carry that, for free)
  ];
  // SEARCH_SKIP=acquisitions,financials — leaves those core queries out, to measure what they add on the
  // golden set (owner, 2026-11-05: search is ~60% of the cost). Unset in every normal run.
  const skip = new Set((process.env.SEARCH_SKIP ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  const [searchBatches, newsResults] = await Promise.all([
    Promise.all(queries.filter(([label]) => !skip.has(label)).map(([label, q]) => webSearch(q, label, state))),
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

/** HQ_DEBUG=true — why each HQ sentence did or did not count (owner, 2026-11-02). */
function logHqDiagnosis(sources: LabeledSource[], name: string, statements: HqStatement[], contact: HqStatement[], modelCity: { value: string; source_id: string; evidence_quote: string } | undefined): void {
  console.log(`    🔬  HQ diagnosis for ${name}:`);
  for (const s of sources) for (const line of diagnoseHq(s, name)) console.log(`        ${line}`);
  console.log(`        Contact-page addresses: ${contact.length ? contact.map((c) => `${c.city} ("${c.quote.slice(0, 80)}")`).join(" | ") : "none"}`);
  console.log(`        Model's city: ${modelCity ? `${modelCity.value} [${modelCity.source_id}] "${modelCity.evidence_quote.slice(0, 160)}"` : "none"}`);
  console.log(`        Statements kept: ${statements.length ? statements.map((s) => `${s.city} (${s.kind}, ${s.date ?? "undated"})`).join(", ") : "none"}`);
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
  if (effectiveWebsite && !ctx.update && websitePages.length === 0) {
    console.log(`    🛠️   No page of ${effectiveWebsite} could be read — listed as a website to fix.`);
    ctx.onWebsiteIssue?.("unreadable", `No page of ${effectiveWebsite} could be read (Jina Reader and Serper scrape both failed).`);
  }
  // A site that belongs to another company now (acquired, rebranded): nothing is described from it (owner, 2026-11-09).
  const siteOwnerIssue = ctx.update ? null : siteBelongsToAnotherCompany(row.name, effectiveWebsite, websitePages);
  if (siteOwnerIssue) {
    console.log(`    🛠️   ${siteOwnerIssue} — no description or sector is written; listed for review.`);
    ctx.onWebsiteIssue?.("content_mismatch", siteOwnerIssue);
  }
  if (ctx.techGate && !ctx.update) {
    // The verdict is cached with the search results, so seeing the same
    // company again (a re-run, the next cycle) costs nothing.
    const cachedVerdict = searchState.cache?.get<TechGateVerdict>("techgate");
    const gate = cachedVerdict
      ? { verdict: cachedVerdict, inputTokens: 0, outputTokens: 0 }
      : await runTechGate(row.name, websitePages[0]?.content ?? "", row.description, row.industry, { client: ctx.anthropic, model: ctx.models.enrich });
    if (!cachedVerdict) searchState.cache?.set("techgate", gate.verdict);
    if (gate.verdict?.site_matches_description === false && !shouldSkipAsNonTech(gate.verdict)) {
      console.log(`    🛠️   The site shows another business than the description on file — listed as a website to fix: ${gate.verdict.reason}`);
      ctx.onWebsiteIssue?.("content_mismatch", gate.verdict.reason);
    }
    ctx.recordCost(ctx.models.enrich, gate);
    if (shouldSkipAsNonTech(gate.verdict)) {
      console.log(`    🚫  REJECTED before searching — not a technology company: ${gate.verdict!.reason}`);
      // A site that shows another business than the company's own description is a website to fix.
      if (gate.verdict!.site_matches_description === false) ctx.onWebsiteIssue?.("content_mismatch", gate.verdict!.reason);
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
    ...websitePages.map((p) => ({ url: p.url, content: p.content, provider: p.provider, query_label: "website", ...(p.also_urls ? { also_urls: p.also_urls } : {}) })),
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
  // The full name ("Mistral AI") is trusted only when no namesake surfaced (entity.ts).
  anchors.fullNameTrusted = !searchOnly.some((r) => isNamesakeDrop(filterByEntity({ url: r.url, title: r.title, snippet: r.content }, anchors, row.name).drop_reason));
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
  if (ctx.articlesToRead > 0 && componentOn("full_articles")) {
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
  markCompanyLinkedFiles(allSources, websitePages);
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
  // The company's own organization on GitHub / Hugging Face, from links on its own site (devLinks.ts): one organization, bare address.
  {
    const dev = pickDevLinks(websitePages);
    for (const [key, hit] of [["github_url", dev.github], ["huggingface_url", dev.huggingface]] as const) {
      if (!hit || market.technology[key]) continue;
      const src = allSources.find((s) => s.query_label === "website" && s.url === hit.page);
      if (src) market.technology[key] = { value: hit.url, source_id: src.source_id, evidence_quote: hit.url };
    }
  }
  for (const d of [...fundingOutcome.extraction.dropped, ...marketOutcome.extraction.dropped]) bump(stats.droppedByReason, d.reason);

  const existingRefs = roundRefs(existingRounds);

  // ── Stage 9: deep dive into whichever sections came back thin ──────────
  // (an update fills gaps with its own few searches instead)
  if (ctx.deepDive && !ctx.update && componentOn("deep_dive")) {
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
        markCompanyLinkedFiles(allSources, websitePages);
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
  // A "founded by" sentence adds a founder only on the company's own site or
  // in the press of tiers 1–3 (owner, 2026-11-01), its name without an
  // honorific; the name filters (no place, no organisation) are foundersFromText's.
  if (componentOn("founders_from_sentences")) {
    const textFounders: string[] = [];
    for (const src of allSources) {
      if (!statementKind(src)) continue;
      for (const raw of foundersFromText(src.content, row.name, { url: src.url, title: src.title })) {
        const f = { ...raw, name: stripHonorific(raw.name) };
        if (!f.name.includes(" ")) continue;
        const founders = profile.profile.founders ?? [];
        if (founders.some((x) => x?.name && samePersonName(x.name, f.name))) continue;
        profile.profile.founders = [...founders, { name: f.name, title: f.title }];
        textFounders.push(`${f.name} [${src.source_id}]`);
      }
    }
    if (textFounders.length > 0) console.log(`    👥  Founders from "founded by" sentences: ${textFounders.join(", ")}`);
  } else {
    const textOnly = founderNamesNotExtracted(profile.profile.founders ?? [], allSources, row.name);
    if (textOnly.length > 0) console.log(`    👥  Named as founder in a sentence but not extracted with evidence — not added: ${textOnly.join(", ")}`);
  }

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
  if (ctx.deepDive && (!ctx.update || gapFillDue) && componentOn("linkedin_people")) {
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
  // Only an allowed source grounds a founder (owner, 2026-11-02: the list applies to every field).
  const grounded = groundFounders(profile.profile.founders ?? [], allSources.filter((s) => profileSourceAllowed(s, row.name)), row.name, roundInvestors);
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
  const unlistedDomains: Array<{ domain: string; url: string }> = [];
  // A round written without an amount whose own sources state one gets it back (hints.ts
  // recoverMissingAmount); two different sums in them is "ambiguous" and the round is not written.
  const withAmounts: V2Round[] = [];
  for (const r of funding.funding_rounds) {
    const rec = recoverMissingAmount(r, allSources, row.name);
    if (rec?.kind === "ambiguous") {
      console.log(`    🚫  ${r.round_type} not written (round_amount_ambiguous: its sources state ${rec.candidates.join(" and ")})`);
      bump(stats.droppedByReason, "round_amount_ambiguous");
      continue;
    }
    if (rec?.kind === "recovered") {
      console.log(`    🔧  ${r.round_type}: amount ${rec.amount} read back from its source — "${rec.quote.slice(0, 100)}"`);
      bump(stats.droppedByReason, "round_amount_recovered");
      withAmounts.push({ ...r, amount_raised: { value: rec.amount, source_id: rec.source_id, evidence_quote: rec.quote } });
      continue;
    }
    withAmounts.push(r);
  }
  const keptRounds = withAmounts.filter((r) => {
    const why = rejectRound(r, row.name, allSources);
    if (!why) return true;
    if (why === "round_only_from_data_platform" || why === "round_source_not_listed") {
      platformOnly.push(r);
      // An unlisted domain goes to the owner's review list (roundSources.ts).
      for (const s of roundSourceStandings(r, allSources, row.name)) {
        if (s.kind === "unlisted") unlistedDomains.push({ domain: s.domain, url: s.url });
      }
      if (why === "round_source_not_listed") bump(stats.droppedByReason, why);
      return false;
    }
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
    if (ctx.hintSearch === false || !componentOn("hints") || h.amount_raised == null) { roundHints.push(h); continue; }
    const found: RawSearchResult[] = [];
    for (const [label, q] of hintQueries(row.name, h)) found.push(...await webSearch(q, label, searchState));
    const labelled: LabeledSource[] = mergeDuplicateResults(found).results.map((raw) => ({ ...raw, source_id: `H${++hintSourceCount}`, source_type: classifySourceType(raw.url, domain) }));
    // The pages already read count too: Mollie's own "Series C" page was a source of this run.
    const candidate = confirmHint(h, [...labelled, ...allSources], row.name);
    // A confirmed round still passes every rule a round passes (raiser named, not a job post ...).
    const confirmed = candidate && !rejectRound(candidate, row.name, [...allSources, ...labelled]) ? candidate : null;
    if (!confirmed) {
      roundHints.push(h);
      console.log(`    💡  Hint kept, not written: ${h.round_type ?? "round"} ${h.amount_raised ?? ""} — ${h.cited_url && h.cited_url !== h.source_url ? `cited from ${h.cited_url}` : `only ${h.source_url ?? "a data platform"} states it`}; no allowed source confirmed it with its amount and date`);
      bump(stats.droppedByReason, "round_kept_as_hint");
      continue;
    }
    const fromLabelled = labelled.find((x) => x.source_id === confirmed.amount_raised?.source_id);
    const src = fromLabelled ?? allSources.find((x) => x.source_id === confirmed.amount_raised?.source_id)!;
    if (fromLabelled) allSources = [...allSources, src];
    keptRounds.push(confirmed);
    confirmedHints.push({ ...h, confirmed_source_url: src.url });
    console.log(`    ✅  Hint confirmed by a primary source: ${h.round_type ?? "round"} ${h.amount_raised} — ${src.url}`);
    bump(stats.droppedByReason, "round_confirmed_from_hint");
  }
  for (const h of [...hints.values()].slice(MAX_HINTS_SEARCHED)) roundHints.push(h);

  // ── A round dated only by a press article's dateline (roundDates.ts, owner 2026-11-08) ──
  // The article can trail the announcement by days: look for the original release; else keep the month.
  if (componentOn("round_dates") && !ctx.update) {
    let dateSearches = Math.max(0, Number(process.env.DATE_SEARCHES ?? 3) || 0);
    let dateSourceCount = 0;
    for (const r of keptRounds) {
      if (!pressOnlyDate(r, allSources, row.name)) continue;
      const articleSrc = allSources.find((x) => x.source_id === r.announcement_date!.source_id);
      let originals: LabeledSource[] = [];
      if (dateSearches > 0) {
        dateSearches--;
        const found = await webSearch(originalReleaseQuery(r, row.name, domain), "round_date", searchState);
        originals = mergeDuplicateResults(found).results.map((raw) => ({ ...raw, source_id: `D${++dateSourceCount}`, source_type: classifySourceType(raw.url, domain) }));
      }
      const res = resolveRoundDate(r, originals, articleSrc, row.name);
      if (res.kind === "original") {
        allSources = [...allSources, res.source];
        console.log(`    📅  ${r.round_type} ${r.amount_raised?.value ?? ""}: ${r.announcement_date!.value} was a press article's date — the original release says ${res.iso} (${res.source.url})`);
        r.announcement_date = { value: res.iso, source_id: res.source.source_id, evidence_quote: res.quote };
        r.announcement_date_precision = "day";
        bump(stats.droppedByReason, "round_date_from_original");
      } else {
        console.log(`    📅  ${r.round_type} ${r.amount_raised?.value ?? ""}: dated by a press article only (${r.announcement_date!.value}) and no original release found — kept as ${res.month}`);
        r.announcement_date = { ...r.announcement_date!, value: `${res.month}-01` };
        r.announcement_date_precision = "month";
        bump(stats.droppedByReason, "round_date_month_only");
      }
    }
  }

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
    const like = roundToRoundLike(grounded.round);
    const incomplete = incompleteRound(like);
    if (incomplete) {
      console.log(`    🚫  ${like.round_type} not written (${incomplete})`);
      bump(stats.droppedByReason, incomplete);
      return [];
    }
    return [like];
  });

  // ── Coverage (owner, 2026-11-02): facts the company states about itself, and
  // a targeted search behind a value only a data platform gave. Each behind a switch.
  const extraStatements: HqStatement[] = [];
  // The HQ the decision took (a Contact-page address, an About paragraph): validation does not ask
  // its quote for an HQ word again (Anonymised's "7 Bell Yard, London" — model check 2026-11-02).
  let hqDecided = false;
  // Extra searches (EXTRA_SEARCHES, default 4, owner 2026-11-07): competitors by tier and the founders' background share them.
  let extraSearchesLeft = Math.max(0, Number(process.env.EXTRA_SEARCHES ?? 4) || 0);
  const extraSearch = async (query: string, label: string): Promise<RawSearchResult[]> => {
    if (extraSearchesLeft <= 0 || ctx.update) return [];
    extraSearchesLeft--;
    return webSearch(query, label, searchState);
  };
  const newSource = (url: string, content: string, title: string, label: string): LabeledSource => {
    const src: LabeledSource = { url, title, content, provider: "serper", query_label: label, source_id: `X${allSources.length + 1}`, source_type: classifySourceType(url, domain) };
    allSources.push(src);
    sourceById.set(src.source_id, src);
    return src;
  };
  const allowedFact = (f: { source_id: string } | undefined) => !!f && !!sourceById.get(f.source_id) && profileSourceAllowed(sourceById.get(f.source_id)!, row.name);

  // a. The "About <Company>" paragraph of its own press releases.
  if (componentOn("press_about") && !ctx.update) {
    const wires = `"About ${row.name}" (site:prnewswire.com OR site:businesswire.com OR site:globenewswire.com)`;
    const hits = [
      ...(await webSearch(wires, "press_about", searchState)),
      ...(domain ? await webSearch(`"About ${row.name}" site:${domain}`, "press_about", searchState) : []),
    ].filter((r, i, xs) => xs.findIndex((x) => x.url === r.url) === i)
      .filter((r) => /prnewswire\.com|businesswire\.com|globenewswire\.com/.test(r.url) || (domain && r.url.includes(domain)));
    for (const hit of hits.slice(0, 2)) {
      const page = await readPageCached(hit.url, searchState);
      const para = page && aboutParagraph(page.text, row.name);
      if (!para || !aboutIsOf(para, row.name)) continue;
      // A namesake's release (field review run 2: "Streak", a Singapore trading app, for
      // streak.com; "Mutiny", a Los Angeles gaming agency, for mutinyhq.com): the release
      // must point to the company's own site, or its About paragraph is not used.
      if (!releasePointsTo(page!.text, domain)) {
        console.log(`    🧭  About ${row.name} (${hit.url}) does not point to ${domain || "the company's site"} — a namesake's release, not used.`);
        continue;
      }
      const facts = factsFromAbout(para, row.name);
      if (!facts.city && !facts.foundedYear && !facts.employees) continue;
      const src = newSource(hit.url, para, hit.title ?? `About ${row.name}`, "press_about");
      if (src.source_type !== "company_site") src.source_type = "press_release";
      const date = articleDate({ url: hit.url, content: page!.text });
      console.log(`    📣  About ${row.name} (${hit.url}): ${[facts.city && `HQ ${facts.city}`, facts.foundedYear && `founded ${facts.foundedYear}`, facts.employees && `${facts.employees} employees`].filter(Boolean).join(", ")}`);
      // The company's own statement of its size; the recency rule below keeps it only if the release is of the last two years.
      if (facts.employees && !allowedFact(profile.metrics.employee_count as { source_id: string } | undefined)) {
        profile.metrics.employee_count = { value: facts.employees, source_id: src.source_id, evidence_quote: facts.employeesQuote! } as typeof profile.metrics.employee_count;
      }
      if (facts.city) extraStatements.push({ city: facts.city, quote: facts.cityQuote!, source_id: src.source_id, url: hit.url, kind: "company", date });
      if (facts.foundedYear && !allowedFact(profile.profile.founded_year)) {
        profile.profile.founded_year = { value: facts.foundedYear, source_id: src.source_id, evidence_quote: facts.yearQuote! } as typeof profile.profile.founded_year;
      }
      break;
    }
  }

  // b. Its legal pages: legal name, company number, registered office (an office only).
  let legal: LegalFacts = {};
  if (componentOn("legal_pages") && !ctx.update && effectiveWebsite) {
    const root = (effectiveWebsite.startsWith("http") ? effectiveWebsite : `https://${effectiveWebsite}`).replace(/\/+$/, "");
    // A site that answers every path with its home page (Moon Active, Carbeniumtec: model check
    // 2026-11-02) is read once; two unreadable paths in a row end the search (EnerVenue's 404s).
    const seenPages = new Set<string>();
    let misses = 0;
    for (const path of ["/terms", "/privacy", "/legal", "/imprint", "/terms-of-service", "/privacy-policy"]) {
      if (misses >= 2) break;
      const page = await readPageCached(root + path, searchState);
      if (!page) { misses++; continue; }
      misses = 0;
      // Jina puts the page's own URL and title on top: compare the body (Carbeniumtec's six copies).
      const fingerprint = page.text.replace(/^(Title|URL Source|Published Time|Markdown Content):.*$/gim, "").replace(/\s+/g, " ").trim().slice(0, 2000);
      if (seenPages.has(fingerprint)) continue;
      seenPages.add(fingerprint);
      const f = legalFacts(page.text, row.name);
      if (!f.legalName && !f.companyNumber && !f.registeredCity) continue;
      legal = { ...f, ...legal };
      const src = newSource(root + path, f.quote ?? "", `${row.name} — legal`, "legal_pages");
      src.source_type = "company_site";
      console.log(`    ⚖️   ${root + path}: ${[legal.legalName && `legal name ${legal.legalName}`, legal.companyNumber && `company no. ${legal.companyNumber}`, legal.registeredCity && `registered office in ${legal.registeredCity}`].filter(Boolean).join(", ")}`);
      if (f.registeredCity) {
        const offices = profile.profile.offices ?? [];
        if (!offices.some((o) => canonicalCity(o.city) === canonicalCity(f.registeredCity!))) {
          offices.push({ city: f.registeredCity, ...(countryOfCity(f.registeredCity) ? { country: countryOfCity(f.registeredCity)! } : {}), source_id: src.source_id, evidence_quote: f.quote ?? f.registeredCity });
        }
        profile.profile.offices = offices;
      }
      if (legal.legalName && legal.companyNumber && legal.registeredCity) break;
    }
  }

  // d. A value only a data platform gives: one targeted search for an allowed source that states it.
  if (componentOn("profile_hints") && !ctx.update) {
    const pc = profile.profile;
    const checks: Array<[string, string]> = [];
    if (pc.city && !allowedFact(pc.city)) checks.push(["city", `"${row.name}" "${pc.city.value}" headquartered OR "based in" OR "${pc.city.value}-based"`]);
    if (pc.founded_year && !allowedFact(pc.founded_year)) checks.push(["founded_year", `"${row.name}" founded ${pc.founded_year.value}`]);
    if (pc.founding_country && !allowedFact(pc.founding_country)) checks.push(["founding_country", `"${row.name}" founded ${pc.founding_country.value}`]);
    for (const [field, q] of checks.slice(0, 3)) {
      const results = (await webSearch(q, "profile_hint", searchState)).filter((r) => profileSourceAllowed({ url: r.url, source_type: classifySourceType(r.url, domain) }));
      let confirmed: string | null = null;
      for (const r of results) {
        const text = `${r.title ?? ""}. ${r.content}`;
        if (field === "city") {
          const src0 = { ...r, source_id: "tmp", source_type: classifySourceType(r.url, domain) } as LabeledSource;
          const st = hqStatementsIn(src0, row.name).find((x) => x.city.toLowerCase() === pc.city!.value.toLowerCase());
          if (st) { const src = newSource(r.url, r.content, r.title ?? "", "profile_hint"); extraStatements.push({ ...st, source_id: src.source_id }); confirmed = r.url; break; }
        } else if (field === "founded_year") {
          const y = String(pc.founded_year!.value);
          const sent = text.split(/(?<=[.!?])\s+/).find((x) => x.includes(y) && /\b(founded|established|started|launched)\b/i.test(x) && namesCompany(x, row.name));
          if (sent) { const src = newSource(r.url, r.content, r.title ?? "", "profile_hint"); pc.founded_year = { value: pc.founded_year!.value, source_id: src.source_id, evidence_quote: sent.trim() } as typeof pc.founded_year; confirmed = r.url; break; }
        } else {
          const sent = text.split(/(?<=[.!?])\s+/).find((x) => namesCompany(x, row.name) && !checkFoundingCountry(pc.founding_country!.value, x));
          if (sent) { const src = newSource(r.url, r.content, r.title ?? "", "profile_hint"); pc.founding_country = { value: pc.founding_country!.value, source_id: src.source_id, evidence_quote: sent.trim() } as typeof pc.founding_country; confirmed = r.url; break; }
        }
      }
      console.log(`    💡  ${field} hint "${field === "city" ? pc.city?.value : field === "founded_year" ? pc.founded_year?.value : pc.founding_country?.value}": ${confirmed ? `confirmed by ${confirmed}` : "no allowed source confirms it — not written"}`);
    }
  }

  ctx.onStage?.("validating");
  // ── Headquarters: the company's own declaration, else the latest in the
  // press of tiers 1–3; press of the last two years that disagrees leaves it
  // empty and both cities become offices (headquarters.ts, owner 2026-11-01).
  {
    const statements = [...allSources.flatMap((s) => hqStatementsIn(s, row.name)), ...extraStatements.filter((x, i, xs) => xs.findIndex((y) => y.city === x.city && y.source_id === x.source_id) === i)];
    // One street address on the Contact page is the headquarters (owner, 2026-11-02).
    const contact = allSources.flatMap((s) => contactPageAddresses(s));
    if (contact.length === 1 && !statements.some((s) => s.kind === "company")) {
      console.log(`    🏢  The Contact page gives one address — ${contact[0].city}: "${contact[0].quote.slice(0, 120)}"`);
      statements.push(contact[0]);
    }
    if (process.env.HQ_DEBUG === "true") logHqDiagnosis(allSources, row.name, statements, contact, profile.profile.city);
    const mc = profile.profile.city;
    const mcSource = mc ? sourceById.get(mc.source_id) : undefined;
    const mcKind = mcSource ? statementKind(mcSource) : null;
    if (mc && mcSource && mcKind && /\b(headquarter(?:s|ed)?|hq|head office|based in|-based)\b/i.test(mc.evidence_quote)
      && quoteSaysHqOf(mc.evidence_quote, mc.value, row.name, mcSource.source_type === "company_site") && !statements.some((s) => s.city.toLowerCase() === mc.value.toLowerCase() && s.source_id === mc.source_id)) {
      statements.push({ city: mc.value, quote: mc.evidence_quote, source_id: mc.source_id, url: mcSource.url, kind: mcKind, date: mcKind === "company" && mcSource.source_type === "company_site" ? null : articleDate(mcSource) });
    }
    const hq = decideHeadquarters(statements, undefined, (profile.profile.offices ?? []).map((o) => o.city));
    if (hq.kind === "declared") {
      const st = hq.statement;
      // The model's own quote stands only when it cites the statement's source: the same city
      // from a denied page (Anonymised's London from prospeo.io, model check 2026-11-02) would
      // otherwise carry the HQ to the source check and drop it there.
      const sameAsModel = !!mc && mc.value.toLowerCase() === st.city.toLowerCase() && mc.source_id === st.source_id;
      const country = sameAsModel && profile.profile.country && profile.profile.country.evidence_quote === mc!.evidence_quote
        ? profile.profile.country
        : (() => { const c = countryFromLocationQuote(st.quote, st.city) ?? countryOfCity(st.city); return c ? { value: c, source_id: st.source_id, evidence_quote: st.quote } : undefined; })();
      if (!sameAsModel) console.log(`    🏢  Headquarters ${st.city} — ${st.kind === "company" ? "the company's own declaration" : `the latest press declaration (${st.date ?? "undated"})`}: ${st.url}`);
      profile.profile.city = sameAsModel ? mc : { value: st.city, source_id: st.source_id, evidence_quote: st.quote };
      hqDecided = true;
      profile.profile.country = country;
    } else if (hq.kind === "conflict") {
      console.log(`    🏢  Headquarters left empty — the press of the last two years disagrees: ${hq.cities.map((c) => `${c.city} (${c.url})`).join(" vs ")}. Both are offices.`);
      profile.profile.city = undefined;
      profile.profile.country = undefined;
      const offices = profile.profile.offices ?? [];
      for (const c of hq.cities) {
        if (!offices.some((o) => canonicalCity(o.city) === canonicalCity(c.city))) offices.push({ city: c.city, ...(countryOfCity(c.city) ? { country: countryOfCity(c.city)! } : {}), source_id: c.source_id, evidence_quote: c.quote });
      }
      profile.profile.offices = offices;
    } else if (hq.kind === "none" && mc && hqBelongsToAnother(mc.evidence_quote, mc.value, row.name)) {
      console.log(`    🚫  city "${mc.value}" not written — its quote gives another company's headquarters: "${mc.evidence_quote.slice(0, 140)}"`);
      bump(stats.droppedByReason, "hq_of_another_company");
      profile.profile.city = undefined;
      if (profile.profile.country?.evidence_quote === mc.evidence_quote) profile.profile.country = undefined;
    } else if (hq.kind === "site_offices") {
      console.log(`    🏢  Headquarters left empty — the company's site lists ${hq.cities.join(", ")} without naming one, and no press declaration is from the last two years. They stay offices.`);
      profile.profile.city = undefined;
      profile.profile.country = undefined;
    }
  }

  // "Founder, Sisense" never makes anyone a founder of this company (owner, 2026-11-04).
  profile.profile.founders = profile.profile.founders?.filter((f) => {
    if (!f.title || roleAtCompany(f.title, row.name).role !== null) return true;
    console.log(`    🚫  founder ${f.name} not written — the title "${f.title}" is at another company`);
    bump(stats.droppedByReason, "founder_of_another_company");
    return false;
  });
  // Names without honorifics ("Dr. …", "… 님"), whatever found them.
  profile.profile.founders = profile.profile.founders?.map((f) => ({ ...f, name: stripHonorific(f.name) }));
  profile.leadership = profile.leadership.map((l) => ({ ...l, name: stripHonorific(l.name) }));

  // Founder background (founderBackground.ts, owner 2026-11-07): structured facts, each with a quote from an allowed
  // source; one targeted search (extra budget) and one model call for all the founders.
  if (componentOn("founder_background") && !ctx.update && (profile.profile.founders ?? []).length) {
    const names = (profile.profile.founders ?? []).map((f) => f.name).filter(Boolean).slice(0, 4);
    try {
      // One search per founder (FOUNDER_SEARCHES, default 3), apart from the extra budget the competitors share.
      const perFounder = Math.max(0, Number(process.env.FOUNDER_SEARCHES ?? 3) || 0);
      for (const name of names.slice(0, perFounder)) {
        for (const r of await webSearch(founderSearchQuery(row.name, name), "founder_background", searchState)) newSource(r.url, r.content ?? "", r.title ?? "", "founder_background");
      }
      const usable = allSources.filter((x) => profileSourceAllowed(x, row.name) && names.some((n) => normalizeForMatch(x.content ?? "").includes(normalizeForMatch(n.split(" ").slice(-1)[0] ?? "")))).slice(0, 12);
      if (usable.length) {
        const msg = await ctx.anthropic.messages.create(requestFor(buildBackgroundRequest(row.name, names, usable), ctx.models.market));
        ctx.recordCost(ctx.models.market, { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0, cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0 });
        const tool = msg.content.find((b) => b.type === "tool_use");
        if (tool && tool.type === "tool_use") {
          const { kept, dropped } = processBackgroundResponse(tool.input, names, row.name, Object.fromEntries(usable.map((x) => [x.source_id, x])), (id) => allowedFact({ source_id: id }));
          for (const d of dropped) { console.log(`    🚫  background of ${d.founder} (${d.fact.kind}: ${d.fact.organization}) not written — ${d.why}`); bump(stats.droppedByReason, `founder_background_${d.why}`); }
          for (const k of kept) {
            const f = (profile.profile.founders ?? []).find((x) => x.name === k.founder);
            if (!f) continue;
            f.background = k.facts;
            for (const fact of k.facts) console.log(`    🎓  ${k.founder}: ${fact.kind} ${fact.organization}${fact.role ? ` (${fact.role})` : ""} — "${fact.evidence_quote.slice(0, 100)}"`);
          }
        }
      }
    } catch (e) {
      console.log(`    ⚠️  founder background skipped: ${(e as Error).message}`);
    }
  }

  // ── HQ, founded year, founding country: only from allowed sources ─────
  // (owner, 2026-11-02 — roundSources.ts profileSourceAllowed).
  for (const key of ["city", "country", "founded_year", "founding_country"] as const) {
    const f = profile.profile[key] as { value: unknown; source_id: string } | undefined;
    if (!f) continue;
    const s = sourceById.get(f.source_id);
    // A legal page's address is the registered office, not the headquarters: an office, never the HQ (owner, 2026-11-08).
    if (s && (key === "city" || key === "country") && isLegalPageUrl(s.url)) {
      console.log(`    🚫  ${key} ${JSON.stringify(f.value)} not written as the headquarters — it comes from a legal page (${s.url}); kept as an office`);
      bump(stats.droppedByReason, "hq_from_legal_page");
      if (key === "city") {
        const offices = profile.profile.offices ?? [];
        if (!offices.some((o) => canonicalCity(o.city) === canonicalCity(String(f.value)))) {
          const ctry = profile.profile.country && sourceById.get(profile.profile.country.source_id) && isLegalPageUrl(sourceById.get(profile.profile.country.source_id)!.url) ? profile.profile.country.value : countryOfCity(String(f.value));
          offices.push({ city: String(f.value), ...(ctry ? { country: ctry } : {}), source_id: f.source_id, evidence_quote: (f as { evidence_quote?: string }).evidence_quote ?? "" } as never);
        }
        profile.profile.offices = offices;
      }
      (profile.profile as Record<string, unknown>)[key] = undefined;
      continue;
    }
    if (s && profileSourceAllowed(s, row.name)) continue;
    console.log(`    🚫  ${key} ${JSON.stringify(f.value)} not written — its source is not on the allowed list: ${s?.url ?? f.source_id}`);
    bump(stats.droppedByReason, "profile_source_not_listed");
    (profile.profile as Record<string, unknown>)[key] = undefined;
  }

  // ── The allowed sources apply to every field (owner, 2026-11-02): the company's own site or
  // release, a register, the press of tiers 1–3 (rounds: 1–4, roundSources.ts). LinkedIn,
  // data platforms and unlisted sites are never the source of a written value.
  {
    const allowedId = (id?: string | null) => { const src = id ? sourceById.get(id) : undefined; return !!src && profileSourceAllowed(src, row.name); };
    const drop = (what: string, reason: string, url?: string) => { console.log(`    🚫  ${what} not written — ${url ? `its source is not on the allowed list: ${url}` : "no allowed source"}`); bump(stats.droppedByReason, reason); };
    // Size: employee count and range.
    for (const key of ["employee_range", "employee_count"] as const) {
      const v = profile.metrics[key] as { value: unknown; source_id: string } | undefined;
      if (v && !allowedId(v.source_id)) { drop(`${key} ${JSON.stringify(v.value)}`, `${key}_source_not_listed`, sourceById.get(v.source_id)?.url); profile.metrics[key] = undefined; }
    }
    // The current headcount only from a source of the last two years (owner, 2026-11-04 — field
    // review run 4: Argus's "more than 70 people" from Continental's 2017 release). An older dated
    // figure is a point of the headcount history at its own date; an undated article's, nothing.
    const count = profile.metrics.employee_count;
    if (count) {
      const s = sourceById.get(count.source_id);
      const ownPage = s?.source_type === "company_site" && !s.url.match(/\/(news|blog|press|insights)\//i);
      const date = s && !ownPage ? articleDate(s) : null;
      const cutoff = new Date(Date.now() - 2 * 365.25 * 86_400_000).toISOString().slice(0, 10);
      if (!ownPage && (!date || date < cutoff)) {
        if (date && count.value > 0) {
          profile.metrics.headcount_history = [...(profile.metrics.headcount_history ?? []), { date, employee_count: count.value, source_id: count.source_id, evidence_quote: count.evidence_quote, point_type: "press_reported" as const }];
        }
        console.log(`    🕰️   employee_count ${count.value} not the current headcount — ${date ? `its source is of ${date}; kept as a history point` : "its source is undated"}`);
        bump(stats.droppedByReason, date ? "employee_count_dated_old" : "employee_count_undated");
        profile.metrics.employee_count = undefined;
      }
    }
    // Bios: kept only when one of their sources is allowed, and only the sentences those
    // allowed sources support (supportedBio — owner, 2026-11-03).
    const peopleNames = [...(profile.profile.founders ?? []), ...profile.leadership].map((p) => p.name).filter(Boolean);
    for (const person of [...(profile.profile.founders ?? []), ...profile.leadership] as Array<{ name: string; bio?: string; bio_source_ids?: string[] }>) {
      if (!person.bio) continue;
      const allowedIds = (person.bio_source_ids ?? []).filter((id) => allowedId(id));
      if (!allowedIds.length) {
        drop(`bio of ${person.name}`, "bio_source_not_listed", (person.bio_source_ids ?? []).map((id) => sourceById.get(id)?.url).filter(Boolean)[0]);
        person.bio = undefined;
        continue;
      }
      const kept = supportedBio(person.bio, allowedIds.map((id) => { const x = sourceById.get(id)!; return `${x.title ?? ""} ${x.content}`; }), person.name, peopleNames.filter((n) => n !== person.name));
      if (kept !== person.bio) {
        console.log(`    ✂️   bio of ${person.name}: ${kept ? "a sentence no source supports was removed" : "no sentence its sources support — not written"}`);
        bump(stats.droppedByReason, kept ? "bio_sentence_unsupported" : "bio_unsupported");
      }
      person.bio = kept ?? undefined;
    }
    // Leaders: kept only when an allowed source names them (field review run 1: leaders from a
    // Google redirect, from LinkedIn, or with no source at all).
    const allowedTexts = allSources.filter((x) => profileSourceAllowed(x, row.name)).map((x) => `${x.title ?? ""} ${x.content}`);
    // The title too (owner, 2026-11-03): on the company's own pages, the person's card by the
    // HTML's structure; elsewhere, the role beside the name. Not verified, but the person is on
    // the team / leadership page: kept, without a title ("Leadership team"). Otherwise dropped.
    const teamPage = (u: string) => { try { return /\/(team|about|company|leadership|management|people|our-team|who-we-are)\b/i.test(new URL(u).pathname); } catch { return false; } };
    const htmlCache = new Map<string, string | null>();
    const keptLeaders: typeof profile.leadership = [];
    for (const raw of profile.leadership) {
      // Advisors out; the board apart; roles at other companies removed (owner, 2026-11-04).
      const cls = roleAtCompany(raw.role, row.name);
      if (cls.kind === "advisor") { console.log(`    🚫  ${raw.name} not written — an advisor ("${raw.role}")`); bump(stats.droppedByReason, "advisor_not_kept"); continue; }
      const l = { ...raw, role: cls.role ?? "" };
      if (!allowedTexts.some((t) => personMentionedIn(l.name, t))) { drop(`leader ${l.name}`, "leader_source_not_listed"); continue; }
      if (cls.kind === "board") { console.log(`    🏛️   ${l.name}: board — "${cls.role}"${cls.role !== raw.role ? ` (was "${raw.role}")` : ""}`); keptLeaders.push({ ...l, group: "board" }); continue; }
      const others = peopleNames.filter((n) => n !== l.name);
      let role = l.role ?? "";
      const onPages = websitePages.filter((p) => personMentionedIn(l.name, p.content));
      let outcome: "verified_card" | "verified_text" | null = null;
      // Why no card verified it — the first test against real sites (owner, 2026-11-03).
      let cardNote = onPages.length ? "" : "not named on the site's pages read";
      for (const p of onPages.slice(0, 3)) {
        if (!htmlCache.has(p.url)) htmlCache.set(p.url, ctx.update ? null : await fetchPageHtml(p.url, searchState));
        const html = htmlCache.get(p.url);
        const cards = html ? personCardsInHtml(html, l.name, others) : [];
        // The extraction gave no title, but the site's own card does (Quris AI's "Head of Strategic Alliances").
        if (!role) {
          const fromCard = cards.map((c) => titleFromCard(l.name, c)).find((t): t is string => !!t);
          const cardCls = fromCard ? roleAtCompany(fromCard, row.name) : null;
          if (fromCard && cardCls?.kind === "leader") {
            role = cardCls.role ?? fromCard; l.role = role; outcome = "verified_card"; cardNote = `card on ${p.url}`;
            console.log(`    🏷️   leader ${l.name}: the title "${role}" read from the site's card (${p.url})`);
            bump(stats.droppedByReason, "leader_title_from_card");
            break;
          }
        }
        // The card's own biography, word for word (people.ts bioFromCard): it replaces a rewritten one.
        if (html && !ctx.update && !l.bio_verbatim && componentOn("bios")) {
          const bioCard = personCardsInHtml(html, l.name, others, { keepCase: true, maxLen: 1500 }).map((c) => bioFromCard(c, l.name, role, others)).find((b): b is string => !!b);
          const sid = allSources.find((x) => x.url === p.url)?.source_id;
          if (bioCard && sid) { l.bio = bioCard; l.bio_source_ids = [sid]; l.bio_verbatim = true; console.log(`    📖  ${l.name}: biography taken word for word from the card on ${p.url}`); bump(stats.droppedByReason, "bio_from_card"); }
        }
        if (role && cards.some((c) => roleSupported(l.name, role, [c]))) { outcome = "verified_card"; cardNote = `card on ${p.url}`; break; }
        cardNote = !html ? `no HTML for ${p.url}` : !cards.length ? `no card found on ${p.url}` : `card on ${p.url} without the title: "${cards[0].slice(0, 80)}"`;
      }
      if (!outcome && role && roleSupported(l.name, role, allowedTexts, others)) outcome = "verified_text";
      const team = onPages.find((p) => teamPage(p.url) || (p.also_urls ?? []).some(teamPage));
      const record = (o: "verified_card" | "verified_text" | "kept_without_title" | "dropped") => stats.roleChecks?.push({ company: row.name, name: l.name, title: role, outcome: o, page: team?.url ?? onPages[0]?.url, card: cardNote });
      if (outcome) { record(outcome); keptLeaders.push(l); continue; }
      if (team) {
        console.log(`    🏷️   leader ${l.name}: the title "${role}" is not verified — kept as "Leadership team" (${team.url})`);
        bump(stats.droppedByReason, "leader_title_removed");
        record("kept_without_title");
        keptLeaders.push({ ...l, role: "Leadership team" });
        continue;
      }
      // Part of the title is verified: that part is written (Scripbox: "Founded in 2012 by Atul Shinghal" gives Founder; no source says CEO).
      const partial = role ? supportedRoleSubset(l.name, role, allowedTexts, others) : null;
      if (partial) {
        console.log(`    🏷️   leader ${l.name}: only "${partial}" of "${role}" is beside the name in an allowed source — written as "${partial}"`);
        bump(stats.droppedByReason, "leader_title_reduced_to_verified");
        record("verified_text");
        keptLeaders.push({ ...l, role: partial });
        continue;
      }
      const namedIn = allowedTexts.filter((t) => personMentionedIn(l.name, t)).length;
      cardNote = `${cardNote ? `${cardNote} · ` : ""}named in ${namedIn} allowed source(s), the title is beside the name in none`;
      console.log(`    🚫  leader ${l.name} not written — no allowed source gives the title "${role}" (${cardNote})`);
      bump(stats.droppedByReason, "leader_title_unsupported");
      record("dropped");
    }
    // The closed list of leadership roles holds for a title read from a card or a page too (owner, 2026-11-09):
    // "Head of …", "Tech Lead", "Director of …" are not leaders. The board is apart; "Leadership team" is the
    // owner's 2026-11-03 placeholder for a person on the leadership page whose title could not be verified.
    profile.leadership = keptLeaders.filter((l) => {
      if (l.group === "board" || l.role === "Leadership team" || isLeadershipRole(l.role)) return true;
      console.log(`    🚫  leader ${l.name} not written — "${l.role}" is not on the closed list of leadership roles`);
      bump(stats.droppedByReason, "leader_role_not_on_list");
      return false;
    });
    // The founders' cards on the company's own pages: their biography word for word too.
    if (!ctx.update && componentOn("bios")) {
      for (const f of (profile.profile.founders ?? [])) {
        if (f.bio_verbatim) continue;
        const others = peopleNames.filter((n) => n !== f.name);
        for (const p of websitePages.filter((x) => personMentionedIn(f.name, x.content)).slice(0, 3)) {
          if (!htmlCache.has(p.url)) htmlCache.set(p.url, await fetchPageHtml(p.url, searchState));
          const html = htmlCache.get(p.url);
          if (!html) continue;
          const bio = personCardsInHtml(html, f.name, others, { keepCase: true, maxLen: 1500 }).map((c) => bioFromCard(c, f.name, f.title, others)).find((b): b is string => !!b);
          const sid = allSources.find((x) => x.url === p.url)?.source_id;
          if (bio && sid) { f.bio = bio; f.bio_source_ids = [sid]; f.bio_verbatim = true; console.log(`    📖  ${f.name}: biography taken word for word from the card on ${p.url}`); bump(stats.droppedByReason, "bio_from_card"); break; }
        }
      }
    }
    // The website may be another company's (websiteIdentity.ts): the allowed press names founders the site never shows.
    {
      const siteHosts = domain ? [domain] : [];
      const pressFounders = (profile.profile.founders ?? []).filter((f) => f.grounded_url && !siteHosts.some((d) => f.grounded_url!.includes(d))).map((f) => f.name);
      const sitePages = allSources.filter((x) => x.source_type === "company_site").map((x) => x.content ?? "");
      if (websiteLooksLikeAnotherCompany({ sitePages, pressFounders })) {
        console.log(`    🚫  The website (${domain}) names none of the founders the press names (${pressFounders.join(", ")}) — it may be another company's. Its people are not written: ${profile.leadership.length} leader(s) dropped.`);
        bump(stats.droppedByReason, "website_may_be_another_company");
        profile.leadership = [];
      }
    }
    // Competitors: the sentence that says they compete comes from an allowed source.
    market.competitors = market.competitors.filter((c) => {
      if (allowedId(c.source_id)) return true;
      drop(`competitor ${c.name}`, "competitor_source_not_listed", c.source_id ? sourceById.get(c.source_id)?.url : undefined);
      return false;
    });
    // Competitors by tier (competitorTiers.ts, owner 2026-11-07): declared — rival sentences of every page read, "X vs Y"
    // pages of the company's own site and of the competitors' own sites; market — the model's hints, each kept only when
    // an allowed source puts both companies in one market. The searches come from the extra budget.
    if (componentOn("competitor_tiers") && !ctx.update) {
      for (const c of market.competitors) c.tier ??= "declared";
      const have = new Set([...market.competitors.map((c) => normalizeForMatch(c.name)), normalizeForMatch(row.name)]);
      const adopt = (claims: TieredClaim[], how: string) => {
        for (const cl of claims) {
          const k = normalizeForMatch(cl.name);
          if (!k || have.has(k) || market.competitors.length >= 8) continue;
          have.add(k);
          market.competitors.push({ name: cl.name, how_it_competes: cl.how_it_competes, source_ids: [cl.source_id], source_id: cl.source_id, evidence_quote: cl.evidence_quote, tier: cl.tier });
          console.log(`    🥊  ${cl.tier} competitor ${cl.name} (${how}): "${cl.evidence_quote.slice(0, 110)}"`);
          bump(stats.droppedByReason, `competitor_${cl.tier}_${how}`);
        }
      };
      console.log(`    💡  Market peer hint(s) from the model: ${(market.market_peers ?? []).join(", ") || "none"}`);
      const { claims, unconfirmedHints } = await competitorTierClaims({
        companyName: row.name, domain, sources: allSources, hints: market.market_peers ?? [], known: have,
        search: (q, label) => extraSearch(q, label),
        addSource: (r, label) => newSource(r.url, r.content ?? "", r.title ?? "", label),
        // A competitor named on its own site is a competitor only if it is a company we know: an allowed source other
        // than its own pages names it (owner, 2026-11-08: SecPortal's SEO page).
        companyDescription: [profile.profile.description, profile.profile.value_proposition, row.description].filter(Boolean).join(" "),
        knownCompany: (name, host) => allSources.some((x) => !x.url.includes(host) && !/^(vs_page|vs_own|vs_other)/.test(x.query_label ?? "") && profileSourceAllowed(x, row.name) && normalizeForMatch(`${x.title ?? ""} ${x.content}`).includes(normalizeForMatch(name))),
      });
      adopt(claims, "found");
      if (unconfirmedHints.length) console.log(`    💡  Market hint(s) not confirmed by an allowed source, not written: ${unconfirmedHints.join(", ")}`);
    }
    const sourceByUrl = (u: string) => allSources.find((x) => x.url === u);
    // The company's investors, found now or on file: their own sites are allowed.
    // Only investors that an allowed source other than their own site also names (roundSources.ts corroboratedInvestors).
    const knownInvestors = corroboratedInvestors([...roundInvestors, ...existingRounds.flatMap((r) => [r.lead_investor, ...(r.investors ?? [])])], allSources, row.name);
    // News: an article of an allowed outlet (tiers 1–4) or the company's own site.
    const newsStanding = (url: string, content?: string, headline?: string) => roundSourceStanding(url, {
      isCompanySite: classifySourceType(url, domain) === "company_site" || sourceByUrl(url)?.source_type === "company_site",
      investors: knownInvestors,
      content: content ?? sourceByUrl(url)?.content,
      headline: headline ?? sourceByUrl(url)?.title,
      companyName: row.name,
    });
    const keptNews: typeof market.news = [];
    const newsDeps = {
      companyName: row.name,
      content: (u: string) => sourceByUrl(u)?.content,
      isOwnSite: (u: string) => classifySourceType(u, domain) === "company_site" || sourceByUrl(u)?.source_type === "company_site",
      fetchHtml: async (u: string) => (ctx.update ? null : await fetchPageHtml(u, searchState)),
    };
    let hintSearches = 0;
    for (const raw of market.news) {
      const n = { ...raw, url: unwrapRedirect(raw.url) };
      const standing = newsStanding(n.url, undefined, n.title);
      if (standing.kind === "allowed") {
        // newsGate.ts decides (guides, passing mentions, other companies' news, own-site pages, cut headlines, dates).
        const about = [profile.profile.description, profile.profile.value_proposition, profile.profile.industry, row.description].filter(Boolean).join(" ");
        const v = await judgeNews(n, { ...newsDeps, about });
        if (!v.keep) { console.log(`    🚫  news "${n.title.slice(0, 60)}" not written — ${v.message}: ${n.url}`); bump(stats.droppedByReason, v.reason); continue; }
        if (v.dated) { console.log(`    📅  news "${n.title.slice(0, 50)}" dated ${v.item.published_date} from ${v.dated === "address" ? "its address" : "the page's code"}`); bump(stats.droppedByReason, "news_date_recovered"); }
        keptNews.push(v.item as typeof n); continue;
      }
      // A hint-only site (owner, 2026-11-03): its headline is searched for in an allowed source.
      if (standing.kind === "denied" && standing.why === "hint_only" && hintSearches < 2 && !ctx.update) {
        hintSearches++;
        const found = (await webSearch(`"${n.title.slice(0, 90)}"`, "news_hint", searchState))
          .find((r) => r.url !== n.url && sameHeadline(r.title ?? "", n.title) && newsStanding(r.url, r.content, r.title).kind === "allowed");
        if (found) {
          console.log(`    ✅  news "${n.title.slice(0, 60)}" — a hint from ${hostOfUrl(n.url)}, confirmed by ${found.url}`);
          keptNews.push({ ...n, url: found.url });
          continue;
        }
      }
      drop(`news "${n.title.slice(0, 60)}"`, standing.kind === "denied" && standing.why === "hint_only" ? "news_hint_not_confirmed" : "news_source_not_listed", n.url);
    }
    // One row per event, then no date, no news (newsGate.ts).
    const fin = finishNews(keptNews, newsDeps);
    for (const x of fin.dropped) { console.log(`    🚫  news "${x.item.title.slice(0, 60)}" not written — ${x.message}: ${x.item.url}`); bump(stats.droppedByReason, x.reason); }
    market.news = fin.kept;
  }

  let registerLegalName: string | null = null;
  let registerCountry: string | null = null;
  let ukRegisterEntity: { number: string; entity: string } | null = null;
  // ── Registers: founded year and founding country, a certain match beats any article ──
  if (componentOn("registers") && !ctx.update) {
    const siteSources = allSources.filter((s) => s.source_type === "company_site");
    const siteCities = [
      ...allSources.flatMap((s) => contactPageAddresses(s)).map((c) => c.city),
      ...(profile.profile.offices ?? []).map((o) => o.city),
      ...(profile.profile.city && sourceById.get(profile.profile.city.source_id)?.source_type === "company_site" ? [profile.profile.city.value] : []),
    ];
    // (Tests never reach a real register: they pass a stand-in or get none.)
    const lookup = ctx.registerLookup ?? (process.env.VITEST ? async () => [] : (c: RegisterContext) => lookupRegisters(c, nodeRegisterIo(), (m) => console.warn(`    ⚠️  ${m}`)));
    const findings = await lookup({
      name: row.name,
      siteText: [...siteSources.map((s) => s.content), legal.companyNumber ? `company number ${legal.companyNumber}` : ""].join("\n"),
      siteCities,
      founders: (profile.profile.founders ?? []).map((f) => f.name).filter(Boolean),
      legalName: legal.legalName ?? null,
      statedFoundingCountry: profile.profile.founding_country?.value ?? null,
    });
    // A register decides founding only for the company's own entity in its headquarters country
    // (registers.ts registerDecides): Wiz's UK subsidiary, Upwind's, Black Forest Labs' US parent.
    const hqCountry = profile.profile.country?.value ?? (profile.profile.city ? countryOfCity(profile.profile.city.value) : null);
    for (const f of findings) {
      const d = registerDecides(f, row.name, hqCountry);
      if (d.decides) continue;
      console.log(`    🏛️   Register ${f.register}: ${f.entity} (${f.number}) not used for founded year / founding country — ${d.why === "local_subsidiary" ? "a local subsidiary (a country in its name)" : d.why === "headquarters_unknown" ? "no headquarters decided to compare its country with" : `the headquarters is not in ${f.founding_country}`}.`);
      bump(stats.droppedByReason, `register_${d.why}`);
    }
    const reg = findings.find((f) => registerDecides(f, row.name, hqCountry).decides);
    if (reg) { registerLegalName = reg.entity; registerCountry = reg.founding_country; if (reg.register === "uk_companies_house") ukRegisterEntity = { number: reg.number, entity: reg.entity }; }
    if (!reg && !findings.length) {
      const known = (profile.profile.founders ?? []).map((f) => f.name).filter(Boolean);
      console.log(`    🏛️   Registers: no certain match (name + number / office city${known.length ? ` / founders ${known.join(", ")}` : " — no founder known to match against"}).`);
    }
    if (reg) {
      const source: LabeledSource = { url: reg.url, title: `${reg.entity} — register`, content: reg.quote, provider: "registry", query_label: "register", source_id: `R${allSources.length + 1}`, source_type: "registry" };
      allSources.push(source);
      sourceById.set(source.source_id, source);
      const before = { year: profile.profile.founded_year?.value ?? null, country: profile.profile.founding_country?.value ?? null };
      // A register gives the year of incorporation; a company can be founded earlier and
      // incorporated later (Carbeniumtec: founded 2020, incorporated 2022 — owner, 2026-11-02).
      // An earlier founding year from an allowed source stands; otherwise the register's year.
      const earlierFounding = before.year != null && reg.founded_year != null && before.year < reg.founded_year;
      if (reg.founded_year && !earlierFounding) profile.profile.founded_year = { value: reg.founded_year, source_id: source.source_id, evidence_quote: reg.quote } as typeof profile.profile.founded_year;
      else if (earlierFounding) console.log(`    🏛️   Founded ${before.year} kept — the register's ${reg.founded_year} is the later incorporation.`);
      profile.profile.founding_country = { value: reg.founding_country, source_id: source.source_id, evidence_quote: reg.quote } as typeof profile.profile.founding_country;
      const disagree = [before.year != null && reg.founded_year && before.year !== reg.founded_year ? `year ${before.year} → ${reg.founded_year}` : null,
        before.country && before.country !== reg.founding_country ? `country ${before.country} → ${reg.founding_country}` : null].filter(Boolean);
      console.log(`    🏛️   Register ${reg.register}: ${reg.entity} (${reg.number}) — ${reg.match}. Founded ${reg.founded_year ?? "?"}, ${reg.founding_country}${disagree.length ? ` — overrides the articles: ${disagree.join(", ")}` : ""}`);
    }
  }

  // ── Stage 6: validation (city/country/founded_year/headcount/rounds) ──
  // A no-amount round on the date of one with an amount is that round (assemble.ts).
  const absorbed = absorbAmountlessRounds(newRoundLikes);
  newRoundLikes.splice(0, newRoundLikes.length, ...absorbed);
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
      city_source_type: sourceTypeFor(profile.profile.city?.source_id) ?? null,
      city_source_url: sourceUrlFor(profile.profile.city?.source_id),
      hq_decided: hqDecided,
      country_source_url: sourceUrlFor(profile.profile.country?.source_id),
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
  // The sector agrees with its sub-sector: the most specific category wins, DeepTech only without one (sectors.ts).
  {
    const rec = reconcileSector(profile.profile, taxonomy.parentOf, taxonomy.parentNames);
    if (rec.changes.length) {
      Object.assign(profile.profile, { sector_name: rec.fields.sector_name, sub_sector_name: rec.fields.sub_sector_name, sub_sector_names: rec.fields.sub_sector_names });
      for (const c of rec.changes) { console.log(`    🧭  Sector reconciled — ${c}`); bump(stats.droppedByReason, "sector_reconciled"); }
    }
  }
  // v2's own description (descriptionBuilder.ts, owner 2026-11-08): replaces the extraction's free text; without a
  // verified "what" and "for whom" there is none. Written later only for a company with no description on file.
  if (componentOn("description_v2") && !ctx.update && siteOwnerIssue) {
    profile.profile.description = undefined;
    profile.profile.description_source_ids = undefined;
    bump(stats.droppedByReason, "description_company_acquired_or_rebranded");
  } else if (componentOn("description_v2") && !ctx.update) {
    const before = profile.profile.description;
    profile.profile.description = undefined;
    profile.profile.description_source_ids = undefined;
    try {
      // Not the extra searches' pages (founders, rivals): they did not pass the entity filter the first pass did.
      const usable = descriptionSources(allSources, (x) => profileSourceAllowed(x, row.name) && !/^(founder_background|vs_own|vs_other|market_peers)/.test(x.query_label ?? ""));
      if (usable.length) {
        const msg = await ctx.anthropic.messages.create(requestFor(buildDescriptionRequest(row.name, usable), ctx.models.profile));
        ctx.recordCost(ctx.models.profile, { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0, cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0 });
        const tool = msg.content.find((b) => b.type === "tool_use");
        const built = tool && tool.type === "tool_use" ? processDescription(tool.input, row.name, Object.fromEntries(usable.map((x) => [x.source_id, x])), (id) => allowedFact({ source_id: id })) : null;
        for (const d of built?.dropped ?? []) { console.log(`    🚫  description sentence dropped (${d.why}): "${d.text.slice(0, 90)}"`); bump(stats.droppedByReason, `description_${d.why.split(":")[0]}`); }
        if (built) {
          profile.profile.description = built.description;
          profile.profile.description_source_ids = [...new Set(built.sentences.flatMap((x) => x.source_ids))];
          profile.profile.description_sentences = built.sentences;
          console.log(`    📝  Description (v2): ${built.sentences.length} sentence(s) — ${built.description.slice(0, 120)}…`);
        } else {
          console.log(`    📝  Description (v2): no verified "what" and "for whom" — none written${before ? " (the extraction's free text is not used)" : ""}.`);
          bump(stats.droppedByReason, "description_not_verified");
        }
      }
    } catch (e) {
      console.log(`    ⚠️  description skipped: ${(e as Error).message}`);
    }
  }
  // A sector needs the verified description and its sources behind it (owner, 2026-11-09, review 7): a sector with no
  // source, or one taken from a sentence about the CEO, is not written.
  if (componentOn("description_v2") && !ctx.update && profile.profile.sector_name && !(profile.profile.description_sentences?.length)) {
    console.log(`    🧭  Sector "${profile.profile.sector_name}" not written — no verified description to derive it from.`);
    bump(stats.droppedByReason, "sector_without_verified_description");
    profile.profile.sector_name = undefined;
    profile.profile.sub_sector_name = undefined;
  }
  // The sector comes from the verified description alone (classifySector.ts, owner 2026-11-10): the extraction chose it while
  // reading search results; here the model sees only the checked description, the definitions and the rules.
  if (componentOn("description_v2") && !ctx.update && profile.profile.description_sentences?.length && taxonomy.parentNames.length) {
    try {
      const descText = profile.profile.description_sentences.map((x) => x.text).join(" ");
      const classify = async (feedback?: string): Promise<SectorChoice | null> => {
        const msg = await ctx.anthropic.messages.create(requestFor(buildSectorRequest(row.name, descText, taxonomy, feedback), ctx.models.enrich));
        ctx.recordCost(ctx.models.enrich, { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0, cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0 });
        const tool = msg.content.find((b) => b.type === "tool_use");
        return tool && tool.type === "tool_use" ? parseSectorChoice(tool.input, taxonomy) : null;
      };
      const choice = await classifyWithRetry(classify, descText, (m) => { console.log(`    🧭  Sector ${m}.`); bump(stats.droppedByReason, "sector_answer_rejected"); });
      if (choice) {
        console.log(`    🧭  Sector from the verified description: ${choice.sector_name}${choice.sub_sector_name ? ` › ${choice.sub_sector_name}` : ""}${choice.sub_sector_names.length ? ` (+ ${choice.sub_sector_names.join(", ")})` : ""}`);
        Object.assign(profile.profile, { sector_name: choice.sector_name, sub_sector_name: choice.sub_sector_name, sub_sector_names: choice.sub_sector_names });
      } else {
        console.log(`    🧭  Sector not written — the classification of the verified description gave none.`);
        bump(stats.droppedByReason, "sector_classification_none");
        profile.profile.sector_name = undefined; profile.profile.sub_sector_name = undefined; profile.profile.sub_sector_names = [];
      }
    } catch (e) {
      console.log(`    ⚠️  sector classification skipped: ${(e as Error).message} — the extraction's choice is not used.`);
      profile.profile.sector_name = undefined; profile.profile.sub_sector_name = undefined;
    }
  }
  // A sub-sector the verified description does not support is not kept (Computer Vision for a voice AI company).
  if (profile.profile.description_sentences?.length) {
    const text = profile.profile.description_sentences.map((x) => x.text).join(" ");
    for (const sub of [profile.profile.sub_sector_name, ...(profile.profile.sub_sector_names ?? [])]) {
      if (!subSectorUnsupported(sub, text)) continue;
      console.log(`    🧭  Sub-sector "${sub}" dropped — the verified description does not support it.`);
      bump(stats.droppedByReason, "sub_sector_unsupported");
      if (profile.profile.sub_sector_name === sub) profile.profile.sub_sector_name = undefined;
      profile.profile.sub_sector_names = (profile.profile.sub_sector_names ?? []).filter((n) => n !== sub);
    }
  }
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
  if (componentOn("epo_patents")) try {
    const legalName = registerLegalName ?? legal.legalName ?? null;
    // The anchor: the country of the register that gave the name, else the registered office on the legal pages.
    const legalNameCountry = registerLegalName ? registerCountry : legal.registeredCity ? countryOfCity(legal.registeredCity) ?? null : null;
    const patentCountries = [validation.accepted.country ?? row.country, profile.profile.founding_country?.value ?? row.founding_country, registerCountry];
    const register = await (ctx.patentLookup ?? lookupEpoPatents)({
      name: row.name,
      // The full legal name, from the register entity that decided or the company's own legal pages: an
      // applicant in another legal form ("WAYVE LLC") is another company.
      legalName,
      legalNameCountry,
      countries: patentCountries,
    });
    if (!register) {
      // null is "not looked up", never "none" (epoPatents.ts): say why, so a missing key is not read as "no patents".
      const why = !ctx.patentLookup && !(process.env.EPO_OPS_KEY?.trim() && process.env.EPO_OPS_SECRET?.trim()) ? "EPO_OPS_KEY / EPO_OPS_SECRET are not set in this shell" : "the name is too common to look up safely, or the register search was incomplete";
      console.log(`    📜  EPO register: NOT looked up — ${why}. Patents are left as they are (unknown, not zero).`);
      bump(stats.droppedByReason, "patents_not_looked_up");
    } else {
      patentsFromRegister = true;
      market.patents = register.patents;
      market.patent_summary = { patent_count: register.familyCount, patent_fields: [] };
      for (const r of register.rejected) bump(stats.droppedByReason, r.reason);
      console.log(`    📜  EPO register: ${register.patents.length} patent famil(ies) with ${row.name} as applicant${register.rejected.length ? `, ${register.rejected.length} publication(s) of other applicants set aside (${[...register.rejected.reduce((m, r) => m.set(r.reason, (m.get(r.reason) ?? 0) + 1), new Map<string, number>())].map(([k, n]) => `${k} ×${n}`).join(", ")})` : ""}${legalName ? `; legal name "${legalName}"` : "; no legal name known"}; countries ${JSON.stringify(patentCountries)}.`);
    }
  } catch (e) {
    console.warn(`    ⚠️  EPO register lookup failed (${e instanceof Error ? e.message : String(e)}) — patents left as they are.`);
  }

  // ── Headcount points from registers and archived pages (headcountCollect.ts, owner 2026-11-08) ──
  // Companies House only for the certain match whose country is the decided headquarters; Brreg for a Norwegian
  // headquarters; the Wayback copies of the company's About / Careers pages for every company with a website.
  const headcountExtra: HistoryPoint[] = [];
  if (componentOn("headcount_sources") && !ctx.update && !process.env.VITEST) {
    const hqNow = profile.profile.country?.value ?? (profile.profile.city ? countryOfCity(profile.profile.city.value) : null);
    const io: HeadcountIo = { ...nodeRegisterIo(), pause: () => new Promise((r) => setTimeout(r, 1000)) };
    const today = new Date().toISOString().slice(0, 10);
    if (ukRegisterEntity && (hqNow ?? "").toLowerCase().replace(/^uk$/, "united kingdom") === "united kingdom") headcountExtra.push(...await companiesHouseHeadcount(ukRegisterEntity.number, ukRegisterEntity.entity, io));
    if ((hqNow ?? "").toLowerCase() === "norway") headcountExtra.push(...await brregHeadcount(row.name, legal.legalName, io, today));
    if (domain) headcountExtra.push(...await waybackHeadcount(domain, row.name, io));
    if (headcountExtra.length) console.log(`    👥  Headcount points: ${headcountExtra.map((p) => `${p.value}${p.lowerBound ? "+" : ""}@${p.date} (${p.type})`).join(", ")}`);
    else console.log("    👥  Headcount points: none from registers or archived pages.");
  }

  return {
    outcome: "collected",
    profile, funding, market, allSources, sourceById, sourceTypeFor, sourceUrlFor,
    linkedinFounders, linkedinLeaders, existingRefs, validation, plan,
    cityConfidence, countryConfidence, domain, verifiedFacts, patentsFromRegister, roundHints, confirmedHints, unlistedDomains,
    ...(headcountExtra.length ? { headcountExtra } : {}),
  };
}
