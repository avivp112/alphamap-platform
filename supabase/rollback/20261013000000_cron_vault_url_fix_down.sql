-- Rollback for 20261013000000_cron_vault_url_fix.sql
--
-- The repaired Vault value project_url is NOT reverted: the old value was a
-- placeholder that made every scheduled HTTP call fail.
--
-- To restore the previous functions, re-run the sourcing_required_secret()
-- definition from supabase/migrations/20260726080000_sourcing_weekly_cron.sql
-- and the pipeline_health_watchdog() definition from
-- supabase/migrations/20261011000000_pipeline_monitoring.sql, then:
DROP FUNCTION IF EXISTS sourcing_jwt_claims(text);
