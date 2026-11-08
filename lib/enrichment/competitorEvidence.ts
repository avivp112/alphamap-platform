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
  | "competitor_from_data_platform" | "competitor_from_listing" | "competitor_news_not_trusted"
  | "competitor_from_user_content" | "competitor_name_not_a_company";

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

/**
 * A forum, a community thread, a Q&A or a user post: user content, not a source for a competitor, even on the company's own
 * domain (owner, 2026-11-08: community.hailo.ai/t/…, community.celonis.com/general-product-q-a-2/…).
 */
export function isUserContentUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url.startsWith("http") ? url : `https://${url}`); } catch { return false; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (/^(community|communities|forum|forums|discuss|discussion|discussions|discourse|answers|ask|help-community|board|boards)\./.test(host)) return true;
  if (/(^|\.)(reddit\.com|stackoverflow\.com|stackexchange\.com|quora\.com|news\.ycombinator\.com|medium\.com\/@[^/]+\/responses)$/.test(host)) return true;
  return /\/(t\/[^/]+\/\d+|questions?|discussions?|threads?|topics?|forum|forums|community|answers?|q-a|q-and-a)(\/|$)|\/[a-z-]*q-a-\d+\//i.test(u.pathname);
}

const GENERIC_WORD = new Set(["high", "low", "new", "best", "top", "other", "others", "many", "some", "most", "more", "less", "free", "open", "fast", "easy", "smart", "simple", "modern", "global", "local", "general"]);
const CATEGORY_PREFIX = /^(?:conventional|traditional|legacy|standard|manual|generic|other|existing|alternative|competing|typical|classic|basic)\b/i;

/**
 * A name that can be a company (owner, 2026-11-08, review 6 and the competitors sheet): not a category ("EDR / AV",
 * "Conventional AI"), not a post title or a question ("Prometheus for High Cardinality, Part 1", "Why Bob beats
 * competitors?"), not a possessive or a lone common word ("India's", "High"), not a version or a figure ("4.20",
 * "126 FPS on PC/RPi5").
 */
export function looksLikeCompanyName(name: string): boolean {
  const n = name.trim();
  if (!n || n.length > 40 || n.length < 2) return false;
  if (/[\/,;?!]/.test(n) || /\bpart\s*\d+\b/i.test(n)) return false;
  if (/['’]s$/i.test(n) || /['’]s\s/i.test(n)) return false;
  if (/^[\d.\s,%$-]+$/.test(n) || /^\d/.test(n) || /\b\d+(?:\.\d+)?\s*(?:fps|ms|gb|mb|tb|tops|ghz|mhz|x)\b/i.test(n)) return false;
  if (/\s(?:for|with|in|on|at|to|and|or|vs|beats|why|how|what)\s/i.test(n) && n.split(/\s+/).length > 3) return false;
  if (/^(?:why|how|what|when|where|which|is|are|does|do|can)\b/i.test(n)) return false;
  if (n.split(/\s+/).length > 4) return false;
  if (CATEGORY_PREFIX.test(n)) return false;
  if (/\b(?:competitors?|alternatives?|others|solutions?)$/i.test(n)) return false;
  const words = n.split(/\s+/);
  if (words.length === 1 && GENERIC_WORD.has(n.toLowerCase())) return false;
  return /\p{L}/u.test(n);
}

const PAGE_GENERIC = new Set(["platform", "software", "company", "solution", "solutions", "technology", "tools", "service", "services", "product", "products", "business", "which", "compare", "comparison", "alternatives", "better", "features", "pricing"]);
/**
 * A page on a competitor's own site compares itself to "<name>": is that our company, or another of the same name? It is
 * another when the page names a domain built on the name that is not ours ("bolt.new" for Bolt of bolt.com), or, when the
 * page is long enough to describe the product, when none of the company's description shows in it.
 */
export function pageIsAboutAnotherCompany(pageText: string, companyName: string, ownDomain: string | null, description?: string): boolean {
  const core = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const text = pageText.toLowerCase();
  if (core.length >= 3) {
    const domains = [...text.matchAll(new RegExp(`(?:^|[^a-z0-9])(${core}[a-z0-9-]*\\.[a-z]{2,}(?:\\.[a-z]{2})?)(?![a-z0-9])`, "g"))].map((m) => m[1]);
    const own = (ownDomain ?? "").toLowerCase();
    if (domains.length && !domains.some((d) => d === own || d.endsWith(`.${own}`) || own.endsWith(`.${d}`))) return true;
  }
  if (description && pageText.length >= 800) {
    const dw = [...new Set((description.toLowerCase().match(/\p{L}{5,}/gu) ?? []).filter((w) => !PAGE_GENERIC.has(w)))];
    if (dw.length >= 4 && !dw.some((w) => text.includes(w))) return true;
  }
  return false;
}

/** null when a primary source explicitly says the competitor competes with the company; otherwise why not. */
export function competitorEvidenceProblem(c: CompetitorClaim, sources: LabeledSource[], companyName?: string): CompetitorEvidenceDrop | null {
  if (!c.source_id || !c.evidence_quote?.trim()) return "competitor_no_evidence";
  const src = sources.find((s) => s.source_id === c.source_id);
  if (!src) return "competitor_no_evidence";
  if (isUserContentUrl(src.url)) return "competitor_from_user_content";
  if (c.name && !looksLikeCompanyName(c.name)) return "competitor_name_not_a_company";
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
