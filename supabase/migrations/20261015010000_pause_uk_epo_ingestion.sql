-- =============================================================================
-- Migration: pause UK Companies House and EPO ingestion until the quality gate
-- Created:   2026-10-15
-- Description:
--   Every UK incorporation and every EPO patent applicant these two ingesters
--   see becomes a startups row, with no filter in between: in the 60 days to
--   2026-10-15, 200 of 200 UK filings and 72 of 87 EPO filings created a
--   company. 24 of 25 sampled UK rows had a single director (contractor
--   companies), and the EPO sample was mostly corporations (Disney, GM,
--   Intuit, Zoom, Google DeepMind's GDM Holding) and private individuals.
--   Those rows are hidden from the Private Market page (no description), but
--   enrichment v2 picks never-enriched empty rows FIRST, so the next run would
--   spend on them and, if it found data, publish them.
--
--   Both jobs are paused (cron.alter_job active := false — the definitions
--   stay, so resuming is one statement) until the quality gate and the
--   candidate review queue replace direct creation. No data is lost: both
--   sources can be re-fetched by date range, and the paused days will go
--   through the gate when it ships.
--
--   source_expectations marks both disabled so the daily health check does
--   not report a deliberate pause as an outage. SEC Form D, GitHub, Hugging
--   Face and the job-board crawl keep running.
--
-- Rollback: supabase/rollback/20261015010000_pause_uk_epo_ingestion_down.sql
-- Idempotent.
-- =============================================================================

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid, jobname FROM cron.job
            WHERE jobname IN ('ingest-uk-companies-house', 'ingest-epo-ops')
  LOOP
    PERFORM cron.alter_job(j.jobid, active := false);
    RAISE NOTICE 'paused %', j.jobname;
  END LOOP;
END
$$;

UPDATE source_expectations
   SET enabled = false,
       note = 'paused 2026-10-15 until the quality gate + candidate review queue: every row created a company unfiltered (contractor one-director UK companies, corporations and individuals from EPO). Re-fetch the paused dates through the gate on resume.'
 WHERE source IN ('uk_companies_house', 'epo_ops');

SELECT jobname, schedule, active FROM cron.job
 WHERE jobname IN ('ingest-uk-companies-house', 'ingest-epo-ops')
 ORDER BY jobname;
