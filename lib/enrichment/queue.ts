/**
 * lib/enrichment/queue.ts — v2's copy of v1's Tier 1/2/3 classification
 * (ground rule 3: "keep what works" explicitly names Tier 1/2/3 queue
 * ordering). Faithfully ported from scripts/bulk_enrich_all.ts's private
 * classifyTier/hasRealRounds/hasCompetitors/hasPatents (same duplication-
 * over-import reasoning as sanitize.ts — v1 is frozen).
 *
 * Resumability itself (ordering the queue by last_enriched_at, OFFSET/
 * BATCH_SIZE/MAX_TIER env vars) is orchestration, not pure logic — that
 * lives in scripts/bulk_enrich_v2.ts, which builds the actual SQL query.
 * This module is just the per-row tier DECISION, independently testable.
 */

import { normalizeRoundType } from "./rounds";

export interface TierRow {
  description: string | null;
  employee_count: number | null;
  competitors: unknown[] | null;
}

export interface TierRound {
  round_type: string | null;
}

export function hasRealRounds(rounds: TierRound[]): boolean {
  return rounds.some((r) => r.round_type && normalizeRoundType(r.round_type) !== "Other");
}

export function hasCompetitors(row: Pick<TierRow, "competitors">): boolean {
  return Array.isArray(row.competitors) && row.competitors.length > 0;
}

export type Tier = 1 | 2 | 3;

/**
 * Tier 1 (NO data): no description, no headcount, no real funding round.
 * Tier 3 (FULL data): description + headcount + at least one real round +
 *   competitors mapped.
 * Tier 2 (PARTIAL data): everything in between.
 */
export function classifyTier(row: TierRow, rounds: TierRound[]): Tier {
  const realRounds = hasRealRounds(rounds);
  if (!row.description && !row.employee_count && !realRounds) return 1;
  if (row.description && row.employee_count && realRounds && hasCompetitors(row)) return 3;
  return 2;
}
