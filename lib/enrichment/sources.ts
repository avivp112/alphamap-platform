/**
 * lib/enrichment/sources.ts — builds the labeled source list (S1…Sn,
 * W1…Wn) that extract.ts's prompts are built from, per
 * docs/enrichment_v2_spec.md issue 1 point 1 and issue 15.
 *
 * Every search result and every fetched website page gets a short id
 * ("S3", "W1") so extract.ts can ask Claude to cite exactly which source
 * backs each material field, and evidence.ts can later look that source
 * back up to verify the citation. source_type classification feeds both
 * confidence.ts (issue 9) and write.ts's overwrite ranking (issue 3), and
 * is what lets the run summary show "share of fields whose only source is
 * aggregator_snippet" (issue 15).
 */

import type { SourceType } from "./sourceTypes";

export type Provider = "serper" | "tavily" | "jina" | "tavily_extract" | "cheerio";

const REGISTRY_HOSTS = new Set([
  "sec.gov", "www.sec.gov", "efts.sec.gov",
  "find-and-update.company-information.service.gov.uk", "companieshouse.gov.uk",
]);

const AGGREGATOR_HOSTS = new Set([
  "crunchbase.com", "www.crunchbase.com", "news.crunchbase.com",
  "pitchbook.com", "www.pitchbook.com",
  "linkedin.com", "www.linkedin.com",
  "tracxn.com", "www.tracxn.com",
  "cbinsights.com", "www.cbinsights.com",
  "dealroom.co", "www.dealroom.co",
]);

const PRESS_RELEASE_HOSTS = new Set([
  "prnewswire.com", "www.prnewswire.com",
  "businesswire.com", "www.businesswire.com",
  "globenewswire.com", "www.globenewswire.com",
]);

function hostnameOf(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function bareHost(host: string): string {
  return host.replace(/^www\./, "");
}

/**
 * Classifies one URL's source_type. `companyDomain` (the company's own
 * verified domain, no protocol/www) is required to recognize company_site —
 * that classification is inherently company-specific, not inferable from a
 * generic domain list. Falls back to "news" for anything not otherwise
 * classified — a deliberately open catch-all for genuine direct-reporting
 * outlets (TechCrunch, Reuters, Bloomberg, regional trade press, etc.)
 * rather than an exhaustive, high-maintenance news-domain whitelist.
 */
export function classifySourceType(url: string, companyDomain?: string | null): SourceType {
  const host = hostnameOf(url);
  if (!host) return "news";

  if (companyDomain) {
    const domain = companyDomain.toLowerCase().replace(/^www\./, "");
    if (bareHost(host) === domain || bareHost(host).endsWith(`.${domain}`)) return "company_site";
  }
  if (REGISTRY_HOSTS.has(host) || REGISTRY_HOSTS.has(bareHost(host))) return "registry";
  if (AGGREGATOR_HOSTS.has(host) || AGGREGATOR_HOSTS.has(bareHost(host))) return "aggregator_snippet";
  if (PRESS_RELEASE_HOSTS.has(host) || PRESS_RELEASE_HOSTS.has(bareHost(host))) return "press_release";
  return "news";
}

export interface RawSearchResult {
  url: string;
  title?: string;
  /** Snippet text (search result) or full page content (website fetch). */
  content: string;
  provider: Provider;
  /** Which query produced this, e.g. "history", "amounts", "backers", "profile", "website" — matches v1's section labels. */
  query_label: string;
}

export interface LabeledSource extends RawSearchResult {
  source_id: string;
  source_type: SourceType;
}

const WEBSITE_PROVIDERS = new Set<Provider>(["jina", "tavily_extract", "cheerio"]);

/**
 * Assigns "S1", "S2", ... to search-engine results and "W1", "W2", ... to
 * fetched website pages, in input order, and classifies each one's
 * source_type. Input order should match v1's existing query order so a
 * human reading S3 in a stored evidence row can tell which query section it
 * came from via query_label without needing to reverse-engineer anything.
 */
export function buildLabeledSources(raw: RawSearchResult[], companyDomain?: string | null): LabeledSource[] {
  let sCounter = 0;
  let wCounter = 0;
  return raw.map((r) => {
    const isWebsite = WEBSITE_PROVIDERS.has(r.provider);
    const source_id = isWebsite ? `W${++wCounter}` : `S${++sCounter}`;
    return { ...r, source_id, source_type: classifySourceType(r.url, companyDomain) };
  });
}

/** Renders the labeled sources into the "[S3] https://...\n<content>" blocks extract.ts's prompts embed. */
export function formatSourcesForPrompt(sources: LabeledSource[]): string {
  return sources
    .map((s) => `[${s.source_id}] ${s.url}${s.title ? `\n${s.title}` : ""}\n${s.content}`)
    .join("\n---\n");
}

/** For the run summary (issue 15): share of the given source_ids whose source_type is aggregator_snippet. */
export function aggregatorOnlyShare(sourceIds: string[], sources: LabeledSource[]): number {
  if (sourceIds.length === 0) return 0;
  const byId = new Map(sources.map((s) => [s.source_id, s]));
  const aggregatorCount = sourceIds.filter((id) => byId.get(id)?.source_type === "aggregator_snippet").length;
  return aggregatorCount / sourceIds.length;
}

/**
 * The same URL returned by several of the ~11 queries (a company's
 * Crunchbase page, its funding announcement) used to reach Claude once per
 * query — the same page billed as several sources. Merged here into one
 * source per URL; snippets that add something are kept (joined), exact or
 * contained repeats are dropped. Website pages are never touched.
 */
export function mergeDuplicateResults(results: RawSearchResult[]): { results: RawSearchResult[]; merged: number } {
  const keyOf = (url: string) => {
    try {
      const u = new URL(url);
      return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      return url.trim().toLowerCase();
    }
  };
  const byKey = new Map<string, RawSearchResult>();
  const out: RawSearchResult[] = [];
  let merged = 0;
  for (const r of results) {
    if (WEBSITE_PROVIDERS.has(r.provider)) { out.push(r); continue; }
    const key = keyOf(r.url);
    const first = byKey.get(key);
    if (!first) {
      const copy = { ...r };
      byKey.set(key, copy);
      out.push(copy);
      continue;
    }
    merged++;
    const snippet = r.content.trim();
    if (snippet && !first.content.includes(snippet)) first.content = `${first.content} … ${snippet}`;
    if (!first.title && r.title) first.title = r.title;
  }
  return { results: out, merged };
}
