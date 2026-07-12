-- =============================================================================
-- Migration: rename_headcount_history_columns
-- Created:   2026-07-12
-- Description: Renames headcount_history columns to match the standard naming
--              used elsewhere (startup_id, employee_count) and to make the
--              primary timeseries timestamp explicit (recorded_date):
--                company_id  -> startup_id
--                headcount   -> employee_count
--                recorded_at -> recorded_date
--              `snapshot_date` (date) is left untouched — it remains the
--              pipeline's one-row-per-company-per-day dedup key, used by
--              scripts/bulk_enrich_all.ts's upsert onConflict target.
--              Dependent objects (the CHECK constraint, the UNIQUE constraint,
--              and the startups FK) are updated automatically by Postgres when
--              their referenced column is renamed — no need to redefine them.
-- =============================================================================

ALTER TABLE headcount_history RENAME COLUMN company_id  TO startup_id;
ALTER TABLE headcount_history RENAME COLUMN headcount   TO employee_count;
ALTER TABLE headcount_history RENAME COLUMN recorded_at TO recorded_date;

ALTER TABLE headcount_history
  RENAME CONSTRAINT uq_headcount_company_day TO uq_headcount_history_startup_day;

-- Replace the old (company_id, snapshot_date) index with indexes matching the
-- renamed columns. The composite index also serves plain startup_id lookups
-- (Postgres can use a leading-column prefix of a composite index directly).
DROP INDEX IF EXISTS idx_headcount_history_company_time;

CREATE INDEX idx_headcount_history_startup_recorded
  ON headcount_history(startup_id, recorded_date DESC);

CREATE INDEX idx_headcount_history_recorded_date
  ON headcount_history(recorded_date DESC);
