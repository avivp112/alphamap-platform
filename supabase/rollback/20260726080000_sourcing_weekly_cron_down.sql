-- =============================================================================
-- ROLLBACK for: 20260726080000_sourcing_weekly_cron.sql
--   psql "$DATABASE_URL" -f supabase/rollback/20260726080000_sourcing_weekly_cron_down.sql
--
-- Unschedules both weekly jobs and drops the secret-reader helper. The Vault
-- secrets themselves are LEFT IN PLACE — deleting a credential is a decision
-- for you, not something a rollback should do. Remove them explicitly if you
-- want them gone:
--   select vault.delete_secret(id) from vault.secrets
--    where name in ('project_url','service_role_key');
--
-- Extensions pg_cron / pg_net are also left installed: other things may rely
-- on them, and dropping an extension cascades to every dependent object.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sourcing-weekly-crawl') THEN
    PERFORM cron.unschedule('sourcing-weekly-crawl');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sourcing-weekly-extract') THEN
    PERFORM cron.unschedule('sourcing-weekly-extract');
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS sourcing_required_secret(text);
