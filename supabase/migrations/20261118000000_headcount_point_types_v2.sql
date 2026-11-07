-- Headcount point types, second step (owner, 2026-11-08). 20261117000000 had already run: its column exists with the
-- default 'observed', so every point on file reads 'observed'. This migration, safe to run once or twice:
--   * widens the type list: registry, plan_participants, site_stated, press_reported, observed, model_estimate, legacy
--   * adds the source, quote, measure, floor and range columns
--   * makes 'legacy' the default and turns every point on file into 'legacy' — its source was not recorded, so it is
--     shown as a reported point, never counts as the current number, and never switches on "Live data"
--   * the day key now includes the type, so two points of different types in one month can both be kept
-- Points written after this migration always carry their own type.
ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS point_type text NOT NULL DEFAULT 'legacy';
ALTER TABLE headcount_history DROP CONSTRAINT IF EXISTS headcount_history_point_type_check;
ALTER TABLE headcount_history ADD CONSTRAINT headcount_history_point_type_check
  CHECK (point_type IN ('registry', 'plan_participants', 'site_stated', 'press_reported', 'observed', 'model_estimate', 'legacy'));
ALTER TABLE headcount_history ALTER COLUMN point_type SET DEFAULT 'legacy';

ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS evidence_quote text;
ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS measure text;                       -- average_in_period | count_at_date | participants | range
ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS is_lower_bound boolean NOT NULL DEFAULT false;
ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS employee_count_max integer;         -- the upper end of a register range

-- Only points with no recorded source: a point written with its source later is never touched.
UPDATE headcount_history SET point_type = 'legacy' WHERE point_type = 'observed' AND source_url IS NULL;

ALTER TABLE headcount_history DROP CONSTRAINT IF EXISTS uq_headcount_history_startup_day;
ALTER TABLE headcount_history DROP CONSTRAINT IF EXISTS uq_headcount_history_startup_day_type;
ALTER TABLE headcount_history ADD CONSTRAINT uq_headcount_history_startup_day_type UNIQUE (startup_id, snapshot_date, point_type);
