/**
 * lib/enrichment/write.ts — provenance-aware write DECISIONS, per
 * docs/enrichment_v2_spec.md issue 3 (scalars) and issue 6 (headcount).
 *
 * Pure decision logic only — no Supabase calls live here. The orchestrator
 * (scripts/bulk_enrich_v2.ts, not yet built) calls these functions to decide
 * WHETHER and HOW to write a field, then performs the actual
 * insert/update/field_provenance/field_changes calls itself, the same
 * separation extract.ts uses between its pure build/process functions and
 * its thin live-API wrapper.
 */

import { isHigherRanked, sourceTypeRank, type SourceType } from "./sourceTypes";

export interface ExistingFieldState<T> {
  value: T | null;
  /** null = no field_provenance row for the current value (e.g. set by an older process, or CSV import) — genuinely unknown origin, not "weak" origin. */
  provenance: { source_type: SourceType; is_manually_verified?: boolean } | null;
}

export interface CandidateValue<T> {
  value: T;
  source_type: SourceType;
  /** How many independent, evidence-verified sources support this exact value. */
  independentSourceCount: number;
}

export type ScalarWriteDecision = "fill" | "overwrite" | "keep_existing";

export interface ScalarWriteResult {
  decision: ScalarWriteDecision;
  reason: string;
}

/**
 * Decides whether a new scalar value may be written. This is what actually
 * fixes "a wrong city or founded_year written once can never be corrected"
 * (issue 3's own framing) — without this, v1's fill-null-only rule means a
 * bad early value is permanent.
 *
 * Does NOT check value equality — if the candidate equals the existing
 * value there's nothing meaningful to decide, so callers should short-
 * circuit that case themselves before calling this (comparing values
 * generically for arbitrary T belongs with the caller, not this module).
 */
export function decideScalarWrite<T>(existing: ExistingFieldState<T>, candidate: CandidateValue<T>): ScalarWriteResult {
  if (existing.value == null) {
    return { decision: "fill", reason: "no existing value" };
  }
  if (existing.provenance?.is_manually_verified) {
    return { decision: "keep_existing", reason: "existing value is manually verified — never overwritten" };
  }
  if (!existing.provenance) {
    if (candidate.independentSourceCount >= 2) {
      return { decision: "overwrite", reason: "existing value has no provenance row; candidate corroborated by 2+ independent sources" };
    }
    return { decision: "keep_existing", reason: "existing value has no provenance row, and candidate isn't corroborated by 2+ independent sources" };
  }
  if (isHigherRanked(candidate.source_type, existing.provenance.source_type)) {
    return { decision: "overwrite", reason: `candidate source_type (${candidate.source_type}) outranks existing (${existing.provenance.source_type})` };
  }
  return { decision: "keep_existing", reason: "candidate does not outrank the existing provenance" };
}

// ── Headcount update guard (issue 6) ──────────────────────────────────────

export type HeadcountPointType = "observed" | "press_reported" | "model_estimate";

export interface HeadcountUpdateDecision {
  /** Whether to update startups.employee_count itself. */
  writeEmployeeCount: boolean;
  /** What point_type to record this snapshot as, regardless of writeEmployeeCount. */
  pointType: HeadcountPointType;
}

/**
 * "A change of more than 50% from the current employee_count requires 2
 * sources or one source of type company_site or higher. Otherwise keep the
 * old value and store the new one only as model_estimate." (issue 6) — a
 * company_site/registry/manual source counts as "company_site or higher"
 * (rank >= company_site's rank); press_release and below do not count
 * alone, matching the spec's own wording ("2 sources OR one source of type
 * company_site or higher", not "press_release or higher").
 */
export function decideHeadcountUpdate(
  existingEmployeeCount: number | null,
  candidate: CandidateValue<number>,
): HeadcountUpdateDecision {
  if (existingEmployeeCount == null) {
    return { writeEmployeeCount: true, pointType: "observed" };
  }
  if (existingEmployeeCount === 0) {
    // Avoid a division by zero; any nonzero candidate is by definition a
    // huge relative jump, so fall straight to the strong-evidence check.
    const strong = candidate.independentSourceCount >= 2 || sourceTypeRank(candidate.source_type) >= sourceTypeRank("company_site");
    return strong ? { writeEmployeeCount: true, pointType: "observed" } : { writeEmployeeCount: false, pointType: "model_estimate" };
  }
  const changeRatio = Math.abs(candidate.value - existingEmployeeCount) / existingEmployeeCount;
  const strongEnough = candidate.independentSourceCount >= 2 || sourceTypeRank(candidate.source_type) >= sourceTypeRank("company_site");
  if (changeRatio <= 0.5 || strongEnough) {
    return { writeEmployeeCount: true, pointType: "observed" };
  }
  return { writeEmployeeCount: false, pointType: "model_estimate" };
}

