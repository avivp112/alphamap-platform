/**
 * lib/enrichment/rounds.ts — round type normalization and duplicate
 * detection/merge, per docs/enrichment_v2_spec.md issue 5.
 *
 * Reconciling issue 5's closed type list with ground rule 1 ("no data
 * loss"): issue 5's list (Pre-Seed..Series F+, Growth, Venture Debt, Grant,
 * Secondary, Unknown) drops several types v1 already records and Section 2
 * requires parity on (Convertible Note, Bootstrapped, Acquired, PE Buyout,
 * IPO, Debt, Other — see v1's NON-VC FINANCIAL EVENTS prompt rule). Rather
 * than lose those, CanonicalRoundType is the UNION of both lists. Issue 5's
 * dedup/merge rules only ever apply to the VC-style round types anyway
 * (nobody duplicate-detects two "IPO" rows against each other), so nothing
 * in the spec's intent is changed by keeping the extra types available.
 *
 * The APEX case this module exists to get right, confirmed by hand against
 * primary sources while building the eval golden set (see eval/golden_set.json,
 * apex-space.production_bug_notes): the production bug is NOT one real event
 * stored twice. Apex raised a real Series D (~Sept 2025, $200M) and a real,
 * separate Growth round (Jun 2026, $200M, $2.3B valuation) — two distinct
 * events roughly 9 months apart with DIFFERENT reported lead investors
 * (sources conflict on the Series D's investor name, but agree it is not
 * the Growth round's). Naively dedup-merging "same amount, ~9 months apart"
 * would silently delete a real round, which is exactly the kind of wrong
 * write ground rule 2 exists to prevent. So: a lead-investor MATCH is strong
 * corroboration and merges automatically; an amount/valuation match with
 * CONFLICTING named investors on both sides is flagged for human review,
 * never auto-merged.
 */

export const CANONICAL_ROUND_TYPES = [
  "Pre-Seed", "Seed", "Series A", "Series B", "Series C", "Series D",
  "Series E", "Series F+", "Growth", "Venture Debt", "Grant", "Secondary",
  // Kept for v1 parity (ground rule 1) — not part of issue 5's VC-round
  // progression, so they never participate in specificity ranking below.
  // "Bridge" specifically: issue 5's own closed list omits it, but it's a
  // real value in the startups.funding_rounds round_type CHECK constraint
  // (supabase/migrations/20260526000000_init_market_intelligence_schema.sql)
  // — without this, a real existing Bridge round would silently fall
  // through to "Other" below and be invisible to hasRealRounds()'s tiering
  // check, exactly the "no data loss" ground rule 1 forbids.
  "Convertible Note", "Bootstrapped", "Acquired", "PE Buyout", "IPO", "Debt", "Bridge", "Other",
  "Unknown",
] as const;

export type CanonicalRoundType = (typeof CANONICAL_ROUND_TYPES)[number];

// Specificity rank for the VC-round progression only (issue 5: "most
// specific type, e.g. Series D over Growth"). Everything else (including
// "Growth" itself, which is a catch-all bucket) ranks 0 — equally
// unspecific — so merging never prefers one non-series label over another,
// only a named series over a bucket.
const SERIES_SPECIFICITY: Partial<Record<CanonicalRoundType, number>> = {
  "Pre-Seed": 1, "Seed": 2, "Series A": 3, "Series B": 4, "Series C": 5,
  "Series D": 6, "Series E": 7, "Series F+": 8,
};

function specificity(t: CanonicalRoundType): number {
  return SERIES_SPECIFICITY[t] ?? 0;
}

