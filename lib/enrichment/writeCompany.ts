// =============================================================================
// lib/enrichment/writeCompany.ts — enrichment v2's Stage 10: what a collected
// company (lib/enrichment/collect.ts) writes to startups, funding_rounds,
// headcount_history, startup_sub_sectors and field_provenance.
//
// Moved verbatim out of scripts/bulk_enrich_v2.ts (2026-10-19) so the check
// worker writes an admin-approved company by exactly the same rules as the
// bulk run (worker/promote.ts). Only the inputs changed: the database client,
// the run flags and the domain index are passed in instead of read from the
// script's globals.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollectedCompany, V2StartupRow } from "./collect.ts";
import { filterCrossSectorTags, type SectorTaxonomy } from "./extractProfile.ts";
import { normalizeUrlForMatch } from "./extractMarket.ts";
import { normalizeIsoDate, appendNew, reconcileOnFile } from "./assemble.ts";
import { fetchArticleOgImage } from "./ogImage.ts";
import { cleanPeople, isFounderEntry, cleanFounderTitle } from "./people.ts";
import { samePersonName } from "./linkedin.ts";
import { checkHeadcountOutlier } from "./validation.ts";
import { countryFromLocationQuote } from "./location.ts";
import { retireReplacedExecutives } from "./update.ts";
import { MAJOR_CITIES } from "./majorCities.ts";
import { normalizeForMatch } from "./evidence.ts";
import { computeTotalRaised } from "./rounds.ts";
import { computeFieldConfidence, meetsProfileThreshold } from "./confidence.ts";
import { roundFieldEvidence } from "./roundProvenance.ts";
import { cleanNarrative } from "./narrative.ts";
import {
  decideScalarWrite, decideHeadcountUpdate, mergePeople, appendDatedFigures, fillScalarIfNull, type CandidateValue,
} from "./write.ts";
import { validateWebsiteCandidate, websiteDomain, type DomainOwner } from "./websiteValidation.ts";
import { sourceTypeRank, type SourceType } from "./sourceTypes.ts";

// Upper bounds on the additive list sections, so repeated runs can't grow
// them without limit. Entries already on file are never removed.
export const MAX_COMPETITORS = 8;
export const MAX_NEWS = 15;

/**
 * The bulk run's default confidence thresholds (MIN_PROFILE_CONFIDENCE /
 * MIN_FUNDING_CONFIDENCE). The check worker shows and writes with these too.
 */
export const BULK_THRESHOLDS = { minProfileConfidence: 40, minFundingConfidence: 60 };

let warnedNoEnrichedV2Column = false;

