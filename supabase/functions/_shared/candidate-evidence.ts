// =============================================================================
// Candidate evidence merging — pure, no Deno, no network.
//
// The ingesters write company_candidates.evidence from the RPC's named
// parameters. The registry detail added later (addresses, director detail,
// Form D extras) is merged on top by merge_candidate_evidence() for new
// candidates, and by the ingesters' backfillEvidence mode for the ones already
// waiting for review. Both paths share these rules.
// =============================================================================

/** Keys the ingest RPC itself writes. A merge never overwrites them (officers are merged person by person). */
export const INGEST_KEYS = [
  "form_type", "jurisdiction", "industry_group", "codes", "officers", "summary",
  "total_offering", "total_sold", "title", "abstract", "filing_date",
] as const;

/** Set on every candidate whose registry detail has been read, so the backfill never reads one twice. */
export const DETAIL_STAMP = "detail_checked_at";

/** PostgREST path of the stamp inside evidence.signals: a candidate without it still needs its signals collected. */
export const SIGNALS_PATH = "evidence->signals->>checked_at";

type Json = Record<string, unknown>;

const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** Drop null / empty values: a field the register left blank adds nothing. */
export function stripEmpty(o: Json): Json {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => !isEmpty(v)));
}

/**
 * Add the new people fields to the officers already on the candidate, matched
 * by name (case-insensitive). People already there keep their order and their
 * existing fields; a person only the register knows is not added (the gate
 * already decided who the directors are).
 */
export function mergeOfficers(
  current: Array<Record<string, unknown>> | undefined,
  fresh: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(current)) return current;
  const byName = new Map<string, Record<string, unknown>>();
  for (const o of fresh ?? []) {
    const n = String(o?.name ?? "").trim().toLowerCase();
    if (n) byName.set(n, o);
  }
  return current.map((o) => {
    const f = byName.get(String(o?.name ?? "").trim().toLowerCase());
    return f ? { ...stripEmpty(f), ...stripEmpty(o) } : o;
  });
}

/**
 * The evidence a candidate should have after a merge. `extra` never replaces a
 * key the ingest wrote; `officers`, when given, enrich the existing ones.
 */
export function mergeCandidateEvidence(
  current: Json | null | undefined,
  extra: Json,
  officers?: Array<Record<string, unknown>>,
  stampedAt?: string,
): Json {
  const base: Json = { ...(current ?? {}) };
  const add = stripEmpty(extra);
  for (const k of INGEST_KEYS) delete add[k];
  const merged: Json = { ...base, ...add };
  if (officers && Array.isArray(base.officers)) merged.officers = mergeOfficers(base.officers as Array<Record<string, unknown>>, officers);
  if (stampedAt) merged[DETAIL_STAMP] = stampedAt;
  return merged;
}
