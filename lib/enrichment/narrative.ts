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
  /\bas (reported|listed|noted|cited|described|ranked) (by|on|in)\b/i,
  /\b(listed|named|ranked|cited|mentioned|identified|flagged) (as|among) (a |an |the |one of )?(top |main |key |leading |direct |primary )*(competitors?|rivals?|alternatives?|peers?)\b/i,
  /\b(competitors?|alternatives?|rivals?) (in|on|by) [^.;]{0,60}\b(comparisons?|lists?|rankings?|reports?|profiles?|databases?)\b/i,
  /\b(per|on|from|in) (its|their|the company'?s) (linkedin|crunchbase|pitchbook)\b/i,
  /\b(linkedin|crunchbase|pitchbook) (profile|page|data|listing|snippet)s?\b/i,
  /\b(data|figures|estimates) (from|by|via) [A-Z]/,
  /\bsources? (say|said|show|indicate|report|suggest)s?\b/i,
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (term: string, flags: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(term)}(?=$|[^\\p{L}\\p{N}])`, flags);
const PLATFORMS = DATA_PLATFORMS.map((p) => ({
  names: [p.name, ...(p.aliases ?? [])].map((n) => n.toLowerCase()),
  res: [p.name, ...(p.aliases ?? [])].map((n) => word(n, p.caseSensitive ? "u" : "iu")),
}));

export interface NarrativeOptions {
  /** The company itself: a data platform's own profile may name itself. */
  selfName?: string | null;
}

export type NarrativeProblem = "data_platform" | "source_talk";

/** Why a clause goes, or null when it stays. */
export function clauseProblem(clause: string, opts: NarrativeOptions = {}): NarrativeProblem | null {
  const self = opts.selfName?.trim().toLowerCase();
  if (PLATFORMS.some((p) => !(self && p.names.includes(self)) && p.res.some((re) => re.test(clause)))) return "data_platform";
  if (SOURCE_TALK.some((re) => re.test(clause))) return "source_talk";
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
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  const kept: string[] = [];
  for (const sentence of sentences) {
    const parts = sentence.split(/\s*;\s*/);
    const good = parts.filter((p) => {
      if (!p.trim()) return false;
      const problem = clauseProblem(p, opts);
      if (problem) reasons.push(problem);
      return !problem;
    });
    if (good.length === 0) continue;
    let s = good.join("; ").trim();
    if (good.length < parts.length) {
      s = s.replace(/[\s,;:–—-]+$/, "");
      if (!/[.!?]$/.test(s)) s += ".";
    }
    kept.push(s.charAt(0).toUpperCase() + s.slice(1));
  }
  return { text: kept.join(" "), reasons };
}
