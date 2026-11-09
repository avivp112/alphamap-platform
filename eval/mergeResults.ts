/**
 * eval/mergeResults.ts — a partial run laid over a full one (owner, 2026-11-06): after a fix, only the
 * companies it touches are run again; their output replaces theirs in the stored full run, and
 * RESCORE=true scores the whole. Pure.
 */
interface Stored { generated_at?: string; per_company?: Record<string, unknown>; [k: string]: unknown }

export function mergeRuns(base: Stored, patch: Stored): { merged: Stored; replaced: string[]; added: string[] } {
  const replaced: string[] = [], added: string[] = [];
  const per = { ...(base.per_company ?? {}) };
  for (const [id, v] of Object.entries(patch.per_company ?? {})) {
    (id in per ? replaced : added).push(id);
    per[id] = v;
  }
  return {
    merged: { ...base, per_company: per, generated_at: patch.generated_at ?? base.generated_at, merged_from: { base: base.generated_at ?? null, patch: patch.generated_at ?? null, replaced, added } },
    replaced, added,
  };
}
