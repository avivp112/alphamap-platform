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

import type { Provider, RawSearchResult } from "./sources";
import { websiteDomain } from "./websiteValidation";
import type { SearchCache } from "./searchCache";
import { cleanArticleText } from "./articles";
import { componentOn } from "./components";

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
  /** Jina Search answers (Serper's backup / deep-dive partner) and Serper scrape reads (Jina Reader's backup). */
  jinaSearchCallCount?: number;
  serperScrapeCount?: number;
  /** Search calls made, and those that failed (network error, timeout, HTTP 5xx) — not "no results". */
  searchAttempts?: number;
  searchFailures?: number;
}

/** Most of this company's searches failed: an outage, not a company with nothing about it. */
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
  if (cached) return { results: cached.map((r) => ({ ...r, query_label: queryLabel })), failed: false };
  state.searchAttempts = (state.searchAttempts ?? 0) + 1;
  try {
    const res = await fetch(`https://google.serper.dev/${endpoint}`, {
      method: "POST",
      headers: { "X-API-KEY": process.env.SERP_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 10, autocorrect: false }),
    });

    if (res.status === 429 && attempt < 3) {
      const wait = 10_000 * 2 ** attempt;
      console.warn(`    ⚠️  ${name} 429 — waiting ${wait / 1000}s (retry ${attempt + 1}/3)…`);
      await sleep(wait);
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

export async function webSearch(query: string, queryLabel: string, state: SearchProviderState, opts: SearchOptions = {}): Promise<RawSearchResult[]> {
  return searchWithBackup(await serperCall("search", query, queryLabel, state), query, query, queryLabel, state, opts);
}

/**
 * The "news" query: Serper's dedicated News API (a plain "name + anchor news"
 * query) first; Jina Search backs it up and joins going deeper with the
 * general query, on the same terms as webSearch.
 */
export async function newsSearch(
  newsQuery: string, generalQuery: string, queryLabel: string, state: SearchProviderState, opts: SearchOptions = {},
): Promise<RawSearchResult[]> {
  return searchWithBackup(await serperCall("news", newsQuery, queryLabel, state), generalQuery, generalQuery, queryLabel, state, opts);
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

const JINA_TIMEOUT_MS = 15_000;
const MAX_WEBSITE_CHARS = 6_000; // spec stage 2: "cap content per page (for example 6,000 characters)" -- raised from v1's 3,000 now that each page is its own labeled [W#] source rather than one slot in a single shared context budget

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

async function fetchViaJinaReader(url: string, state: SearchProviderState): Promise<string | null> {
  if (jinaDisabled()) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
    const headers: Record<string, string> = { Accept: "text/plain" };
    if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;

    const res = await fetch(`https://r.jina.ai/${url}`, { signal: controller.signal, headers }).finally(() => clearTimeout(timer));
    if (res.status === 402 || res.status === 401) {
      disableJina(res.status);
      return null;
    }
    if (!res.ok) {
      console.warn(`    ⚠️  Jina Reader HTTP ${res.status} for ${url} — Serper may read it instead.`);
      return null;
    }
    const text = (await res.text()).trim();
    if (!text) {
      console.warn(`    ⚠️  Jina Reader returned empty content for ${url} — Serper may read it instead.`);
      return null;
    }
    return text;
  } catch (err) {
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
      console.warn(`    ⚠️  Serper scrape HTTP ${res.status} for ${url}`);
      return null;
    }
    const text = parseSerperScrape(await res.json() as { text?: string; markdown?: string });
    if (text) state.serperScrapeCount = (state.serperScrapeCount ?? 0) + 1;
    return text;
  } catch (err) {
    console.warn(`    ⚠️  Serper scrape threw for ${url}: ${describeFetchError(err)}`);
    return null;
  }
}

/** Jina Reader first; Serper scrape when Jina could not read it. */
async function readPage(url: string, state: SearchProviderState): Promise<{ text: string; provider: Provider } | null> {
  const viaJina = await fetchViaJinaReader(url, state);
  if (viaJina) return { text: viaJina, provider: "jina" };
  if (!componentOn("search_backup")) return null;
  const viaSerper = await fetchViaSerperScrape(url, state);
  return viaSerper ? { text: viaSerper, provider: "serper_scrape" } : null;
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
export async function fetchCompanyWebsitePages(
  website: string | null | undefined,
  state: SearchProviderState,
): Promise<FetchedPage[]> {
  if (!website) return [];
  const root = website.startsWith("http") ? website : `https://${website}`;
  const candidatePaths = ["", "/about", "/team", "/company", "/contact"];
  const urls = candidatePaths.map((path) => root.replace(/\/+$/, "") + path);
  const pages: FetchedPage[] = [];

  const fetched = new Map<string, { content: string; provider: Provider; cached: boolean }>();
  for (const url of urls) {
    const cachedPage = state.cache?.get<{ content: string; provider: Provider }>(`page:${url}`);
    if (cachedPage) { fetched.set(url, { ...cachedPage, cached: true }); continue; }
    const read = await readPage(url, state);
    if (read && looksLikeRealContent(read.text)) fetched.set(url, { content: read.text, provider: read.provider, cached: false });
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
  return pages;
}
