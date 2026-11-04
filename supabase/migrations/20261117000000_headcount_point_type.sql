-- What a headcount point is (owner, 2026-11-04): "observed" (the current headcount, from a
-- source of the last two years), "press_reported" (an older article's dated figure — a point
-- of the history, never the current headcount) or "model_estimate".
ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS point_type text NOT NULL DEFAULT 'observed'
  CHECK (point_type IN ('observed', 'press_reported', 'model_estimate'));
