/**
 * lib/enrichment/runChanges.ts — every value a run writes is recorded in
 * field_changes with the run's run_id, so a run can be undone as a whole
 * (owner, 2026-10-26): "cancel, by run_id, everything the recent runs wrote
 * in patents, competitors and round type, then run again after the fix".
 *
 * Rows:
 *   startups column     field = the column ("patents", "competitors", ...),
 *                       old_value = what was on file, new_value = what the run wrote
 *   new round           field = "funding_rounds.<id>", old_value = null,
 *                       new_value = the inserted row
 *   deleted round       field = "funding_rounds.<id>", old_value = the row,
 *                       new_value = null (a cleanup; undo puts it back)
 *   filled round field  field = "funding_rounds.<id>.<column>"
 *
 * planUndo() turns a run's rows into what undoing it means, and refuses a
 * value someone changed after the run (it says so instead of overwriting).
 * Pure; scripts/undo_run.ts does the reads and writes. Tested in
 * runChanges.test.ts with the 2026-10-26 run's companies.
 */

export interface FieldChangeRow {
  startup_id: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
  source_url?: string | null;
  run_id: string | null;
}

const json = (v: unknown) => (v === undefined ? null : v);

/** One row per startups column the patch changes. */
export function startupChanges(startupId: string, before: Record<string, unknown>, patch: Record<string, unknown>, runId: string | null): FieldChangeRow[] {
  return Object.entries(patch).map(([field, value]) => ({ startup_id: startupId, field, old_value: json(before[field]), new_value: json(value), run_id: runId }));
}

export function roundDeleteChange(startupId: string, roundId: string, row: Record<string, unknown>, runId: string | null): FieldChangeRow {
  return { startup_id: startupId, field: `funding_rounds.${roundId}`, old_value: row, new_value: null, source_url: (row.source_url as string | null) ?? null, run_id: runId };
}

export function roundInsertChange(startupId: string, roundId: string, row: Record<string, unknown>, runId: string | null): FieldChangeRow {
  return { startup_id: startupId, field: `funding_rounds.${roundId}`, old_value: null, new_value: row, source_url: (row.source_url as string | null) ?? null, run_id: runId };
}

/** The columns a fill wrote on a round already on file, each with what it held before. */
export function roundUpdateChanges(startupId: string, roundId: string, before: Record<string, unknown>, patch: Record<string, unknown>, runId: string | null): FieldChangeRow[] {
  const prior = (column: string) => json(column === "investors" ? before.investors ?? before.other_investors : before[column]);
  return Object.entries(patch).map(([column, value]) => ({ startup_id: startupId, field: `funding_rounds.${roundId}.${column}`, old_value: prior(column), new_value: json(value), run_id: runId }));
}

// ── Undo ─────────────────────────────────────────────────────────────────────

/** Which recorded fields an undo covers: a startups column, or "funding_rounds" (new rounds and their filled fields). */
export type UndoScope = string;

export type UndoAction =
  | { kind: "restore_startup_field"; startup_id: string; field: string; value: unknown; written: unknown }
  | { kind: "delete_round"; startup_id: string; round_id: string; round: Record<string, unknown> }
  | { kind: "restore_round"; startup_id: string; round_id: string; round: Record<string, unknown> }
  | { kind: "restore_round_field"; startup_id: string; round_id: string; column: string; value: unknown }
  | { kind: "skip"; startup_id: string; field: string; reason: "changed_since" | "round_gone" | "round_back" | "out_of_scope" };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface CurrentState {
  /** The startups row now, by id (only the columns the run touched are needed). */
  startups: Map<string, Record<string, unknown>>;
  /** funding_rounds rows now, by id; a missing id means the round was deleted since. */
  rounds: Map<string, Record<string, unknown>>;
}

const inScope = (field: string, scope: UndoScope[]) =>
  scope.includes(field.startsWith("funding_rounds.") ? "funding_rounds" : field);

/**
 * What undoing one run means. A value is put back only when it is still what
 * the run wrote; a round the run inserted is deleted whole (its type, amount
 * and date were all this run's). Rows are one run's, oldest first.
 */
export function planUndo(changes: FieldChangeRow[], now: CurrentState, scope: UndoScope[]): UndoAction[] {
  const actions: UndoAction[] = [];
  const insertedRounds = new Set<string>();
  for (const c of changes) {
    if (!inScope(c.field, scope)) { actions.push({ kind: "skip", startup_id: c.startup_id, field: c.field, reason: "out_of_scope" }); continue; }
    const parts = c.field.split(".");
    if (parts[0] === "funding_rounds" && parts.length === 2 && c.new_value == null) {
      // A round the run deleted: put back as it was, unless a round with its id is there again.
      if (now.rounds.has(parts[1])) { actions.push({ kind: "skip", startup_id: c.startup_id, field: c.field, reason: "round_back" }); continue; }
      actions.push({ kind: "restore_round", startup_id: c.startup_id, round_id: parts[1], round: c.old_value as Record<string, unknown> });
      continue;
    }
    if (parts[0] === "funding_rounds" && parts.length === 2) {
      const round = now.rounds.get(parts[1]);
      if (!round) { actions.push({ kind: "skip", startup_id: c.startup_id, field: c.field, reason: "round_gone" }); continue; }
      insertedRounds.add(parts[1]);
      actions.push({ kind: "delete_round", startup_id: c.startup_id, round_id: parts[1], round });
      continue;
    }
    if (parts[0] === "funding_rounds" && parts.length === 3) {
      if (insertedRounds.has(parts[1])) continue;   // the whole round goes anyway
      const round = now.rounds.get(parts[1]);
      if (!round) { actions.push({ kind: "skip", startup_id: c.startup_id, field: c.field, reason: "round_gone" }); continue; }
      if (!same(round[parts[2]], c.new_value)) { actions.push({ kind: "skip", startup_id: c.startup_id, field: c.field, reason: "changed_since" }); continue; }
      actions.push({ kind: "restore_round_field", startup_id: c.startup_id, round_id: parts[1], column: parts[2], value: c.old_value });
      continue;
    }
    const current = now.startups.get(c.startup_id)?.[c.field];
    if (!same(current, c.new_value)) { actions.push({ kind: "skip", startup_id: c.startup_id, field: c.field, reason: "changed_since" }); continue; }
    actions.push({ kind: "restore_startup_field", startup_id: c.startup_id, field: c.field, value: c.old_value, written: c.new_value });
  }
  return actions;
}
