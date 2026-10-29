// =============================================================================
// eval/score.ts — scoring a pipeline's output against eval/golden_set.json.
//
// Pure (no network, no database): eval/run_eval.ts runs a pipeline (v1 or
// v2) and hands each company's output here. The rules are the ones the
// Phase 0 harness already used — moved out of run_eval.ts so both pipelines
// are scored identically, and so the scoring itself is tested.
//
//   coverage    = correct / scored    (of the golden TRUE values, how many came out right)
//   precision   = correct / produced  (of what the pipeline output, how much was right)
//   wrong-write = (produced - correct) / produced
//
// A golden value marked "unknown" is excluded, never guessed.
// =============================================================================

import { samePersonName } from "../lib/enrichment/linkedin.ts";
import { patentDigits } from "../lib/enrichment/patents.ts";

export type Confidence = "verified" | "likely" | "unknown";
export interface GoldenField<T> { value: T | null; confidence: Confidence; source_url?: string; notes?: string }
export interface GoldenFounder { name: string; title?: string; confidence: Confidence; source_url?: string }
export interface GoldenRound {
  type: string; amount_usd: number | null; date: string | null;
  lead_investor?: string | null; valuation_usd?: number | null; confidence: Confidence;
  /** Where the round was verified (rounds the owner marked on the review sheet). */
  source_url?: string;
}
export interface GoldenCompany {
  id: string; name: string; website?: string;
  city?: GoldenField<string>; country?: GoldenField<string>; founded_year?: GoldenField<number>;
  /** Where it was founded, beside the HQ `country` (lib/enrichment/origin.ts). */
  founding_country?: GoldenField<string>;
  founders?: GoldenFounder[]; funding_rounds?: GoldenRound[];
  /** Rounds that probably happened but have no primary source: not scored either way. */
  funding_rounds_excluded_unknown?: Array<Omit<GoldenRound, "confidence"> & { confidence?: Confidence }>;
  employee_range?: GoldenField<string>; github_url?: string | null; huggingface_url?: string | null;
  /** Latest annual recurring revenue a primary source states (batch 3 on). */
  arr_usd?: GoldenField<number> & { as_of?: string | null };
  /**
   * Competitors a primary source says compete with the company (2026-10-26).
   * names: judged right; not_competitors: judged wrong (partners, customers,
   * "similar companies" a data platform lists). A name in neither is left
   * unjudged and reported, so the list can grow — never counted either way.
   */
  competitors?: { names: string[]; not_competitors?: string[]; confidence: Confidence; source_urls?: string[]; notes?: string };
  /**
   * The company's patents per the EPO register / Espacenet, as publication
   * numbers (any publication of a family counts). none: the register shows
   * none — every patent output is then wrong.
   */
  patents?: { numbers: string[]; none?: boolean; confidence: Confidence; source_url?: string; notes?: string };
  reviewed_by_human?: boolean;
  hard_case_tags?: string[];
}
export interface GoldenSet { version: number; companies: GoldenCompany[] }

/** What a pipeline would write for one company, in one shape for v1 and v2. */
export interface PipelineOutput {
  city: string | null;
  country: string | null;
  founded_year: number | null;
  founding_country?: string | null;
  founders: Array<{ name: string }>;
  rounds: Array<{ round_type: string; amount_raised: number | null; date: string | null; lead_investor?: string | null; source_url?: string | null }>;
  employee_range: string | null;
  arr_usd?: number | null;
  /** Competitor names written (undefined: the pipeline does not produce them). */
  competitors?: string[];
  /** Patent publication numbers written. */
  patents?: string[];
  /** Where each competitor was found, for the review sheet. */
  competitor_sources?: Array<{ name: string; source_url: string | null; quote: string | null }>;
  /** Rounds only a data platform stated (lib/enrichment/hints.ts): confirmed by a primary source, or kept as hints. */
  hints?: { confirmed: HintedRound[]; kept: HintedRound[] };
}

export interface HintedRound { round_type: string | null; amount_raised: number | null; date: string | null; source_url: string | null }

/**
 * What the hints added (owner, 2026-10-28: "measure on the golden set how many
 * rounds this adds"): confirmed hints that match a verified golden round are
 * rounds gained; ones that match none are wrong writes; kept hints that match
 * a golden round are rounds a primary-source search still has to find.
 */
