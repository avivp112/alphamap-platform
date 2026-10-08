-- =============================================================================
-- Migration: pipeline monitoring — run log per source + daily health check
-- Created:   2026-10-11
-- Description:
--   The sourcing pipeline failed silently. pg_cron reaches every source
--   Edge Function through net.http_post, which only QUEUES the request:
--   cron.job_run_details records "succeeded" the moment it is queued. A
--   missing API key, a 403 from the upstream API, or a function that was
--   never deployed (backfill-embeddings was missing from the CI deploy list)
--   all looked like a healthy run. Nothing checked whether rows arrived, or
--   whether the one TEI server on RunPod that every embedding — and so every
--   thesis-match alert — depends on was up.
--
--   1. source_runs — one row per invocation of each source function
--      (written by supabase/functions/_shared/run-log.ts): status
--      ok / empty / partial / error / dry_run, rows that came in, the error
--      in plain words, the HTTP status, and a compact copy of the response.
--   2. source_expectations — what "healthy" means per source: how recent
--      new rows (or a successful run) must be. Data, not code: change a
--      window with an UPDATE.
--   3. source_health — view: per source, its last run, last success, last
--      rows from the run log, and the newest row actually in its data table
--      (so a source is judged by what arrived, even for runs from before the
--      run log existed).
--   4. pipeline_health_snapshot() — every fact the daily check needs, as
--      jsonb. pipeline_health_checks + record_pipeline_health() — stores each
--      day's results and turns each failure into an in-app notification for
--      the addresses in pipeline_alert_recipients (at most once per check
--      per day). The pipeline-health Edge Function adds the TEI probe and the
--      email.
--   5. pg_cron: pipeline-health-daily at 05:30 UTC (after the ingesters,
--      resolvers and the 04:00 embedding job) and pipeline-health-watchdog
--      at 06:30 UTC — plain SQL, so it still runs when the Edge Function is
--      not deployed or crashes, and notifies when no check ran in 26h.
--   6. USPTO is taken off the schedule. PatentsView keys now go through
--      USPTO's ID.me identity verification, which needs a US SSN or US
--      government ID (see supabase/functions/ingest-epo-ops/index.ts). EPO
--      OPS already covers US publications (DOCDB is worldwide). The function
--      stays deployed for manual use; its expectation row is disabled so the
--      health check does not report it.
--
-- Rollback: supabase/rollback/20261011000000_pipeline_monitoring_down.sql
-- Idempotent.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── 1. Run log ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS source_runs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text        NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text        NOT NULL DEFAULT 'running'
                           CHECK (status IN ('running', 'ok', 'empty', 'partial', 'error', 'dry_run')),
  rows_in      integer     NOT NULL DEFAULT 0,
  error        text,
  http_status  integer,
  detail       jsonb
);

COMMENT ON TABLE source_runs IS
  'One row per invocation of a sourcing Edge Function (written by _shared/run-log.ts). status: running (never finished = killed by a time limit), ok (rows came in), empty (worked, wrote nothing), partial (some items failed), error, dry_run. Read source_health for the per-source summary.';

CREATE INDEX IF NOT EXISTS idx_source_runs_source_started ON source_runs (source, started_at DESC);

ALTER TABLE source_runs ENABLE ROW LEVEL SECURITY;   -- service role only

-- ── 2. What healthy means, per source ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS source_expectations (
  source           text    PRIMARY KEY,
  label            text    NOT NULL,
  enabled          boolean NOT NULL DEFAULT true,
  max_age_hours    integer NOT NULL CHECK (max_age_hours > 0),
  -- true: new rows must have arrived within the window. false: a successful
  -- run is enough (an empty run is normal for this source).
  require_rows     boolean NOT NULL,
  -- SEC publishes no Form D index on weekends; "yesterday's" UK tech
  -- incorporations can be zero. These get 72h on Sunday and Monday (UTC).
  weekend_tolerant boolean NOT NULL DEFAULT false,
  note             text
);

COMMENT ON TABLE source_expectations IS
  'Health rules per source, read by the daily pipeline-health check. Change a window with UPDATE source_expectations SET max_age_hours = ... ; switch a source off with enabled = false.';

ALTER TABLE source_expectations ENABLE ROW LEVEL SECURITY;

INSERT INTO source_expectations (source, label, enabled, max_age_hours, require_rows, weekend_tolerant, note) VALUES
  ('sec_form_d',          'SEC Form D',                    true,  24,  true,  true,  'daily 00:10 UTC; Form D index is published on business days'),
  ('uk_companies_house',  'UK Companies House',            true,  24,  true,  true,  'daily 00:25 UTC; yesterday''s tech-SIC incorporations'),
  ('github_velocity',     'GitHub',                        true,  24,  true,  false, 'daily 00:40 UTC'),
  ('huggingface',         'Hugging Face',                  true,  24,  true,  false, 'daily 00:55 UTC'),
  ('epo_ops',             'EPO patents',                   true,  192, true,  false, 'weekly, Monday 02:00 UTC'),
  ('uspto_patents',       'USPTO patents',                 false, 192, true,  false, 'off the schedule since 2026-10-11: the PatentsView key needs ID.me (US SSN / US government ID). EPO OPS covers US publications.'),
  ('ats_crawl',           'Job boards (crawl)',            true,  24,  false, false, 'every 2h; an empty run is normal'),
  ('discover_boards',     'Job boards (discovery)',        true,  24,  false, false, 'hourly; usually finds nothing'),
  ('extract_job_signals', 'Job boards (signals)',          true,  24,  false, false, 'hourly; usually nothing pending'),
  ('backfill_embeddings', 'Embedding job',                 true,  26,  false, false, 'daily 04:00 UTC; also checked by the embeddings rule')
