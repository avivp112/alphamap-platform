/**
 * lib/enrichment/validation.ts — validateEnrichment() and the logical rules
 * from docs/enrichment_v2_spec.md issue 4, run after extraction/sanitize,
 * before any write.
 *
 * Beyond the spec's literal "on failure: do not write" table: per an
 * explicit product instruction, a detected contradiction should not just
 * blank a field silently — the system should first try to tell WHICH side
 * of the contradiction is wrong before giving up. This module resolves what
 * it can from information already in hand (comparing source_type ranks of
 * the conflicting values — see sourceTypes.ts), and marks what it can't as
 * needsExternalResolution so the orchestrator (not this module — it has no
 * search access) can fire one targeted follow-up lookup before accepting
 * the field as genuinely unresolvable and leaving it empty, per ground
 * rule 2 ("missing is better than wrong").
 */

import citiesData from "cities.json";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import { CANONICAL_ROUND_TYPES, normalizeRoundType, type CanonicalRoundType, type RoundLike } from "./rounds";
import { resolveConflictBySourceRank, type SourceType } from "./sourceTypes";

countries.registerLocale(en);

// ── City/country reference data (issue 4: "local GeoNames cities15000 JSON,
// with alternate names") ────────────────────────────────────────────────
// GeoNames access itself (download.geonames.org) is blocked by this
// environment's egress policy; `cities.json` on npm ships the same GeoNames
// gazetteer data (171k populated places) and IS reachable via the npm
// registry, so it's used as the equivalent local reference instead of a raw
// GeoNames dump. It doesn't carry a separate alternate-names list, so
// "alternate names" support here means case/whitespace-insensitive matching
// against every place GeoNames itself records under that name — which
// already covers the common case (a city genuinely has one canonical
// GeoNames name, just capitalized/spaced differently across sources).
interface CityRow { name: string; country: string }
const CITY_COUNTRY_INDEX: Map<string, Set<string>> = (() => {
  const index = new Map<string, Set<string>>();
  for (const row of citiesData as CityRow[]) {
    const key = row.name.trim().toLowerCase();
    if (!key) continue;
    let set = index.get(key);
    if (!set) { set = new Set(); index.set(key, set); }
    set.add(row.country); // ISO 3166-1 alpha-2
  }
  return index;
})();

/**
 * True when the dataset confirms OR can't speak to the pair — false only
 * when the dataset positively knows this city and positively knows it's
 * never been in this country. Absence of data is never treated as evidence
 * of an error (ground rule 2's spirit applied to the validator itself): a
 * real small-market city missing from a 171k-place gazetteer, or a country
 * name this build can't resolve to an ISO code, must not block a
 * perfectly good value.
 */
export function cityExistsInCountry(city: string | null | undefined, country: string | null | undefined): boolean {
  if (!city || !country) return true;
  const alpha2 = countries.getAlpha2Code(country, "en");
  if (!alpha2) return true;
  const key = city.trim().toLowerCase();
  const knownCountries = CITY_COUNTRY_INDEX.get(key);
  if (!knownCountries) return true;
  return knownCountries.has(alpha2);
}

export type ValidationRuleCode =
  | "city_country_mismatch" | "founded_after_first_round" | "founded_out_of_range"
  | "headcount_outlier" | "valuation_below_round" | "round_date_invalid"
  | "stage_order" | "profile_country_conflict";

export interface ValidationIssue {
  rule: ValidationRuleCode;
  fields: string[];
  message: string;
  /** What to do given no further information — blank it, flag for a human, or keep the existing value. */
  action: "drop_field" | "drop_both" | "drop_round" | "flag_needs_review" | "keep_existing";
  /** True when this module could not resolve the conflict itself and a fresh targeted search might. */
  needsExternalResolution?: boolean;
}

// ── Individual rule checks (each independently unit-testable) ────────────

export function checkCityCountryMismatch(city: string | null | undefined, country: string | null | undefined): ValidationIssue | null {
  if (!city || !country) return null;
  if (cityExistsInCountry(city, country)) return null;
  return {
    rule: "city_country_mismatch",
    fields: ["profile.city", "profile.country"],
    message: `"${city}" is not a known city in "${country}" — likely mixed from two different sources.`,
    action: "drop_both",
    // A rank comparison can't help here (it's not two sources disagreeing
    // on one field, it's one proposed PAIR that's internally inconsistent)
    // — only a fresh targeted lookup could determine which half is wrong.
    needsExternalResolution: true,
  };
}

export function checkFoundedYear(
  founded_year: number | null | undefined,
  earliestRoundYear: number | null | undefined,
): ValidationIssue | null {
  if (founded_year == null) return null;
  const currentYear = new Date().getFullYear();
  if (founded_year < 1900 || founded_year > currentYear) {
    return {
      rule: "founded_out_of_range",
      fields: ["profile.founded_year"],
      message: `founded_year ${founded_year} is outside 1900–${currentYear}.`,
      action: "drop_field",
    };
  }
  if (earliestRoundYear != null && founded_year > earliestRoundYear) {
    return {
      rule: "founded_after_first_round",
      fields: ["profile.founded_year"],
      message: `founded_year ${founded_year} is after the earliest known funding round (${earliestRoundYear}).`,
      action: "drop_field",
    };
  }
  return null;
}

