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

/**
 * Attribution: "according to X", "as reported by X", "per its X", "based on
 * X", "X sources indicate". What happens depends on X (owner, 2026-10-25):
 *
 *   primary   the company, its press release / website / filings, the SEC,
 *             Companies House → the sentence is untouched.
 *   platform  a data platform (dataPlatforms.ts) → the whole claim goes.
 *   weak      LinkedIn, sources, reports, estimates, case studies,
 *             testimonials … → the claim stays (without the attribution)
 *             only if a verified fact backs it (opts.isVerified, from
 *             field_provenance); otherwise the whole claim goes.
 */
const ATTRIBUTION = /(^|,\s*|\s+)(according to|as reported (?:by|on|in)|as stated (?:by|in|on)|as (?:listed|noted|shown) (?:on|in|by)|based on|per(?= (?:its|their|the|a|an) )|citing)\s+([^,;.]{1,90})/gi;
const WEAK_HEARSAY = /(^|,\s*|\s+)((?:though |but |while |and )?(?:sources?|reports?|estimates?) (?:say|said|show|showed|indicate|indicated|suggest|suggested|claim|claimed)s?|reportedly|(?:its|their|the company'?s) linkedin (?:profile|page)s? (?:lists?|shows?|states?|says?))\b/gi;
/** Weak whoever publishes it: "case studies on its website", "its LinkedIn". */
const ALWAYS_WEAK = /\b(case stud(?:y|ies)|testimonials?|linkedin|sources?|estimates?|rumou?rs?|third[- ]party|media|analysts?|reviews?)\b/i;
const PRIMARY_SOURCE = /\b(the company|the firm|its (?:own )?(?:press releases?|announcements?|website|blog|filings?|annual reports?|reports? to|submissions?|statements?|prospectus|investor (?:relations|materials)|s-1|10-k|20-f|ceo|founders?|co-founders?|management)|(?:a |the )?press releases?|sec|edgar|companies house|regulatory filings?|official filings?|(?:the )?(?:ceo|founders?|co-founders?|management))\b/i;

/** What a source is called: "per its LinkedIn", "based on Crunchbase references", "citing filings". */
const SOURCE_NOUN = /\b(case stud(?:y|ies)|testimonials?|linkedin|sources?|estimates?|rumou?rs?|third[- ]party|media|analysts?|reviews?|data|reports?|filings?|press releases?|references?|figures|statements?|announcements?|website|records?)\b/i;

/** Mentions that only say where it was listed or ranked: "listed as a top competitor in … comparisons". */
const LISTING_TALK: RegExp[] = [
  /\b(competitors?|alternatives?|rivals?|comparables|peers?) (in|on|by) [^.;]{0,60}\b(comparisons?|lists?|rankings?|reports?|profiles?|databases?|comparables)\b/i,
  /\b(linkedin|crunchbase|pitchbook) (profile|page|data|listing|snippet)s?\b/i,
];
/** Where a listing / recognition tail starts: the part before it is kept when it stands alone. */
const LISTING_TAIL = /(,\s*|\s+)(positioned as|listed (?:as|among|on|in)|cited (?:as|by)|named (?:as|among|by)|ranked (?:as|among|by)|identified (?:as|by)|recognized (?:as|by)|being recognized|with recognition|tracked (?:on|by)|featured (?:on|in))\b/gi;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (term: string, flags: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(term)}(?=$|[^\\p{L}\\p{N}])`, flags);
const PLATFORMS = DATA_PLATFORMS.map((p) => ({
  res: [p.name, ...(p.aliases ?? [])].map((n) => word(n, p.caseSensitive ? "u" : "iu")),
}));

/** Ordinary words a clause may open with — capitalized when it starts a sentence. */
const COMMON_OPENERS = /^(provides?|offers?|it|its|both|competes?|competing|focus(es|ed)?|operates?|serves?|sells?|builds?|develops?|delivers?|targets?|specializ(es|ing)|positioned|the|a|an|also|with|and|but|while|unlike|like|as|in|on|for)\b/;
const capitalize = (t: string) => (/^[a-z]+\b/.test(t) && !/^[a-z]+[A-Z]/.test(t) && COMMON_OPENERS.test(t) ? t.charAt(0).toUpperCase() + t.slice(1) : t);

const splitSentences = (text: string) => text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
const splitClauses = (text: string) => splitSentences(text).flatMap((s) => s.split(/\s*;\s*/));
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export interface NarrativeOptions {
  /**
   * The company the text is about. When it is itself a data platform
   * (Apollo.io, Grata …), other platforms are its competitors — real
   * information — so platform names are not removed from its texts.
   */
  selfName?: string | null;
  /** A competitor the text describes ("how it competes"): it may name itself (PitchBook). */
  subjectName?: string | null;
  /**
   * Is this claim backed by a verified fact (field_provenance / this run's
   * verified evidence)? Without it, a claim with a weak attribution is dropped.
   */
  isVerified?: (claim: string) => boolean;
}

export type NarrativeProblem = "data_platform" | "source_talk";

/** "Apollo.io" / "Apollo", "CB Insights" / "cbinsights": the same name. */
const core = (n: string) => n.toLowerCase().replace(/\.(io|com|co|ai|vc|app)\b/g, "").replace(/[^\p{L}\p{N}]/gu, "");
const PLATFORM_CORES = DATA_PLATFORMS.map((p) => [p.name, ...(p.aliases ?? [])].map(core));
export const isDataPlatform = (name: string | null | undefined) => !!name && PLATFORM_CORES.some((cores) => cores.includes(core(name)));

function namesPlatform(text: string, opts: NarrativeOptions): boolean {
  if (isDataPlatform(opts.selfName)) return false;
  const subject = opts.subjectName ? core(opts.subjectName) : null;
  return PLATFORMS.some((p, i) => !(subject && PLATFORM_CORES[i].includes(subject)) && p.res.some((re) => re.test(text)));
}

type Decision =
  | { kind: "keep" }
  | { kind: "drop"; reason: NarrativeProblem }
  | { kind: "cut"; text: string; reason: NarrativeProblem; needsVerification: boolean };

/** What to do with one clause (a sentence, or a part of one between semicolons). */
function decide(part: string, opts: NarrativeOptions): Decision {
  // 1. Attribution, by who is cited.
  for (const m of part.matchAll(ATTRIBUTION)) {
    const source = m[3];
    // "per" / "based on" / "citing" are also product language ("pricing based
    // on usage", "per user", "per the agreement"): an attribution only when
    // what follows is a source.
    // "pricing based on proprietary data", "offers based on traffic data": inside a phrase, "based on" / "citing"
    // describe the product. As an attribution they open the sentence or follow a comma.
    if (/^(based on|citing)$/i.test(m[2]) && !/^(|,\s*)$/.test(m[1]) && !namesPlatform(source, opts)) continue;
    const lead = source.trim().split(/\s+/).slice(0, 4).join(" ");   // the source is named right away: "per its LinkedIn page"
    if (!/^(according to|as reported)/i.test(m[2]) && !namesPlatform(lead, opts) && !SOURCE_NOUN.test(lead)) continue;
    if (namesPlatform(source, opts)) return { kind: "drop", reason: "data_platform" };
    if (!ALWAYS_WEAK.test(source) && PRIMARY_SOURCE.test(source)) continue;   // the company / its filings: untouched
    return weakClaim(part, m.index!, m[0], opts);
  }
  for (const m of part.matchAll(WEAK_HEARSAY)) return weakClaim(part, m.index!, m[0], opts);

  // 2. A platform named outside an attribution, 3. a listing that names its list.
  const platform = namesPlatform(part, opts);
  if (!platform && !LISTING_TALK.some((re) => re.test(part))) return { kind: "keep" };
  const reason: NarrativeProblem = platform ? "data_platform" : "source_talk";
  for (const m of part.matchAll(LISTING_TAIL)) {
    const head = part.slice(0, m.index).replace(/[\s,;:–—-]+$/, "");
    if (words(head) >= 6 && decide(head, opts).kind === "keep") return { kind: "cut", text: head, reason, needsVerification: false };
  }
  return { kind: "drop", reason };
}

/** The claim a weak attribution is attached to, kept only when verified. */
function weakClaim(part: string, index: number, matched: string, opts: NarrativeOptions): Decision {
  let claim: string;
  if (index === 0 || /^\s*,?\s*$/.test(part.slice(0, index))) {
    // Lead-in: "According to user testimonials, Happo is …"
    const comma = part.indexOf(",", index + matched.length - 1);
    claim = comma >= 0 ? part.slice(comma + 1).trim() : "";
  } else {
    claim = part.slice(0, index).replace(/[\s,;:–—-]+$/, "");
  }
  if (words(claim) < 6) return { kind: "drop", reason: "source_talk" };
  const rest = decide(claim, opts);
  if (rest.kind === "drop") return rest;
  const text = rest.kind === "cut" ? rest.text : claim;
  return { kind: "cut", text: capitalize(text), reason: "source_talk", needsVerification: true };
}

/** Why a clause goes (or is cut), or null when it stays as written. */
export function clauseProblem(clause: string, opts: NarrativeOptions = {}): NarrativeProblem | null {
  const d = decide(clause, opts);
  return d.kind === "keep" ? null : d.reason;
}

// ── Verified facts ─────────────────────────────────────────────────────────

const NUMBER = /([$€£])?\s?(\d+(?:[.,]\d+)*)\s*(billion|bn|b|million|mn|m|thousand|k)?\b\s*(%|x)?/gi;
const SCALE: Record<string, number> = { billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, mn: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };

/** Every figure a text states ("$300 million" → 300000000, "646%" → 646, "2024" → 2024). */
export function figuresIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[2].replace(/,(?=\d{3}\b)/g, "");
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n)) continue;
    out.push(n * (m[3] ? SCALE[m[3].toLowerCase()] ?? 1 : 1));
  }
  return out;
}

export interface VerifiedFact { value?: unknown; quote?: string | null }

/**
 * isVerified() from verified facts (field_provenance rows, or this run's
 * evidence): a claim stating figures is verified only when EVERY figure it
 * states is in a verified value or quote; a claim with no figures, only when
 * a verified quote says nearly the same (most of its words).
 */
export function verifierFrom(facts: VerifiedFact[]): (claim: string) => boolean {
  const known: number[] = [];
  const quotes: string[] = [];
  for (const f of facts) {
    if (typeof f.value === "number") known.push(f.value);
    else if (typeof f.value === "string") known.push(...figuresIn(f.value));
    if (f.quote) { known.push(...figuresIn(f.quote)); quotes.push(f.quote.toLowerCase()); }
  }
  const same = (a: number, b: number) => a === b || (b !== 0 && Math.abs(a - b) / Math.abs(b) < 0.005);
  const contentWords = (t: string) => new Set(t.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
  return (claim: string) => {
    const figures = figuresIn(claim);
    if (figures.length > 0) return figures.every((f) => known.some((k) => same(f, k)));
    const w = contentWords(claim);
    if (w.size === 0) return false;
    return quotes.some((q) => { const qw = contentWords(q); let hit = 0; for (const x of w) if (qw.has(x)) hit++; return hit / w.size >= 0.6; });
  };
}

/**
 * The text without the clauses clauseProblem() flags. Sentences and
 * semicolon-separated parts are kept or dropped whole, in order.
 * "" when nothing is left.
 */
export function cleanNarrative(text: string | null | undefined, opts: NarrativeOptions = {}): string {
  return cleanNarrativeWithReasons(text, opts).text;
}

/** cleanNarrative(), plus why each dropped or cut clause changed (for reports). */
export function cleanNarrativeWithReasons(
  text: string | null | undefined,
  opts: NarrativeOptions = {},
): { text: string; reasons: NarrativeProblem[] } {
  const reasons: NarrativeProblem[] = [];
  if (!text) return { text: "", reasons };
  // Nothing to change: the text comes back exactly as stored.
  if (splitClauses(text).every((p) => decide(p, opts).kind === "keep")) return { text, reasons };
  const kept: string[] = [];
  for (const sentence of splitSentences(text)) {
    const parts = sentence.split(/\s*;\s*/);
    const good: string[] = [];
    let touched = false;
    for (const p of parts) {
      if (!p.trim()) continue;
      const d = decide(p, opts);
      if (d.kind === "keep") { good.push(p); continue; }
      reasons.push(d.reason);
      touched = true;
      if (d.kind === "cut" && (!d.needsVerification || opts.isVerified?.(d.text))) good.push(d.text);
    }
    if (good.length === 0) continue;
    let s = good.join("; ").trim();
    if (touched) {
      s = s.replace(/[\s,;:–—-]+$/, "");
      if (!/[.!?]$/.test(s)) s += ".";
      // A part that now opens the sentence gets a capital — only a plain
      // lowercase word ("provides …"), never a name written in lowercase or
      // mixed case (mParticle, eMed, happyhotel, greytHR).
      s = capitalize(s);
    }
    kept.push(s);
  }
  return { text: kept.join(" "), reasons };
}
