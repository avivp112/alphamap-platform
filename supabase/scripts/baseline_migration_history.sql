-- =============================================================================
-- One-time baseline of the Supabase migration history.
--
-- WHY THIS EXISTS
--   The 30 migrations listed below were applied to this project by hand,
--   before the pipeline gained a `supabase db push` step. The remote therefore
--   has the tables but no record of which files produced them.
--
--   `supabase db push` reads supabase_migrations.schema_migrations to decide
--   what is pending. With that table empty it considers every file pending and
--   replays them — and four of the early ones use a bare CREATE TABLE, so the
--   push aborts with "relation already exists".
--
--   This script records the historical files as already applied WITHOUT
--   running them, so the next `db push` applies only genuinely new migrations.
--
-- DELIBERATELY NOT BASELINED (these have NOT been applied to the remote yet,
-- and must be left pending so `db push` actually creates the tables):
--     20260726010000_sourcing_engine_schema.sql
--     20260726020000_sourcing_companies_last_crawled_at.sql
--
-- WHEN TO RUN
--   Exactly once, against a database that already has the historical schema:
--
--     psql "$SUPABASE_DB_URL" -f supabase/scripts/baseline_migration_history.sql
--
--   Safe to re-run: ON CONFLICT DO NOTHING.
--
-- WARNING
--   Only run this if the listed migrations really ARE applied. Marking an
--   unapplied migration as applied means it will never run, and the schema
--   silently diverges from the code that expects it. On a fresh, EMPTY
--   database do NOT run this — let `supabase db push` apply everything.
--
--   Sanity check first (should list the app's existing tables):
--     psql "$SUPABASE_DB_URL" -c "\dt public.*"
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS supabase_migrations;

CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY
);

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES
  ('20260526000000'),  -- 20260526000000_init_market_intelligence_schema.sql
  ('20260526000001'),  -- 20260526000001_add_founders_to_startups.sql
  ('20260526000002'),  -- 20260526000002_add_investors_to_funding_rounds.sql
  ('20260526000003'),  -- 20260526000003_add_profile_columns.sql
  ('20260604000001'),  -- 20260604000001_alphamap_schema.sql
  ('20260604000002'),  -- 20260604000002_alphamap_fn.sql
  ('20260608000001'),  -- 20260608000001_headcount_history.sql
  ('20260614000001'),  -- 20260614000001_deals_table.sql
  ('20260617000001'),  -- 20260617000001_investors_table.sql
  ('20260617000002'),  -- 20260617000002_investors_is_manually_verified.sql
  ('20260618000001'),  -- 20260618000001_investors_website_unique.sql
  ('20260701000001'),  -- 20260701000001_investors_tier.sql
  ('20260701000002'),  -- 20260701000002_alphamap_fn_fix.sql
  ('20260712000000'),  -- 20260712000000_add_startups_competitors.sql
  ('20260712000001'),  -- 20260712000001_create_headcount_history.sql
  ('20260712000002'),  -- 20260712000002_convert_founders_to_jsonb.sql
  ('20260713000000'),  -- 20260713000000_startups_scalable_search.sql
  ('20260717000000'),  -- 20260717000000_startups_schema_expansion.sql
  ('20260719000000'),  -- 20260719000000_automate_competitors.sql
  ('20260719000100'),  -- 20260719000100_investor_amounts_acquisitions_patents.sql
  ('20260719000200'),  -- 20260719000200_funding_history_complete.sql
  ('20260719000300'),  -- 20260719000300_dual_track_scoring.sql
  ('20260720000000'),  -- 20260720000000_pe_firms.sql
  ('20260720000100'),  -- 20260720000100_investors_enrichment.sql
  ('20260720000200'),  -- 20260720000200_pe_directory_debt.sql
  ('20260721000000'),  -- 20260721000000_semantic_search_pgvector.sql
  ('20260722000000'),  -- 20260722000000_watchlist_items.sql
  ('20260723000000'),  -- 20260723000000_startups_completeness_score.sql
  ('20260725000000'),  -- 20260725000000_public_companies.sql
  ('20260726000000')  -- 20260726000000_public_companies_search.sql
ON CONFLICT (version) DO NOTHING;

SELECT count(*) AS baselined_versions FROM supabase_migrations.schema_migrations;
