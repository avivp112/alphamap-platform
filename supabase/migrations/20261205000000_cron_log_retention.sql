-- =============================================================================
-- Migration: cron_log_retention
-- Created:   2026-11-23 (owner's decision)
-- Description:
--   cron.job_run_details is pg_cron's own technical log of every scheduled run: 64 MB of the 478 MB used on the 500 MB plan. Keep 30 days of it.
--   Touches NO other table: field_changes, field_provenance, funding_rounds, headcount_history, startup_changes, early_job_postings … keep their whole history.
--   1. deletes the log rows older than 30 days (once, now); 2. schedules a daily job that does the same.
--   The disk space is returned to the database only by VACUUM FULL cron.job_run_details (a separate statement, scripts/sql/cron_log_cleanup.sql step 4).
-- Idempotent; safe to run more than once.
-- Rollback: SELECT cron.unschedule('cron-log-retention');  (deleted log rows cannot be restored; they are only a log)
-- =============================================================================

DELETE FROM cron.job_run_details WHERE coalesce(end_time, start_time) < now() - interval '30 days';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-log-retention') THEN
    PERFORM cron.unschedule('cron-log-retention');
  END IF;
END;
$$;

SELECT cron.schedule(
  'cron-log-retention', '40 3 * * *',
  $cron$ DELETE FROM cron.job_run_details WHERE coalesce(end_time, start_time) < now() - interval '30 days' $cron$
);
