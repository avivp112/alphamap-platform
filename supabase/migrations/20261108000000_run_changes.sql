-- =============================================================================
-- 20261108000000_run_changes.sql
--
-- Every value an enrichment run writes is recorded in field_changes under the
-- run's run_id, so a run can be undone as a whole (owner, 2026-10-26):
-- scripts/undo_run.ts. Until now field_changes held only overwrites of a
-- non-empty value, with no run_id — the 2026-10-26 run's patents, competitors
-- and round types cannot be traced back to it.
--
--   * new_value may be NULL: a run can clear a value (a patent count the EPO
--     register cannot confirm).
--   * an index on run_id, for the undo.
--
-- Additive. Rollback: supabase/rollback/20261108000000_run_changes_down.sql
-- =============================================================================

ALTER TABLE field_changes ALTER COLUMN new_value DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_field_changes_run ON field_changes (run_id, created_at);

COMMENT ON TABLE field_changes IS
  'One row per value an enrichment run wrote (startups column, a new funding round "funding_rounds.<id>", or a filled round field "funding_rounds.<id>.<column>"), with the value it replaced and the run_id — every run can be undone by scripts/undo_run.ts. Rows written before 2026-11-08 are overwrites only, mostly without run_id.';

-- Confirm.
SELECT is_nullable FROM information_schema.columns WHERE table_name = 'field_changes' AND column_name = 'new_value';
