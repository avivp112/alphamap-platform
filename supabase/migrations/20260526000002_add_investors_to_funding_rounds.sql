-- Add investors array column to funding_rounds.
-- Stores all known investors for a round; lead investor is first element.
ALTER TABLE funding_rounds
  ADD COLUMN IF NOT EXISTS investors text[];
