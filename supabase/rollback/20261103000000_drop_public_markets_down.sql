-- Rollback of 20261103000000_drop_public_markets.sql: schedules the daily
-- public-markets sync again (as in 20260930010000_cron_job_audit_fixes.sql).
-- Only useful once the sync-public-markets function is deployed again
-- (restore it from git history) and FMP_API_KEY is set.
SELECT cron.schedule(
  'sync-public-markets-daily',
  '0 6 * * *',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/sync-public-markets',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);