ON CONFLICT (source) DO NOTHING;

-- ── 3. Who is alerted ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_alert_recipients (
  email    text        PRIMARY KEY CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  added_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE pipeline_alert_recipients IS
  'Who hears about pipeline failures: an email (when RESEND_API_KEY is set on the pipeline-health function) and an in-app notification for the account with that email, if one exists. Add or remove addresses with INSERT / DELETE.';

ALTER TABLE pipeline_alert_recipients ENABLE ROW LEVEL SECURITY;

-- The same address the Contact Us form already delivers to (send-contact-message).
INSERT INTO pipeline_alert_recipients (email) VALUES ('avivp112@gmail.com') ON CONFLICT DO NOTHING;

-- ── 4. Daily results ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_health_checks (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id      uuid        NOT NULL,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  check_name  text        NOT NULL,
  ok          boolean     NOT NULL,
  detail      text
);

CREATE INDEX IF NOT EXISTS idx_pipeline_health_checks_at ON pipeline_health_checks (checked_at DESC);

ALTER TABLE pipeline_health_checks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE pipeline_health_checks IS
  'One row per check per daily pipeline-health run. Latest results: SELECT * FROM pipeline_health_checks ORDER BY checked_at DESC LIMIT 30;';

-- ── 5. Per-source summary ────────────────────────────────────────────────────
CREATE OR REPLACE VIEW source_health
WITH (security_invoker = on) AS
SELECT
  e.source, e.label, e.enabled, e.max_age_hours, e.require_rows, e.weekend_tolerant, e.note,
  lr.started_at                                         AS last_run_at,
  lr.status                                             AS last_status,
  lr.error                                              AS last_error,
  (SELECT max(r.started_at) FROM source_runs r
    WHERE r.source = e.source AND r.status IN ('ok', 'empty', 'partial'))      AS last_ok_at,
  (SELECT max(r.started_at) FROM source_runs r
    WHERE r.source = e.source AND r.rows_in > 0 AND r.status <> 'dry_run')   AS last_rows_at,
  CASE e.source
    WHEN 'sec_form_d'          THEN (SELECT max(ingested_at) FROM raw_gov_filings WHERE source = 'sec_form_d')
    WHEN 'uk_companies_house'  THEN (SELECT max(ingested_at) FROM raw_gov_filings WHERE source = 'uk_companies_house')
    WHEN 'epo_ops'             THEN (SELECT max(ingested_at) FROM raw_gov_filings WHERE source = 'epo_ops')
    WHEN 'uspto_patents'       THEN (SELECT max(ingested_at) FROM raw_gov_filings WHERE source = 'uspto_patent')
    WHEN 'github_velocity'     THEN (SELECT max(m.observed_at) FROM oss_project_metrics m JOIN oss_projects p ON p.id = m.project_id
                                      WHERE p.source = 'github_repo')
    WHEN 'huggingface'         THEN (SELECT max(m.observed_at) FROM oss_project_metrics m JOIN oss_projects p ON p.id = m.project_id
                                      WHERE p.source LIKE 'huggingface_%')
    WHEN 'ats_crawl'           THEN (SELECT max(first_seen_at) FROM early_job_postings)
    WHEN 'backfill_embeddings' THEN (SELECT max(embedding_updated_at) FROM startups)
  END                                                   AS data_last_row_at,
  (SELECT count(*) FROM source_runs r WHERE r.source = e.source AND r.started_at > now() - interval '7 days' AND r.status <> 'dry_run') AS runs_7d,
  (SELECT count(*) FROM source_runs r WHERE r.source = e.source AND r.started_at > now() - interval '7 days' AND r.status = 'error')    AS errors_7d
FROM source_expectations e
LEFT JOIN LATERAL (
  SELECT r.started_at, r.status, r.error FROM source_runs r
   WHERE r.source = e.source AND r.status <> 'dry_run'
   ORDER BY r.started_at DESC LIMIT 1
) lr ON true;

-- Operator view: not readable through the public API.
REVOKE ALL ON source_health FROM anon, authenticated;
GRANT SELECT ON source_health TO service_role;

COMMENT ON VIEW source_health IS
  'Per source: last run and its status/error, last successful run, last run that brought rows, and the newest row actually present in the source''s data table. SELECT * FROM source_health;';

-- ── 6. Facts for the daily check ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pipeline_health_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT jsonb_build_object(
    'now', now(),
    'sources', COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.source) FROM source_health h), '[]'::jsonb),
    'cron', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'jobname', j.jobname,
        'active', j.active,
        'last_run_at', lr.start_time,
        'last_status', lr.status,
        'last_message', left(lr.return_message, 300),
        'last_success_at', (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.status = 'succeeded'),
        'failures_24h', (SELECT count(*) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.status = 'failed'
                           AND d.start_time > now() - interval '24 hours')
      ) ORDER BY j.jobname)
      FROM cron.job j
      LEFT JOIN LATERAL (
        SELECT d.start_time, d.status, d.return_message FROM cron.job_run_details d
         WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1
      ) lr ON true
    ), '[]'::jsonb),
    'embeddings', (
      SELECT jsonb_build_object(
        'backlog', count(*),
        'oldest_backlog_at', min(s.created_at),
        'last_embedded_at', (SELECT max(embedding_updated_at) FROM startups)
      )
      FROM startups s
      WHERE s.embedding IS NULL
        AND coalesce(btrim(s.description), '') <> ''
        AND s.created_at < now() - interval '26 hours'
    )
  );
