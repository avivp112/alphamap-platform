import { mkdirSync, readFileSync, writeFileSync } from "fs";
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
 * rendering proxy. Jina is primary for Stage 2 again.
 *
 * Provider order (owner's decision, 2026-10-20; Serper and Jina back each
 * other up, 2026-10-29): Serper searches and Jina reads pages and articles.
 * Each is the other's backup — a search Serper could not answer (network
 * error, HTTP error) goes to Jina Search; a page Jina could not read goes to
 * Serper's scrape endpoint. Going deeper (the Stage 9 deep dive), Jina Search
 * joins Serper. Tavily is only a last resort, when both failed and a
 * TAVILY_API_KEY is set. cheerio is not used for reading at all. Same endpoints, same retry/
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

import { parseSitemap, robotsSitemaps, pickSitePages, MAX_SITE_PAGES } from "./sitemap.ts";
import { devLinksFromText, type DevLinks } from "./devLinks";
import type { Provider, RawSearchResult } from "./sources";
import { websiteDomain } from "./websiteValidation";
import type { SearchCache } from "./searchCache";
import { cleanArticleText } from "./articles";
import { noteRateLimit, waitIfLimited } from "./rateLimit.ts";
import { componentOn } from "./components";
import { replayMode } from "./recorder.ts";

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
  /** Every search of the run, when set: label, query, provider and whether the cache answered (eval/search_audit.ts). */
  queryLog?: Array<{ label: string; query: string; provider: string; cached: boolean }>;
  /** Jina Search answers (Serper's backup / deep-dive partner) and Serper scrape reads (Jina Reader's backup). */
  jinaSearchCallCount?: number;
  serperScrapeCount?: number;
  /** Search calls made, and those that failed (network error, timeout, HTTP 5xx) — not "no results". */
  searchAttempts?: number;
  searchFailures?: number;
}

/** Most of this company's searches failed: an outage, not a company with nothing about it. */
function logQuery(state: SearchProviderState, provider: string, label: string, query: string, cached: boolean): void {
  state.queryLog?.push({ label, query, provider, cached });
}

export function searchMostlyFailed(state: SearchProviderState): boolean {
  const attempts = state.searchAttempts ?? 0, failures = state.searchFailures ?? 0;
  return failures >= 3 && failures / Math.max(attempts, 1) >= 0.3;
}

/** Paid search/read calls in a state: Serper (search, news, scrape), Jina Search, Tavily. */
export function searchCalls(state: SearchProviderState): number {
  return state.serperCallCount + state.tavilyCallCount + (state.jinaSearchCallCount ?? 0) + (state.serperScrapeCount ?? 0);
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

/**
 * What a failed fetch really was: "fetch failed (ECONNRESET)", not just
 * "fetch failed" (eval run of 2026-10-29: Serper "fetch failed" for almost
 * every company — the cause says whether it is the network, DNS or TLS).
 */
export function describeFetchError(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string; errno?: number } };
  const cause = e?.cause?.code ?? e?.cause?.message;
  return `${e?.message ?? String(err)}${cause ? ` (${cause})` : ""}`;
}

/** A network failure (no HTTP answer) worth one more try after a pause. */
const NETWORK_RETRIES = 2;
const networkBackoffMs = (attempt: number) => 1500 * (attempt + 1);

/** A search's results, and whether the provider failed to answer (as opposed to answering "nothing"). */
export interface SearchOutcome { results: RawSearchResult[]; failed: boolean }

export async function serperSearch(query: string, queryLabel: string, state: SearchProviderState): Promise<RawSearchResult[]> {
  return (await serperCall("search", query, queryLabel, state)).results;
}

