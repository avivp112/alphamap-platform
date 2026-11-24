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
/** null when there is too little text to tell (a profile under 6 content words, a site under 40). */
export function identityOverlap(profileText: string, siteText: string, cut = IDENTITY_CUT): IdentityOverlap | null {
  const p = words(profileText), s = words(siteText);
  if (p.size < 6 || s.size < 40) return null;
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