export function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function confidenceLabel(t: SourceType | undefined): "high" | "medium" | "low" {
  if (!t) return "low";
  const rank = sourceTypeRank(t);
  return rank >= sourceTypeRank("press_release") ? "high" : rank >= sourceTypeRank("news") ? "medium" : "low";
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface WriteContext {
  db: SupabaseClient;
  /** Print what would be written, write nothing. */
  dryRun: boolean;
  /** MODE=update: only what is new since the last run. */
  update: boolean;
  verbose: boolean;
  thresholds: { minProfileConfidence: number; minFundingConfidence: number };
  taxonomy: SectorTaxonomy;
  /** Who owns which website domain — keeps two startups off one site. */
  startupByDomain: Map<string, DomainOwner>;
  /** The pages this run read, so a later update skips them (bulk only). */
  seen?: { add(urls: string[]): void; save(): void } | null;
}

/** The run totals Stage 10 adds to (the bulk run's RunSummary has these). */
export interface WriteSummary {
  tally: { success: number; partial: number };
  droppedByReason: Map<string, number>;
  totalRoundsInserted: number;
  totalRoundsUpdated: number;
  totalFieldsPatched: number;
  totalNewsAdded: number;
  totalCompetitorsAdded: number;
}

export const newWriteSummary = (): WriteSummary => ({
  tally: { success: 0, partial: 0 }, droppedByReason: new Map(),
  totalRoundsInserted: 0, totalRoundsUpdated: 0, totalFieldsPatched: 0, totalNewsAdded: 0, totalCompetitorsAdded: 0,
});

/** What Stage 10 wrote — or, in a dry run, would write. */
export interface WriteOutcome {
  anyWrite: boolean;
  /** The startups columns changed, with their new values. */
  patch: Record<string, unknown>;
  roundInserts: CollectedCompany["plan"]["inserts"];
  roundUpdates: CollectedCompany["plan"]["updates"];
  headcountPoints: Array<{ date: string; count: number }>;
  tags: string[];
  newsAdded: number;
  competitorsAdded: number;
}

export async function writeCollected(
  row: V2StartupRow,
  collected: CollectedCompany,
  ctx: WriteContext,
  summary: WriteSummary,
): Promise<WriteOutcome> {
  const { db: supabase, dryRun: DRY_RUN, update: UPDATE, verbose: VERBOSE, thresholds: THRESHOLDS, taxonomy, startupByDomain, seen } = ctx;
  const MIN_PROFILE_CONFIDENCE = THRESHOLDS.minProfileConfidence;
  const {
    profile, funding, market, allSources, sourceById, sourceTypeFor, sourceUrlFor,
    linkedinFounders, linkedinLeaders, existingRefs, validation, plan, cityConfidence, countryConfidence,
  } = collected;

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
      // Derived from the city's own evidence: that quote is the source.
      provenance("profile.country", patch.country, profile.profile.city);
      console.log(`    🧭  Country "${patch.country}" derived from city "${patch.city}" (unambiguous in the city list).`);
    } else {
      console.log(`    ℹ️   City "${patch.city}" written without a country — no source states one and the city is not unambiguous.`);
    }
  }
  if (validation.accepted.founded_year && row.founded_year == null) {
    patch.founded_year = validation.accepted.founded_year;
    provenance("profile.founded_year", validation.accepted.founded_year, profile.profile.founded_year);
  }
  // Origin (lib/enrichment/origin.ts): filled once, at the same bar as the HQ country.
  const origin = profile.profile.founding_country;
  if (origin && row.founding_country == null
    && meetsProfileThreshold(computeFieldConfidence([{ source_type: sourceTypeFor(origin.source_id) ?? "model_inferred" }]), THRESHOLDS)) {
    patch.founding_country = origin.value;
    provenance("profile.founding_country", origin.value, origin);
  }
  const rnd = profile.profile.israel_rnd_center;
  if (rnd?.value === true && row.israel_rnd_center == null
    && meetsProfileThreshold(computeFieldConfidence([{ source_type: sourceTypeFor(rnd.source_id) ?? "model_inferred" }]), THRESHOLDS)) {
    patch.israel_rnd_center = true;
    provenance("profile.israel_rnd_center", true, rnd);
  }
  // Texts were cleaned in the validation stage (collect.ts, checkNarratives).
  // A field listed in refresh_fields is written over (and leaves the list).
  const refresh = new Set(row.refresh_fields ?? []);
  const description = profile.profile.description;
  const valueProposition = profile.profile.value_proposition;
  if ((!row.description || refresh.has("description")) && description && description !== row.description) {
    patch.description = description;
    refresh.delete("description");
  }
  if ((!row.value_proposition || refresh.has("value_proposition")) && valueProposition && valueProposition !== row.value_proposition) {
    patch.value_proposition = valueProposition;
    refresh.delete("value_proposition");
  }
  if (!row.industry && profile.profile.industry) patch.industry = profile.profile.industry;
  if (!row.website && profile.profile.website) {
    const websiteResult = validateWebsiteCandidate(profile.profile.website.value, row.id, startupByDomain);
    if (websiteResult.website) {
      patch.website = websiteResult.website;
      provenance("profile.website", websiteResult.website, profile.profile.website);
    }
    if (websiteResult.rejectedReason) console.warn(`    ⚠️  Rejected website "${profile.profile.website.value}" — ${websiteResult.rejectedReason}${websiteResult.rejectedOwnerName ? ` (${websiteResult.rejectedOwnerName})` : ""}.`);
  }
  for (const key of ["linkedin_url", "facebook_url", "instagram_url"] as const) {
    const ev = profile.profile[key];
    if (!row[key] && ev) {
      patch[key] = ev.value;
      provenance(`profile.${key}`, ev.value, ev);
    }
  }

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
    name: f.name, title: cleanFounderTitle(f.title, row.name), bio: f.bio, linkedin_url: f.linkedin_url?.value,
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
    // (A cleaned title can be null; the founders column takes it as is.)
    setIfChanged("founders", cleanPeople(mergePeople(row.founders ?? [], aligned as NonNullable<V2StartupRow["founders"]>)), row.founders);
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
  // An explanation on file that names a data platform or says where it was read
  // (narrative.ts) is replaced by this run's own for the same competitor; with
  // none, it stays as stored (the site hides the offending part).
  const freshExplanation = new Map(market.competitors.map((c) => [normalizeForMatch(c.name), c.how_it_competes]));
  let staleExplanations = 0;
  const existingCompetitors = (reconciled.competitors as NonNullable<V2StartupRow["competitors"]>).map((c) => {
    const opts = { selfName: row.name, subjectName: c?.name };
    if (!c?.how_it_competes || cleanNarrative(c.how_it_competes, opts) === c.how_it_competes) return c;
    const fresh = freshExplanation.get(normalizeForMatch(c.name ?? ""));
    if (fresh) return { ...c, how_it_competes: fresh };
    const cleaned = cleanNarrative(c.how_it_competes, opts);
    if (cleaned) return { ...c, how_it_competes: cleaned };
    staleExplanations++;
    return c;
  });
  if (staleExplanations === 0) refresh.delete("competitors");
  else refresh.add("competitors");
  const competitors = appendNew(
    existingCompetitors,
    market.competitors.map((c) => ({ name: c.name, website: c.website ?? null, how_it_competes: c.how_it_competes, startup_id: crossLink(c.website) })),
    (c) => normalizeForMatch(c.name ?? ""), MAX_COMPETITORS,
  );
  const competitorsAdded = competitors.length - existingCompetitors.length;
  if (!sameJson(competitors, row.competitors ?? [])) patch.competitors = competitors;
  if (!sameJson([...refresh].sort(), [...(row.refresh_fields ?? [])].sort())) patch.refresh_fields = [...refresh];

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
  for (const key of ["github_url", "huggingface_url"] as const) {
    const ev = market.technology[key];
    if (!row[key] && ev) {
      patch[key] = ev.value;
      provenance(`technology.${key}`, ev.value, ev);
    }
  }

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
  if (arr.length > (row.arr_milestones?.length ?? 0)) {
    patch.arr_milestones = arr;
    const onFile = new Set((row.arr_milestones ?? []).map((m) => m.arr));
    for (const m of funding.arr_milestones) if (!onFile.has(m.arr) && arr.some((a) => a.arr === m.arr)) provenance("funding.arr_milestones", m.arr, m);
  }
  const valuations = appendDatedFigures(
    row.valuation_benchmarks ?? [],
    funding.valuation_benchmarks.map((v) => ({ valuation: v.valuation, date: normalizeIsoDate(v.date) ?? v.date ?? null, source: sourceUrlFor(v.source_id), is_estimated: v.is_estimated ?? null })),
    (v) => v.valuation,
  );
  if (valuations.length > (row.valuation_benchmarks?.length ?? 0)) {
    patch.valuation_benchmarks = valuations;
    const onFile = new Set((row.valuation_benchmarks ?? []).map((v) => v.valuation));
    for (const v of funding.valuation_benchmarks) if (!onFile.has(v.valuation) && valuations.some((x) => x.valuation === v.valuation)) provenance("funding.valuation_benchmarks", v.valuation, v);
  }
  if (!row.revenue_estimate && funding.revenue_estimate) {
    const re = funding.revenue_estimate;
    patch.revenue_estimate = {
      range_low: re.range_low ?? null, range_high: re.range_high ?? null, as_of_date: normalizeIsoDate(re.as_of_date) ?? re.as_of_date ?? null,
      source: sourceUrlFor(re.source_id), confidence: confidenceLabel(sourceTypeFor(re.source_id)),
    };
    if (re.source_id && re.evidence_quote) provenance("funding.revenue_estimate", { range_low: re.range_low ?? null, range_high: re.range_high ?? null }, { source_id: re.source_id, evidence_quote: re.evidence_quote });
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

    const writeProvenance = async (fw: { field: string; value: unknown; source_id: string; evidence_quote: string; source_type: SourceType }) => {
      const { error: provenanceErr } = await supabase.from("field_provenance").insert({
        startup_id: row.id, field: fw.field, value: fw.value, source_url: sourceById.get(fw.source_id)?.url,
        source_type: fw.source_type, evidence_quote: fw.evidence_quote,
        confidence: computeFieldConfidence([{ source_type: fw.source_type }]),
      });
      if (provenanceErr) console.warn(`    ⚠️  field_provenance insert failed (${fw.field}): ${provenanceErr.message}`);
    };
    for (const fw of fieldWrites) await writeProvenance(fw);
    // A round's amount / valuation / date / lead: field "funding_rounds.<id>.<column>".
    const roundProvenance = async (roundId: string, written: Parameters<typeof roundFieldEvidence>[0]) => {
      for (const e of roundFieldEvidence(written, funding.funding_rounds)) {
        await writeProvenance({ field: `funding_rounds.${roundId}.${e.field}`, value: e.value, source_id: e.source_id, evidence_quote: e.evidence_quote, source_type: sourceTypeFor(e.source_id) ?? "model_inferred" });
      }
    };

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
      const { data: inserted, error: roundErr } = await supabase.from("funding_rounds").insert({
        startup_id: row.id, round_type: round.round_type,
        amount_raised: round.amount_raised ?? null, valuation: round.valuation ?? null,
        is_valuation_estimated: round.valuation != null ? (round.is_valuation_estimated ?? null) : null,
        announcement_date: round.announcement_date ?? null, source_url: round.source_url ?? null,
        lead_investor: round.lead_investor ?? null,
        investors: round.other_investors && round.other_investors.length > 0 ? round.other_investors : null,
        investor_amounts: round.investor_amounts && round.investor_amounts.length > 0 ? round.investor_amounts : null,
      }).select("id").single();
      if (roundErr) console.warn(`    ⚠️  Round insert failed (${round.round_type}): ${roundErr.message}`);
      else {
        summary.totalRoundsInserted++;
        if (inserted?.id) await roundProvenance(inserted.id as string, round);
      }
    }
    for (const u of plan.updates) {
      const { error: updErr } = await supabase.from("funding_rounds").update(u.patch).eq("id", u.id);
      if (updErr) console.warn(`    ⚠️  Round update failed (${u.round_type}): ${updErr.message}`);
      else {
        summary.totalRoundsUpdated++;
        await roundProvenance(u.id, u.patch);
      }
    }

    await supabase.from("startups").update({ last_enriched_at: new Date().toISOString() }).eq("id", row.id);
    // Every page this run sent to Claude: a later update skips them.
    seen?.add(allSources.map((src) => src.url));
    seen?.save();
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
  return {
    anyWrite, patch, roundInserts: plan.inserts, roundUpdates: plan.updates,
    headcountPoints, tags: tagNames, newsAdded, competitorsAdded: Math.max(0, competitorsAdded),
  };
}
