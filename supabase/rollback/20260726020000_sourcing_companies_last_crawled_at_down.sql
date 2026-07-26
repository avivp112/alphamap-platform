-- =============================================================================
-- ROLLBACK for: 20260726020000_sourcing_companies_last_crawled_at.sql
--
-- Outside supabase/migrations/ on purpose — see the note in
-- 20260726010000_sourcing_engine_schema_down.sql. Run deliberately:
--
--   psql "$DATABASE_URL" -f supabase/rollback/20260726020000_sourcing_companies_last_crawled_at_down.sql
--
-- Dropping this column loses all crawl scheduling state. It is recoverable in
-- the sense that the crawler will simply treat every board as never-crawled
-- and work through the whole backlog again — correct, just expensive.
-- =============================================================================

DROP INDEX IF EXISTS idx_sourcing_companies_crawl_queue;

ALTER TABLE sourcing_companies
  DROP COLUMN IF EXISTS last_crawled_at;
