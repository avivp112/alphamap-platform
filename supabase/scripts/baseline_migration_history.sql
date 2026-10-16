-- =============================================================================
-- Evidence-based baseline of the Supabase migration history (2026-10-15).
--
-- WHY
--   Every migration here was applied by hand in the SQL Editor, so
--   supabase_migrations.schema_migrations does not record them, and
--   `supabase db push` (CI job migrate-database) would RUN every file it does
--   not find there — against the live database.
--
-- HOW THE LIST WAS BUILT
--   supabase/scripts/verify_migration_history.sql checked, per migration, that
--   the objects it creates exist (356 checks). 76 verified. The rest were
--   traced by hand — each is annotated below. Six that only change a
--   constraint or setting are re-checked by the guard block before anything
--   is written; if one did not really run, this script stops and names it.
--
-- LEFT PENDING ON PURPOSE (safe to re-run; the next CI pipeline applies them):
--     20260617000002  index idx_investors_not_verified missing (column exists); CREATE INDEX IF NOT EXISTS
--     20260930000000  notify_welcome_on_mandate_created missing; CREATE OR REPLACE + DROP TRIGGER IF EXISTS
--     20261013020000  secret-message wording; not run by hand; CREATE OR REPLACE
--
-- Run once in the SQL Editor. Re-running is harmless (ON CONFLICT DO NOTHING).
-- =============================================================================

-- ── Guard: the constraint/setting migrations really ran ──────────────────────
DO $$
DECLARE
  v_bad text[] := '{}';
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'sourcing_companies_ats_provider_check';
  IF v_def IS NULL OR v_def NOT LIKE '%workable%' THEN v_bad := v_bad || '20260726050000 (ats_provider check lacks workable)'::text; END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'raw_gov_filings_source_check';
  IF v_def IS NULL OR v_def NOT LIKE '%epo_ops%' THEN v_bad := v_bad || '20260726150000 (source check lacks epo_ops)'::text; END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'user_interactions_action_type_check';
  IF v_def IS NULL OR v_def NOT LIKE '%tearsheet_pdf%' THEN v_bad := v_bad || '20260928000000 (action_type check lacks tearsheet_pdf)'::text; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_webhooks_user_id') THEN
    v_bad := v_bad || '20260929000000 (uq_user_webhooks_user_id missing)'::text;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'funding_rounds_round_type_check';
  IF v_def IS NULL OR v_def NOT LIKE '%Convertible Note%' THEN v_bad := v_bad || '20261008000000 (round_type check lacks Convertible Note)'::text; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
     WHERE r.rolname = 'service_role' AND 'statement_timeout=180s' = ANY (s.setconfig)
  ) THEN
    v_bad := v_bad || '20261009000000 (service_role statement_timeout is not 180s)'::text;
  END IF;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'Not baselined — these migrations did not fully run: %. Run each file in the SQL Editor, then run this script again.', array_to_string(v_bad, '; ');
  END IF;
END
$$;

