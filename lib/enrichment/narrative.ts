/**
 * lib/enrichment/narrative.ts — what a company's written text may talk about
 * (owner's rule, 2026-10-25).
 *
 * A description, value proposition, founder bio or "how it competes" line
 * says what the company (or person) does. It never says where AlphaMap read
 * it, and never names a data platform — most of them are AlphaMap's own
 * competitors ("listed as a top competitor in Tracxn and CB Insights
 * comparisons"). A description never names the company's competitors either:
 * those belong in the Competitors section, where each one explains how it
 * competes.
 *
 * cleanNarrative() drops every clause (a sentence, or a part of one between
 * semicolons) that does any of that, and keeps the rest as written. Nothing
 * is rephrased. Pure, no imports: used by enrichment (lib/), the check worker
 * and the site (src/), so all three agree.
 */

/** Data and company-intelligence platforms — named in a company's text only as a source. */
const DATA_PLATFORMS = [
  "crunchbase", "pitchbook", "tracxn", "cb insights", "cbinsights", "dealroom", "owler", "growjo",
  "zoominfo", "rocketreach", "seedtable", "sacra", "mattermark", "preqin", "craft.co", "getlatka",
  "latka", "wellfound", "angellist", "angel list", "startup nation finder", "ivc research", "golden.com",
  "clay.com", "privco", "signalhire", "apollo.io", "leadiq", "lusha", "6sense", "cbinsight",
];

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
const word = (term: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(term)}(?=$|[^\\p{L}\\p{N}])`, "iu");
const PLATFORM_RES = DATA_PLATFORMS.map(word);

export interface NarrativeOptions {
  /** Names the text must not mention — a description's own competitors. */
  avoidNames?: Array<string | null | undefined>;
  /** The company itself: never treated as a name to avoid. */
  selfName?: string | null;
}

/** Why a clause goes, or null when it stays. */
export function clauseProblem(clause: string, opts: NarrativeOptions = {}): "data_platform" | "source_talk" | "names_competitor" | null {
  if (PLATFORM_RES.some((re) => re.test(clause))) return "data_platform";
  if (SOURCE_TALK.some((re) => re.test(clause))) return "source_talk";
  const self = opts.selfName?.trim().toLowerCase();
  for (const n of opts.avoidNames ?? []) {
    const name = n?.trim();
    // Very short names ("X", "Go") would match ordinary words.
    if (!name || name.length < 3 || name.toLowerCase() === self) continue;
    if (word(name).test(clause)) return "names_competitor";
  }
  return null;
}

/**
 * The text without the clauses clauseProblem() flags. Sentences and
 * semicolon-separated parts are kept or dropped whole, in order.
 * "" when nothing is left.
 */
export function cleanNarrative(text: string | null | undefined, opts: NarrativeOptions = {}): string {
  if (!text) return "";
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  const kept: string[] = [];
  for (const sentence of sentences) {
    const parts = sentence.split(/\s*;\s*/);
    const good = parts.filter((p) => p.trim() && !clauseProblem(p, opts));
    if (good.length === 0) continue;
    let s = good.join("; ").trim();
    if (good.length < parts.length) {
      s = s.replace(/[\s,;:–—-]+$/, "");
      if (!/[.!?]$/.test(s)) s += ".";
    }
    kept.push(s.charAt(0).toUpperCase() + s.slice(1));
  }
  return kept.join(" ");
}
