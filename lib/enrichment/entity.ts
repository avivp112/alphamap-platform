/**
 * lib/enrichment/entity.ts — filterByEntity(), per docs/enrichment_v2_spec.md
 * issue 2. Runs before extraction so a same-named, unrelated company's
 * search results never reach the context Claude sees.
 */

import { readFileSync } from "fs";
import wordListPath from "word-list";

// "A single dictionary word" (issue 2) is checked against a real English
// word list (sindresorhus/word-list, ~274k words) rather than only the
// spec's example names — "Apex" and "Nova" are both literally in it, and
// so, tellingly, is "Wiz" (one of the golden-set's own common_name hard
// cases).
const ENGLISH_WORDS: Set<string> = (() => {
  const text = readFileSync(wordListPath, "utf8");
  return new Set(text.split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean));
})();

// Spec's explicit examples, plus other short, generic, frequently-reused
// startup names that may not all appear in a general English dictionary
// (e.g. stylized/compressed forms) but are just as prone to collision.
export const COMMON_COMPANY_NAMES = new Set([
  "apex", "nova", "atlas", "orbit", "pulse", "vertex", "horizon", "spark", "flux",
  "nexus", "zenith", "catalyst", "momentum", "echo", "prism", "beacon", "summit",
  "anchor", "edge", "forge", "launch", "pivot", "quantum", "rise", "shift", "signal",
  "stride", "surge", "thrive", "vector", "wave", "aurora", "axiom", "cobalt", "drift",
  "ember", "halo", "ion", "wiz",
]);

const SUFFIXES_TO_STRIP = /\b(ltd|inc|llc|gmbh|corp|co|ai|labs|technologies|tech|group|holdings|limited)\b\.?/gi;

/**
 * True when a name is specific enough, on its own, to anchor a search
 * result to one real company. False for: a single English dictionary word,
 * a name on the common-startup-names list, or anything under 5 characters
 * once generic suffixes (Ltd, Inc, AI, Labs, Technologies, ...) are
 * stripped.
 */
export function isDistinctiveName(name: string | null | undefined): boolean {
  if (!name) return false;
  const stripped = name.trim().replace(SUFFIXES_TO_STRIP, "").replace(/\s+/g, " ").trim();
  if (stripped.length < 5) return false;
  const isSingleWord = !/\s/.test(stripped);
  if (isSingleWord) {
    const lower = stripped.toLowerCase();
    if (COMMON_COMPANY_NAMES.has(lower)) return false;
    if (ENGLISH_WORDS.has(lower)) return false;
  }
  return true;
}

export interface EntityAnchors {
  /** Verified company domain, e.g. "apexspace.com" — no protocol, no "www.". */
  domain?: string | null;
  /** Founder/leadership names already on file for this company. */
  founderNames?: string[];
  /** Verified LinkedIn/Crunchbase company profile URLs for this company. */
  verifiedProfileUrls?: string[];
  /** Only set when the existing country is manually verified or registry-sourced (issue 2). */
  trustedCountry?: string | null;
}

export interface SearchResultLike {
  url: string;
  title?: string;
  snippet?: string;
}

export type EntityMatchKind = "domain_url" | "domain_mention" | "founder_mention" | "verified_profile_url" | "distinctive_name";
export type EntityDropReason = "not_distinctive_name" | "country_contradiction" | "no_entity_match";

export interface EntityFilterVerdict {
  kept: boolean;
  matched?: EntityMatchKind;
  drop_reason?: EntityDropReason;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function textOf(result: SearchResultLike): string {
  return `${result.title ?? ""} ${result.snippet ?? ""}`.toLowerCase();
}

/**
 * Classifies ONE search result against the company's anchors and name.
 * Order matches issue 2's own priority: a positive entity match is checked
 * before the name-distinctiveness fallback, and the country-contradiction
 * filter runs last so it can veto an otherwise-kept result.
 */
export function filterByEntity(
  result: SearchResultLike,
  anchors: EntityAnchors,
  companyName: string,
): EntityFilterVerdict {
  const text = textOf(result);
  const host = hostnameOf(result.url);

  if (anchors.domain) {
    const domain = anchors.domain.toLowerCase();
    if (host === domain || host?.endsWith(`.${domain}`)) {
      return { kept: true, matched: "domain_url" };
    }
    if (text.includes(domain)) {
      return { kept: true, matched: "domain_mention" };
    }
  }

  for (const founder of anchors.founderNames ?? []) {
    if (founder && text.includes(founder.toLowerCase())) {
      return { kept: true, matched: "founder_mention" };
    }
  }

  for (const profileUrl of anchors.verifiedProfileUrls ?? []) {
    const profileHost = hostnameOf(profileUrl);
    if (profileHost && host === profileHost && result.url.replace(/\/+$/, "") === profileUrl.replace(/\/+$/, "")) {
      return { kept: true, matched: "verified_profile_url" };
    }
  }

  // No positive anchor match — fall back to "is the bare name specific
  // enough to trust on its own".
  if (!isDistinctiveName(companyName)) {
    return { kept: false, drop_reason: "not_distinctive_name" };
  }

  // Contradiction filter: even a distinctive-name match is dropped if the
  // result explicitly places the company in a different country than a
  // trusted anchor.
  if (anchors.trustedCountry) {
    const trusted = anchors.trustedCountry.toLowerCase();
    // A naive contains-check on country NAMES other than the trusted one is
    // unreliable in general, but catching the trusted country's absence
    // alongside an explicit different-country mention in the same snippet
    // is exactly the "Los Angeles, United Kingdom" class of contradiction
    // this filter exists to catch at the search-result level, before it
    // ever reaches extraction.
    if (!text.includes(trusted) && /\b(united states|united kingdom|israel|germany|india|canada|france|australia|china|japan)\b/.test(text)) {
      return { kept: false, drop_reason: "country_contradiction" };
    }
  }

  return { kept: true, matched: "distinctive_name" };
}

export interface FilterResultsOutput {
  kept: SearchResultLike[];
  dropped: Array<{ result: SearchResultLike; drop_reason: EntityDropReason }>;
  /** "low_evidence" means: skip the Claude call entirely, per issue 2 (saves cost on a company with too little to go on). */
  status: "ok" | "low_evidence";
}

export function filterResultsByEntity(
  results: SearchResultLike[],
  anchors: EntityAnchors,
  companyName: string,
): FilterResultsOutput {
  const kept: SearchResultLike[] = [];
  const dropped: FilterResultsOutput["dropped"] = [];
  for (const result of results) {
    const verdict = filterByEntity(result, anchors, companyName);
    if (verdict.kept) kept.push(result);
    else dropped.push({ result, drop_reason: verdict.drop_reason ?? "no_entity_match" });
  }
  return { kept, dropped, status: kept.length < 2 ? "low_evidence" : "ok" };
}