export function hintGain(g: GoldenCompany, hints: PipelineOutput["hints"]): { confirmed: number; confirmed_matching_golden: number; kept: number; kept_matching_golden: number } {
  const verified = (g.funding_rounds ?? []).filter((r) => r.confidence !== "unknown");
  const matches = (h: HintedRound) => verified.some((gr) => roundsDayGap(gr, { amount_raised: h.amount_raised, date: h.date }) !== null);
  const c = hints?.confirmed ?? [], k = hints?.kept ?? [];
  return { confirmed: c.length, confirmed_matching_golden: c.filter(matches).length, kept: k.length, kept_matching_golden: k.filter(matches).length };
}

/** unjudged: produced values the golden set neither confirms nor rejects (competitors only) — reported, not scored. */
export interface FieldStats { scored: number; produced: number; correct: number; unjudged?: number }
export const FIELDS = ["city", "country", "founding_country", "founded_year", "founders", "funding_rounds", "round_type", "employee_range", "arr_usd", "competitors", "patents"] as const;
export type Field = (typeof FIELDS)[number];
export type Scoreboard = Record<Field, FieldStats>;

export const newScoreboard = (): Scoreboard =>
  Object.fromEntries(FIELDS.map((f) => [f, { scored: 0, produced: 0, correct: 0 }])) as Scoreboard;