/** Serper's /search or /news, with its retries. failed: no usable answer (network error, HTTP error, no key). */
async function serperCall(endpoint: "search" | "news", query: string, queryLabel: string, state: SearchProviderState, attempt = 0): Promise<SearchOutcome> {
  const name = endpoint === "news" ? "Serper News" : "Serper";
  if (!process.env.SERP_KEY) return { results: [], failed: true };
  const cacheKey = `${endpoint === "news" ? "serper_news" : "serper"}:${query}`;
  const cached = state.cache?.get<RawSearchResult[]>(cacheKey);
  logQuery(state, endpoint === "news" ? "serper_news" : "serper", queryLabel, query, !!cached);
  if (cached) return { results: cached.map((r) => ({ ...r, query_label: queryLabel })), failed: false };
  state.searchAttempts = (state.searchAttempts ?? 0) + 1;
  try {
    await waitIfLimited("serper");   // a 429 to any company pauses them all
    const res = await fetch(`https://google.serper.dev/${endpoint}`, {
      method: "POST",
      headers: { "X-API-KEY": process.env.SERP_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 10, autocorrect: false }),
    });

    if (res.status === 429 && attempt < 3) {
      const wait = 10_000 * 2 ** attempt;
      console.warn(`    ⚠️  ${name} 429 — waiting ${wait / 1000}s (retry ${attempt + 1}/3)…`);
      noteRateLimit("serper", wait);
      return serperCall(endpoint, query, queryLabel, state, attempt + 1);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status >= 500) state.searchFailures = (state.searchFailures ?? 0) + 1;
      console.warn(`    ⚠️  ${name} HTTP ${res.status}` + (body ? ` — ${body.slice(0, 200)}` : ""));
      return { results: [], failed: true };
    }

    const data = await res.json();
    const results = endpoint === "news" ? parseSerperNewsResponse(data as SerperNewsResponse, queryLabel) : parseSerperResponse(data as SerperResponse, queryLabel);
    if (results.length > 0) state.serperCallCount++;
    state.cache?.set(cacheKey, results);
    return { results, failed: false };
  } catch (err) {
    if (attempt < NETWORK_RETRIES) {
      await sleep(networkBackoffMs(attempt));
      return serperCall(endpoint, query, queryLabel, state, attempt + 1);
    }
    state.searchFailures = (state.searchFailures ?? 0) + 1;
    console.warn(`    ⚠️  ${name} threw: ${describeFetchError(err)} — after ${NETWORK_RETRIES} retries`);
    return { results: [], failed: true };
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

export async function serperNewsSearch(query: string, queryLabel: string, state: SearchProviderState): Promise<RawSearchResult[]> {
  return (await serperCall("news", query, queryLabel, state)).results;
}

// ── Jina Search (Serper's backup, and its partner going deeper) ─────────────

interface JinaSearchResponse {
  data?: Array<{ title?: string; url?: string; description?: string; content?: string; date?: string }> | null;
}

export function parseJinaSearchResponse(data: JinaSearchResponse, queryLabel: string): RawSearchResult[] {
  return (data.data ?? []).filter((r) => r.url).slice(0, 8).map((r) => ({
    url: r.url!,
    title: r.title ?? "",
    content: [r.date ? `Date: ${r.date}` : "", r.description || r.content || ""].filter(Boolean).join(" — ").slice(0, 600),
    provider: "jina_search" as const,
    query_label: queryLabel,
  }));
}

/** The domains a query restricts itself to ("site:linkedin.com/company" → linkedin.com). */
export function siteDomains(query: string): string[] {
  return [...query.matchAll(/\bsite:([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase().replace(/^www\./, ""));
}

/** Keep only results on the query's site: domains — a backup engine may not honour the operator. */
export function onSites(results: RawSearchResult[], domains: string[]): RawSearchResult[] {
  if (domains.length === 0) return results;
  return results.filter((r) => {
    let host = "";
    try { host = new URL(r.url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return false; }
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  });
}

export async function jinaSearch(query: string, queryLabel: string, state: SearchProviderState): Promise<SearchOutcome> {
  if (!process.env.JINA_API_KEY || jinaDisabled()) return { results: [], failed: true };
  const cacheKey = `jina_search:${query}`;
  const cached = state.cache?.get<RawSearchResult[]>(cacheKey);
  logQuery(state, "jina_search", queryLabel, query, !!cached);
  if (cached) return { results: cached.map((r) => ({ ...r, query_label: queryLabel })), failed: false };
  state.searchAttempts = (state.searchAttempts ?? 0) + 1;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS * 2);
    const res = await fetch(`https://s.jina.ai/?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json", Authorization: `Bearer ${process.env.JINA_API_KEY}`, "X-Respond-With": "no-content" },
    }).finally(() => clearTimeout(timer));
    if (res.status === 402 || res.status === 401) {
      disableJina(res.status);
      return { results: [], failed: true };
    }
    if (!res.ok) {
      if (res.status >= 500) state.searchFailures = (state.searchFailures ?? 0) + 1;
      console.warn(`    ⚠️  Jina Search HTTP ${res.status}`);
      return { results: [], failed: true };
    }
    const results = onSites(parseJinaSearchResponse(await res.json() as JinaSearchResponse, queryLabel), siteDomains(query));
    if (results.length > 0) state.jinaSearchCallCount = (state.jinaSearchCallCount ?? 0) + 1;
    state.cache?.set(cacheKey, results);
    return { results, failed: false };
  } catch (err) {
    state.searchFailures = (state.searchFailures ?? 0) + 1;
    console.warn(`    ⚠️  Jina Search threw: ${describeFetchError(err)}`);
    return { results: [], failed: true };
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
  logQuery(state, "tavily", queryLabel, query, !!cached);
  if (cached) return cached.map((r) => ({ ...r, query_label: queryLabel }));
  state.searchAttempts = (state.searchAttempts ?? 0) + 1;
  if (state.tavilyExhausted) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, search_depth: "advanced", max_results: 6, include_answer: true }),
    });

    if (res.status === 401 || res.status === 402 || res.status === 432) {
      if (res.status >= 500) state.searchFailures = (state.searchFailures ?? 0) + 1;
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
    state.searchFailures = (state.searchFailures ?? 0) + 1;
    console.warn(`    ⚠️  Tavily threw: ${describeFetchError(err)}`);
    return [];
  }
}

/** Pure: the first provider's results, then any of the second's whose URL the first did not already return — never one source under two provider labels. */
export function mergeSearchResults(serperResults: RawSearchResult[], tavilyResults: RawSearchResult[]): RawSearchResult[] {
  const seenUrls = new Set(serperResults.map((r) => r.url));
  return [...serperResults, ...tavilyResults.filter((r) => !seenUrls.has(r.url))];
}

export interface SearchOptions {
  /** A Stage 9 deep-dive search: Jina Search joins Serper. */
  deep?: boolean;
}

/**
 * Serper searches; Jina Search backs it up and goes deeper with it:
 *   - Serper failed to answer (network, HTTP error) → Jina Search answers;
 *   - a deep-dive search → Jina Search joins, merged after Serper's results;
 *   - both failed → Tavily, only if a TAVILY_API_KEY is set (last resort).
 */
async function searchWithBackup(primary: SearchOutcome, jinaQuery: string, tavilyQuery: string, queryLabel: string, state: SearchProviderState, opts: SearchOptions): Promise<RawSearchResult[]> {
  if ((!primary.failed && !opts.deep) || !componentOn("search_backup")) return primary.results;
  const jina = await jinaSearch(jinaQuery, queryLabel, state);
  if (primary.failed && !jina.failed && jina.results.length) console.log(`    🔁  Serper could not answer "${queryLabel}" — Jina Search did (${jina.results.length} result(s)).`);
  let merged = mergeSearchResults(primary.results, jina.results);
  if (primary.failed && jina.failed && !state.tavilyExhausted) {
    merged = mergeSearchResults(merged, onSites(await tavilySearch(tavilyQuery, queryLabel, state), siteDomains(tavilyQuery)));
  }
  return merged;
}

/** A result whose address is a google.com/url?q=<target> redirect is the target (owner, 2026-11-19): the source is the real domain, never google.com. */
function unwrapGoogleRedirect(url: string): string {
  try {
    const u = new URL(url);
    if (!/(^|\.)google\.[a-z.]+$/.test(u.hostname) || u.pathname !== "/url") return url;
    const target = u.searchParams.get("url") ?? u.searchParams.get("q") ?? "";
    return /^https?:\/\//.test(target) ? target : url;
  } catch { return url; }
}
const realAddresses = (rs: RawSearchResult[]): RawSearchResult[] => rs.map((r) => (r.url ? { ...r, url: unwrapGoogleRedirect(r.url) } : r));

export async function webSearch(query: string, queryLabel: string, state: SearchProviderState, opts: SearchOptions = {}): Promise<RawSearchResult[]> {
  return realAddresses(await searchWithBackup(await serperCall("search", query, queryLabel, state), query, query, queryLabel, state, opts));
}

/**
 * The "news" query: Serper's dedicated News API (a plain "name + anchor news"
 * query) first; Jina Search backs it up and joins going deeper with the
 * general query, on the same terms as webSearch.
 */
export async function newsSearch(
  newsQuery: string, generalQuery: string, queryLabel: string, state: SearchProviderState, opts: SearchOptions = {},
): Promise<RawSearchResult[]> {
  return realAddresses(await searchWithBackup(await serperCall("news", newsQuery, queryLabel, state), generalQuery, generalQuery, queryLabel, state, opts));
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

const JINA_TIMEOUT_MS = Number(process.env.JINA_TIMEOUT_MS ?? 15_000);
import { promptText, htmlToText } from "./pageText.ts";
const MAX_WEBSITE_CHARS = Number(process.env.WEB_PAGE_PROMPT_CHARS ?? 3_000);   // what the model gets of a page; the verifier reads the whole page (up to MAX_PAGE_STORED)
const MAX_PAGE_STORED = 120_000;
/** Why the last read failed, set by each step (readPage names every step of the chain when all fail). */
let lastFailure = "";
const DUMMY_WEBSITE_CHARS = 0; // spec stage 2: "cap content per page (for example 6,000 characters)" -- raised from v1's 3,000 now that each page is its own labeled [W#] source rather than one slot in a single shared context budget

// Set on an HTTP 402/401 from Jina (out of credit / bad key): later pages go
// straight to Tavily instead of paying a failed round trip and a warning line
// each. Only for a while — the check worker runs for weeks, and a key topped
// up or fixed must come back without a restart.
let jinaDisabledReason: string | null = null;
let jinaDisabledAt = 0;
export const JINA_RETRY_AFTER_MS = 10 * 60_000;

/** Why Jina Reader is switched off for now, or null while it works. */
export function jinaDisabled(now = Date.now()): string | null {
  if (jinaDisabledReason && now - jinaDisabledAt > JINA_RETRY_AFTER_MS) jinaDisabledReason = null;
  return jinaDisabledReason;
}

async function fetchViaJinaReader(url: string, state: SearchProviderState, attempt = 0): Promise<string | null> {
  if (jinaDisabled()) return null;
  try {
    await waitIfLimited("jina");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
    const headers: Record<string, string> = { Accept: "text/plain" };
    if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;

    const res = await fetch(`https://r.jina.ai/${url}`, { signal: controller.signal, headers }).finally(() => clearTimeout(timer));
    if (res.status === 402 || res.status === 401) {
      disableJina(res.status);
      return null;
    }
    if (res.status === 429 && attempt < 2) {
      const wait = 10_000 * 2 ** attempt;
      console.warn(`    ⚠️  Jina Reader 429 — every company waits ${wait / 1000}s (retry ${attempt + 1}/2)…`);
      noteRateLimit("jina", wait);
      return fetchViaJinaReader(url, state, attempt + 1);
    }
    if (!res.ok) {
      lastFailure = `HTTP ${res.status}`;
      console.warn(`    ⚠️  Jina Reader HTTP ${res.status} for ${url} — Serper may read it instead.`);
      return null;
    }
    const text = (await res.text()).trim();
    if (!text) {
      lastFailure = "empty page";
      console.warn(`    ⚠️  Jina Reader returned empty content for ${url} — Serper may read it instead.`);
      return null;
    }
    return text;
  } catch (err) {
    lastFailure = describeFetchError(err);
    console.warn(`    ⚠️  Jina Reader threw for ${url}: ${describeFetchError(err)} — Serper may read it instead.`);
    return null;
  }
}

/** Jina said out of credit / bad key: Reader and Search both stop for a while (one account, one credit). */
function disableJina(status: number): void {
  if (jinaDisabled()) return;
  jinaDisabledReason = status === 402 ? "HTTP 402 — out of credit" : "HTTP 401 — JINA_API_KEY rejected";
  jinaDisabledAt = Date.now();
  console.warn(`    ⛔  Jina ${jinaDisabledReason}. Switched off for ${JINA_RETRY_AFTER_MS / 60_000} minutes — Serper now reads pages and articles, and Serper's failed searches have no backup. Top up Jina (jina.ai) or fix JINA_API_KEY in .env.`);
}

/**
 * A page's HTML, for its structure (a team page's cards — owner, 2026-11-03): Jina Reader
 * rendering it (scripts run), or a plain request when Jina cannot. Cached like a page.
 */
export async function fetchPageHtml(url: string, state: SearchProviderState): Promise<string | null> {
  const key = `html:${url}`;
  const cached = state.cache?.get<{ html: string }>(key);
  if (cached) return cached.html;
  let html: string | null = null;
  if (!jinaDisabled()) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
      const headers: Record<string, string> = { Accept: "text/plain", "X-Return-Format": "html" };
      if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
      const res = await fetch(`https://r.jina.ai/${url}`, { signal: controller.signal, headers }).finally(() => clearTimeout(timer));
      if (res.ok) html = (await res.text()).trim() || null;
    } catch { /* the plain request below */ }
  }
  if (!html) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; AlphaMapBot/1.0)", Accept: "text/html" } }).finally(() => clearTimeout(timer));
      if (res.ok && /html/i.test(res.headers.get("content-type") ?? "html")) html = (await res.text()).trim() || null;
    } catch { /* no HTML */ }
  }
  if (html) state.cache?.set(key, { html });
  return html;
}