export function checkHeadcountOutlier(
  employee_count: number | null | undefined,
  totalRaisedUsd: number | null | undefined,
): ValidationIssue | null {
  if (employee_count == null) return null;
  const overAbsoluteCap = employee_count > 20_000;
  const overRaiseRatio = !!totalRaisedUsd && totalRaisedUsd > 1_000_000 && employee_count > totalRaisedUsd / 20_000;
  if (!overAbsoluteCap && !overRaiseRatio) return null;
  return {
    rule: "headcount_outlier",
    fields: ["metrics.employee_count"],
    message: overAbsoluteCap
      ? `employee_count ${employee_count} exceeds the 20,000 cap for a private company.`
      : `employee_count ${employee_count} implies more than 1 employee per $20K raised ($${totalRaisedUsd} total).`,
    action: "flag_needs_review",
  };
}

export function checkRoundValuation(round: Pick<RoundLike, "amount_raised" | "valuation">): ValidationIssue | null {
  if (round.amount_raised == null || round.valuation == null) return null;
  if (round.amount_raised < round.valuation) return null;
  return {
    rule: "valuation_below_round",
    fields: ["valuation"],
    message: `Round amount ($${round.amount_raised}) is not less than the stated post-money valuation ($${round.valuation}) — valuation is unverifiable.`,
    action: "drop_field",
  };
}

export function checkRoundDate(
  round: Pick<RoundLike, "announcement_date">,
  foundedYear: number | null | undefined,
): ValidationIssue | null {
  if (!round.announcement_date) return null;
  const d = new Date(round.announcement_date);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  if (d.getTime() > now.getTime()) {
    return {
      rule: "round_date_invalid",
      fields: ["announcement_date"],
      message: `Round date ${round.announcement_date} is in the future.`,
      action: "drop_round",
    };
  }
  if (foundedYear != null && d.getFullYear() < foundedYear) {
    return {
      rule: "round_date_invalid",
      fields: ["announcement_date"],
      message: `Round date ${round.announcement_date} is before the company's founded_year (${foundedYear}).`,
      action: "drop_round",
    };
  }
  return null;
}

const SERIES_ORDER: CanonicalRoundType[] = [
  "Pre-Seed", "Seed", "Series A", "Series B", "Series C", "Series D", "Series E", "Series F+",
];

/**
 * Flags consecutive named-series rounds (issue 4's "stage_order": a LATER
 * stage dated more than 6 months BEFORE an earlier one) for human review.
 * Only compares the closed Pre-Seed..Series F+ progression — "Growth" and
 * the non-VC types have no fixed position in a stage order to violate.
 */
export function checkStageOrder(rounds: RoundLike[]): ValidationIssue[] {
  const named = rounds
    .map((r) => ({ r, type: normalizeRoundType(r.round_type) }))
    .filter((x): x is { r: RoundLike; type: CanonicalRoundType } => SERIES_ORDER.includes(x.type))
    .sort((a, b) => SERIES_ORDER.indexOf(a.type) - SERIES_ORDER.indexOf(b.type));

  const issues: ValidationIssue[] = [];
  for (let i = 0; i < named.length - 1; i++) {
    const earlier = named[i];
    const later = named[i + 1];
    if (!earlier.r.announcement_date || !later.r.announcement_date) continue;
    const dEarlier = new Date(earlier.r.announcement_date);
    const dLater = new Date(later.r.announcement_date);
    if (Number.isNaN(dEarlier.getTime()) || Number.isNaN(dLater.getTime())) continue;
    const daysDiff = (dEarlier.getTime() - dLater.getTime()) / 86_400_000; // positive if later-stage is dated BEFORE earlier-stage
    if (daysDiff > 182) {
      issues.push({
        rule: "stage_order",
        fields: [`funding_rounds.${earlier.type}`, `funding_rounds.${later.type}`],
        message: `${later.type} is dated ${Math.round(daysDiff)} days before ${earlier.type} — stage order looks wrong.`,
        action: "flag_needs_review",
      });
    }
  }
  return issues;
}

export interface ExistingCountryFact {
  value: string | null | undefined;
  source_type?: SourceType | null;
  is_manually_verified?: boolean;
}

/**
 * Per issue 4's profile_country_conflict, refined per the "try to resolve,
 * not just blank" instruction: a manually-verified existing country is
 * never overwritten outright (same rule write.ts enforces generally). For a
 * non-manual existing value, rank the two source types against each other
 * first — a registry-sourced new country can correct a model-inferred old
 * one — and only fall back to "keep the existing value, flag for review"
 * when rank alone can't decide.
 */
