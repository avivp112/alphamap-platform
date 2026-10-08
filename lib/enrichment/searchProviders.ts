/**
 * lib/enrichment/searchProviders.ts — v2's Serper/Tavily/Jina calling code.
 * Ground rule 4: "keep the current providers... do not add or remove
 * providers without an explicit request." Jina was briefly removed from
 * this pipeline (cheerio direct-fetch tried as its replacement for Stage
 * 2), then RESTORED the same session once a real DRY_RUN=false batch
 * measured the actual effect: cheerio fetched 1.2 real website pages per
 * company on average (several companies got only the homepage, one got
 * zero pages at all) versus Jina's prior 3.9 pages/company -- roughly a
 * 3x drop in website content volume, because cheerio is a static-HTML
 * parser with no JS execution and weaker anti-bot handling than a real
 * rendering proxy. Jina is primary for Stage 2 again; cheerio stays in
 * the fallback chain as a zero-cost last resort. Serper remains primary
 * general search, Tavily supplements thin Serper coverage (see
 * webSearch() below) -- that part of the removal instruction is unrelated
 * to Stage 2 and stays as implemented. Same endpoints, same retry/
 * backoff behavior as v1's private serperSearch/tavilySearch/
 * fetchViaJinaReader/fetchCompanyWebsite/verifyDomainMatch (duplicated
 * rather than imported — v1 is frozen, same reasoning as sanitize.ts).
 *
 * The one deliberate shape change: v1's functions return ONE pre-joined
 * text blob per query ("fine" for v1's single mega-prompt). v2 needs each
 * individual result kept separate — with its own url/title/snippet — so
 * entity.ts can filter per-result and sources.ts can assign each one its
 * own [S#]/[W#] id for evidence.ts to verify a quote against later (issue
 * 1's whole point: know which source backed which value). So these return
 * RawSearchResult[] instead of a joined string. The queries themselves,
 * endpoints, and fallback order are unchanged.
 *
 * Not unit-tested beyond pure helpers (parseSerperResponse etc.) — these
 * functions make real HTTP calls, same "thin, untestable-without-
 * credentials wrapper" situation as extractProfile.ts/extractFunding.ts's
 * live API wrappers.
 */

import * as cheerio from "cheerio";
import type { Provider, RawSearchResult } from "./sources";
import { websiteDomain } from "./websiteValidation";
import type { SearchCache } from "./searchCache";
import { cleanArticleText } from "./articles";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SearchProviderState {
  serperCallCount: number;
  tavilyCallCount: number;
  tavilyExhausted: boolean;
  websitePagesFetched: number;
  /** A fetched page was non-empty but thin/404-style for a guessed path
   *  (/team, /company, /contact) that doesn't actually exist on the site —
   *  see looksLikeRealContent(). Tracked separately so a run can tell
   *  "website fetch is failing" apart from "it's succeeding but half of
   *  what it fetches is junk". */
  websitePagesSkippedThin: number;
  /** Website pages dropped as near-duplicates of a page already kept (e.g. /team redirecting to /about). */
  websitePagesDuplicate: number;
  /** Per-company disk cache (searchCache.ts) — a hit costs no API call. */
  cache?: SearchCache;
}

export function createSearchProviderState(): SearchProviderState {
  return {
    serperCallCount: 0, tavilyCallCount: 0,
    tavilyExhausted: !process.env.TAVILY_API_KEY,
    websitePagesFetched: 0, websitePagesSkippedThin: 0, websitePagesDuplicate: 0,
  };
}