// ── Serper scrape (Jina Reader's backup) ───────────────────────────────────

export function parseSerperScrape(data: { text?: string; markdown?: string } | null | undefined): string | null {
  const text = (data?.markdown || data?.text || "").trim();
  return text || null;
}

async function fetchViaSerperScrape(url: string, state: SearchProviderState): Promise<string | null> {
  if (!process.env.SERP_KEY) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS * 2);
    const res = await fetch("https://scrape.serper.dev", {
      method: "POST",
      signal: controller.signal,
      headers: { "X-API-KEY": process.env.SERP_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ url, includeMarkdown: true }),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      lastFailure = `HTTP ${res.status}`;
      console.warn(`    ⚠️  Serper scrape HTTP ${res.status} for ${url}`);
      return null;
    }
    const text = parseSerperScrape(await res.json() as { text?: string; markdown?: string });
    if (text) state.serperScrapeCount = (state.serperScrapeCount ?? 0) + 1;
    return text;
  } catch (err) {
    lastFailure = describeFetchError(err);
    console.warn(`    ⚠️  Serper scrape threw for ${url}: ${describeFetchError(err)}`);
    return null;
  }
}

/**
 * Why a home page could not be read, by site (owner, 2026-11-19: 17 sites of batch 8 were "domain_unresolved" because Jina answered 422 and Serper 400 — the services failed, not the domains).
 * `service`: the readers failed (HTTP 4xx / 5xx, aborted, empty) and the site's own server did not prove itself dead; `dead`: the site's server itself does not answer (DNS, refused, certificate).
 */
