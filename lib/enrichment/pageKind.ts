/**
 * lib/enrichment/pageKind.ts — pages that say nothing about what a company does (owner, 2026-11-09, review 7).
 * A privacy policy, terms of use, glossary entry, help article, career page or wiki tutorial was the "source" of tags
 * (Pentera's Data Security from /privacy, SafetyCulture's from its terms, DealHub's from a glossary of ARR).
 */
const NON_DESCRIPTIVE = /\/(?:privacy|privacy-policy|terms|terms-and-conditions|terms-of-use|terms-of-service|tos|cookies?|cookie-policy|legal|impressum|gdpr|dpa|disclaimer|security-policy|glossary|careers?|jobs?|open-positions|help|help_|support|docs?|kb|knowledge-base|tutorials?|wiki|faq|sitemap|login|signin|sign-up|unsubscribe)(?:[/_-]|$|\?)|\bkb\.|\/user-guide\/|\/help_\//i;
export function isNonDescriptivePage(url: string | null | undefined): boolean {
  if (!url) return false;
  try { const u = new URL(url); return NON_DESCRIPTIVE.test(`${u.hostname.startsWith("kb.") ? "kb." : ""}${u.pathname}`) || /^(?:kb|help|support|docs)\./i.test(u.hostname); } catch { return false; }
}

/**
 * A page that is not an article (owner, round 10): a tag / topic / category / author / search or listing page (financemagnates.com/tag/…, cision.com/…?k=…),
 * and sponsored content (businessinsider.com/sc/…). Its address is no source for a news item or a value.
 */
export function isListingOrSponsoredUrl(url: string | null | undefined): "listing_page" | "sponsored_content" | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url.startsWith("http") ? url : `https://${url}`); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)businessinsider\.com$/.test(host) && /^\/sc(?:\/|$)/i.test(u.pathname)) return "sponsored_content";
  if (/\/(?:tags?|topics?|authors?|search|labels?|keywords?)(?:\/[^/]+)?\/?$/i.test(u.pathname)) return "listing_page";
  for (const k of ["k", "s", "q", "query", "search", "tag", "keyword"]) if (u.searchParams.has(k)) return "listing_page";
  return null;
}
