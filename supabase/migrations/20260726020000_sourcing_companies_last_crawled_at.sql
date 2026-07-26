-- =============================================================================
-- Migration: sourcing_companies.last_crawled_at
-- Created:   2026-07-26
-- Description:
--   Adds crawl scheduling state to sourcing_companies.
--
--   The crawler picks its next batch with
--     ORDER BY last_crawled_at ASC NULLS FIRST
--   so never-crawled boards go first and the rest round-robin by staleness.
--   NULL therefore means "discovered but never crawled", which is distinct
--   from "crawled and found empty" — the scheduler needs to tell those apart.
--
--   Deliberately nullable with no default: backfilling now() on existing rows
--   would mark every already-discovered board as freshly crawled and starve
--   them from the first few batches.
--
-- Rollback: supabase/rollback/20260726020000_sourcing_companies_last_crawled_at_down.sql
--
-- Idempotent; safe to run more than once.
-- =============================================================================

ALTER TABLE sourcing_companies
  ADD COLUMN IF NOT EXISTS last_crawled_at timestamptz;

COMMENT ON COLUMN sourcing_companies.last_crawled_at IS
  'When the crawler last completed a pass over this board. NULL = never crawled; ordered NULLS FIRST so new boards are picked up first.';

-- Matches the scheduler''s ORDER BY exactly. Postgres defaults ASC to NULLS
-- LAST, so the index has to spell out NULLS FIRST to be usable for this sort.
CREATE INDEX IF NOT EXISTS idx_sourcing_companies_crawl_queue
  ON sourcing_companies (last_crawled_at ASC NULLS FIRST);