export function normalizeRoundType(raw: string | null | undefined): CanonicalRoundType {
  if (!raw) return "Unknown";
  const s = raw.toLowerCase().trim();
  if (/pre.?seed/.test(s)) return "Pre-Seed";
  if (/\bseed\b/.test(s) && !/series/.test(s)) return "Seed";
  if (/series\s*a\b/.test(s)) return "Series A";
  if (/series\s*b\b/.test(s)) return "Series B";
  if (/series\s*c\b/.test(s)) return "Series C";
  if (/series\s*d\b/.test(s)) return "Series D";
  if (/series\s*e\b/.test(s)) return "Series E";
  if (/series\s*[f-z+]/.test(s) || /late.?stage/.test(s)) return "Series F+";
  if (/\bgrowth\b/.test(s) || /expansion/.test(s)) return "Growth";
  if (/venture.?debt/.test(s)) return "Venture Debt";
  if (/\bdebt\b|credit facilit|term loan|\bloan\b|mezzanine/.test(s)) return "Debt";
  if (/secondar/.test(s)) return "Secondary";
  if (/\bbridge\b/.test(s)) return "Bridge";
  if (/convertible|safe\b|\bnote\b/.test(s)) return "Convertible Note";
  if (/buyout|\blbo\b|leveraged buy|take.?private/.test(s)) return "PE Buyout";
  if (/bootstrap/.test(s)) return "Bootstrapped";
  if (/\bgrant\b/.test(s)) return "Grant";
  if (/acqui|merg/.test(s)) return "Acquired";
  if (/\bipo\b|\bpublic\b|nyse|nasdaq|\blse\b|\btase\b/.test(s)) return "IPO";
  return "Other";
}

/** Lowercase, trim, collapse whitespace/punctuation — for comparing investor names. */
export function normalizeInvestorName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.toLowerCase().trim().replace(/[.,]/g, "").replace(/\s+/g, " ");
}

/**
 * True if two normalized investor names plausibly name the same firm — exact
 * match, or one is contained in the other (handles "Glade Brook" vs.
 * "Glade Brook Capital Partners"). Empty input never matches anything —
 * "no investor named" is not evidence of agreement.
 */
export function investorNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeInvestorName(a);
  const nb = normalizeInvestorName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export interface RoundLike {
  round_type: string;
  amount_raised?: number | null;
  valuation?: number | null;
  announcement_date?: string | null; // YYYY-MM-DD
  lead_investor?: string | null;
  other_investors?: string[] | null;
  source_url?: string | null;
  is_valuation_estimated?: boolean | null;
  /** Per-investor disclosed contributions (funding_rounds.investor_amounts) — rare. */
  investor_amounts?: Array<{ name: string; amount: number }> | null;
}

function parseDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return null;
  return Math.abs(da.getTime() - db.getTime()) / 86_400_000;
}

function withinPct(a: number, b: number, pct: number): boolean {
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= pct;
}

export type RoundPairVerdict = "duplicate" | "possible_duplicate_needs_review" | null;

/**
 * Classifies a pair of rounds per issue 5's rules, refined per the APEX
 * finding above: an amount/valuation match alone is only auto-merged when
 * investor names don't actively conflict (one/both unknown is fine — that's
 * absence of evidence, not evidence of two different investors). A
 * lead-investor NAME match is itself always sufficient to auto-merge,
 * regardless of valuation, since agreement on who led the round is strong,
 * specific corroboration.
 */
export function classifyRoundPair(a: RoundLike, b: RoundLike): RoundPairVerdict {
  const gap = daysBetween(a.announcement_date, b.announcement_date);
  // No date on either side: can't apply the ±9-month window at all — require
  // dates to classify a pair, never guess "close enough" without one.
  if (gap == null || gap > 270) return null;

  const amountA = a.amount_raised ?? null;
  const amountB = b.amount_raised ?? null;
  const amountClose = amountA != null && amountB != null && withinPct(amountA, amountB, 0.10);
  const amountVeryClose = amountA != null && amountB != null && withinPct(amountA, amountB, 0.05);

  const valA = a.valuation ?? null;
  const valB = b.valuation ?? null;
  const valuationClose = valA != null && valB != null && withinPct(valA, valB, 0.05);

  const investorsMatch = investorNamesMatch(a.lead_investor, b.lead_investor);
  const investorsConflict =
    !!a.lead_investor && !!b.lead_investor && !investorsMatch;

  // Rule (a): same lead investor + amount within 10% — investor agreement
  // is strong enough evidence on its own, always a safe auto-merge.
  if (investorsMatch && amountClose) return "duplicate";

  // Rule (b): amount within 5% AND valuation within 5%.
  if (amountVeryClose && valuationClose) {
    return investorsConflict ? "possible_duplicate_needs_review" : "duplicate";
  }

  return null;
}

