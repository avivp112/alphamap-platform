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

export type Confidence = "verified" | "likely" | "unknown";
export interface GoldenField<T> { value: T | null; confidence: Confidence; source_url?: string; notes?: string }
export interface GoldenFounder { name: string; title?: string; confidence: Confidence; source_url?: string }
export interface GoldenRound {
  type: string; amount_usd: number | null; date: string | null;
  lead_investor?: string | null; valuation_usd?: number | null; confidence: Confidence;
}
export interface GoldenCompany {
  id: string; name: string; website?: string;
  city?: GoldenField<string>; country?: GoldenField<string>; founded_year?: GoldenField<number>;
  founders?: GoldenFounder[]; funding_rounds?: GoldenRound[];
  employee_range?: GoldenField<string>; github_url?: string | null; huggingface_url?: string | null;
  /** Latest annual recurring revenue a primary source states (batch 3 on). */
  arr_usd?: GoldenField<number> & { as_of?: string | null };
  reviewed_by_human?: boolean;
  hard_case_tags?: string[];
}
export interface GoldenSet { version: number; companies: GoldenCompany[] }

/** What a pipeline would write for one company, in one shape for v1 and v2. */
export interface PipelineOutput {
  city: string | null;
  country: string | null;
  founded_year: number | null;
  founders: Array<{ name: string }>;
  rounds: Array<{ round_type: string; amount_raised: number | null; date: string | null }>;
  employee_range: string | null;
  arr_usd?: number | null;
}

export interface FieldStats { scored: number; produced: number; correct: number }
export const FIELDS = ["city", "country", "founded_year", "founders", "funding_rounds", "employee_range", "arr_usd"] as const;
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
  const names = new Set(verified.map((f) => normalize(f.name)));
  s.scored += verified.length;
  s.produced += extracted.length;
  const correct = extracted.filter((f) => names.has(normalize(f.name))).length;
  s.correct += correct;
  return extracted.length === 0 ? "missing" : correct === extracted.length && correct === verified.length ? "correct" : "wrong";
}

// The same real-world round: amount within ±10% and dates within ~9 months.
// Returns the day gap, so the closest unused round is matched first.
export function roundsDayGap(g: GoldenRound, e: { amount_raised?: number | null; date?: string | null }): number | null {
  if (g.amount_usd == null || e.amount_raised == null) return null;
  if (Math.abs(e.amount_raised - g.amount_usd) / g.amount_usd > 0.1) return null;
  if (!g.date || !e.date) return 0;   // an amount match with no date on one side cannot be disproved
  const gDate = new Date(g.date.length === 4 ? `${g.date}-06-15` : g.date.length === 7 ? `${g.date}-15` : g.date);
  const diffDays = Math.abs(gDate.getTime() - new Date(e.date).getTime()) / 86_400_000;
  return diffDays <= 270 ? diffDays : null;
}

// Greedy injective matching, closest first: one extracted round satisfies at
// most one golden round — otherwise a round between two real ones would
// "cover" both and hide the duplicate-round bug (Apex) this exists to catch.
function scoreRounds(s: FieldStats, golden: GoldenRound[] | undefined, extracted: PipelineOutput["rounds"]): FieldResult {
  const verified = (golden ?? []).filter((r) => r.confidence !== "unknown");
  if (verified.length === 0) return "excluded";
  s.scored += verified.length;
  s.produced += extracted.length;   // a hallucinated or duplicate round is produced-but-not-correct
  const used = new Set<number>();
  const order = verified.map((gr) => {
    let best = Infinity;
    extracted.forEach((er) => { const g = roundsDayGap(gr, er); if (g !== null && g < best) best = g; });
    return { gr, best };
  }).sort((a, b) => a.best - b.best);
  let correct = 0;
  for (const { gr } of order) {
    let idx = -1, gap = Infinity;
    extracted.forEach((er, i) => {
      if (used.has(i)) return;
      const g = roundsDayGap(gr, er);
      if (g !== null && g < gap) { gap = g; idx = i; }
    });
    if (idx < 0) continue;
    used.add(idx);
    correct++;
  }
  s.correct += correct;
  return extracted.length === 0 ? "missing" : correct === verified.length && extracted.length === verified.length ? "correct" : "wrong";
}

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
    founded_year: scoreScalar(board.founded_year, g.founded_year, out.founded_year),
    founders: scoreFounders(board.founders, g.founders, out.founders),
    funding_rounds: scoreRounds(board.funding_rounds, g.funding_rounds, out.rounds),
    employee_range: scoreScalar(board.employee_range, g.employee_range, out.employee_range),
    arr_usd: scoreArr(board.arr_usd, g.arr_usd, out.arr_usd),
  };
}

// ── Phase 1's hard rules (docs/enrichment_v2_spec.md §7) ─────────────────────

const roundDate = (d: string | null) => (d ? new Date(d.length === 4 ? `${d}-06-15` : d.length === 7 ? `${d}-15` : d) : null);
const canonType = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Pairs of output rounds that are one real round written twice: the same type
 * within 9 months, or the same amount (±10%) within 9 months.
 */
export function duplicateRounds(rounds: PipelineOutput["rounds"]): Array<[number, number]> {
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
      if (sameType || sameAmount) pairs.push([i, j]);
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

export function phase1Checks(board: Scoreboard, facts: { locationMismatches: number; duplicateRounds: number; foundedAfterRound: number }): Phase1Check[] {
  const precision = (fs: FieldStats[]) => {
    const produced = fs.reduce((n, f) => n + f.produced, 0);
    return produced ? fs.reduce((n, f) => n + f.correct, 0) / produced : null;
  };
  const loc = precision([board.city, board.country, board.founded_year]);
  const rounds = precision([board.funding_rounds]);
  return [
    { rule: "zero city/country mismatches", pass: facts.locationMismatches === 0, detail: `${facts.locationMismatches} wrong` },
    { rule: "zero duplicate rounds", pass: facts.duplicateRounds === 0, detail: `${facts.duplicateRounds} duplicate pair(s)` },
    { rule: "zero founded_year after the first round", pass: facts.foundedAfterRound === 0, detail: `${facts.foundedAfterRound} company(ies)` },
    { rule: "precision ≥ 95% on location and founded year", pass: loc != null && loc >= 0.95, detail: loc == null ? "nothing produced" : `${(loc * 100).toFixed(1)}%` },
    { rule: "precision ≥ 90% on round amounts", pass: rounds != null && rounds >= 0.9, detail: rounds == null ? "nothing produced" : `${(rounds * 100).toFixed(1)}%` },
  ];
}
