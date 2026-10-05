/**
 * lib/enrichment/ogImage.ts — a news article's own og:image / twitter:image,
 * same technique as v1's fetchArticleOgImage() (scripts/bulk_enrich_all.ts).
 * The article's full-size share image looks right on a News card; a search
 * thumbnail is blurry once stretched. Best-effort: any failure returns null.
 */

import * as cheerio from "cheerio";

const OG_FETCH_TIMEOUT_MS = 8_000;

export function parseOgImage(html: string, pageUrl: string): string | null {
  const $ = cheerio.load(html);
  const raw = $('meta[property="og:image"]').attr("content")
    ?? $('meta[name="twitter:image"]').attr("content")
    ?? $('meta[property="twitter:image"]').attr("content");
  if (!raw) return null;
  try {
    return new URL(raw, pageUrl).toString();
  } catch {
    return null;
  }
}

export async function fetchArticleOgImage(articleUrl: string): Promise<string | null> {
  if (!articleUrl) return null;
  const url = articleUrl.startsWith("http") ? articleUrl : `https://${articleUrl}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OG_FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AlphaMapEnrichmentBot/1.0; +https://alphamap.app)",
        Accept: "text/html",
      },
    }).finally(() => clearTimeout(timer));
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return null;
    return parseOgImage(await res.text(), res.url || url);
  } catch {
    return null;
  }
}
