-- =============================================================================
-- Migration: create_headcount_history
-- Created:   2026-07-12
-- Description: Creates headcount_history with the target schema (startup_id,
--              recorded_date, employee_count). An earlier migration
--              (20260608000001_headcount_history.sql) defined this table with
--              different column names (company_id, headcount, recorded_at),
--              but that migration was never actually applied to this
--              project's database, so this uses CREATE TABLE IF NOT EXISTS
--              with the correct target schema directly rather than renaming
--              columns on a table that doesn't exist.
--              `snapshot_date` (date) is kept as the pipeline's one-row-per-
--              startup-per-day dedup key, used by bulk_enrich_all.ts's upsert.
-- =============================================================================

CREATE TABLE IF NOT EXISTS headcount_history (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id     uuid        NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  recorded_date  timestamptz NOT NULL DEFAULT now(),
  employee_count integer     NOT NULL CHECK (employee_count >= 0),
  snapshot_date  date        NOT NULL DEFAULT CURRENT_DATE,

  CONSTRAINT uq_headcount_history_startup_day UNIQUE (startup_id, snapshot_date)
);

COMMENT ON TABLE headcount_history
  IS 'One employee-count snapshot per startup per calendar day, for Talent Velocity timeseries.';

CREATE INDEX IF NOT EXISTS idx_headcount_history_startup_recorded
  ON headcount_history(startup_id, recorded_date DESC);

CREATE INDEX IF NOT EXISTS idx_headcount_history_recorded_date
  ON headcount_history(recorded_date DESC);

-- RLS: anyone can read; only service_role (pipeline / edge functions) can write
ALTER TABLE headcount_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "headcount_history_public_read" ON headcount_history;
CREATE POLICY "headcount_history_public_read"
  ON headcount_history FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "headcount_history_service_write" ON headcount_history;
CREATE POLICY "headcount_history_service_write"
  ON headcount_history FOR ALL
  USING (auth.role() = 'service_role');
