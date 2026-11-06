/**
 * lib/enrichment/competitorEvidence.ts — a competitor is kept only when a
 * primary source says, in so many words, that it competes with the company
 * (owner, 2026-10-26).
 *
 * The 2026-10-26 run gave Chalice "Powerlytics" and "Algocraft" because
 * leadiq.com/c/chalice-ai listed them under "similar companies"; the model
 * then wrote "Powerlytics is listed as a similar company to Chalice AI". A
 * data platform's "similar companies", a review site's "alternatives" page,
 * a "top 10" listicle: these group companies, they do not say two compete.
 *
 * Kept only when:
 *   1. the cited source is primary — the company's own site, a press
 *      release, a filing, or an article in a trusted outlet (trustedNews.ts:
 *      the journalist or a quote from the company says they compete) — and
 *      not a data platform
 *      (dataPlatforms.ts, subdomains included) or a review / comparison
 *      directory (LISTING_SITES), and not an "alternatives" / "competitors"
 *      / "similar companies" / "X vs Y" / "top N" listing page anywhere but
 *      the company's own site;
 *   2. its verbatim quote is in that source, names the competitor, and says
 *      they compete: "competes with", "competitor", "rival", "versus",
 *      "goes up against", "alternative to" in running text.
 * Pure; tested with the run's cases (competitorEvidence.test.ts).
 */

import { normalizeForMatch } from "./evidence";
import { isDataPlatformUrl, isListingSiteUrl } from "./dataPlatforms";
import type { LabeledSource } from "./sources";
import { isTrustedNewsUrl } from "./trustedNews";

export type CompetitorEvidenceDrop =
  | "competitor_no_evidence" | "competitor_quote_not_in_source" | "competitor_quote_not_explicit"
  | "competitor_from_data_platform" | "competitor_from_listing" | "competitor_news_not_trusted";

const PRIMARY = new Set(["company_site", "press_release", "registry", "news", "manual"]);

// The page is a list of companies "like" one, whatever site it is on.
const LISTING_PAGE = /\b(alternatives?|competitors?|similar[- ]compan(?:y|ies)|companies[- ]like|sites[- ]like|top[- ]\d+|best[- ]\d+|\d+[- ]best|vs\.?|versus|comparisons?|compare)\b/i;
const LISTING_PATH = /\/(alternatives?|competitors?|similar|compare|comparison|vs)(\/|$|-)|-(alternatives?|competitors?|vs)-|\/c\/[^/]+\/[0-9a-f]{12,}/i;

// "competes with", "a competitor", "rival", "versus", "goes up against", "an alternative to".
const COMPETES = /\b(compet(?:e|es|ed|ing|itor|itors|ition|itive)|rivals?|rivalry|versus|vs\.?|goes? (?:up )?against|takes? on|head[- ]to[- ]head|challenger to|an alternative to|alternative to)\b/i;
// "listed as a similar company" is a listing's words, not a statement of competition.
const LISTING_WORDS = /\b(similar compan(?:y|ies)|listed (?:as|among|alongside)|companies like|is (?:also )?listed|(?:named|identified|included|featured|mentioned|appears?) (?:as|among|in) (?:an? |the )?(?:list of )?(?:similar|alternatives?|top alternatives))\b/i;

/**
 * An explanation already on file that says where the competitor was found:
 * a data platform's "similar companies" or an "alternatives" list ("Powerlytics
 * is listed as a similar company to Chalice AI"). Used to clean what earlier
 * runs wrote, which kept no source (scripts/clean_legacy_market_data.ts).
 */
export function explanationIsListing(text: string): boolean {
  return LISTING_WORDS.test(text) || /\b(top|best) (?:\d+ )?alternatives\b|\balternatives? (?:list|page)s?\b/i.test(text);
}

/** "E Ink Corporation" → "e ink": a quote names a company without its legal form. */
const coreName = (name: string) => normalizeForMatch(name.replace(/,?\s*\b(inc|incorporated|llc|ltd|limited|corp|corporation|gmbh|plc|co)\b\.?$/i, ""));

const sourceText = (s: LabeledSource) => `${s.title ?? ""} ${s.content}`;

/** A listing page: by its address, or by its title on any site but the company's own. */
export function isListingPage(source: Pick<LabeledSource, "url" | "title" | "source_type">): boolean {
  if (isListingSiteUrl(source.url)) return true;
  if (source.source_type === "company_site") return false;
  let path = source.url;
  try { const u = new URL(source.url); path = u.pathname; } catch { /* keep the raw url */ }
  return LISTING_PATH.test(path) || LISTING_PAGE.test(source.title ?? "");
}

