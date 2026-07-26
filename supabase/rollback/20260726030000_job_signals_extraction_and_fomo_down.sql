-- =============================================================================
-- ROLLBACK for: 20260726030000_job_signals_extraction_and_fomo.sql
--
-- Outside supabase/migrations/ on purpose — see the note in
-- 20260726010000_sourcing_engine_schema_down.sql. Run deliberately:
--
--   psql "$DATABASE_URL" -f supabase/rollback/20260726030000_job_signals_extraction_and_fomo_down.sql
--
-- Dropping signals_extracted_at loses extraction bookkeeping only — the
-- signals themselves live in job_signals and survive. The next extractor run
-- simply treats every posting as pending and reprocesses it, which is correct
-- but re-does work.
-- =============================================================================

DROP VIEW  IF EXISTS sourcing_fomo_scores;
DROP INDEX IF EXISTS idx_early_job_postings_signals_pending;

ALTER TABLE early_job_postings
  DROP COLUMN IF EXISTS signals_extracted_at;
