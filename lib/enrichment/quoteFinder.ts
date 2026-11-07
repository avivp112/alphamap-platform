/**
 * lib/enrichment/quoteFinder.ts — the sentence of a source that best supports a text (owner, 2026-11-07).
 * The description, the sector and the tags have source ids but no quote of their own; the review sheet
 * shows the source's own sentence that carries the most of their words, so the marker can check the value.
 * Pure. An extractive quote only: it is shown to the marker, never used to verify the value.
 */

const STOP = new Set(["that", "this", "with", "from", "their", "which", "have", "been", "into", "also", "more", "than", "such", "about", "company", "platform", "provides", "helps", "uses", "using"]);
export const contentWords = (s: string): string[] => (s.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !STOP.has(w));

export function sentencesOf(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((s) => s.trim()).filter((s) => s.length >= 25 && s.length <= 400);
}

/** The sentence with the most distinct words in common with `terms` (at least `min`), or null. */
export function bestSentence(content: string, terms: string, min = 2): string | null {
  const want = new Set(contentWords(terms));
  if (!want.size) return null;
  let best: { s: string; n: number } | null = null;
  for (const s of sentencesOf(content)) {
    const have = new Set(contentWords(s));
    let n = 0;
    for (const w of want) if (have.has(w)) n++;
    if (n >= Math.min(min, want.size) && (!best || n > best.n)) best = { s, n };
  }
  return best?.s ?? null;
}

/** The best sentence over several sources: { id, quote } of the source whose sentence scores highest. */
export function bestQuote(sources: Array<{ id: string; content: string }>, terms: string, min = 2): { id: string; quote: string } | null {
  let best: { id: string; quote: string; n: number } | null = null;
  const want = new Set(contentWords(terms));
  for (const src of sources) {
    const s = bestSentence(src.content, terms, min);
    if (!s) continue;
    const have = new Set(contentWords(s));
    let n = 0;
    for (const w of want) if (have.has(w)) n++;
    if (!best || n > best.n) best = { id: src.id, quote: s, n };
  }
  return best ? { id: best.id, quote: best.quote } : null;
}
