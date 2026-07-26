-- =============================================================================
-- DOWN migration for 20260726100000_sourcing_cron_cadence.sql
--
-- Unschedules the three-job pipeline and restores the original weekly pair
-- from 20260726080000, so a rollback leaves a working schedule rather than no
-- schedule at all.
--
-- Deliberately NOT in supabase/migrations/ — the CLI would run it as a forward
-- migration and immediately undo the migration it is meant to reverse.
--
-- Requires sourcing_required_secret() from 20260726080000 to still exist.
-- =============================================================================

DO $$
DECLARE
  j text;
BEGIN
  FOREACH j IN ARRAY ARRAY[
    'sourcing-discover-boards',
    'sourcing-crawl-batch',
    'sourcing-extract-signals',
    'sourcing-weekly-crawl',
    'sourcing-weekly-extract'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
    END IF;
  END LOOP;
END;
$$;

-- Restore the weekly pair exactly as 20260726080000 defined it.
SELECT cron.schedule(
  'sourcing-weekly-crawl',
  '0 3 * * 1',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/sourcing-crawl',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')
               ),
    body    := jsonb_build_object('limit', 50),
    timeout_milliseconds := 300000
  );
  $cron$
);

SELECT cron.schedule(
  'sourcing-weekly-extract',
  '0 4 * * 1',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/extract-job-signals',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')
               ),
    body    := jsonb_build_object('limit', 2000),
    timeout_milliseconds := 300000
  );
  $cron$
);

SELECT jobname, schedule, active FROM cron.job
 WHERE jobname LIKE 'sourcing-%' ORDER BY jobname;