export interface CompetitorClaim { name: string; source_id?: string; evidence_quote?: string }

/** null when a primary source explicitly says the competitor competes with the company; otherwise why not. */
export function competitorEvidenceProblem(c: CompetitorClaim, sources: LabeledSource[], companyName?: string): CompetitorEvidenceDrop | null {
  if (!c.source_id || !c.evidence_quote?.trim()) return "competitor_no_evidence";
  const src = sources.find((s) => s.source_id === c.source_id);
  if (!src) return "competitor_no_evidence";
  if (isDataPlatformUrl(src.url) || src.source_type === "aggregator_snippet") return "competitor_from_data_platform";
  if (!PRIMARY.has(src.source_type) || isListingPage(src)) return "competitor_from_listing";
  if (src.source_type === "news" && !isTrustedNewsUrl(src.url)) return "competitor_news_not_trusted";
  const quote = normalizeForMatch(c.evidence_quote);
  if (!normalizeForMatch(sourceText(src)).includes(quote)) return "competitor_quote_not_in_source";
  if (!` ${quote} `.includes(` ${coreName(c.name)} `) || !COMPETES.test(c.evidence_quote) || LISTING_WORDS.test(c.evidence_quote)) return "competitor_quote_not_explicit";
  if (companyName && !quoteIsAboutTheCompany(c.evidence_quote, companyName, src.source_type === "company_site")) return "competitor_quote_not_explicit";
  // A menu of "X vs Y" links is not a sentence (owner, 2026-11-06: Port's "Port vs Compass · Port vs Cortex · …").
  if (isLinkList(c.evidence_quote)) return "competitor_quote_not_explicit";
  // The two must be linked directly: "Rippling competes with HiBob, Namely, BambooHR" says nothing about
  // HiBob and BambooHR (owner, 2026-11-06).
  if (companyName && !quoteLinksTheTwo(c.evidence_quote, companyName, c.name)) return "competitor_quote_not_explicit";
  return null;
}

/** A row of links, not running text: three "vs", or two separators (· | • ›) between fragments. */
export function isLinkList(quote: string): boolean {
  return (quote.match(/\bvs\.?(?=\s)/gi) ?? []).length >= 3 || (quote.match(/\s[·|•›»]\s/g) ?? []).length >= 2;
}

const positions = (haystack: string, needle: string): number[] => {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) out.push(i);
  return out;
};

/**
 * The quote links the company and the competitor directly: a word that says they compete lies between
 * their two names ("Zepto competes with Blinkit", "Boeing … competes with Helsing", "HiBob vs Namely vs
 * Rippling"). Two companies named after one "competes with" — "Rippling competes with HiBob, Namely,
 * BambooHR" — are both Rippling's rivals, not each other's. A quote that does not name the company at
 * all (its own site's "we", "let's") is judged by quoteIsAboutTheCompany alone.
 */
export function quoteLinksTheTwo(quote: string, companyName: string, competitorName: string): boolean {
  const q = ` ${normalizeForMatch(quote)} `;
  const cs = positions(q, ` ${coreName(companyName)} `);
  const xs = positions(q, ` ${coreName(competitorName)} `);
  if (!cs.length || !xs.length) return true;
  const verbs = [...q.matchAll(new RegExp(COMPETES.source, "gi"))].map((m) => m.index!);
  return cs.some((c) => xs.some((x) => verbs.some((v) => v > Math.min(c, x) && v < Math.max(c, x))));
}

/**
 * The quote says the COMPANY competes (owner, 2026-11-01): Bolt's own blog
 * "…competes with big names like Amazon" was about the merchants Bolt helps
 * compete with Amazon, not Bolt. The quote names the company — or, on its
 * own site, speaks as "we / our / us / let's" — and is not "helps … compete".
 */
export function quoteIsAboutTheCompany(quote: string, companyName: string | null, ownSite: boolean): boolean {
  if (/\bhelp(?:s|ed|ing)?\b[^.]{0,60}\bcompete\b/i.test(quote)) return false;
  if (companyName && ` ${normalizeForMatch(quote)} `.includes(` ${coreName(companyName)} `)) return true;
  return ownSite && /\b(we|we're|our|us|let's|let us)\b/i.test(quote);
}