$$;

COMMENT ON FUNCTION pipeline_health_snapshot() IS
  'Everything the pipeline-health Edge Function judges: source_health rows, every pg_cron job''s last run / last success / failures in 24h, and the embedding backlog (companies with a description and no embedding for over 26h).';

-- ── 7. Store results, notify ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_pipeline_health(p_checks jsonb, p_notify boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run uuid := gen_random_uuid();
  n_notified integer := 0;
BEGIN
  INSERT INTO pipeline_health_checks (run_id, check_name, ok, detail)
  SELECT v_run, c->>'check', (c->>'ok')::boolean, c->>'detail'
    FROM jsonb_array_elements(p_checks) c;

  IF p_notify THEN
    WITH failed AS (
      SELECT c->>'check' AS check_name, c->>'detail' AS detail
        FROM jsonb_array_elements(p_checks) c
       WHERE NOT (c->>'ok')::boolean
    ), admins AS (
      SELECT u.id FROM auth.users u
        JOIN pipeline_alert_recipients r ON lower(r.email) = lower(u.email)
    ), inserted AS (
      INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
      SELECT a.id, 'pipeline_health', 'Pipeline problem: ' || f.check_name, left(f.detail, 1000), '/my-area?tab=alerts',
             'health:' || f.check_name || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        FROM failed f CROSS JOIN admins a
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO n_notified FROM inserted;
  END IF;

  RETURN jsonb_build_object(
    'run_id', v_run,
    'notified', n_notified,
    'recipients', COALESCE((SELECT jsonb_agg(email ORDER BY email) FROM pipeline_alert_recipients), '[]'::jsonb)
  );
END;
$$;

-- ── 8. Watchdog: the check itself stopped running ────────────────────────────
CREATE OR REPLACE FUNCTION pipeline_health_watchdog()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
BEGIN
  -- Keep the run log bounded.
  DELETE FROM source_runs WHERE started_at < now() - interval '90 days';
  DELETE FROM pipeline_health_checks WHERE checked_at < now() - interval '180 days';

  IF NOT EXISTS (SELECT 1 FROM pipeline_health_checks WHERE checked_at > now() - interval '26 hours') THEN
    WITH inserted AS (
      INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
      SELECT u.id, 'pipeline_health', 'Pipeline health check did not run',
             'No pipeline-health results in the last 26 hours. The pipeline-health Edge Function is probably not deployed, or failed before saving (Supabase Dashboard -> Edge Functions -> pipeline-health -> Logs). Until it runs, source failures go unreported.',
             '/my-area?tab=alerts',
             'health:watchdog:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        FROM auth.users u JOIN pipeline_alert_recipients r ON lower(r.email) = lower(u.email)
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO n FROM inserted;
    RETURN jsonb_build_object('health_check_missing', true, 'notified', n);
  END IF;
  RETURN jsonb_build_object('health_check_missing', false);
END;
$$;

REVOKE ALL ON FUNCTION pipeline_health_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_pipeline_health(jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pipeline_health_watchdog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pipeline_health_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION record_pipeline_health(jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION pipeline_health_watchdog() TO service_role;

-- ── 9. Schedules ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  j text;
BEGIN
  FOREACH j IN ARRAY ARRAY['pipeline-health-daily', 'pipeline-health-watchdog', 'ingest-uspto-patents'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
    END IF;
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'pipeline-health-daily', '30 5 * * *',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/pipeline-health',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

SELECT cron.schedule('pipeline-health-watchdog', '30 6 * * *', $cron$SELECT pipeline_health_watchdog();$cron$);

-- End state: the two new jobs present, ingest-uspto-patents gone.
SELECT jobname, schedule, active FROM cron.job
 WHERE jobname IN ('pipeline-health-daily', 'pipeline-health-watchdog', 'ingest-uspto-patents')
 ORDER BY jobname;