const NOT_FOUND_PHRASES_RE = /\b(404(?:\s+error)?|page not found|(?:this\s+)?page (?:could not|couldn'?t) be found|we can'?t find (?:that|this) page|doesn'?t exist|does not exist|oops[,!]?\s*(?:this\s+)?page)\b/i;
// A real page is almost never this short once boilerplate/markup is
// stripped; most "guessed" subpaths (/team, /company, /contact) that don't
// actually exist on a given site resolve to a generic platform 404 --
// non-empty, no error, just useless. A real DRY_RUN=false batch showed this
// exact pattern: completely different companies' /about, /team, /company,
// /contact pages all coming back at 150-250 chars (near-identical
// boilerplate sizes), while every real homepage fetch was 1,000+ chars.
const MIN_USEFUL_CONTENT_CHARS = 250;

export function looksLikeRealContent(text: string): boolean {
  if (text.length < MIN_USEFUL_CONTENT_CHARS) return false;
  // A long page that merely mentions "404" somewhere isn't itself a 404 page
  // -- only treat the not-found phrasing as disqualifying when the whole
  // page is still short enough that it's plausibly JUST the error page.
  if (text.length < 600 && NOT_FOUND_PHRASES_RE.test(text)) return false;
  return true;
}

// ── Serper (PRIMARY search) ────────────────────────────────────────────────

interface SerperResponse {
  organic?: Array<{ title: string; link: string; snippet: string }>;
  answerBox?: { answer?: string; snippet?: string };
  knowledgeGraph?: { description?: string };
}

export function parseSerperResponse(data: SerperResponse, queryLabel: string): RawSearchResult[] {
  // The answerBox/knowledgeGraph summary (if any) has no URL of its own to
  // cite as a source, so — unlike v1, which just prepended it to the text
  // blob — it's dropped here rather than produce a claim evidence.ts could
  // never verify against a real source_id. Every actual organic result
  // (which does have a real URL) is kept, same top-8 cap as v1.
  return (data.organic ?? []).slice(0, 8).map((r) => ({
    url: r.link,
    title: r.title,
    content: (r.snippet ?? "").slice(0, 600),
    provider: "serper" as const,
    query_label: queryLabel,
  }));
}

export async function serperSearch(
  query: string,
  queryLabel: string,
  state: SearchProviderState,
  attempt = 0,
): Promise<RawSearchResult[]> {
  if (!process.env.SERP_KEY) return [];
  const cacheKey = `serper:${query}`;
  const cached = state.cache?.get<RawSearchResult[]>(cacheKey);
  if (cached) return cached.map((r) => ({ ...r, query_label: queryLabel }));
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": process.env.SERP_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 10, autocorrect: false }),
    });

    if (res.status === 429 && attempt < 3) {
      const wait = 10_000 * 2 ** attempt;
      console.warn(`    ⚠️  Serper 429 — waiting ${wait / 1000}s (retry ${attempt + 1}/3)…`);
      await sleep(wait);
      return serperSearch(query, queryLabel, state, attempt + 1);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`    ⚠️  Serper HTTP ${res.status}` + (body ? ` — ${body.slice(0, 200)}` : ""));
      return [];
    }

    const data = await res.json() as SerperResponse;
    const results = parseSerperResponse(data, queryLabel);
    if (results.length > 0) state.serperCallCount++;
    state.cache?.set(cacheKey, results);
    return results;
  } catch (err) {
    console.warn(`    ⚠️  Serper threw: ${String(err)}`);
    return [];
  }
}

// ── Serper News (dedicated News API — NOT the same as serperSearch's /search endpoint) ──
// v1 has always used this; v2 never did -- it ran the "news" query through
// the generic web-search endpoint with "news 2025 2026" stuffed into the
// query text, which is a structurally weaker way to find actual news
// articles than Google's own News-scoped index. A real comparison run
// confirmed the gap directly: v1 consistently surfaced recent articles for
// companies v2 found none for on the exact same "news" query slot.

interface SerperNewsResponse {
  news?: Array<{ title: string; link: string; snippet?: string; date?: string; source?: string; imageUrl?: string }>;
}

export function parseSerperNewsResponse(data: SerperNewsResponse, queryLabel: string): RawSearchResult[] {
  return (data.news ?? []).slice(0, 8).map((n) => ({
    url: n.link,
    title: n.title,
    content: [n.source ? `Source: ${n.source}` : "", n.date ? `Date: ${n.date}` : "", n.snippet ?? ""].filter(Boolean).join(" — ").slice(0, 600),
    provider: "serper" as const,
    query_label: queryLabel,
  }));
}

