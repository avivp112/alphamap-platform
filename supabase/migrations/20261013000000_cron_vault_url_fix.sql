-- =============================================================================
-- Migration: fix the cron's project_url, and make that failure loud
-- Created:   2026-10-13
-- Description:
--   Root cause of "no source has brought data since July": the Vault secret
--   project_url — which every HTTP cron job (all ingesters, discover-boards,
--   sourcing-crawl, extract-job-signals, backfill-embeddings, pipeline-health)
--   builds its URL from — is the placeholder https://xxxxxxxxxxxxxxxxxxxx.supabase.co.
--   pg_net answered every call with "Couldn't resolve host name", nothing
--   was ever invoked, and cron.job_run_details still said "succeeded"
--   because net.http_post only queues. sourcing_required_secret() rejected
--   placeholders with <...> or "your-project" wording, but a ref of twenty
--   x's has the right shape and passed.
--
--   1. One-time repair: when project_url is not a real project URL, it is set
--      from the service_role_key already in the Vault. A legacy Supabase key
--      is a JWT whose payload says {"ref": "<project ref>", "role":
--      "service_role"}; https://<ref>.supabase.co is exactly the URL the
--      functions live at. Only done when the key really is the project's
--      service_role JWT; otherwise a NOTICE says what to set by hand.
--   2. sourcing_required_secret() also rejects a ref made of one repeated
--      character, and a project_url whose ref differs from the service-role
--      key's own ref (a URL and key for two different projects can never
--      work).
--   3. pipeline_health_watchdog() (daily 06:30 UTC, plain SQL, so it works
--      even when no HTTP call does) now also reads pg_net's responses from
--      the last hours and notifies when the cron's own HTTP calls fail —
--      with the error, e.g. "Couldn't resolve host name".
--
-- Rollback: supabase/rollback/20261013000000_cron_vault_url_fix_down.sql
-- Idempotent.
-- =============================================================================

