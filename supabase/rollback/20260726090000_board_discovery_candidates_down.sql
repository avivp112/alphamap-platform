-- =============================================================================
-- ROLLBACK for: 20260726090000_board_discovery_candidates.sql
--   psql "$DATABASE_URL" -f supabase/rollback/20260726090000_board_discovery_candidates_down.sql
--
-- Drops the candidate view and the discovery-progress column. Boards already
-- registered in sourcing_companies are untouched — this only removes the
-- machinery that finds new ones.
--
-- Dropping board_discovery_at loses the record of which companies have been
-- attempted, so a re-applied discovery run would re-probe everything from
-- scratch. Correct, just wasteful.
-- =============================================================================

DROP VIEW  IF EXISTS board_discovery_candidates;
DROP INDEX IF EXISTS idx_startups_board_discovery_pending;
ALTER TABLE startups DROP COLUMN IF EXISTS board_discovery_at;
