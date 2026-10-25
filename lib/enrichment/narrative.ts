/**
 * lib/enrichment/narrative.ts — what a company's written text may talk about
 * (owner's rule, 2026-10-25).
 *
 * A description, value proposition, founder bio or "how it competes" line
 * says what the company (or person) does. It never says where AlphaMap read
 * it, and never names a data platform (lib/enrichment/dataPlatforms.ts —
 * most are AlphaMap's own competitors): "listed as a top competitor in
 * Tracxn and CB Insights comparisons" goes. A company's own competitors are
 * NOT in this rule: "Unlike Hinge Health, it uses AI care" is information
 * and stays.
 *
 * cleanNarrative() drops every clause (a sentence, or a part of one between
 * semicolons) that does either, and keeps the rest as written. Nothing is
 * rephrased. Pure: used by enrichment v2's validation stage (lib/), the
 * check worker, the site (src/) and scripts/clean_narratives.ts, so all agree.
 */
import { DATA_PLATFORMS } from "./dataPlatforms";

/** "according to …", "listed as a competitor in …", "per its LinkedIn": where it was read, not what it does. */
const SOURCE_TALK: RegExp[] = [
  /\baccording to\b/i,
  /\bas (reported|listed|ranked) (by|on|in)\b/i,
  // "listed as a top competitor in … comparisons": names the list it was read in. A bare
  // "Fondeadora is listed as a direct alternative to Hey Banco" names none, and stays.
  /\b(competitors?|alternatives?|rivals?|comparables|peers?) (in|on|by) [^.;]{0,60}\b(comparisons?|lists?|rankings?|reports?|profiles?|databases?|comparables)\b/i,
  /\b(per|on|from|in) (its|their|the company'?s) (linkedin|crunchbase|pitchbook)\b/i,
  /\b(linkedin|crunchbase|pitchbook) (profile|page|data|listing|snippet)s?\b/i,
  /\bsources? (say|said|show|indicate|report|suggest)s?\b/i,
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (term: string, flags: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(term)}(?=$|[^\\p{L}\\p{N}])`, flags);
const PLATFORMS = DATA_PLATFORMS.map((p) => ({
  names: [p.name, ...(p.aliases ?? [])].map((n) => n.toLowerCase()),
  res: [p.name, ...(p.aliases ?? [])].map((n) => word(n, p.caseSensitive ? "u" : "iu")),
}));

/** Ordinary words a clause may open with — capitalized when it starts a sentence. */
const COMMON_OPENERS = /^(provides?|offers?|it|its|both|competes?|competing|focus(es|ed)?|operates?|serves?|sells?|builds?|develops?|delivers?|targets?|specializ(es|ing)|positioned|the|a|an|also|with|and|but|while|unlike|like|as|in|on|for)\b/;

const splitClauses = (text: string) => text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).flatMap((s) => s.split(/\s*;\s*/));

export interface NarrativeOptions {
  /**
   * The company the text is about. When it is itself a data platform
   * (Apollo.io, Grata …), other platforms are its competitors — real
   * information — so platform names are not removed from its texts.
   */
  selfName?: string | null;
  /** A competitor the text describes ("how it competes"): it may name itself (PitchBook). */
  subjectName?: string | null;
}

export type NarrativeProblem = "data_platform" | "source_talk";

/** "Apollo.io" / "Apollo", "CB Insights" / "cbinsights": the same name. */
const core = (n: string) => n.toLowerCase().replace(/\.(io|com|co|ai|vc|app)\b/g, "").replace(/[^\p{L}\p{N}]/gu, "");
const PLATFORM_CORES = DATA_PLATFORMS.map((p) => [p.name, ...(p.aliases ?? [])].map(core));
export const isDataPlatform = (name: string | null | undefined) => !!name && PLATFORM_CORES.some((cores) => cores.includes(core(name)));

/** Why a clause goes, or null when it stays. */
export function clauseProblem(clause: string, opts: NarrativeOptions = {}): NarrativeProblem | null {
  if (!isDataPlatform(opts.selfName)) {
    const subject = opts.subjectName ? core(opts.subjectName) : null;
    if (PLATFORMS.some((p, i) => !(subject && PLATFORM_CORES[i].includes(subject)) && p.res.some((re) => re.test(clause)))) return "data_platform";
  }
  if (SOURCE_TALK.some((re) => re.test(clause))) return "source_talk";
  return null;
}

/**
 * Where a flagged part can be cut instead of dropped whole: before a
 * trailing "…, positioned as an alternative on comparison lists", "…, as
 * reported by LinkedIn", "… according to case studies", or after a leading
 * "According to user testimonials, …". Only when what is kept is itself
 * clean and a real sentence (6+ words). null: drop the whole part.
 */
const TAIL_MARKER = /(,\s*|\s+)(according to|as reported (by|on|in)|as listed (on|in|by)|based on|per (its|their|the)\b|positioned as|listed (as|among|on|in)|cited (as|by)|named (as|among)|ranked (as|among|by)|identified (as|by)|recognized (as|by)|being recognized|with recognition)\b/gi;
const LEAD_IN = /^(according to|based on|per)\b[^,]{0,120},\s*/i;
function rescue(part: string, opts: NarrativeOptions): string | null {
  const words = (t: string) => t.trim().split(/\s+/).length;
  for (const m of part.matchAll(TAIL_MARKER)) {
    const head = part.slice(0, m.index).replace(/[\s,;:–—-]+$/, "");
    if (words(head) >= 6 && !clauseProblem(head, opts)) return head;
  }
  const lead = part.match(LEAD_IN);
  if (lead) {
    const rest = part.slice(lead[0].length);
    if (words(rest) >= 6) {
      const kept = clauseProblem(rest, opts) ? rescue(rest, opts) : rest;
      if (kept) return /^[a-z]+\b/.test(kept) && !/^[a-z]+[A-Z]/.test(kept) && COMMON_OPENERS.test(kept) ? kept.charAt(0).toUpperCase() + kept.slice(1) : kept;
    }
  }
  return null;
}

/**
 * The text without the clauses clauseProblem() flags. Sentences and
 * semicolon-separated parts are kept or dropped whole, in order.
 * "" when nothing is left.
 */
export function cleanNarrative(text: string | null | undefined, opts: NarrativeOptions = {}): string {
  return cleanNarrativeWithReasons(text, opts).text;
}

/** cleanNarrative(), plus why each dropped clause went (for reports). */
export function cleanNarrativeWithReasons(
  text: string | null | undefined,
  opts: NarrativeOptions = {},
): { text: string; reasons: NarrativeProblem[] } {
  const reasons: NarrativeProblem[] = [];
  if (!text) return { text: "", reasons };
  // Nothing to drop: the text comes back exactly as stored.
  if (!splitClauses(text).some((p) => clauseProblem(p, opts))) return { text, reasons };
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  const kept: string[] = [];
  for (const sentence of sentences) {
    const parts = sentence.split(/\s*;\s*/);
    const good: string[] = [];
    let touched = false;
    for (const p of parts) {
      if (!p.trim()) continue;
      const problem = clauseProblem(p, opts);
      if (!problem) { good.push(p); continue; }
      reasons.push(problem);
      touched = true;
      const cut = rescue(p, opts);
      if (cut) good.push(cut);
    }
    if (good.length === 0) continue;
    let s = good.join("; ").trim();
    if (touched) {
      s = s.replace(/[\s,;:–—-]+$/, "");
      if (!/[.!?]$/.test(s)) s += ".";
      // A part that now opens the sentence gets a capital — only a plain
      // lowercase word ("provides …"), never a name written in lowercase or
      // mixed case (mParticle, eMed, happyhotel, greytHR).
      if (parts.indexOf(good[0]) > 0 && /^[a-z]+\b/.test(s) && !/^[a-z]+[A-Z]/.test(s) && COMMON_OPENERS.test(s)) {
        s = s.charAt(0).toUpperCase() + s.slice(1);
      }
    }
    kept.push(s);
  }
  return { text: kept.join(" "), reasons };
}
