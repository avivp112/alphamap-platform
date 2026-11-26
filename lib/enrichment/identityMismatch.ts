/**
 * lib/enrichment/identityMismatch.ts — does the profile the search gave describe the company whose site we read? (owner, 2026-11-24: Aperio — the search profile described an industrial data-quality company,
 * the site on file is a digital pathology company.) The share of the profile's content words (4+ letters, no common words) that the company's own pages also use. Pure, no model.
 * Under IDENTITY_CUT with enough words on both sides, the profile is not about the site's company.
 */
export const IDENTITY_CUT = 0.25;
const STOP = new Set("that with from this their which they have been into also more than other such these those about company companies business provides provide offers offer platform services service solutions solution based using used help helps allows allow including include customers customer software technology products product global leading".split(" "));
const stem = (w: string) => w.replace(/(?:ing|ies|es|s)$/, "");
const words = (t: string): Set<string> => new Set((t.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !STOP.has(w)).map(stem).filter((w) => w.length >= 3));

export interface IdentityOverlap { share: number; profileWords: number; siteWords: number; mismatch: boolean }
/** A page that is no page of the company: an error or a block page (owner, 2026-11-24: Lendbox's Cloudflare 403). */
export const looksLikeErrorPage = (t: string): boolean => /attention required|cloudflare|403 forbidden|access denied|just a moment|checking your browser|enable javascript and cookies|target url returned error (?:4|5)\d\d/i.test(t.slice(0, 800));
export const MIN_ENGLISH = 0.15;
/**
 * null when there is no verdict: too little text (a profile under 6 content words, a site under 40), a site that is not in English (the share of common English words under MIN_ENGLISH — a word overlap with an
 * English profile then says nothing about identity: Polish, Chinese, Japanese, Swedish, Portuguese and German sites were all flagged by it), or a page that is an error / block page.
 */
export function identityOverlap(profileText: string, siteText: string, cut = IDENTITY_CUT): IdentityOverlap | null {
  const p = words(profileText), s = words(siteText);
  if (p.size < 6 || s.size < 40) return null;
  if (looksLikeErrorPage(siteText) || englishShare(siteText) < MIN_ENGLISH) return null;
  let n = 0; for (const w of p) if (s.has(w)) n++;
  const share = n / p.size;
  return { share, profileWords: p.size, siteWords: s.size, mismatch: share < cut };
}

const EN_STOP = new Set("the and of to in for with is are our you we your that this on by as at from it be or an a can all more not have has will they their which who what how why when where about into over than its but".split(" "));
/** The share of a text's words that are common English words: a site in another language has a low one, and then a word overlap with an English profile says nothing about identity. */
export function englishShare(text: string): number {
  const toks = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (toks.length < 30) return 0;
  return toks.filter((w) => EN_STOP.has(w)).length / toks.length;
}

/** The company's own pages as the "about" of the entity check: markdown and addresses taken out, the first 600 characters. */
export function identityAbout(siteText: string): string {
  return siteText.replace(/https?:\/\/\S+/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\b(?:Title|URL Source|Final URL|Markdown Content|Published Time):/g, " ").replace(/[#*_`>|\[\]()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
}
