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
--   ALREADY CREATED ONE? create_secret refuses duplicates. Update in place:
--
--     select vault.update_secret(
--       (select id from vault.secrets where name = 'project_url'),
--       'https://<project-ref>.supabase.co', 'project_url',
--       'Base URL for Edge Function calls from pg_cron');
--
--   Verify without printing the key itself:
--     select name,
--            decrypted_secret LIKE '%<%' AS still_a_placeholder,
--            length(decrypted_secret)    AS len
--       FROM vault.decrypted_secrets
--      WHERE name IN ('project_url', 'service_role_key');
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

  -- Reject un-substituted placeholders. Pasting a setup snippet verbatim
  -- stores literal text like '<YOUR-PROJECT-REF>' or 'eyJhbGci...', which is
  -- non-empty and so sails past the check above — leaving the cron to POST at
  -- a nonsense URL every week and fail in a way that looks like a network
  -- problem rather than a configuration one.
  --
  -- Angle brackets and a literal ellipsis are safe to reject for BOTH secrets:
  -- a URL contains neither, and a JWT cannot contain '...' because its three
  -- segments are non-empty by construction.
  IF v LIKE '%<%' OR v LIKE '%...%' THEN
    RAISE EXCEPTION
      'sourcing cron: vault secret "%" still contains a placeholder (found angle brackets or an ellipsis). Replace it with the real value: select vault.update_secret((select id from vault.secrets where name = %L), ''<real value>'', %L)',
      p_name, p_name, p_name;
  END IF;

  -- Shape checks, per secret. Substring sniffing alone is not enough — the
  -- placeholder 'YOUR_REAL_REF' has no angle brackets and no ellipsis, yet is
  -- obviously not a project ref. Validating the SHAPE catches the whole class
  -- rather than the specific spellings we happened to think of.
  IF p_name = 'project_url' THEN
    -- Hostnames are lowercase and have no underscores, so every SHOUTY
    -- placeholder fails here regardless of how it is spelled.
    IF v !~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' THEN
      RAISE EXCEPTION
        'sourcing cron: vault secret "project_url" is % — that is not a URL. Expected https://<ref>.supabase.co with your real Reference ID (Dashboard > Settings > General), no path and no trailing slash.',
        quote_literal(v);
    END IF;
    -- A lowercased placeholder like 'your-project-ref' is a perfectly legal
    -- hostname, so shape alone lets it through. Match the placeholder WORDS,
    -- narrowly: a real customer domain such as 'yourbrand.io' must still pass,
    -- which rules out simply rejecting anything containing "your".
    IF v ~* 'your[-_]?(project|real|ref)|(project|real)[-_]?ref' THEN
      RAISE EXCEPTION
        'sourcing cron: vault secret "project_url" is % — that host is still the placeholder wording, not a project ref. Use your real Reference ID from Dashboard > Settings > General (20 lowercase letters, e.g. https://qwertyuiopasdfghjklz.supabase.co).',
        quote_literal(v);
    END IF;
  ELSIF p_name = 'service_role_key' THEN
    -- Real credentials are long: a JWT service role key runs 200+ characters
    -- and an sb_secret_ key ~40. Anything shorter is a truncated paste.
    IF length(v) < 40 THEN
      RAISE EXCEPTION
        'sourcing cron: vault secret "service_role_key" is only % characters, far too short for a real key. Copy the full service_role value from Dashboard > Settings > API.',
        length(v);
    END IF;
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
