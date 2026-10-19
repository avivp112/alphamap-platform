// =============================================================================
// worker/profile.ts — turns what v2 collected about one company
// (lib/enrichment/collect.ts) into the profile a user sees on /checks/:id.
//
// The same rules as the bulk run's write stage (lib/enrichment/writeCompany.ts,
// Stage 10), applied to a company with nothing on file: a city or country
// only above the profile confidence threshold, a headcount only when
// decideHeadcountUpdate accepts its evidence, a "founder" only when a source
// says so (a hired executive goes to leadership), rounds only as validated
// and planned. Every value keeps its source link. Nothing here is written to
// the shared database: the profile lives on the user's own check, labelled
// unverified until v2 passes Phase 1.
// =============================================================================

import type { CollectedCompany } from "../lib/enrichment/collect.ts";
import type { EvidencedValue } from "../lib/enrichment/extractProfile.ts";
import { cleanPeople, isFounderEntry, cleanFounderTitle } from "../lib/enrichment/people.ts";
import { samePersonName } from "../lib/enrichment/linkedin.ts";
import { mergePeople, decideHeadcountUpdate } from "../lib/enrichment/write.ts";
import { meetsProfileThreshold } from "../lib/enrichment/confidence.ts";
import { BULK_THRESHOLDS } from "../lib/enrichment/writeCompany.ts";
import { computeTotalRaised } from "../lib/enrichment/rounds.ts";
import { countryFromLocationQuote } from "../lib/enrichment/location.ts";
import { MAJOR_CITIES } from "../lib/enrichment/majorCities.ts";
import { normalizeIsoDate } from "../lib/enrichment/assemble.ts";
import { sourceTypeRank, type SourceType } from "../lib/enrichment/sourceTypes.ts";

export type Confidence = "high" | "medium" | "low";

export interface Sourced<T> {
  value: T;
  source_url: string | null;
  quote: string | null;
  confidence: Confidence;
}

export interface ProfilePerson {
  name: string;
  title: string | null;
  bio: string | null;
  linkedin_url: string | null;
}

export interface ProfileRound {
  round_type: string;
  amount: number | null;
  valuation: number | null;
  date: string | null;
  lead_investor: string | null;
  investors: string[];
  source_url: string | null;
}

export interface InvestorFact {
  name: string;
  investor_id: string | null;
  investor_name: string | null;
  /** In AlphaMap's own data (funding_rounds). */
  companies: number;
  rounds: number;
  rounds_led: number;
  main_stages: string[];
  /** Led a round of THIS company (from the rounds found). */
  led_here: boolean;
}

export interface CheckProfile {
  overview: {
    description: string | null;
    value_proposition: string | null;
    industry: string | null;
    sector: string | null;
    sub_sectors: string[];
    founded_year: Sourced<number> | null;
    city: Sourced<string> | null;
    country: Sourced<string> | null;
    headcount: Sourced<number> | null;
    employee_range: string | null;
    linkedin_url: string | null;
  };
  people: { founders: ProfilePerson[]; leadership: ProfilePerson[] };
  funding: { rounds: ProfileRound[]; total_raised: number | null; history_complete: boolean | null };
  /** How many sources the research read. */
  sources_count: number;
}

/** Same scale as the bulk run's confidenceLabel(). */
export function confidenceOf(t: SourceType | undefined): Confidence {
  if (!t) return "low";
  const rank = sourceTypeRank(t);
  return rank >= sourceTypeRank("press_release") ? "high" : rank >= sourceTypeRank("news") ? "medium" : "low";
}