const readFailures = new Map<string, Record<string, string>>();
const hostKey = (url: string) => { try { return new URL(/^https?:/.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return url; } };
const redirects = new Map<string, string>();
// What a live run saw of a dead / unreachable home page is kept in cache/read_failures.json: a REPLAY of the same run reads the recordings, in which a failed fetch has lost its cause, and must still tell a
// dead site from a service failure (owner, 2026-11-19: nine dead sites came back as fetch_failed in the replay).
const READ_FAILURES_FILE = "cache/read_failures.json";
let persistedKinds: Record<string, "dead" | "unreachable" | "service"> | null = null;
const persisted = () => { if (!persistedKinds) { try { persistedKinds = JSON.parse(readFileSync(READ_FAILURES_FILE, "utf8")); } catch { persistedKinds = {}; } } return persistedKinds!; };
export function persistReadFailure(website: string, kind: "dead" | "unreachable" | "service"): void {
  try { const m = persisted(); m[hostKey(website)] = kind; mkdirSync("cache", { recursive: true }); writeFileSync(READ_FAILURES_FILE, JSON.stringify(m, null, 1)); } catch { /* a convenience */ }
}
/** Where a site's address ends up when it leads to another origin (nordigen.com → gocardless.com), when a read saw it. */
export function websiteRedirect(website: string): string | null { return redirects.get(hostKey(website)) ?? null; }

/**
 * Pages that are not read at all (owner, 2026-11-19: a news page of onlyfanstg.shop turned up among Heartland's search results): domains of the abuse-prone cheap top-level domains, adult / gambling /
 * pharmacy-spam words in the host, and the owner's list (eval/blocked_domains.json). Only third-party pages: a company's own home page is read whatever it is.
 */
const SUSPICIOUS_TLD = /\.(?:shop|lol|top|xyz|click|buzz|icu|cfd|sbs|rest|monster|cyou|quest|bond|gq|ml|cf|tk|ga|work|fit|loan|win|date|stream|download|racing|review|trade|webcam|party)$/i;
const SUSPICIOUS_WORD = /onlyfans|porn|xxx|sex|escort|casino|betting|poker|viagra|cialis|payday|giveaway|jackpot|nsfw/i;
let blockedFile: string[] | null = null;
export function suspiciousUrl(url: string): boolean {
  const host = hostKey(url);
  if (blockedFile === null) { try { blockedFile = (JSON.parse(readFileSync("eval/blocked_domains.json", "utf8")) as { domains?: string[] }).domains ?? []; } catch { blockedFile = []; } }
  return SUSPICIOUS_TLD.test(host) || SUSPICIOUS_WORD.test(host) || blockedFile.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * The name of the address does not resolve at all (owner, 2026-11-19: nordigen.com is dead, yet a reader returned some page for it): then nothing a reader returned is the company's, and it is a dead address.
 * A replay trusts what the live run (or probe_dead.ts) saw.
 */
export async function addressIsDead(website: string): Promise<boolean> {
  const host = hostKey(website);
  if (replayMode() !== "off") return persisted()[host] === "dead";
  if (process.env.VITEST || process.env.DNS_CHECK === "off") return false;   // tests fake every page: their made-up hosts do not resolve
  try { await (await import("dns/promises")).lookup(host); return false; }
  catch (e) { const code = (e as { code?: string }).code ?? ""; if (code === "ENOTFOUND") { persistReadFailure(website, "dead"); return true; } return false; }
}

export function homepageReadFailure(website: string): "service" | "dead" | "unreachable" | null {
  const kind = classifyReadFailure(website);
  if (replayMode() !== "off") return persisted()[hostKey(website)] ?? kind;   // a replay trusts what the live run saw
  if (kind) persistReadFailure(website, kind);
  return kind;
}
function classifyReadFailure(website: string): "service" | "dead" | "unreachable" | null {
  const f = readFailures.get(hostKey(website));
  if (!f) return null;
  const direct = f["direct"] ?? "";
  // dead: the name does not resolve, or the home page itself answers "not found" (a parked / unconnected address)
  if (/ENOTFOUND|EAI_NODATA|ECONNREFUSED|getaddrinfo|^HTTP (?:404|410)\b/i.test(direct)) return "dead";
  // unreachable: the server exists and does not answer in time, or its certificate fails (to try once more with a longer timeout; else for the owner's list)
  if (/TIMEOUT|ETIMEDOUT|ECONNRESET|ERR_TLS|CERT_|certificate/i.test(direct)) return "unreachable";
  const service = (x?: string) => !x || /^HTTP [45]\d\d$|abort|timeout|timed out|threw|fetch failed|empty page/i.test(x);
  return service(f["Jina Reader"]) && service(f["Serper scrape"]) ? "service" : null;
}

/** Jina Reader first; Serper scrape when Jina could not read it. */
/** The page straight from its server (no reader service between), as text. */
async function fetchDirect(url: string, ms = Number(process.env.DIRECT_TIMEOUT_MS ?? 10_000)): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; AlphaMapBot)", accept: "text/html,application/xhtml+xml" } }).finally(() => clearTimeout(timer));
    try { const fin = new URL(res.url); if (hostKey(res.url) !== hostKey(url)) redirects.set(hostKey(url), fin.origin); } catch { /* no final address */ }
    if (!res.ok) { lastFailure = `HTTP ${res.status}`; return null; }
    if (!/html|text/.test(res.headers.get("content-type") ?? "")) { lastFailure = `not a web page (${res.headers.get("content-type") ?? "no type"})`; return null; }
    const text = htmlToText(await res.text());
    if (!text) lastFailure = "empty page";
    return text || null;
  } catch (e) { lastFailure = describeFetchError(e); return null; }
}