-- ── Record the applied migrations ────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY);
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS statements text[];
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS name text;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES
  ('20260526000000', 'init_market_intelligence_schema'),
  ('20260526000001', 'add_founders_to_startups'),
  ('20260526000002', 'add_investors_to_funding_rounds'),
  ('20260526000003', 'add_profile_columns'),
  ('20260604000001', 'alphamap_schema'),
  ('20260604000002', 'alphamap_fn'),
  ('20260608000001', 'headcount_history'),  -- superseded by 20260712000001 (headcount_history recreated with startup_id/employee_count); its bare CREATE TABLE cannot re-run
  ('20260614000001', 'deals_table'),
  ('20260617000001', 'investors_table'),
  ('20260618000001', 'investors_website_unique'),
  ('20260701000001', 'investors_tier'),
  ('20260701000002', 'alphamap_fn_fix'),
  ('20260712000000', 'add_startups_competitors'),
  ('20260712000001', 'create_headcount_history'),
  ('20260712000002', 'convert_founders_to_jsonb'),  -- founders_jsonb renamed to founders in the same file
  ('20260713000000', 'startups_scalable_search'),
  ('20260717000000', 'startups_schema_expansion'),  -- sub_sector_id + idx_startups_sub_sector dropped by 20260915000000
  ('20260719000000', 'automate_competitors'),  -- comment only
  ('20260719000100', 'investor_amounts_acquisitions_patents'),
  ('20260719000200', 'funding_history_complete'),
  ('20260719000300', 'dual_track_scoring'),
  ('20260720000000', 'pe_firms'),
  ('20260720000100', 'investors_enrichment'),
  ('20260720000200', 'pe_directory_debt'),
  ('20260721000000', 'semantic_search_pgvector'),
  ('20260722000000', 'watchlist_items'),
  ('20260723000000', 'startups_completeness_score'),
  ('20260725000000', 'public_companies'),
  ('20260726000000', 'public_companies_search'),
  ('20260726010000', 'sourcing_engine_schema'),
  ('20260726020000', 'sourcing_companies_last_crawled_at'),
  ('20260726030000', 'job_signals_extraction_and_fomo'),
  ('20260726040000', 'fomo_scaled_org_penalty'),
  ('20260726050000', 'ats_providers_ashby_workable'),  -- checked below: ats_provider CHECK includes workable
  ('20260726060000', 'fomo_gtm_signals'),
  ('20260726070000', 'fomo_company_age'),
  ('20260726080000', 'sourcing_weekly_cron'),  -- sourcing-weekly-* cron jobs replaced by 20260726100000
  ('20260726090000', 'board_discovery_candidates'),
  ('20260726100000', 'sourcing_cron_cadence'),
  ('20260726110000', 'raw_gov_filings'),
  ('20260726120000', 'form_d_pipeline'),
  ('20260726130000', 'gov_sources_expansion'),
  ('20260726140000', 'oss_sourcing_layer'),
  ('20260726150000', 'epo_ops_source'),  -- checked below: raw_gov_filings source CHECK includes epo_ops
  ('20260726160000', 'patent_excluded_applicants'),
  ('20260726170000', 'split_patent_ip_score'),
  ('20260726180000', 'entity_resolution_core'),
  ('20260726190000', 'company_merge'),
  ('20260726200000', 'entity_resolvers'),
  ('20260726210000', 'registrable_domain_public_suffix'),
  ('20260726220000', 'gov_entity_resolution_and_unlinked_fix'),
  ('20260726230000', 'oss_startup_linker'),
  ('20260726240000', 'domain_identifier_cleanup'),
  ('20260726250000', 'sourcing_ingestion_cron'),  -- ingest-uspto-patents unscheduled by 20261011000000 (ID.me)
  ('20260803000000', 'rejected_competitor_candidates'),
  ('20260811000000', 'materialize_startups_search'),
  ('20260811000001', 'startups_created_at_index'),
  ('20260824000000', 'social_links_news_score_history'),
  ('20260827000000', 'update_alphamap_score_formula'),
  ('20260907000000', 'startups_patents_column'),
  ('20260914000000', 'app_releases'),
  ('20260915000000', 'startup_sub_sector_tags'),
  ('20260924000000', 'preference_engine_phase1'),
  ('20260925000000', 'preference_vector_recompute'),
  ('20260926000000', 'match_scores_rpc'),
  ('20260927000000', 'hybrid_lookalikes_rpc'),
  ('20260928000000', 'tearsheet_pdf_action_type'),  -- checked below: action_type CHECK includes tearsheet_pdf
  ('20260929000000', 'user_webhooks_unique_per_user'),  -- checked below: uq_user_webhooks_user_id exists
  ('20260930010000', 'cron_job_audit_fixes'),
  ('20261001000000', 'top_thesis_matches_rpc'),
  ('20261001010000', 'watchlist_notes_and_tags'),
  ('20261002000000', 'notifications_dedupe_key'),
  ('20261002010000', 'generate_live_alerts_rpc'),
  ('20261003000000', 'fix_thesis_match_alert_embedding_timing'),
  ('20261003010000', 'startups_arr_tech_valuation_columns'),
  ('20261004000000', 'schedule_embedding_backfill'),
  ('20261004010000', 'harden_gov_filing_name_match'),
  ('20261005000000', 'update_embedding_vector_dimensions'),
  ('20261006000000', 'enrichment_v2_phase0_evidence'),
  ('20261007000000', 'enrichment_v2_provenance'),
  ('20261008000000', 'widen_round_type_check'),  -- checked below: round_type CHECK includes Convertible Note
  ('20261009000000', 'widen_refresh_startups_search_timeout'),  -- checked below: service_role statement_timeout = 180s
  ('20261010000000', 'startups_market_enriched_only'),
  ('20261011000000', 'pipeline_monitoring'),
  ('20261012000000', 'merge_unique_values_and_cron_cleanup'),
  ('20261013000000', 'cron_vault_url_fix'),
  ('20261013010000', 'cron_vault_key_role_check')
ON CONFLICT (version) DO NOTHING;

-- ── Result: what the next CI pipeline will run (expect exactly the 3 above) ──
SELECT f.version AS will_run_in_ci
  FROM (VALUES ('20260526000000'), ('20260526000001'), ('20260526000002'), ('20260526000003'), ('20260604000001'), ('20260604000002'), ('20260608000001'), ('20260614000001'), ('20260617000001'), ('20260617000002'), ('20260618000001'), ('20260701000001'), ('20260701000002'), ('20260712000000'), ('20260712000001'), ('20260712000002'), ('20260713000000'), ('20260717000000'), ('20260719000000'), ('20260719000100'), ('20260719000200'), ('20260719000300'), ('20260720000000'), ('20260720000100'), ('20260720000200'), ('20260721000000'), ('20260722000000'), ('20260723000000'), ('20260725000000'), ('20260726000000'), ('20260726010000'), ('20260726020000'), ('20260726030000'), ('20260726040000'), ('20260726050000'), ('20260726060000'), ('20260726070000'), ('20260726080000'), ('20260726090000'), ('20260726100000'), ('20260726110000'), ('20260726120000'), ('20260726130000'), ('20260726140000'), ('20260726150000'), ('20260726160000'), ('20260726170000'), ('20260726180000'), ('20260726190000'), ('20260726200000'), ('20260726210000'), ('20260726220000'), ('20260726230000'), ('20260726240000'), ('20260726250000'), ('20260803000000'), ('20260811000000'), ('20260811000001'), ('20260824000000'), ('20260827000000'), ('20260907000000'), ('20260914000000'), ('20260915000000'), ('20260924000000'), ('20260925000000'), ('20260926000000'), ('20260927000000'), ('20260928000000'), ('20260929000000'), ('20260930000000'), ('20260930010000'), ('20261001000000'), ('20261001010000'), ('20261002000000'), ('20261002010000'), ('20261003000000'), ('20261003010000'), ('20261004000000'), ('20261004010000'), ('20261005000000'), ('20261006000000'), ('20261007000000'), ('20261008000000'), ('20261009000000'), ('20261010000000'), ('20261011000000'), ('20261012000000'), ('20261013000000'), ('20261013010000'), ('20261013020000')) AS f(version)
 WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = f.version)
 ORDER BY 1;
