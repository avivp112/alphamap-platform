-- =============================================================================
-- ROLLBACK for: 20260726010000_sourcing_engine_schema.sql
--
-- This file lives OUTSIDE supabase/migrations/ on purpose. The Supabase CLI
-- applies every .sql in migrations/ in filename order, so a "down" file placed
-- there would be executed as a forward migration and drop the tables it was
-- meant to protect.
--
-- Run it deliberately, never automatically:
--
--   psql "$DATABASE_URL" -f supabase/rollback/20260726010000_sourcing_engine_schema_down.sql
--
-- WARNING: this is destructive. It drops all three tables and every row in
-- them — including the crawl history that time-to-fill is derived from, which
-- cannot be reconstructed by re-crawling (a posting that closed while the
-- tables were gone is simply never observed). Snapshot first if the data has
-- any value:
--
--   pg_dump "$DATABASE_URL" -t sourcing_companies -t early_job_postings \
--           -t job_signals > sourcing_engine_backup.sql
--
-- Order matters: children before parents. The FKs are ON DELETE CASCADE, so
-- dropping sourcing_companies alone would take the rest with it, but dropping
-- explicitly in dependency order keeps the intent obvious and works even if a
-- future migration changes the cascade behaviour.
-- =============================================================================

-- Policies and grants disappear with their tables; dropped explicitly first so
-- a partial rollback (tables already gone, policies orphaned) cannot wedge.
DROP POLICY IF EXISTS "job_signals_read_authenticated"        ON job_signals;
DROP POLICY IF EXISTS "job_signals_service_all"               ON job_signals;
DROP POLICY IF EXISTS "early_job_postings_read_authenticated" ON early_job_postings;
DROP POLICY IF EXISTS "early_job_postings_service_all"        ON early_job_postings;
DROP POLICY IF EXISTS "sourcing_companies_read_authenticated" ON sourcing_companies;
DROP POLICY IF EXISTS "sourcing_companies_service_all"        ON sourcing_companies;

DROP INDEX IF EXISTS idx_job_signals_type_value;
DROP INDEX IF EXISTS idx_job_signals_job_id;
DROP INDEX IF EXISTS idx_early_job_postings_closed_at;
DROP INDEX IF EXISTS idx_early_job_postings_active;
DROP INDEX IF EXISTS idx_early_job_postings_company_id;
DROP INDEX IF EXISTS idx_sourcing_companies_inferred_name_lower;
DROP INDEX IF EXISTS idx_sourcing_companies_discovered_at;

DROP TABLE IF EXISTS job_signals;
DROP TABLE IF EXISTS early_job_postings;
DROP TABLE IF EXISTS sourcing_companies;