/** The last snapshot of the page in the Internet Archive, as text (the site down, blocked, or empty to a reader). */
async function fetchFromArchive(url: string): Promise<string | null> {
  const text = await fetchDirect(`https://web.archive.org/web/2/${url}`, 15_000);
  return text ? text.replace(/^[\s\S]*?(?=\n#|\n[A-Z])/, "").trim() || text : null;
}

/**
 * Jina Reader, then Serper's scrape, then the page straight from its server, then the Internet Archive: the first that gives real content.
 * The reader services come first (the site's own server is not hit when they can read it); a site neither can read is tried directly, and then its last
 * archived snapshot (owner, 2026-11-15: Aerobotix, Aida, FlyTech and KrillTech could not be read).
 */
async function readPage(url: string, state: SearchProviderState, fallbacks = false): Promise<{ text: string; provider: Provider } | null> {
  const trail: string[] = [];
  const fail: Record<string, string> = {};
  const step = (name: string) => { fail[name] = lastFailure; trail.push(`${name} — ${lastFailure || "nothing"}`); lastFailure = ""; };
  lastFailure = "";
  if (!fallbacks && suspiciousUrl(url)) { console.log(`    🛑  ${url} is not read — a suspicious domain (a cheap top-level domain, an adult / gambling word, or the owner's blocked list).`); return null; }
  const viaJina = await fetchViaJinaReader(url, state);
  if (viaJina) return { text: viaJina, provider: "jina" };
  step("Jina Reader");
  if (componentOn("search_backup")) {
    const viaSerper = await fetchViaSerperScrape(url, state);
    if (viaSerper) return { text: viaSerper, provider: "serper_scrape" };
    step("Serper scrape");
  }
  // The direct read and the archive only for a site the readers could not read at all (its home page): a missing sub-page of a readable site is just missing.
  if (!fallbacks) return null;
  const direct = await fetchDirect(url);
  if (direct && looksLikeRealContent(direct)) return { text: direct, provider: "cheerio" };
  if (direct) lastFailure = `only ${direct.length} characters (a shell page or a block page)`;
  step("direct");
  const archived = await fetchFromArchive(url);
  if (archived && looksLikeRealContent(archived)) { console.log(`    🗄️  ${url} read from the Internet Archive (its last snapshot).`); return { text: archived, provider: "archive" }; }
  if (!lastFailure) lastFailure = archived ? "snapshot too short" : "no snapshot";
  step("Internet Archive");
  console.log(`    📡  ${url} could not be read — ${trail.join("; ")}.`);
  readFailures.set(hostKey(url), fail);
  return null;
}

/** One page's text, cached with the company's searches (press releases, legal pages — companyFacts.ts). */
export async function readPageCached(url: string, state: SearchProviderState): Promise<{ text: string; provider: Provider } | null> {
  const hit = state.cache?.get<{ content: string; provider: Provider }>(`page:${url}`);
  if (hit) return { text: hit.content, provider: hit.provider };
  const read = await readPage(url, state);
  if (read) state.cache?.set(`page:${url}`, { content: read.text, provider: read.provider });
  return read;
}

/** Tavily Extract, one call for several pages: each page's text by URL. Empty when Tavily is out or fails. */
async function tavilyExtractPages(urls: string[], state: SearchProviderState): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (state.tavilyExhausted || urls.length === 0) return out;
  try {
    const res = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, urls }),
    });
    if (res.status === 401 || res.status === 402 || res.status === 432) {
      state.tavilyExhausted = true;
      return out;
    }
    if (!res.ok) return out;
    const data = await res.json() as { results?: Array<{ url: string; raw_content?: string }> };
    for (const r of data.results ?? []) {
      if (r.raw_content) out.set(r.url, r.raw_content.replace(/\s+/g, " ").trim());
    }
    if (out.size > 0) state.tavilyCallCount++;
    return out;
  } catch {
    return out;
  }
}