export async function serperNewsSearch(
  query: string,
  queryLabel: string,
  state: SearchProviderState,
  attempt = 0,
): Promise<RawSearchResult[]> {
  if (!process.env.SERP_KEY) return [];
  const cacheKey = `serper_news:${query}`;
  const cached = state.cache?.get<RawSearchResult[]>(cacheKey);
  if (cached) return cached.map((r) => ({ ...r, query_label: queryLabel }));
  try {
    const res = await fetch("https://google.serper.dev/news", {
      method: "POST",
      headers: { "X-API-KEY": process.env.SERP_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 10, autocorrect: false }),
    });

    if (res.status === 429 && attempt < 3) {
      const wait = 10_000 * 2 ** attempt;
      console.warn(`    ⚠️  Serper News 429 — waiting ${wait / 1000}s (retry ${attempt + 1}/3)…`);
      await sleep(wait);
      return serperNewsSearch(query, queryLabel, state, attempt + 1);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`    ⚠️  Serper News HTTP ${res.status}` + (body ? ` — ${body.slice(0, 200)}` : ""));
      return [];
    }

    const data = await res.json() as SerperNewsResponse;
    const results = parseSerperNewsResponse(data, queryLabel);
    if (results.length > 0) state.serperCallCount++;
    state.cache?.set(cacheKey, results);
    return results;
  } catch (err) {
    console.warn(`    ⚠️  Serper News threw: ${String(err)}`);
    return [];
  }
}

// ── Tavily (never tried first — supplements Serper when its results are thin, see webSearch() below) ──

interface TavilyResponse {
  answer?: string;
  results?: Array<{ title: string; url: string; content?: string }>;
}

export function parseTavilyResponse(data: TavilyResponse, queryLabel: string): RawSearchResult[] {
  return (data.results ?? []).map((r) => ({
    url: r.url,
    title: r.title,
    content: (r.content ?? "").slice(0, 600),
    provider: "tavily" as const,
    query_label: queryLabel,
  }));
}

export async function tavilySearch(
  query: string,
  queryLabel: string,
  state: SearchProviderState,
  attempt = 0,
): Promise<RawSearchResult[]> {
  const cacheKey = `tavily:${query}`;
  const cached = state.cache?.get<RawSearchResult[]>(cacheKey);
  if (cached) return cached.map((r) => ({ ...r, query_label: queryLabel }));
  if (state.tavilyExhausted) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, search_depth: "advanced", max_results: 6, include_answer: true }),
    });

    if (res.status === 401 || res.status === 402 || res.status === 432) {
      console.warn(`    ⚠️  Tavily HTTP ${res.status} — disabling Tavily fallback for the rest of this run.`);
      state.tavilyExhausted = true;
      return [];
    }
    if (res.status === 429 && attempt < 3) {
      const wait = 15_000 * 2 ** attempt;
      console.warn(`    ⚠️  Tavily 429 — waiting ${wait / 1000}s (retry ${attempt + 1}/3)…`);
      await sleep(wait);
      return tavilySearch(query, queryLabel, state, attempt + 1);
    }
    if (!res.ok) {
      console.warn(`    ⚠️  Tavily HTTP ${res.status} — fallback query returned nothing.`);
      return [];
    }

    const data = await res.json() as TavilyResponse;
    const results = parseTavilyResponse(data, queryLabel);
    if (results.length > 0) state.tavilyCallCount++;
    state.cache?.set(cacheKey, results);
    return results;
  } catch (err) {
    console.warn(`    ⚠️  Tavily threw: ${String(err)}`);
    return [];
  }
}

/** Stage 1 -> Stage 4: Serper first, unconditionally; Tavily only when Serper returned nothing. */
// Below this many organic results, Serper's own coverage of a query is
// treated as too thin to trust on its own -- Tavily is queried too and the
// two are MERGED (not an either/or fallback) so a query that got, say, 2
// real Serper hits keeps those AND gains Tavily's independent hits, rather
// than discarding one provider's results in favor of the other. At or
// above this count, Serper alone is trusted and Tavily is skipped entirely
// (keeps cost/latency down on a query that's already well covered).
export const THIN_RESULTS_THRESHOLD = 3;

/** Pure: does this query's own Serper coverage need Tavily's help? Split out from webSearch() so this threshold decision is unit-testable without live credentials. */
export function needsTavilySupplement(serperResults: RawSearchResult[]): boolean {
  return serperResults.length < THIN_RESULTS_THRESHOLD;
}

