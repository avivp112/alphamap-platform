/**
 * lib/enrichment/searchProviders.ts — v2's Serper/Tavily/Jina calling code.
 * Ground rule 4: "keep the current providers... do not add or remove
 * providers without an explicit request." Same endpoints, same retry/
 * backoff behavior, same timeouts as v1's private serperSearch/
 * tavilySearch/fetchViaJinaReader/fetchCompanyWebsite/verifyDomainMatch
 * (duplicated rather than imported — v1 is frozen, same reasoning as
 * sanitize.ts).
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SearchProviderState {
  serperCallCount: number;
  tavilyCallCount: number;
  tavilyExhausted: boolean;
  jinaAttemptCount: number;
  jinaSuccessCount: number;
  /** Jina returned HTTP 200 + non-empty text, but it was a thin/404-style
   *  page for a guessed path (/team, /company, /contact) that doesn't
   *  actually exist on the site — see looksLikeRealContent(). Tracked
   *  separately from jinaSuccessCount so a run can tell "Jina is failing"
   *  apart from "Jina is succeeding but half of what it fetches is junk". */
  jinaJunkCount: number;
}

export function createSearchProviderState(): SearchProviderState {
  return {
    serperCallCount: 0, tavilyCallCount: 0,
    tavilyExhausted: !process.env.TAVILY_API_KEY,
    jinaAttemptCount: 0, jinaSuccessCount: 0, jinaJunkCount: 0,
  };
}

const NOT_FOUND_PHRASES_RE = /\b(404(?:\s+error)?|page not found|(?:this\s+)?page (?:could not|couldn'?t) be found|we can'?t find (?:that|this) page|doesn'?t exist|does not exist|oops[,!]?\s*(?:this\s+)?page)\b/i;
// A real page is almost never this short once Jina strips boilerplate/markup;
// most "guessed" subpaths (/team, /company, /contact) that don't exist on a
// given site resolve to a generic platform 404 that Jina happily converts to
// clean, non-empty markdown -- HTTP 200, no error, no empty string, just
// useless. A real DRY_RUN=false batch showed this exact pattern: completely
// different companies' /about, /team, /company, /contact pages all coming
// back at 150-250 chars (near-identical boilerplate sizes), while every real
// homepage fetch was 1,000+ chars.
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
    return results;
  } catch (err) {
    console.warn(`    ⚠️  Serper threw: ${String(err)}`);
    return [];
  }
}

// ── Tavily (FALLBACK ONLY — never tried first) ─────────────────────────────

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
    return results;
  } catch (err) {
    console.warn(`    ⚠️  Tavily threw: ${String(err)}`);
    return [];
  }
}

/** Stage 1 -> Stage 4: Serper first, unconditionally; Tavily only when Serper returned nothing. */
export async function webSearch(query: string, queryLabel: string, state: SearchProviderState): Promise<RawSearchResult[]> {
  const r = await serperSearch(query, queryLabel, state);
  if (r.length > 0) return r;
  return tavilySearch(query, queryLabel, state);
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

async function fetchViaJinaReader(url: string, state: SearchProviderState): Promise<string | null> {
  state.jinaAttemptCount++;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
    const headers: Record<string, string> = { Accept: "text/plain" };
    if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;

    const res = await fetch(`https://r.jina.ai/${url}`, { signal: controller.signal, headers }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      console.warn(`    ⚠️  Jina Reader HTTP ${res.status} for ${url} — falling back to Tavily/cheerio.`);
      return null;
    }
    const text = (await res.text()).trim();
    if (!text) {
      console.warn(`    ⚠️  Jina Reader returned empty content for ${url} — falling back to Tavily/cheerio.`);
      return null;
    }
    if (!looksLikeRealContent(text)) {
      state.jinaJunkCount++;
      console.warn(`    ⚠️  Jina Reader got a thin/404-like page for ${url} (${text.length} chars) — skipping, not counted as a real source.`);
      return null;
    }
    state.jinaSuccessCount++;
    return text.slice(0, MAX_WEBSITE_CHARS);
  } catch (err) {
    console.warn(`    ⚠️  Jina Reader threw for ${url}: ${String(err)} — falling back to Tavily/cheerio.`);
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

/**
 * Spec stage 2: home page plus /about, /team, /company, /contact "when they
 * exist" — each one its own [W#] source (not concatenated into one blob
 * like v1), so a quote can be traced to exactly which page it came from.
 * Jina primary, Tavily Extract fallback (home+/about only, matching v1 —
 * Tavily Extract is billed per URL), cheerio last resort on the home page.
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
    const viaJina = await fetchViaJinaReader(url, state);
    if (viaJina) {
      pages.push({ url, content: viaJina, provider: "jina" });
      console.log(`    🌐  Jina Reader: fetched ${url} (${viaJina.length} chars)`);
    }
  }
  if (pages.length > 0) return pages;

  // Jina got nothing for ANY candidate page — fall back to Tavily Extract on
  // home+/about (one call, matching v1), then cheerio on the home page alone.
  if (!state.tavilyExhausted) {
    const aboutUrl = root.replace(/\/+$/, "") + "/about";
    const extracted = await tavilyExtractUrls([root, aboutUrl], state);
    if (extracted) return [{ url: root, content: extracted, provider: "tavily_extract" }];
  }

  const viaCheerio = await cheerioFetch(root);
  if (viaCheerio) return [{ url: root, content: viaCheerio, provider: "cheerio" }];

  return [];
}