/** Tavily's answer for one of the URLs asked: the same URL, or the same page with a trailing slash. */
function extractedFor(extracted: Map<string, string>, url: string): string | undefined {
  const bare = url.replace(/\/+$/, "");
  for (const [u, text] of extracted) if (u.replace(/\/+$/, "") === bare) return text;
  return undefined;
}

export interface FetchedPage {
  url: string; content: string; provider: Provider;
  /** What the model gets of the page (pageText.ts); `content` is the whole page. */
  prompt_content?: string;
  /** Pages of the site that rendered this same page (/contact → /about): the Contact page rule reads them (headquarters.ts). */
  also_urls?: string[];
  /** The organization links the site names (devLinks.ts), read from the whole page before the cap cut the footer off. */
  dev_links?: DevLinks;
}

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
 * Full text of third-party articles: Jina Reader first, Serper scrape for
 * what Jina could not read (it is down, or the page refused it), Tavily
 * Extract last if a key is set. Cleaned of images/link targets. null for an
 * article none read — the caller keeps the search snippet it already has.
 */
export async function fetchArticleTexts(urls: string[], state: SearchProviderState): Promise<Array<{ text: string | null; provider: Provider | null }>> {
  const out: Array<{ text: string | null; provider: Provider | null }> = urls.map(() => ({ text: null, provider: null }));
  const usable = (raw: string | null | undefined) => {
    if (!raw) return null;
    const text = cleanArticleText(raw);
    return looksLikeRealContent(text) ? text : null;
  };
  const unread: number[] = [];
  await Promise.all(urls.map(async (url, i) => {
    const cached = state.cache?.get<{ text: string; provider: Provider } | string>(`article:${url}`);
    if (cached) { out[i] = typeof cached === "string" ? { text: cached, provider: "jina" } : cached; return; }
    const jinaText = usable(await fetchViaJinaReader(url, state));
    if (jinaText) { out[i] = { text: jinaText, provider: "jina" }; return; }
    const serperText = componentOn("search_backup") ? usable(await fetchViaSerperScrape(url, state)) : null;
    if (serperText) out[i] = { text: serperText, provider: "serper_scrape" };
    else unread.push(i);
  }));
  if (unread.length > 0) {
    const extracted = await tavilyExtractPages(unread.map((i) => urls[i]), state);
    for (const i of unread) {
      const text = usable(extractedFor(extracted, urls[i]));
      if (text) out[i] = { text, provider: "tavily_extract" };
    }
  }
  urls.forEach((url, i) => { if (out[i].text) state.cache?.set(`article:${url}`, out[i]); });
  return out;
}

