-- Rollback for 20260726250000_sourcing_ingestion_cron.sql
-- Unschedules all 10 jobs this migration created. Does not touch the ATS
-- layer jobs (sourcing-discover-boards / sourcing-crawl-batch /
-- sourcing-extract-signals) or sourcing_required_secret(), both defined and
-- owned by earlier migrations.

DO $$
DECLARE
  j text;
BEGIN
  FOREACH j IN ARRAY ARRAY[
    'ingest-sec-form-d', 'ingest-uk-companies-house', 'ingest-uspto-patents',
    'ingest-epo-ops', 'ingest-github-velocity', 'ingest-huggingface',
    'link-oss-projects', 'resolve-tier1-identity',
    'queue-tier2-candidates', 'queue-tier3-candidates'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
    END IF;
  END LOOP;
END;
$$;
