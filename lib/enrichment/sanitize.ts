/**
 * lib/enrichment/sanitize.ts — sanitizeModelOutput(), v2's own copy.
 *
 * Identical logic to scripts/bulk_enrich_all.ts's private sanitizeModelOutput
 * (same SENTINEL_STRINGS, same recursive stringified-JSON recovery). Ground
 * rule 7 asks for shared logic to live in lib/enrichment/ so v1 and v2 reuse
 * it — but v1 is explicitly frozen to exactly two changes (the raw-dump
 * diagnostic and the loud-failure guard), so moving its private function out
 * into an import would be a third, unauthorized change to that file. This
 * duplicates the ~25 lines instead of touching v1. Worth collapsing back
 * into one shared copy once v1 is retired (spec Phase 3, when it becomes
 * bulk_enrich_v1_legacy.ts and the freeze presumably lifts).
 */

const SENTINEL_STRINGS = new Set([
  "unknown", "<unknown>", "n/a", "na", "none", "null", "undefined", "tbd", "-", "—",
]);

export function sanitizeModelOutput(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (SENTINEL_STRINGS.has(trimmed.toLowerCase())) return undefined;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return sanitizeModelOutput(JSON.parse(trimmed));
      } catch {
        return undefined;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeModelOutput).filter((v) => v !== undefined);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = sanitizeModelOutput(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

/**
 * Coerces a schema-array field to an actual array, defensively. Found
 * necessary by a real DRY_RUN run: Claude returned `patents` as a bare
 * object instead of a one-item array, which crashed `(i.patents ?? [])
 * .filter(...)` with "filter is not a function" — `??` only catches
 * null/undefined, not "present but the wrong shape". A single non-array
 * object is treated as a one-item array (the model's evident intent);
 * anything else unexpected (a string, a number) is dropped to `[]` rather
 * than thrown on, consistent with "omit rather than guess" applied to malformed
 * model output instead of missing data.
 */
export function ensureArray<T>(value: unknown): T[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value as T[];
  return [value as T];
}
