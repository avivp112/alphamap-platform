/**
 * lib/enrichment/quoteFinder.ts — the sentence of a source that best supports a text (owner, 2026-11-07).
 * The description, the sector and the tags have source ids but no quote of their own; the review sheet
 * shows the source's own sentence that carries the most of their words, so the marker can check the value.
 * Pure. An extractive quote only: it is shown to the marker, never used to verify the value.
 */
import { isNonDescriptivePage } from "./pageKind";

const STOP = new Set(["that", "this", "with", "from", "their", "which", "have", "been", "into", "also", "more", "than", "such", "about", "company", "platform", "provides", "helps", "uses", "using"]);
export const contentWords = (s: string): string[] => (s.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !STOP.has(w));

export function sentencesOf(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((s) => s.trim()).filter((s) => s.length >= 25 && s.length <= 400);
}

/** A fetch that returned an error or a block page, not the page (review 6: Armorblox's "Target URL returned error 403"). */
export const isErrorPage = (content: string): boolean =>
  /Target URL returned error \d{3}|^\s*(?:403|404|429|503)\b[^\n]{0,40}(?:forbidden|not found|too many requests|unavailable)|Access Denied|nothing was found at this location|page not found|404 not found|error 404|this page (?:could not|cannot|can['’]t) be found|the page you (?:are looking for|requested|were looking for)[^.]{0,40}(?:not|no longer)|Please be advised that this page is unavailable|Just a moment\.\.\.|Attention Required! \| Cloudflare/i.test(content.slice(0, 1500));

/** The sentence with the most distinct words in common with `terms` (at least `min`), or null. */
export function bestSentence(content: string, terms: string, min = 2): string | null {
  if (isErrorPage(content)) return null;
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

/**
 * Tags a source sentence supports (owner, 2026-11-08, review 6: BrowserStack's "Cybersecurity / General", Seline's
 * "Consumer & Media" had no sentence anywhere in the sources). A tag no sentence of an allowed page carries a word of
 * is not written.
 */
export function supportedTags(tags: string[], allPages: Array<{ id: string; content: string; url?: string }>): { kept: Array<{ tag: string; id: string; quote: string }>; dropped: string[] } {
  const kept: Array<{ tag: string; id: string; quote: string }> = [];
  const dropped: string[] = [];
  // A privacy policy, terms, glossary, help article or career page supports no tag (review 7, 2026-11-09).
  const pages = allPages.filter((p) => !isNonDescriptivePage(p.url));
  for (const tag of tags) {
    const hit = bestTagQuote(pages, tag);
    if (hit) kept.push({ tag, id: hit.id, quote: hit.quote }); else dropped.push(tag);
  }
  return { kept, dropped };
}

/**
 * The sentence that carries the tag's own words, close together (review 8, 2026-11-10): "Cloud Security" is not supported by
 * "the platform is entirely cloud-based … vehicle security" (the platform runs in the cloud; its product is not cloud security),
 * and "Enterprise Software" is not supported by "enterprise customers". Every content word of the tag ("General" is no word of
 * a tag), within six words of each other.
 */
/**
 * A technology the company secures, tests, scans or monitors is not its own tag (owner, 2026-11-12, run 10: DeepKeep secures AI agents; it is
 * not an "AI Agents" company). True when the sentence puts the tag's words right after such a verb, or right before "security / scanner /
 * firewall / testing / monitoring". A tag that is itself about security or testing is not judged by this.
 */
export function tagIsTechnologyProtected(tag: string, sentence: string): boolean {
  if (/\b(secur|protect|test|monitor|scan|firewall|govern|audit|guard|red.?team)/i.test(tag)) return false;
  const first = contentWords(tag.replace(/\bgeneral\b/gi, "")).map((w) => w.slice(0, 5))[0];
  if (!first) return false;
  const toks = sentence.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const VERB = /^(secur|protect|test|monitor|scan|govern|audit|guard|red|firewall|safeguard|harden)/;
  const AFTER = /^(secur|scanner|scan|firewall|test|monitor|governance|guardrail|safety|red)/;
  for (let i = 0; i < toks.length; i++) {
    if (!toks[i].startsWith(first)) continue;
    if (toks.slice(Math.max(0, i - 4), i).some((t) => VERB.test(t))) return true;
    if (toks.slice(i + 1, i + 3).some((t) => AFTER.test(t))) return true;
  }
  return false;
}

export function bestTagQuote(pages: Array<{ id: string; content: string }>, tag: string): { id: string; quote: string } | null {
  const want = contentWords(tag.replace(/\bgeneral\b/gi, "")).map((w) => w.slice(0, 6));
  if (!want.length) return null;
  let best: { id: string; quote: string; n: number } | null = null;
  for (const page of pages) {
    if (isErrorPage(page.content)) continue;
    for (const s of sentencesOf(page.content)) {
      const toks = (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
      const at = want.map((w) => toks.map((t, i) => (t.startsWith(w) ? i : -1)).filter((i) => i >= 0));
      if (at.some((a) => !a.length)) continue;
      // Some choice of one position per word spans at most six words.
      const starts = at[0];
      const tight = starts.some((p0) => at.every((a) => a.some((p) => Math.abs(p - p0) <= 5)));
      if (!tight) continue;
      if (tagIsTechnologyProtected(tag, s)) continue;
      const n = want.length;
      if (!best || n > best.n) best = { id: page.id, quote: s, n };
    }
  }
  return best ? { id: best.id, quote: best.quote } : null;
}
