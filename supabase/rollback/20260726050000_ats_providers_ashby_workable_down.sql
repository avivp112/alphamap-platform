-- =============================================================================
-- ROLLBACK for: 20260726050000_ats_providers_ashby_workable.sql
--
-- Outside supabase/migrations/ on purpose. Run deliberately:
--   psql "$DATABASE_URL" -f supabase/rollback/20260726050000_ats_providers_ashby_workable_down.sql
--
-- WILL FAIL if any ashby/workable rows exist, and that is the intended
-- behaviour: narrowing the constraint while such rows are present would mean
-- either deleting sourced companies or leaving the table violating its own
-- CHECK. Postgres refuses, loudly, which is the right answer.
--
-- Check what would block it first:
--   SELECT ats_provider, count(*) FROM sourcing_companies
--    WHERE ats_provider IN ('ashby','workable') GROUP BY 1;
--
-- If those rows are genuinely disposable, remove them yourself before running
-- this — that deletion is a decision, not something a rollback should make on
-- your behalf.
-- =============================================================================

ALTER TABLE sourcing_companies
  DROP CONSTRAINT IF EXISTS sourcing_companies_ats_provider_check;

ALTER TABLE sourcing_companies
  ADD CONSTRAINT sourcing_companies_ats_provider_check
  CHECK (ats_provider IN ('greenhouse', 'lever'));
