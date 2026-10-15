-- =============================================================================
-- Migration: resume UK Companies House and EPO ingestion
-- Created:   2026-10-16
-- Description:
--   Paused by 20261015010000 because every record became a company. With the
--   quality gate in the ingesters and 20261016000000 turning unknown companies
--   into review candidates instead of startups rows, both sources can run
--   again: a rejected record is stored alone, a passing one waits for an
--   admin. Nothing was missed — the UK job's next run (00:25 UTC) picks up
--   the previous day's incorporations, and EPO's weekly 14-day window covers
--   the pause.
-- Idempotent.
-- =============================================================================

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job
            WHERE jobname IN ('ingest-uk-companies-house', 'ingest-epo-ops')
  LOOP
    PERFORM cron.alter_job(j.jobid, active := true);
  END LOOP;
END
$$;

UPDATE source_expectations SET enabled = true, note = 'daily 00:25 UTC; yesterday''s tech-SIC incorporations'
 WHERE source = 'uk_companies_house';
UPDATE source_expectations SET enabled = true, note = 'weekly, Monday 02:00 UTC'
 WHERE source = 'epo_ops';

SELECT jobname, schedule, active FROM cron.job
 WHERE jobname IN ('ingest-uk-companies-house', 'ingest-epo-ops')
 ORDER BY jobname;