/** Pure: Serper's own results first (primary), then any Tavily result whose URL Serper didn't already return -- never a duplicate of the same source under two different provider labels. */
export function mergeSearchResults(serperResults: RawSearchResult[], tavilyResults: RawSearchResult[]): RawSearchResult[] {
  const seenUrls = new Set(serperResults.map((r) => r.url));
  return [...serperResults, ...tavilyResults.filter((r) => !seenUrls.has(r.url))];
}

/**
 * Serper is primary for general web search; the company's own site
 * (fetchCompanyWebsitePages, unaffected by this function) is fetched
 * separately via cheerio. Tavily is not a strict last-resort fallback --
 * it supplements whenever Serper's own results for THIS query are thin
 * (including literally empty), merged alongside Serper's rather than
 * replacing them, so the two providers genuinely combine their coverage
 * instead of one simply standing in for the other.
 */
export async function webSearch(query: string, queryLabel: string, state: SearchProviderState): Promise<RawSearchResult[]> {
  const serperResults = await serperSearch(query, queryLabel, state);
  // A site:-restricted query (LinkedIn, Crunchbase, Google Patents) normally
  // returns only a few hits; Tavily's general search can't honor site: and
  // only adds unrelated pages at a cost — 54 Tavily calls in a 20-company run.
  if (/\bsite:/i.test(query)) return serperResults;
  if (!needsTavilySupplement(serperResults)) return serperResults;

  const tavilyResults = await tavilySearch(query, queryLabel, state);
  return mergeSearchResults(serperResults, tavilyResults);
}

/**
 * Same collaboration shape as webSearch(), but for the "news" query
 * specifically: Serper's dedicated News API (recency/news-scoped by
 * nature, so it gets a plain "name + anchor news" query, not the
 * site:-heavy query built for general web search) is primary; Tavily
 * (general search, the site:-heavy query) supplements when News coverage
 * is thin, same threshold/merge as webSearch.
 */
export async function newsSearch(
  newsQuery: string, tavilyQuery: string, queryLabel: string, state: SearchProviderState,
): Promise<RawSearchResult[]> {
  const newsResults = await serperNewsSearch(newsQuery, queryLabel, state);
  if (!needsTavilySupplement(newsResults)) return newsResults;

  const tavilyResults = await tavilySearch(tavilyQuery, queryLabel, state);
  return mergeSearchResults(newsResults, tavilyResults);
}

// ── Domain verification (Stage 0) ──────────────────────────────────────────

export interface DomainVerification {
  verified: boolean | null;
  crunchbaseUrl: string | null;
  linkedinUrl: string | null;
  mismatchDomain: string | null;
  note: string;
}

export async function verifyDomainMatch(
  name: string,
  candidateWebsite: string | null | undefined,
  state: SearchProviderState,
): Promise<DomainVerification> {
  const candidateDomain = websiteDomain(candidateWebsite);
  const empty: DomainVerification = { verified: null, crunchbaseUrl: null, linkedinUrl: null, mismatchDomain: null, note: "" };
  if (!candidateDomain) return empty;

  const results = await serperSearch(`"${name}" (site:crunchbase.com/organization OR site:linkedin.com/company)`, "domain_verification", state);
  if (results.length === 0) return empty;

  const raw = results.map((r) => `[${r.title}]\n${r.url}\n${r.content}`).join("\n---\n");
  const crunchbaseMatch = raw.match(/https?:\/\/(?:www\.)?crunchbase\.com\/organization\/[^\s)\]]+/i);
  const linkedinMatch = raw.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[^\s)\]]+/i);

  if (raw.toLowerCase().includes(candidateDomain)) {
    return {
      verified: true, crunchbaseUrl: crunchbaseMatch?.[0] ?? null, linkedinUrl: linkedinMatch?.[0] ?? null,
      mismatchDomain: null, note: `Candidate domain "${candidateDomain}" confirmed via Crunchbase/LinkedIn.`,
    };
  }

  const websiteLineMatch = raw.match(/website[:\s]+(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/i);
  const mentionedDomain = websiteLineMatch?.[1]?.toLowerCase() ?? null;
  if (mentionedDomain && mentionedDomain !== candidateDomain && (crunchbaseMatch || linkedinMatch)) {
    return {
      verified: false, crunchbaseUrl: crunchbaseMatch?.[0] ?? null, linkedinUrl: linkedinMatch?.[0] ?? null,
      mismatchDomain: mentionedDomain,
      note: `Crunchbase/LinkedIn reference "${mentionedDomain}", not candidate "${candidateDomain}" — likely false-positive domain match.`,
    };
  }

  return {
    verified: null, crunchbaseUrl: crunchbaseMatch?.[0] ?? null, linkedinUrl: linkedinMatch?.[0] ?? null,
    mismatchDomain: null, note: "Crunchbase/LinkedIn found but neither confirmed nor contradicted the candidate domain.",
  };
}