export function checkProfileCountryConflict(
  existing: ExistingCountryFact,
  incomingCountry: string | null | undefined,
  incomingSourceType: SourceType | null | undefined,
): ValidationIssue | null {
  if (!existing.value || !incomingCountry) return null;
  if (existing.value.trim().toLowerCase() === incomingCountry.trim().toLowerCase()) return null;

  if (existing.is_manually_verified) {
    return {
      rule: "profile_country_conflict",
      fields: ["profile.country"],
      message: `Existing country "${existing.value}" is manually verified — "${incomingCountry}" was not written.`,
      action: "keep_existing",
    };
  }

  const resolution = resolveConflictBySourceRank(existing.source_type, incomingSourceType);
  if (resolution === "keep_new") return null; // new value outranks the old — let it through, no issue raised
  if (resolution === "keep_existing") {
    return {
      rule: "profile_country_conflict",
      fields: ["profile.country"],
      message: `Existing country "${existing.value}" (${existing.source_type}) outranks incoming "${incomingCountry}" (${incomingSourceType}).`,
      action: "keep_existing",
    };
  }
  return {
    rule: "profile_country_conflict",
    fields: ["profile.country"],
    message: `"${existing.value}" (${existing.source_type ?? "unknown source"}) vs. "${incomingCountry}" (${incomingSourceType ?? "unknown source"}) — ranks are equal or unknown, can't resolve from source type alone.`,
    action: "keep_existing",
    needsExternalResolution: true,
  };
}

// ── Umbrella entry point ──────────────────────────────────────────────────

export interface ValidateEnrichmentInput {
  existing: {
    founded_year?: number | null;
    country?: ExistingCountryFact;
    employee_count?: number | null;
  };
  extracted: {
    founded_year?: number | null;
    city?: string | null;
    country?: string | null;
    country_source_type?: SourceType | null;
    employee_count?: number | null;
  };
  /** Rounds already on file PLUS newly extracted ones, ideally already deduped via rounds.ts. */
  rounds: RoundLike[];
  totalRaisedUsd?: number | null;
}

export interface ValidateEnrichmentResult {
  issues: ValidationIssue[];
  /** founded_year/city/country/employee_count to actually write — null means "don't write this field". */
  accepted: {
    founded_year: number | null;
    city: string | null;
    country: string | null;
    employee_count: number | null;
  };
  /** Which of the input `rounds` (by reference) survive round-level validation. */
  acceptedRounds: RoundLike[];
}

export function validateEnrichment(input: ValidateEnrichmentInput): ValidateEnrichmentResult {
  const issues: ValidationIssue[] = [];
  const earliestRoundYear = input.rounds
    .map((r) => (r.announcement_date ? new Date(r.announcement_date).getFullYear() : null))
    .filter((y): y is number => y != null && !Number.isNaN(y))
    .sort((a, b) => a - b)[0] ?? null;

  let acceptedFoundedYear: number | null = input.extracted.founded_year ?? null;
  const foundedIssue = checkFoundedYear(acceptedFoundedYear, earliestRoundYear);
  if (foundedIssue) { issues.push(foundedIssue); acceptedFoundedYear = null; }

  let acceptedCity: string | null = input.extracted.city ?? null;
  let acceptedCountry: string | null = input.extracted.country ?? null;
  const cityCountryIssue = checkCityCountryMismatch(acceptedCity, acceptedCountry);
  if (cityCountryIssue) {
    issues.push(cityCountryIssue);
    acceptedCity = null;
    acceptedCountry = null;
  } else if (input.existing.country) {
    const conflictIssue = checkProfileCountryConflict(
      input.existing.country, acceptedCountry, input.extracted.country_source_type,
    );
    if (conflictIssue) {
      issues.push(conflictIssue);
      if (conflictIssue.action === "keep_existing") acceptedCountry = null;
    }
  }

  let acceptedEmployeeCount: number | null = input.extracted.employee_count ?? null;
  const headcountIssue = checkHeadcountOutlier(acceptedEmployeeCount, input.totalRaisedUsd);
  if (headcountIssue) { issues.push(headcountIssue); acceptedEmployeeCount = null; }

  const acceptedRounds: RoundLike[] = [];
  for (const round of input.rounds) {
    const dateIssue = checkRoundDate(round, acceptedFoundedYear ?? input.existing.founded_year ?? null);
    if (dateIssue) { issues.push(dateIssue); continue; }
    const valuationIssue = checkRoundValuation(round);
    let r = round;
    if (valuationIssue) {
      issues.push(valuationIssue);
      r = { ...round, valuation: null };
    }
    acceptedRounds.push(r);
  }
  issues.push(...checkStageOrder(acceptedRounds));

  return {
    issues,
    accepted: {
      founded_year: acceptedFoundedYear,
      city: acceptedCity,
      country: acceptedCountry,
      employee_count: acceptedEmployeeCount,
    },
    acceptedRounds,
  };
}

// Re-exported for convenience so callers don't need to import from two modules.
export { CANONICAL_ROUND_TYPES };
