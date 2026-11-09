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