-- Payload of a JWT, or NULL when the value is not one (new sb_secret_ keys).
CREATE OR REPLACE FUNCTION sourcing_jwt_claims(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  p text := split_part(coalesce(p_token, ''), '.', 2);
BEGIN
  IF p = '' THEN
    RETURN NULL;
  END IF;
  p := translate(p, '-_', '+/');
  p := p || repeat('=', (4 - length(p) % 4) % 4);
  RETURN convert_from(decode(p, 'base64'), 'UTF8')::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION sourcing_jwt_claims(text) FROM PUBLIC, anon, authenticated;

-- ── 1. One-time repair of project_url ─────────────────────────────────────────
DO $$
DECLARE
  v_url    text;
  v_claims jsonb;
  v_ref    text;
  v_id     uuid;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  SELECT sourcing_jwt_claims(decrypted_secret) INTO v_claims FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  v_ref := v_claims->>'ref';

  IF v_ref IS NULL OR v_claims->>'role' IS DISTINCT FROM 'service_role' OR v_ref !~ '^[a-z0-9]{20}$' THEN
    RAISE NOTICE 'project_url not changed: service_role_key in the Vault is not a legacy service_role JWT carrying a project ref. Set it by hand: select vault.update_secret((select id from vault.secrets where name = ''project_url''), ''https://<ref>.supabase.co'');';
    RETURN;
  END IF;

  IF v_url = 'https://' || v_ref || '.supabase.co' THEN
    RAISE NOTICE 'project_url already points at project %', v_ref;
    RETURN;
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'project_url' LIMIT 1;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret('https://' || v_ref || '.supabase.co', 'project_url');
  ELSE
    PERFORM vault.update_secret(v_id, 'https://' || v_ref || '.supabase.co');
  END IF;
  RAISE NOTICE 'project_url was % — now https://%.supabase.co (the project of the service_role_key)', coalesce(v_url, 'missing'), v_ref;
END;
$$;

-- ── 2. Stricter secret check ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sourcing_required_secret(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v     text;
  v_ref text;
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

  IF v LIKE '%<%' OR v LIKE '%...%' THEN
    RAISE EXCEPTION
      'sourcing cron: vault secret "%" still contains a placeholder (found angle brackets or an ellipsis). Replace it with the real value: select vault.update_secret((select id from vault.secrets where name = %L), ''<real value>'', %L)',
      p_name, p_name, p_name;
  END IF;

  IF p_name = 'project_url' THEN
    IF v !~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' THEN
      RAISE EXCEPTION
        'sourcing cron: vault secret "project_url" is % — that is not a URL. Expected https://<ref>.supabase.co with your real Reference ID (Dashboard > Settings > General), no path and no trailing slash.',
        quote_literal(v);
    END IF;
    IF v ~* 'your[-_]?(project|real|ref)|(project|real)[-_]?ref' THEN
      RAISE EXCEPTION
        'sourcing cron: vault secret "project_url" is % — that host is still the placeholder wording, not a project ref. Use your real Reference ID from Dashboard > Settings > General (20 lowercase letters, e.g. https://qwertyuiopasdfghjklz.supabase.co).',
        quote_literal(v);
    END IF;
    -- NEW: twenty x's (or any single repeated character) is a placeholder.
    IF v ~ '^https://([a-z0-9])\1+\.supabase\.co$' THEN
      RAISE EXCEPTION
        'sourcing cron: vault secret "project_url" is % — a placeholder, not a project ref. Set it to https://<your ref>.supabase.co (Dashboard > Settings > General).',
        quote_literal(v);
    END IF;
    -- NEW: the URL must be the project the service-role key belongs to.
    SELECT sourcing_jwt_claims(decrypted_secret)->>'ref' INTO v_ref
      FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
    IF v_ref IS NOT NULL AND v ~ '\.supabase\.co$' AND v <> 'https://' || v_ref || '.supabase.co' THEN
      RAISE EXCEPTION
        'sourcing cron: vault secret "project_url" is % but service_role_key belongs to project % — they must be the same project (https://%.supabase.co).',
        quote_literal(v), v_ref, v_ref;
    END IF;
  ELSIF p_name = 'service_role_key' THEN
    IF length(v) < 40 THEN
      RAISE EXCEPTION
        'sourcing cron: vault secret "service_role_key" is only % characters, far too short for a real key. Copy the full service_role value from Dashboard > Settings > API.',
        length(v);
    END IF;
  END IF;

  RETURN v;
END;
$$;

-- ── 3. Watchdog: also the cron's own HTTP calls ──────────────────────────────
CREATE OR REPLACE FUNCTION pipeline_health_watchdog()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n         integer := 0;
  n_http    integer := 0;
  v_failed  integer;
  v_total   integer;
  v_sample  text;
  v_missing boolean;
BEGIN
  -- Keep the run log bounded.
  DELETE FROM source_runs WHERE started_at < now() - interval '90 days';
  DELETE FROM pipeline_health_checks WHERE checked_at < now() - interval '180 days';

  -- pg_net keeps responses for a few hours, which covers the 05:30 health
  -- check and the 04:00 embedding job at this 06:30 run.
  SELECT count(*) FILTER (WHERE r.status_code IS NULL OR r.status_code >= 400 OR r.timed_out),
         count(*),
         (array_agg(coalesce(nullif(btrim(r.error_msg), ''), 'HTTP ' || r.status_code || ': ' || left(r.content::text, 200))
                    ORDER BY r.created DESC)
            FILTER (WHERE r.status_code IS NULL OR r.status_code >= 400 OR r.timed_out))[1]
    INTO v_failed, v_total, v_sample
    FROM net._http_response r
   WHERE r.created > now() - interval '24 hours';

  IF v_failed > 0 THEN
    WITH inserted AS (
      INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
      SELECT u.id, 'pipeline_health', 'Scheduled HTTP calls are failing',
             format('%s of %s scheduled HTTP calls (ingesters, embeddings, health check) failed in the last hours. Latest error: %s. Check the Vault secrets project_url and service_role_key, and that the Edge Functions are deployed.',
                    v_failed, v_total, coalesce(v_sample, 'unknown')),
             '/my-area?tab=alerts',
             'health:http:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        FROM auth.users u JOIN pipeline_alert_recipients r ON lower(r.email) = lower(u.email)
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO n_http FROM inserted;
  END IF;

  v_missing := NOT EXISTS (SELECT 1 FROM pipeline_health_checks WHERE checked_at > now() - interval '26 hours');
  IF v_missing THEN
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
  END IF;

  RETURN jsonb_build_object(
    'health_check_missing', v_missing,
    'http_failed_24h', coalesce(v_failed, 0), 'http_total_24h', coalesce(v_total, 0), 'http_latest_error', v_sample,
    'notified', n + n_http);
END;
$$;

REVOKE ALL ON FUNCTION pipeline_health_watchdog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pipeline_health_watchdog() TO service_role;

-- Result: the URL the cron now calls (not a secret — it is the project's public address).
SELECT 'project_url' AS vault_secret, decrypted_secret AS value FROM vault.decrypted_secrets WHERE name = 'project_url';