// ── Additive person merge (founders/leadership) ───────────────────────────

export interface MergeablePerson {
  name: string;
  title?: string;
  role?: string;
  bio?: string;
  linkedin_url?: string;
  had_prior_exit?: boolean;
  elite_background?: boolean;
  notable_pedigree?: boolean;
  joined_date?: string;
}

/**
 * Returns null, never throws, for a missing/blank name -- a real DRY_RUN=false
 * run crashed here ("Cannot read properties of undefined (reading 'trim')")
 * on Falanx Cyber, a company with real pre-existing founders/leadership data
 * from a previous (non-v2) enrichment pass. Unlike the two freshly-empty
 * companies this had been tested against, existing JSONB rows written
 * outside this schema carry no guarantee every person object has a `name`.
 */
function normalizeName(name: string | null | undefined): string | null {
  if (!name || !name.trim()) return null;
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Union merge: an existing person already on file is never removed or
 * overwritten on a field they already have a value for — only backfilled
 * on fields that are currently empty. A genuinely new person (no matching
 * name) is appended. Matches v1's existing behavior ("merges founders as a
 * union — additive, never destructive — including backfilling title/bio
 * onto an already-recorded founder, never overwriting"), unchanged by v2.
 *
 * A person (existing OR incoming) with no identifiable name is never
 * matched against -- an existing nameless entry stays in the output
 * untouched (no data loss) but can't be auto-merged into, since identity
 * can't be verified without a name; an incoming nameless entry is skipped
 * entirely rather than appended as an unreferenceable record.
 */
export function mergePeople<T extends MergeablePerson>(existing: T[], incoming: T[]): T[] {
  const result = existing.map((p) => ({ ...p }));
  const byName = new Map<string, number>();
  result.forEach((p, idx) => {
    const key = normalizeName(p.name);
    if (key) byName.set(key, idx);
  });

  for (const person of incoming) {
    const key = normalizeName(person.name);
    if (!key) continue;
    const idx = byName.get(key);
    if (idx == null) {
      result.push({ ...person });
      byName.set(key, result.length - 1);
      continue;
    }
    const current = result[idx];
    for (const field of ["title", "role", "bio", "linkedin_url", "joined_date"] as const) {
      if (current[field] == null && person[field] != null) {
        (current as MergeablePerson)[field] = person[field];
      }
    }
    for (const flag of ["had_prior_exit", "elite_background", "notable_pedigree"] as const) {
      if (person[flag] === true && current[flag] !== true) {
        current[flag] = true;
      }
    }
  }
  return result;
}

// ── Append-with-dedup (ARR milestones / valuation benchmarks) ────────────

export interface DatedFigure { date?: string | null }

/**
 * Appends new dated-figure entries (arr_milestones, valuation_benchmarks),
 * skipping one that's a near-duplicate (same figure, same date) of one
 * already on file — these are a TIME SERIES (unlike a fill-null-once
 * scalar), so new entries are additive, but a re-run finding the same
 * reported figure again shouldn't double it up.
 */
export function appendDatedFigures<T extends DatedFigure>(
  existing: T[],
  incoming: T[],
  figureOf: (item: T) => number,
): T[] {
  const result = [...existing];
  for (const item of incoming) {
    const isDuplicate = existing.some((e) => figureOf(e) === figureOf(item) && (e.date ?? null) === (item.date ?? null));
    if (!isDuplicate) result.push(item);
  }
  return result;
}

// ── Fill-only-if-currently-null (competitors, acquisitions, patents, etc.) ─

/** For an array field that's set once and never touched again once non-empty (competitors, acquisitions, patent records, tech_stack). */
export function fillArrayIfEmpty<T>(existing: T[], incoming: T[]): T[] {
  return existing.length > 0 ? existing : incoming;
}

/** For a scalar field that's set once and never touched again once non-null (value_proposition, github_url, huggingface_url, patent_count). */
export function fillScalarIfNull<T>(existing: T | null | undefined, incoming: T | null | undefined): T | null {
  return existing ?? incoming ?? null;
}