// ── Company website fetch (Stage 2) ────────────────────────────────────────

const FETCH_TIMEOUT_MS = 8_000;
const JINA_TIMEOUT_MS = 15_000;
const MAX_WEBSITE_CHARS = 6_000; // spec stage 2: "cap content per page (for example 6,000 characters)" -- raised from v1's 3,000 now that each page is its own labeled [W#] source rather than one slot in a single shared context budget

// Set on the first HTTP 402/401 from Jina (out of credit / bad key): every
// later page in the run goes straight to cheerio/Tavily instead of paying a
// failed round trip and a warning line per page.
let jinaDisabledReason: string | null = null;

/** Why Jina Reader was switched off for the rest of the run, or null while it works. */
export function jinaDisabled(): string | null {
  return jinaDisabledReason;
}

async function fetchViaJinaReader(url: string, state: SearchProviderState): Promise<string | null> {
  if (jinaDisabledReason) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
    const headers: Record<string, string> = { Accept: "text/plain" };
    if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;

    const res = await fetch(`https://r.jina.ai/${url}`, { signal: controller.signal, headers }).finally(() => clearTimeout(timer));
    if (res.status === 402 || res.status === 401) {
      jinaDisabledReason = res.status === 402 ? "HTTP 402 — out of credit" : "HTTP 401 — JINA_API_KEY rejected";
      console.warn(`    ⛔  Jina Reader ${jinaDisabledReason}. Switched off for the rest of this run — pages and articles now come from cheerio/Tavily only, so fewer full articles are read. Top up Jina (jina.ai) or fix JINA_API_KEY in .env.`);
      return null;
    }
    if (!res.ok) {
      console.warn(`    ⚠️  Jina Reader HTTP ${res.status} for ${url} — falling back to cheerio/Tavily.`);
      return null;
    }
    const text = (await res.text()).trim();
    if (!text) {
      console.warn(`    ⚠️  Jina Reader returned empty content for ${url} — falling back to cheerio/Tavily.`);
      return null;
    }
    return text;
  } catch (err) {
    console.warn(`    ⚠️  Jina Reader threw for ${url}: ${String(err)} — falling back to cheerio/Tavily.`);
    return null;
  }
}

async function tavilyExtractUrls(urls: string[], state: SearchProviderState): Promise<string | null> {
  if (state.tavilyExhausted) return null;
  try {
    const res = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, urls }),
    });
    if (res.status === 401 || res.status === 402 || res.status === 432) {
      state.tavilyExhausted = true;
      return null;
    }
    if (!res.ok) return null;

    const data = await res.json() as { results?: Array<{ url: string; raw_content?: string }> };
    const parts = (data.results ?? [])
      .filter((r) => r.raw_content)
      .map((r) => r.raw_content!.replace(/\s+/g, " ").trim().slice(0, MAX_WEBSITE_CHARS));
    if (!parts.length) return null;
    state.tavilyCallCount++;
    return parts.join("\n---\n");
  } catch {
    return null;
  }
}

async function cheerioFetch(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal, redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AlphaMapEnrichmentBot/1.0; +https://alphamap.app)", Accept: "text/html" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("text/html")) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, svg, nav, footer").remove();
    const title = $("title").first().text().trim();
    const metaDesc = $('meta[name="description"]').attr("content")?.trim() ?? $('meta[property="og:description"]').attr("content")?.trim() ?? "";
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    const parts = [title && `Title: ${title}`, metaDesc && `Meta description: ${metaDesc}`, bodyText && `Page text: ${bodyText.slice(0, MAX_WEBSITE_CHARS)}`].filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : null;
  } catch {
    return null;
  }
}

export interface FetchedPage { url: string; content: string; provider: Provider }

function shingles(text: string, size = 5): Set<string> {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(" "));
  return out;
}

