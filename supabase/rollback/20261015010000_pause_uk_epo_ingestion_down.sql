-- Rollback of 20261015010000_pause_uk_epo_ingestion.sql: resume both jobs.
-- Run only once the quality gate decides what a UK incorporation or a patent
-- applicant becomes — otherwise every row is a company again.

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
