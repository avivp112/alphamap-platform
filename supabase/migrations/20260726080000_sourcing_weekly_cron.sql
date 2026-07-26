-- =============================================================================
-- Migration: weekly automated sourcing pipeline (pg_cron + pg_net)
-- Created:   2026-07-26
-- Description:
--   Schedules the two-step pipeline to run every week without intervention:
--     Mon 03:00 UTC  sourcing-crawl        (batch mode)
--     Mon 04:00 UTC  extract-job-signals   (re-scores the leaderboard)
--
-- ── SECRETS: READ THIS BEFORE RUNNING ───────────────────────────────────────
--   Calling an Edge Function from Postgres needs the project URL and the
--   SERVICE ROLE KEY. That key is a full-access credential and MUST NOT be
--   written into a migration — migrations live in git forever.
--
--   So this migration reads both from Supabase Vault at job runtime and never
--   contains either value. Create them ONCE, by hand, before scheduling:
--
--     select vault.create_secret(
--       'https://<project-ref>.supabase.co', 'project_url',
--       'Base URL for Edge Function calls from pg_cron');
--
--     select vault.create_secret(
--       '<service-role-key>', 'service_role_key',
--       'Service role key used by the weekly sourcing cron');
--
--   Verify (shows names only, not values):
--     select name from vault.secrets order by name;
--
--   If either secret is missing the job will error in cron.job_run_details
--   rather than silently posting to a null URL — see the guard below.
--
-- ── WHY TWO JOBS AN HOUR APART, NOT A CHAIN ─────────────────────────────────
--   pg_net is ASYNCHRONOUS: net.http_post queues the request and returns an id
--   immediately, so it cannot tell us when the crawl actually finished. There
--   is no return value to chain on. An hour is a deliberately generous gap so
--   extraction reads a settled table rather than one mid-write.
--
-- ── WHY limit 50 AND NOT "everything" ───────────────────────────────────────
--   The crawler walks boards SEQUENTIALLY (parallel bursts get you rate-limited
--   off public ATS endpoints), and Edge Functions have a wall-clock timeout.
--   At roughly 0.3-1s per board, 50 is comfortably inside it. Raise it only
--   alongside evidence the function still returns in time; the safer way to
--   cover more boards is a shorter cron interval, not a bigger batch.
--
-- Rollback: supabase/rollback/20260726080000_sourcing_weekly_cron_down.sql
--
-- Idempotent: unschedules by name before scheduling.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Reading a Vault secret is wrapped so a missing secret raises a clear error
-- in cron.job_run_details instead of posting to "null/functions/v1/...".
CREATE OR REPLACE FUNCTION sourcing_required_secret(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v text;
BEGIN
  SELECT decrypted_secret INTO v
    FROM vault.decrypted_secrets
   WHERE name = p_name
   LIMIT 1;

  IF v IS NULL OR btrim(v) = '' THEN
    RAISE EXCEPTION
      'sourcing cron: vault secret "%" is missing. Create it with select vault.create_secret(...) — see 20260726080000_sourcing_weekly_cron.sql',
      p_name;
  END IF;
  RETURN v;
END;
$$;

COMMENT ON FUNCTION sourcing_required_secret(text) IS
  'Reads a Vault secret for the sourcing cron, raising a descriptive error when absent so a misconfigured job fails loudly in cron.job_run_details.';

-- Never expose a service-key reader to client roles.
REVOKE ALL ON FUNCTION sourcing_required_secret(text) FROM PUBLIC, anon, authenticated;

-- ── Schedule ────────────────────────────────────────────────────────────────
-- Unschedule first so re-running this migration replaces rather than
-- duplicates. cron.unschedule throws if the job is absent, hence the guard.

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

-- Step 1 — crawl. Monday 03:00 UTC.
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

-- Step 2 — extract. Monday 04:00 UTC, an hour after the crawl.
-- No reextract flag: the weekly run should only process postings it has not
-- seen. Re-running the whole corpus is a deliberate act after a taxonomy
-- change, not something a schedule should do behind your back.
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

-- Confirm what got scheduled.
SELECT jobname, schedule, active FROM cron.job
 WHERE jobname IN ('sourcing-weekly-crawl', 'sourcing-weekly-extract')
 ORDER BY jobname;
