/**
 * lib/enrichment/sourceTypes.ts — the source_type vocabulary and ranking
 * shared by validation.ts, confidence.ts, write.ts and sources.ts (spec
 * issues 3, 4, 9). Centralized so all four agree on the same ranking
 * instead of each hand-rolling its own copy.
 */

export const SOURCE_TYPES = [
  "manual", "registry", "company_site", "press_release", "news",
  "aggregator_snippet", "model_inferred",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

// Highest-trust first, per issue 3.
const RANK: Record<SourceType, number> = {
  manual: 6,
  registry: 5,
  company_site: 4,
  press_release: 3,
  news: 2,
  aggregator_snippet: 1,
  model_inferred: 0,
};

export function sourceTypeRank(t: SourceType): number {
  return RANK[t];
}

export function isHigherRanked(a: SourceType, b: SourceType): boolean {
  return RANK[a] > RANK[b];
}

export type ConflictResolution = "keep_existing" | "keep_new" | "unresolved";

/**
 * Compares two source types backing conflicting values for the SAME field
 * and says which one should win on rank alone. "unresolved" when they're
 * equally ranked — rank alone can't decide, so a caller needs a different
 * signal (corroboration count, a fresh targeted lookup, or a human) before
 * accepting either value.
 */
export function resolveConflictBySourceRank(
  existing: SourceType | null | undefined,
  incoming: SourceType | null | undefined,
): ConflictResolution {
  if (!existing && !incoming) return "unresolved";
  if (!existing) return "keep_new";
  if (!incoming) return "keep_existing";
  if (existing === incoming) return "unresolved";
  return isHigherRanked(incoming, existing) ? "keep_new" : (isHigherRanked(existing, incoming) ? "keep_existing" : "unresolved");
}