/**
 * Spec stage 2: home page plus /about, /team, /company, /contact "when they
 * exist" — each one its own [W#] source (not concatenated into one blob
 * like v1), so a quote can be traced to exactly which page it came from.
 * Jina Reader reads each candidate path (a real rendering proxy: handles
 * JS-rendered pages and basic anti-bot measures); Serper scrape reads a path
 * Jina could not. Tavily Extract, in one call, only when both got nothing
 * usable from the whole site and a key is set.
 * Everything is checked against looksLikeRealContent(), so a generic 404
 * page isn't counted as a real source whichever provider fetched it.
 */
/** Per site: how many pages its sitemap offered and how many pages were read (for the run's trace table). */
export const sitemapStats = new Map<string, { found: number; read: number }>();

/**
 * The sitemap's pages worth reading (sitemap.ts), cached per site; [] when the site has none. Read through the page readers like every page of the company's site — never a direct
 * fetch (providerOrder.test.ts) — so what comes back is text: the addresses are taken from it whether or not the XML tags survived.
 */
async function sitemapPagesFor(root: string, state: SearchProviderState): Promise<string[]> {
  let origin: string;
  try { origin = new URL(root).origin; } catch { return []; }
  const key = `sitemap:${origin}`;
  const cached = state.cache?.get<string[]>(key);
  if (cached) return cached;
  const get = async (url: string): Promise<string | null> => (await readPage(url, state, false))?.text ?? null;
  const addresses = (text: string): { kind: "urlset" | "index"; urls: string[] } => {
    const parsed = parseSitemap(text);
    if (parsed.urls.length) return parsed;
    // The reader turned the XML into text: every address in it is one.
    return { kind: /sitemap[^\s]*\.xml/i.test(text) && !/<urlset/i.test(text) ? "index" : "urlset", urls: [...new Set((text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? []).map((u) => u.replace(/[.,;]+$/, "")))] };
  };
  const urls: string[] = [];
  const read = async (smUrl: string, depth = 0): Promise<void> => {
    if (urls.length > 5000 || depth > 1) return;
    const text = await get(smUrl);
    if (!text || text.length < 40) return;
    const parsed = addresses(text);
    const isMap = (u: string) => /\.xml(\?|$)/i.test(u) && /sitemap/i.test(u);
    const kids = parsed.urls.filter(isMap);
    if (kids.length && depth === 0) {
      for (const k of kids.filter((u) => !/(product|image|video|post|blog|article|category|tag)/i.test(u)).slice(0, 3)) await read(k, depth + 1);
    }
    urls.push(...parsed.urls.filter((u) => !isMap(u)));
  };
  await read(`${origin}/sitemap.xml`);
  if (!urls.length) {
    const robots = await get(`${origin}/robots.txt`);
    for (const sm of robots ? robotsSitemaps(robots).slice(0, 2) : []) await read(sm);
  }
  const picked = urls.length ? pickSitePages(urls, root) : [];
  state.cache?.set(key, picked);
  return picked;
}

/** A candidate site's home page and its /about, nothing else (the dead-domain check, owner 2026-11-23): their texts joined; null when neither could be read. */
export async function fetchHomeAndAbout(website: string, state: SearchProviderState): Promise<string | null> {
  const root = (website.startsWith("http") ? website : `https://${website}`).replace(/\/+$/, "");
  const texts: string[] = [];
  for (const path of ["", "/about"]) {
    const url = root + path;
    const cached = state.cache?.get<{ content: string; provider: Provider }>(`page:${url}`);
    const read = cached ? { text: cached.content, provider: cached.provider } : await readPage(url, state, true);
    if (read && looksLikeRealContent(read.text)) { texts.push(read.text); if (!cached) state.cache?.set(`page:${url}`, { content: read.text, provider: read.provider }); }
  }
  return texts.length ? texts.join("\n\n") : null;
}