/** True when two pages share at least `threshold` of their 5-word shingles (Jaccard) — the same page under two URLs. */
export function isNearDuplicatePage(a: string, b: string, threshold = 0.8): boolean {
  const sa = shingles(a), sb = shingles(b);
  if (sa.size === 0 || sb.size === 0) return a.trim() === b.trim();
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter) >= threshold;
}

/**
 * Full text of a third-party article via Jina Reader (free), cleaned of
 * images/link targets and capped. null on any failure — the caller keeps
 * the search snippet it already has.
 */
export async function fetchArticleText(url: string, state: SearchProviderState): Promise<string | null> {
  const cacheKey = `article:${url}`;
  const cached = state.cache?.get<string>(cacheKey);
  if (cached) return cached;
  const raw = await fetchViaJinaReader(url, state);
  if (!raw) return null;
  const text = cleanArticleText(raw);
  if (!looksLikeRealContent(text)) return null;
  state.cache?.set(cacheKey, text);
  return text;
}

/**
 * Spec stage 2: home page plus /about, /team, /company, /contact "when they
 * exist" — each one its own [W#] source (not concatenated into one blob
 * like v1), so a quote can be traced to exactly which page it came from.
 * Per candidate path: Jina Reader first (a real rendering proxy -- handles
 * JS-rendered pages and basic anti-bot measures cheerio structurally
 * cannot), cheerio second (free, zero-cost direct fetch, catches whatever
 * Jina itself fails or times out on). Both are checked against
 * looksLikeRealContent() so a generic 404 page for a guessed path that
 * doesn't exist isn't counted as a real source regardless of which one
 * fetched it. If NEITHER got anything usable for ANY candidate path,
 * Tavily Extract (home+/about, one call, matching v1's own fallback shape)
 * is the last resort.
 */
export async function fetchCompanyWebsitePages(
  website: string | null | undefined,
  state: SearchProviderState,
): Promise<FetchedPage[]> {
  if (!website) return [];
  const root = website.startsWith("http") ? website : `https://${website}`;
  const candidatePaths = ["", "/about", "/team", "/company", "/contact"];
  const pages: FetchedPage[] = [];

  for (const path of candidatePaths) {
    const url = root.replace(/\/+$/, "") + path;
    const cachedPage = state.cache?.get<{ content: string; provider: Provider }>(`page:${url}`);
    let content: string | null;
    let provider: Provider;
    if (cachedPage) {
      ({ content, provider } = cachedPage);
    } else {
      const viaJina = await fetchViaJinaReader(url, state);
      [content, provider] = viaJina ? [viaJina, "jina"] : [await cheerioFetch(url), "cheerio"];
    }
    if (!content) continue;
    if (!looksLikeRealContent(content)) {
      state.websitePagesSkippedThin++;
      console.warn(`    ⚠️  thin/404-like page for ${url} (${content.length} chars, ${provider}) — skipping, not counted as a real source.`);
      continue;
    }
    if (!cachedPage) state.cache?.set(`page:${url}`, { content, provider });
    const capped = content.slice(0, MAX_WEBSITE_CHARS);
    // /team, /company and /contact often redirect to (or render) the same
    // page as /about or the homepage — sending it again only costs tokens.
    const duplicateOf = pages.find((p) => isNearDuplicatePage(p.content, capped));
    if (duplicateOf) {
      state.websitePagesDuplicate++;
      console.log(`    ♻️   ${url} is the same page as ${duplicateOf.url} — not sent twice.`);
      continue;
    }
    state.websitePagesFetched++;
    pages.push({ url, content: capped, provider });
    console.log(`    🌐  fetched ${url} (${content.length} chars, ${provider}${cachedPage ? ", cached" : ""})`);
  }
  if (pages.length > 0) return pages;

  // Neither Jina nor cheerio got anything usable for ANY candidate page --
  // fall back to Tavily Extract on home+/about (one call, matching v1's
  // own fallback).
  if (!state.tavilyExhausted) {
    const aboutUrl = root.replace(/\/+$/, "") + "/about";
    const extracted = await tavilyExtractUrls([root, aboutUrl], state);
    if (extracted) return [{ url: root, content: extracted, provider: "tavily_extract" }];
  }

  return [];
}
