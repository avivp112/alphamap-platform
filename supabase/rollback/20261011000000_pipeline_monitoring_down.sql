-- Rollback for 20261011000000_pipeline_monitoring.sql
-- Unschedules the two health jobs, drops the functions, view and tables, and
-- puts ingest-uspto-patents back on its weekly Monday 01:30 UTC schedule.
-- Notifications the checks already wrote are kept (alert history).

DO $$
DECLARE
  j text;
BEGIN
  FOREACH j IN ARRAY ARRAY['pipeline-health-daily', 'pipeline-health-watchdog'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
    END IF;
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS pipeline_health_watchdog();
DROP FUNCTION IF EXISTS record_pipeline_health(jsonb, boolean);
DROP FUNCTION IF EXISTS pipeline_health_snapshot();
DROP VIEW IF EXISTS source_health;
DROP TABLE IF EXISTS pipeline_health_checks;
DROP TABLE IF EXISTS pipeline_alert_recipients;
DROP TABLE IF EXISTS source_expectations;
DROP TABLE IF EXISTS source_runs;

SELECT cron.schedule(
  'ingest-uspto-patents', '30 1 * * 1',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/ingest-uspto-patents',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);