export function pct(n: number, d: number): string { return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`; }

// The same place written two ways is not a wrong value.
const ALIASES: Record<string, string> = {
  "usa": "united states", "us": "united states", "u.s.": "united states", "united states of america": "united states",
  "uk": "united kingdom", "u.k.": "united kingdom", "great britain": "united kingdom",
  "tel aviv-yafo": "tel aviv", "tel aviv-jaffa": "tel aviv", "new york city": "new york", "nyc": "new york",
};

/** The same person: exact after normalising, or lib/enrichment's samePersonName (Boguslavski / Boguslavsky). */
function samePerson(a: string, b: string): boolean {
  return normalize(a) === normalize(b) || samePersonName(a, b);
}

export function normalize(s: string | null | undefined): string {
  const n = (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
  return ALIASES[n] ?? n;
}

/** One field's result for one company, for the per-company report. */
export type FieldResult = "correct" | "wrong" | "missing" | "excluded";

function scoreScalar(s: FieldStats, golden: GoldenField<string | number> | undefined, extracted: unknown): FieldResult {
  if (!golden || golden.confidence === "unknown" || golden.value == null) return "excluded";
  s.scored++;
  if (extracted == null || extracted === "") return "missing";   // lowers coverage, not precision
  s.produced++;
  if (normalize(String(extracted)) === normalize(String(golden.value))) { s.correct++; return "correct"; }
  return "wrong";
}

// Coverage denominator = golden founders (was each real founder found);
// precision denominator = extracted founders (of everyone NAMED a founder, how
// many are real).
function scoreFounders(s: FieldStats, golden: GoldenFounder[] | undefined, extracted: Array<{ name: string }>): FieldResult {
  const verified = (golden ?? []).filter((f) => f.confidence !== "unknown");
  if (verified.length === 0) return "excluded";
  s.scored += verified.length;
  s.produced += extracted.length;
  const correct = extracted.filter((f) => verified.some((g) => samePerson(g.name, f.name))).length;
  s.correct += correct;
  return extracted.length === 0 ? "missing" : correct === extracted.length && correct === verified.length ? "correct" : "wrong";
}

// The same real-world round: amount within ±10% and dates within ~9 months.
// Returns the day gap, so the closest unused round is matched first.
export function roundsDayGap(g: GoldenRound, e: { amount_raised?: number | null; date?: string | null }): number | null {
  if (g.amount_usd == null || e.amount_raised == null) return null;
  if (Math.abs(e.amount_raised - g.amount_usd) / g.amount_usd > 0.1) return null;
  if (!g.date || !e.date) return 0;   // an amount match with no date on one side cannot be disproved
  // A year- or month-only date (golden or extracted) is read as its middle.
  const mid = (d: string) => new Date(d.length === 4 ? `${d}-06-15` : d.length === 7 ? `${d}-15` : d);
  const diffDays = Math.abs(mid(g.date).getTime() - mid(e.date).getTime()) / 86_400_000;
  return diffDays <= 270 ? diffDays : null;
}

// Greedy injective matching, closest first: one extracted round satisfies at
// most one golden round — otherwise a round between two real ones would
// "cover" both and hide the duplicate-round bug (Apex) this exists to catch.
export function matchRounds(verified: GoldenRound[], extracted: PipelineOutput["rounds"]): Array<[GoldenRound, number]> {
  const used = new Set<number>();
  const order = verified.map((gr) => {
    let best = Infinity;
    extracted.forEach((er) => { const g = roundsDayGap(gr, er); if (g !== null && g < best) best = g; });
    return { gr, best };
  }).sort((a, b) => a.best - b.best);
  const pairs: Array<[GoldenRound, number]> = [];
  for (const { gr } of order) {
    let idx = -1, gap = Infinity;
    extracted.forEach((er, i) => {
      if (used.has(i)) return;
      const g = roundsDayGap(gr, er);
      if (g !== null && g < gap) { gap = g; idx = i; }
    });
    if (idx < 0) continue;
    used.add(idx);
    pairs.push([gr, idx]);
  }
  return pairs;
}

function scoreRounds(s: FieldStats, g: GoldenCompany, extracted: PipelineOutput["rounds"]): FieldResult {
  const golden = g.funding_rounds;
  const verified = (golden ?? []).filter((r) => r.confidence !== "unknown");
  if (verified.length === 0) return "excluded";
  // A round that matches one the golden set could not source (2023 Wiz Series
  // D) is neither right nor wrong: left out of "produced" rather than counted
  // as a wrong write. Only rounds no verified golden round takes.
  const unknown = [
    ...(golden ?? []).filter((r) => r.confidence === "unknown"),
    ...(g.funding_rounds_excluded_unknown ?? []).map((r) => ({ ...r, confidence: "unknown" as const })),
  ];
  s.scored += verified.length;
  const pairs = matchRounds(verified, extracted);
  const used = new Set(pairs.map(([, i]) => i));
  const correct = pairs.length;
  const ignored = extracted.filter((er, i) => !used.has(i) && unknown.some((ur) => roundsDayGap(ur, er) !== null)).length;
  // A hallucinated or duplicate round is produced-but-not-correct.
  s.produced += extracted.length - ignored;
  s.correct += correct;
  return extracted.length === 0 ? "missing" : correct === verified.length && extracted.length === verified.length ? "correct" : "wrong";
}

/**
 * Round type (2026-10-26: Biotia's "$9M financing" written as "Growth",
 * Azumo's "$30M in funding" as "Series B"): judged on the rounds matched to a
 * verified golden round by amount and date. "Unknown" is missing, not wrong;
 * debt written as an equity round, or the reverse, is wrong.
 */
function scoreRoundTypes(s: FieldStats, g: GoldenCompany, extracted: PipelineOutput["rounds"]): FieldResult {
  const verified = (g.funding_rounds ?? []).filter((r) => r.confidence !== "unknown" && r.type);
  if (verified.length === 0) return "excluded";
  const pairs = matchRounds(verified, extracted);
  let produced = 0, correct = 0;
  for (const [gr, i] of pairs) {
    s.scored++;
    const t = extracted[i].round_type;
    if (!t || canonType(t) === "unknown" || canonType(t) === "other") continue;
    produced++;
    if (canonType(t) === canonType(gr.type)) correct++;
  }
  s.produced += produced;
  s.correct += correct;
  return pairs.length === 0 ? "excluded" : produced === 0 ? "missing" : correct === produced ? "correct" : "wrong";
}

/**
 * Competitors — precision only (owner, 2026-10-27: is every competitor found
 * really one). A name the golden list confirms is right, one it rejects is
 * wrong, any other is unjudged and goes to eval/review/competitors_review.csv.
 * No coverage: the golden list is what was judged, not every competitor.
 */
function scoreCompetitors(s: FieldStats, g: GoldenCompany, extracted: string[] | undefined): FieldResult {
  const golden = g.competitors;
  if (!golden || golden.confidence === "unknown" || extracted === undefined) return "excluded";
  const same = (a: string, b: string) => normalizeCompany(a) === normalizeCompany(b);
  let produced = 0, correct = 0, unjudged = 0;
  for (const name of extracted) {
    if (golden.names.some((n) => same(n, name))) { produced++; correct++; }
    else if ((golden.not_competitors ?? []).some((n) => same(n, name))) produced++;
    else unjudged++;
  }
  s.produced += produced;
  s.correct += correct;
  s.unjudged = (s.unjudged ?? 0) + unjudged;
  return produced === 0 ? (extracted.length === 0 ? "missing" : "excluded") : correct === produced ? "correct" : "wrong";
}

/** Patents: a number of a family the register gives the company is right; any other is wrong. */
function scorePatents(s: FieldStats, g: GoldenCompany, extracted: string[] | undefined): FieldResult {
  const golden = g.patents;
  if (!golden || golden.confidence === "unknown" || extracted === undefined) return "excluded";
  const known = new Set(golden.numbers.map(patentDigits));
  s.scored += golden.numbers.length;
  s.produced += extracted.length;
  const correct = golden.none ? 0 : extracted.filter((n) => known.has(patentDigits(n))).length;
  s.correct += correct;
  return extracted.length === 0 ? (golden.none ? "correct" : "missing") : correct === extracted.length ? "correct" : "wrong";
}

const normalizeCompany = (name: string) => normalize(name).replace(/,?\s*\b(inc|llc|ltd|limited|corp|corporation|gmbh|plc|co)\b\.?$/, "").replace(/[^a-z0-9]/g, "");

/** ARR: the latest figure within ±20% of the golden one (revenue is stated loosely: "~$10M ARR"). */
function scoreArr(s: FieldStats, golden: GoldenCompany["arr_usd"], extracted: number | null | undefined): FieldResult {
  if (!golden || golden.confidence === "unknown" || golden.value == null) return "excluded";
  s.scored++;
  if (extracted == null) return "missing";
  s.produced++;
  if (Math.abs(extracted - golden.value) / golden.value <= 0.2) { s.correct++; return "correct"; }
  return "wrong";
}

export function scoreCompany(board: Scoreboard, g: GoldenCompany, out: PipelineOutput): Record<Field, FieldResult> {
  return {
    city: scoreScalar(board.city, g.city, out.city),
    country: scoreScalar(board.country, g.country, out.country),
    founding_country: scoreScalar(board.founding_country, g.founding_country, out.founding_country),
    founded_year: scoreScalar(board.founded_year, g.founded_year, out.founded_year),
    founders: scoreFounders(board.founders, g.founders, out.founders),
    funding_rounds: scoreRounds(board.funding_rounds, g, out.rounds),
    round_type: scoreRoundTypes(board.round_type, g, out.rounds),
    employee_range: scoreScalar(board.employee_range, g.employee_range, out.employee_range),
    arr_usd: scoreArr(board.arr_usd, g.arr_usd, out.arr_usd),
    competitors: scoreCompetitors(board.competitors, g, out.competitors),
    patents: scorePatents(board.patents, g, out.patents),
  };
}

// ── Phase 1's hard rules (docs/enrichment_v2_spec.md §7) ─────────────────────

const roundDate = (d: string | null) => (d ? new Date(d.length === 4 ? `${d}-06-15` : d.length === 7 ? `${d}-15` : d) : null);
const canonType = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Pairs of output rounds that are one real round written twice: the same type
 * within 9 months, or the same amount (±10%) within 9 months.
 */
export function duplicateRounds(rounds: PipelineOutput["rounds"], golden?: GoldenCompany): Array<[number, number]> {
  // Two rounds the golden set holds as two real rounds are not one written twice
  // (Apex's $200M Series C, D and Growth, five months apart — eval run 2026-10-29).
  const matchedTo = new Map<number, GoldenRound>();
  for (const [gr, i] of matchRounds((golden?.funding_rounds ?? []).filter((r) => r.confidence !== "unknown"), rounds)) matchedTo.set(i, gr);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < rounds.length; i++) {
    for (let j = i + 1; j < rounds.length; j++) {
      const a = rounds[i], b = rounds[j];
      const da = roundDate(a.date), db = roundDate(b.date);
      const near = !da || !db || Math.abs(da.getTime() - db.getTime()) / 86_400_000 <= 270;
      if (!near) continue;
      const sameType = canonType(a.round_type) === canonType(b.round_type) && canonType(a.round_type) !== "other";
      const sameAmount = a.amount_raised != null && b.amount_raised != null && a.amount_raised > 0
        && Math.abs(a.amount_raised - b.amount_raised) / Math.max(a.amount_raised, b.amount_raised) <= 0.1;
      if ((sameType || sameAmount) && !(matchedTo.has(i) && matchedTo.has(j) && matchedTo.get(i) !== matchedTo.get(j))) pairs.push([i, j]);
    }
  }
  return pairs;
}

/** A founding year after the company's first dated round — impossible, so wrong. */
export function foundedAfterFirstRound(out: PipelineOutput): boolean {
  if (out.founded_year == null) return false;
  const years = out.rounds.map((r) => roundDate(r.date)?.getUTCFullYear()).filter((y): y is number => y != null);
  return years.length > 0 && out.founded_year > Math.min(...years);
}

export interface Phase1Check { rule: string; pass: boolean; detail: string }

/**
 * Pass bars for the fields the 2026-10-26 run got wrong (owner, 2026-10-26):
 * the share of written values that are right, over at least `min` values the
 * golden set can judge.
 */
export const PHASE1_BARS = {
  round_type: { threshold: 0.95, min: 20 },
  competitors: { threshold: 0.9, min: 20 },
  patents: { threshold: 0.98, min: 10 },
} as const;

export function phase1Checks(board: Scoreboard, facts: { locationMismatches: number; duplicateRounds: number; foundedAfterRound: number }): Phase1Check[] {
  const precision = (fs: FieldStats[]) => {
    const produced = fs.reduce((n, f) => n + f.produced, 0);
    return produced ? fs.reduce((n, f) => n + f.correct, 0) / produced : null;
  };
  const loc = precision([board.city, board.country, board.founded_year]);
  const rounds = precision([board.funding_rounds]);
  // The three fields the 2026-10-26 run got wrong: each needs enough judged
  // values to mean something, then its own bar.
  const bar = (rule: string, fs: FieldStats, min: number, threshold: number): Phase1Check => {
    const p = fs.produced ? fs.correct / fs.produced : null;
    const judged = `${fs.produced} judged${fs.unjudged ? `, ${fs.unjudged} unjudged` : ""}`;
    if (fs.produced < min) return { rule, pass: false, detail: `only ${judged} — at least ${min} needed (add to eval/golden_set.json)` };
    return { rule, pass: p! >= threshold, detail: `${(p! * 100).toFixed(1)}% (${judged})` };
  };
  return [
    { rule: "zero city/country mismatches", pass: facts.locationMismatches === 0, detail: `${facts.locationMismatches} wrong` },
    { rule: "zero duplicate rounds", pass: facts.duplicateRounds === 0, detail: `${facts.duplicateRounds} duplicate pair(s)` },
    { rule: "zero founded_year after the first round", pass: facts.foundedAfterRound === 0, detail: `${facts.foundedAfterRound} company(ies)` },
    { rule: "precision ≥ 95% on location and founded year", pass: loc != null && loc >= 0.95, detail: loc == null ? "nothing produced" : `${(loc * 100).toFixed(1)}%` },
    { rule: "precision ≥ 90% on round amounts", pass: rounds != null && rounds >= 0.9, detail: rounds == null ? "nothing produced" : `${(rounds * 100).toFixed(1)}%` },
    bar(`precision ≥ ${PHASE1_BARS.round_type.threshold * 100}% on round type`, board.round_type, PHASE1_BARS.round_type.min, PHASE1_BARS.round_type.threshold),
    bar(`precision ≥ ${PHASE1_BARS.competitors.threshold * 100}% on competitors`, board.competitors, PHASE1_BARS.competitors.min, PHASE1_BARS.competitors.threshold),
    bar(`precision ≥ ${PHASE1_BARS.patents.threshold * 100}% on patents`, board.patents, PHASE1_BARS.patents.min, PHASE1_BARS.patents.threshold),
  ];
}
