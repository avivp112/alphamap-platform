-- =============================================================================
-- Migration: allow 'ashby' and 'workable' as ATS providers
-- Created:   2026-07-26
-- Description:
--   sourcing_companies.ats_provider was CHECKed against ('greenhouse','lever').
--   Real sourcing hit that wall immediately: oak, hemispheric and glow-security
--   all 404 on Greenhouse because they are on newer ATS platforms. Those are
--   exactly the early-stage companies this engine exists to find, so the
--   constraint was excluding the target population.
--
--   Widens the allowed set to ('greenhouse','lever','ashby','workable').
--
--   The CHECK is kept rather than swapped for a Postgres ENUM on purpose:
--   adding a value to an ENUM cannot run inside a transaction block in older
--   Postgres and is awkward to reverse, whereas a CHECK is a one-line
--   DROP/ADD in a normal migration. The list is expected to keep growing
--   (Rippling, Pinpoint, Recruitee), so cheap widening matters more than the
--   marginal storage win.
--
-- Rollback: supabase/rollback/20260726050000_ats_providers_ashby_workable_down.sql
--   NOTE the rollback will FAIL if any ashby/workable rows exist by then —
--   deliberately, since silently deleting sourced companies to satisfy a
--   constraint would be worse.
--
-- Idempotent; safe to run more than once.
-- =============================================================================

ALTER TABLE sourcing_companies
  DROP CONSTRAINT IF EXISTS sourcing_companies_ats_provider_check;

ALTER TABLE sourcing_companies
  ADD CONSTRAINT sourcing_companies_ats_provider_check
  CHECK (ats_provider IN ('greenhouse', 'lever', 'ashby', 'workable'));

COMMENT ON COLUMN sourcing_companies.ats_provider IS
  'Which ATS hosts this board: greenhouse | lever | ashby | workable. Widen the CHECK constraint in a migration to add more.';
