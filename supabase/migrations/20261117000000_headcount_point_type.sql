-- What a headcount point is (owner, 2026-11-04; types and columns revised 2026-11-07, before this migration ran):
--   registry           a register's figure (Companies House average employees, Brreg, CVR) — official
--   plan_participants  active participants of a Form 5500 plan — official, an approximation of employees
--   site_stated        a team-size sentence on the company's own page (current or an archived copy) — reported
--   press_reported     a team-size sentence in an article or release, at its date — reported
--   observed           a current figure read from an allowed source in the last two years
--   model_estimate     never shown, never written as data
--   legacy             every point that was in the table before this migration: its source was not recorded, so it is
--                      shown as a reported point, never counts as current, and never switches on "Live data" (owner, 2026-11-08)
-- Every point carries its source and quote; a floor ("75+") is marked; two points of different types in the
-- same month are both kept (the page shows both, with their types), so the day key now includes the type.
ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS point_type text NOT NULL DEFAULT 'legacy'
  CHECK (point_type IN ('registry', 'plan_participants', 'site_stated', 'press_reported', 'observed', 'model_estimate', 'legacy'));
ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS evidence_quote text;
ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS measure text;                       -- average_in_period | count_at_date | participants | range
ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS is_lower_bound boolean NOT NULL DEFAULT false;
ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS employee_count_max integer;         -- the upper end of a register range

ALTER TABLE headcount_history DROP CONSTRAINT IF EXISTS uq_headcount_history_startup_day;
ALTER TABLE headcount_history ADD CONSTRAINT uq_headcount_history_startup_day_type UNIQUE (startup_id, snapshot_date, point_type);