export async function fetchCompanyWebsitePages(
  website: string | null | undefined,
  state: SearchProviderState,
): Promise<FetchedPage[]> {
  if (!website) return [];
  let root = website.startsWith("http") ? website : `https://${website}`;
  // The company's own pages are read on every run, whatever the search finds (owner, 2026-11-14): home, about, team / leadership, contact, news / press, and customers / solutions / industries / products / platform (where "for whom" is usually written).
  const candidatePaths = ["", "/about", "/about-us", "/team", "/leadership", "/company", "/contact", "/contact-us", "/news", "/press", "/newsroom", "/imprint", "/impressum", "/legal"];   // owner, 2026-11-23: no product, customer, solution or platform pages
  let urls = candidatePaths.map((path) => root.replace(/\/+$/, "") + path);
  const pages: FetchedPage[] = [];

  const fetched = new Map<string, { content: string; provider: Provider; cached: boolean }>();
  // The registered address may lead elsewhere (tymebank.co.za → gotyme.co.za): the reader names where the home page ended, and the fixed pages are read there.
  const finalOriginIn = (text: string): string | null => {
    const m = text.slice(0, 1500).match(/(?:Final URL|URL Source):\s*(https?:\/\/[^\s]+)/i)?.[1];
    try { return m ? new URL(m).origin : null; } catch { return null; }
  };
  const bare = (h: string) => h.replace(/^www\./, "");
  const home = urls[0];
  const cachedHome = state.cache?.get<{ content: string; provider: Provider }>(`page:${home}`);
  const homeRead = cachedHome ? { text: cachedHome.content, provider: cachedHome.provider } : await readPage(home, state, true);
  // The home page could not be read and the reason is conclusive (the name does not resolve, the server does not answer, the readers fail): the other fixed pages and the sitemap are not tried one by one
  // (batch 8: nine dead sites cost seven failed reads each, and two slow ones ran past the ten minutes of a company).
  if (!homeRead && homepageReadFailure(root)) { console.log(`    ⛔  ${root} could not be read (${homepageReadFailure(root)}): its other pages are not tried.`); return []; }
  const needFallbacks = homeRead?.provider === "cheerio" || homeRead?.provider === "archive";
  if (homeRead) {
    const origin = finalOriginIn(homeRead.text);
    if (origin && bare(new URL(origin).hostname) !== bare(new URL(root).hostname)) {
      console.log(`    🔀  ${root} leads to ${origin}: its pages are read there.`);
      redirects.set(hostKey(root), origin);
      root = origin; urls = candidatePaths.map((path) => root.replace(/\/+$/, "") + path);
    } else if (looksLikeRealContent(homeRead.text)) {
      fetched.set(home, { content: homeRead.text, provider: homeRead.provider, cached: !!cachedHome });
      if (!cachedHome) state.cache?.set(`page:${home}`, { content: homeRead.text, provider: homeRead.provider });
    }
  }
  // The site's own sitemap (owner, round 10): sitemap.xml, or the Sitemap line of robots.txt; the pages whose path says about / team / leadership / contact / press / news / careers /
  // impressum / legal / investors (and the same words in the site's language) replace the fixed list, at most 12 pages. No sitemap: the fixed list stays.
  let sitemapFound = 0;
  if (process.env.SITEMAP !== "off") {
    const fromMap = await sitemapPagesFor(root, state);
    if (fromMap.length) {
      const next = [urls[0], ...fromMap.filter((u) => u.replace(/\/+$/, "") !== urls[0].replace(/\/+$/, ""))].slice(0, MAX_SITE_PAGES);
      console.log(`    🗺️   sitemap: ${fromMap.length} page(s) chosen (${next.length} read, cap ${MAX_SITE_PAGES}) instead of the ${urls.length} fixed addresses.`);
      urls = next;
      sitemapFound = fromMap.length;
    }
  }
  // Sixteen addresses on a site that does not answer would cost minutes: after four misses in a row the rest of the pages are not tried.
  let misses = 0;
  for (const url of urls) {
    if (fetched.has(url)) continue;
    const cachedPage = state.cache?.get<{ content: string; provider: Provider }>(`page:${url}`);
    if (cachedPage) { fetched.set(url, { ...cachedPage, cached: true }); misses = 0; continue; }
    if (misses >= 4) continue;
    const read = await readPage(url, state, needFallbacks);
    if (read && looksLikeRealContent(read.text)) { fetched.set(url, { content: read.text, provider: read.provider, cached: false }); misses = 0; }
    else misses++;
  }
  if (fetched.size === 0) {
    // Neither Jina nor Serper got anything from this site: Tavily Extract, one call.
    const extracted = await tavilyExtractPages(urls, state);
    for (const url of urls) {
      const text = extractedFor(extracted, url);
      if (text) fetched.set(url, { content: text, provider: "tavily_extract", cached: false });
    }
  }

  for (const url of urls) {
    const page = fetched.get(url);
    if (!page) continue;
    const { content, provider } = page;
    const cachedPage = page.cached;
    if (!looksLikeRealContent(content)) {
      state.websitePagesSkippedThin++;
      console.warn(`    ⚠️  thin/404-like page for ${url} (${content.length} chars, ${provider}) — skipping, not counted as a real source.`);
      continue;
    }
    if (!cachedPage) state.cache?.set(`page:${url}`, { content, provider });
    const capped = content.slice(0, MAX_PAGE_STORED);
    // /team, /company and /contact often redirect to (or render) the same
    // page as /about or the homepage — sending it again only costs tokens.
    const duplicateOf = pages.find((p) => isNearDuplicatePage(p.content, capped));
    if (duplicateOf) {
      state.websitePagesDuplicate++;
      duplicateOf.also_urls = [...(duplicateOf.also_urls ?? []), url];
      console.log(`    ♻️   ${url} is the same page as ${duplicateOf.url} — not sent twice.`);
      continue;
    }
    state.websitePagesFetched++;
    const sent = promptText(capped, MAX_WEBSITE_CHARS);
    pages.push({ url, content: capped, prompt_content: sent, provider, dev_links: devLinksFromText(content) });
    console.log(`    🌐  fetched ${url} (${content.length} chars, ${provider}${cachedPage ? ", cached" : ""}; ${sent.length} sent to the model)`);
  }
  if (sitemapFound) sitemapStats.set(root.replace(/\/+$/, ""), { found: sitemapFound, read: pages.length });
  return pages;
}