/** Merge two rounds classified as a genuine duplicate into one record. */
export function mergeRoundPair(a: RoundLike, b: RoundLike): RoundLike {
  const typeA = normalizeRoundType(a.round_type);
  const typeB = normalizeRoundType(b.round_type);
  const mergedType = specificity(typeB) > specificity(typeA) ? typeB : typeA;

  const dateA = parseDate(a.announcement_date);
  const dateB = parseDate(b.announcement_date);
  const earliestDate =
    dateA && dateB ? (dateA <= dateB ? a.announcement_date : b.announcement_date)
    : a.announcement_date ?? b.announcement_date ?? null;

  const otherInvestorSet = new Set<string>();
  for (const name of [...(a.other_investors ?? []), ...(b.other_investors ?? [])]) {
    if (name && name.trim()) otherInvestorSet.add(name.trim());
  }
  // If one side's lead investor isn't the other's, it still participated —
  // fold it into other_investors rather than silently dropping it.
  const mergedLead = a.lead_investor ?? b.lead_investor ?? null;
  for (const candidate of [a.lead_investor, b.lead_investor]) {
    if (candidate && !investorNamesMatch(candidate, mergedLead)) otherInvestorSet.add(candidate);
  }

  return {
    round_type: mergedType,
    amount_raised: a.amount_raised ?? b.amount_raised ?? null,
    valuation: a.valuation ?? b.valuation ?? null,
    announcement_date: earliestDate,
    lead_investor: mergedLead,
    other_investors: [...otherInvestorSet],
    source_url: a.source_url ?? b.source_url ?? null,
    is_valuation_estimated: a.valuation != null ? (a.is_valuation_estimated ?? null) : (b.is_valuation_estimated ?? null),
    investor_amounts: a.investor_amounts?.length ? a.investor_amounts : (b.investor_amounts ?? null),
  };
}

export interface DedupResult {
  rounds: RoundLike[];
  merged: Array<{ a: RoundLike; b: RoundLike; into: RoundLike }>;
  needsReview: Array<{ a: RoundLike; b: RoundLike }>;
}

/**
 * Dedups a flat list of rounds (existing DB rows + newly extracted rounds
 * combined) pairwise. Greedy: once a round is merged or flagged, it's
 * removed from further pairing in this pass so one round can't be silently
 * consumed by two different "duplicates" — same injective-matching
 * principle as eval/run_eval.ts's scoreRounds, for the same reason (a
 * single round must not be allowed to satisfy/absorb more than one other).
 */
export function dedupRounds(rounds: RoundLike[]): DedupResult {
  const remaining = [...rounds];
  const result: RoundLike[] = [];
  const merged: DedupResult["merged"] = [];
  const needsReview: DedupResult["needsReview"] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < remaining.length; i++) {
    if (consumed.has(i)) continue;
    let current = remaining[i];
    for (let j = i + 1; j < remaining.length; j++) {
      if (consumed.has(j)) continue;
      const verdict = classifyRoundPair(current, remaining[j]);
      if (verdict === "duplicate") {
        const into = mergeRoundPair(current, remaining[j]);
        merged.push({ a: current, b: remaining[j], into });
        current = into;
        consumed.add(j);
      } else if (verdict === "possible_duplicate_needs_review") {
        needsReview.push({ a: current, b: remaining[j] });
        // Not consumed — both rounds are kept as-is; a human decides.
      }
    }
    result.push(current);
  }

  return { rounds: result, merged, needsReview };
}

// Types that represent real capital landing in the company. Secondary sales
// (existing shareholders selling, no new money in) and non-equity/IPO
// events are excluded, same as v1's prompt rule 16 and issue 5's explicit
// "IPO rounds stay excluded, as in v1".
const EXCLUDED_FROM_TOTAL_RAISED = new Set<CanonicalRoundType>([
  "Secondary", "IPO", "Acquired", "PE Buyout",
]);

/** Recomputes Total Raised from a deduped round list — never from a model-returned total (issue 5). */
export function computeTotalRaised(rounds: RoundLike[]): number {
  return rounds.reduce((sum, r) => {
    const type = normalizeRoundType(r.round_type);
    if (EXCLUDED_FROM_TOTAL_RAISED.has(type)) return sum;
    return sum + (r.amount_raised ?? 0);
  }, 0);
}
