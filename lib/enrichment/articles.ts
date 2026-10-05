/**
 * lib/enrichment/articles.ts — which search results are worth reading in
 * full (free, via Jina Reader) instead of only their ~600-character
 * snippet. A funding announcement read in full usually carries the exact
 * date, every participating investor, headcount and the "About" boilerplate
 * (founding year, HQ) — facts a snippet cuts off, which otherwise cost a
 * Stage 9 deep dive (more searches + another Claude call) to recover.
 *
 * Picked: third-party articles that name the company, preferring funding /
 * acquisition / launch news. Never profile directories (their pages are
 * login walls or already fully represented by the snippet), social sites,
 * patents, or the company's own site (fetched separately).
 */

import type { RawSearchResult } from "./sources";
import { namesCompany } from "./headcount";

const SKIP_HOSTS = [
  "crunchbase.com", "linkedin.com", "pitchbook.com", "tracxn.com", "cbinsights.com", "dealroom.co", "zoominfo.com",
  "owler.com", "g2.com", "capterra.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "youtube.com",
  "reddit.com", "tiktok.com", "patents.google.com", "glassdoor.com", "indeed.com", "apollo.io", "rocketreach.co",
];

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

const EVENT_RE = /\b(rais(e|es|ed|ing)|funding|series [a-k]\b|seed round|pre-seed|investment|invest(s|ed)|acquir(e|es|ed|ition)|valuation|valued at|launch(es|ed)?|partners? with)\b/i;
const FUNDING_LABELS = new Set(["funding", "funding_db", "financials", "news", "acquisitions"]);

export function pickArticlesToRead(
  results: RawSearchResult[],
  companyName: string,
  companyDomain: string | null,
  k = 4,
): RawSearchResult[] {
  const seen = new Set<string>();
  const scored: Array<{ r: RawSearchResult; score: number; i: number }> = [];
  results.forEach((r, i) => {
    if (r.provider !== "serper" && r.provider !== "tavily") return;
    const host = hostOf(r.url);
    if (!host) return;
    if (SKIP_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return;
    if (companyDomain && (host === companyDomain || host.endsWith(`.${companyDomain}`))) return;
    const key = `${host}${(() => { try { return new URL(r.url).pathname.replace(/\/+$/, ""); } catch { return ""; } })()}`;
    if (seen.has(key)) return;
    const text = `${r.title ?? ""} ${r.content}`;
    if (!namesCompany(text, companyName)) return;
    seen.add(key);
    let score = 0;
    if (EVENT_RE.test(text)) score += 3;
    if (FUNDING_LABELS.has(r.query_label)) score += 2;
    if (/\bDate:/.test(r.content)) score += 1;
    if (r.title && namesCompany(r.title, companyName)) score += 1;
    scored.push({ r, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, k).map((s) => s.r);
}

/** Jina Reader markdown -> plain prose: images and link targets dropped, blank runs collapsed. */
export function cleanArticleText(markdown: string, maxChars = 7000): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^(Title|URL Source|Markdown Content|Published Time):.*$/gim, (line) => (/^Published Time:/i.test(line) ? line : ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, maxChars);
}