export function buildProfile(c: CollectedCompany, companyName: string): CheckProfile {
  const { profile, funding, validation, plan } = c;
  const sourced = <T>(value: T, ev: EvidencedValue<unknown> | undefined): Sourced<T> => ({
    value,
    source_url: c.sourceUrlFor(ev?.source_id),
    quote: ev?.evidence_quote ?? null,
    confidence: confidenceOf(c.sourceTypeFor(ev?.source_id)),
  });

  // Location: the threshold the bulk run writes with.
  const city = validation.accepted.city && meetsProfileThreshold(c.cityConfidence, BULK_THRESHOLDS)
    ? sourced(validation.accepted.city, profile.profile.city) : null;
  let country = validation.accepted.country && meetsProfileThreshold(c.countryConfidence, BULK_THRESHOLDS)
    ? sourced(validation.accepted.country, profile.profile.country) : null;
  if (city && !country) {
    // Only from the city's own quote, or a city that maps to one country.
    const fromQuote = countryFromLocationQuote(profile.profile.city?.evidence_quote, city.value);
    const countries = MAJOR_CITIES.get(city.value.trim().toLowerCase());
    if (fromQuote) country = { ...city, value: fromQuote };
    else if (countries && countries.size === 1) country = { ...city, value: [...countries][0] };
  }

  const founded = validation.accepted.founded_year ? sourced(validation.accepted.founded_year, profile.profile.founded_year) : null;

  let headcount: Sourced<number> | null = null;
  const hc = validation.accepted.employee_count;
  if (hc != null && profile.metrics.employee_count) {
    const decision = decideHeadcountUpdate(null, {
      value: hc, source_type: c.sourceTypeFor(profile.metrics.employee_count.source_id) ?? "model_inferred", independentSourceCount: 1,
    });
    if (decision.writeEmployeeCount) headcount = sourced(hc, profile.metrics.employee_count);
  }

  // People — the bulk run's founder/leadership rules, with nothing on file.
  const founderCandidates = cleanPeople((profile.profile.founders ?? []).map((f) => ({
    name: f.name, title: cleanFounderTitle(f.title, companyName) ?? undefined, bio: f.bio, linkedin_url: f.linkedin_url?.value,
  })));
  const founders = founderCandidates.filter(isFounderEntry);
  const demoted = founderCandidates.filter((f) => !isFounderEntry(f));
  const linkedinFounders = c.linkedinFounders.map((f) => ({ name: f.name, title: f.title, bio: f.bio, linkedin_url: f.linkedin_url }));
  const knownNames = founders.map((f) => f.name);
  const allFounders = cleanPeople(mergePeople([], [...founders, ...linkedinFounders]
    .map((f) => ({ ...f, name: knownNames.find((n) => samePersonName(n, f.name)) ?? f.name }))));
  const leaders = cleanPeople((profile.leadership ?? []).map((l) => ({ name: l.name, title: l.role, bio: l.bio, linkedin_url: l.linkedin_url?.value })));
  const allLeaders = cleanPeople(mergePeople([], [
    ...leaders,
    ...c.linkedinLeaders.map((l) => ({ name: l.name, title: l.role ?? "", bio: l.bio, linkedin_url: l.linkedin_url })),
    ...demoted.filter((d) => !leaders.some((l) => samePersonName(l.name, d.name))),
  ])).filter((l) => !allFounders.some((f) => samePersonName(f.name, l.name)));
  const person = (p: { name: string; title?: string | null; bio?: string; linkedin_url?: string }): ProfilePerson => ({
    name: p.name, title: p.title || null, bio: p.bio || null, linkedin_url: p.linkedin_url || null,
  });

  const rounds: ProfileRound[] = plan.inserts
    .map((r) => ({
      round_type: r.round_type,
      amount: r.amount_raised ?? null,
      valuation: r.valuation ?? null,
      date: normalizeIsoDate(r.announcement_date) ?? null,
      lead_investor: r.lead_investor ?? null,
      investors: r.other_investors ?? [],
      source_url: r.source_url ?? null,
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const total = computeTotalRaised(plan.inserts);

  return {
    overview: {
      description: profile.profile.description ?? null,
      value_proposition: profile.profile.value_proposition ?? null,
      industry: profile.profile.industry ?? null,
      sector: profile.profile.sector_name ?? null,
      sub_sectors: [...new Set([profile.profile.sub_sector_name, ...(profile.profile.sub_sector_names ?? [])].filter((s): s is string => !!s))],
      founded_year: founded,
      city, country, headcount,
      employee_range: profile.metrics.employee_range ?? null,
      linkedin_url: profile.profile.linkedin_url?.value ?? null,
    },
    people: { founders: allFounders.map(person), leadership: allLeaders.map(person) },
    funding: { rounds, total_raised: total > 0 ? total : null, history_complete: funding.funding_history_complete ?? null },
    sources_count: c.allSources.length,
  };
}

/** Every investor named in the rounds, leads first. */
export function investorNames(p: CheckProfile): { names: string[]; led: Set<string> } {
  const led = new Set(p.funding.rounds.map((r) => r.lead_investor?.trim().toLowerCase()).filter((n): n is string => !!n));
  const seen = new Map<string, string>();
  for (const r of p.funding.rounds) {
    for (const n of [r.lead_investor, ...r.investors]) {
      const k = n?.trim().toLowerCase();
      if (k && !seen.has(k)) seen.set(k, n!.trim());
    }
  }
  const names = [...seen.values()].sort((a, b) => Number(led.has(b.toLowerCase())) - Number(led.has(a.toLowerCase())));
  return { names, led };
}
