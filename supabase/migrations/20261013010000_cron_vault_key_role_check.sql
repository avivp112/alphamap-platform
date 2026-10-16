-- =============================================================================
-- Migration: the cron's service_role_key must be the service_role key
-- Created:   2026-10-13
-- Description:
--   Found right after 20261013000000: the Vault secret service_role_key held
--   the project's ANON key (JWT role "anon") — same shape, same length, so
--   the length check passed. sourcing_required_secret() now rejects a JWT
--   whose role is not service_role, so every scheduled HTTP job fails with
--   that message in cron.job_run_details (which the daily health check
--   reports) instead of calling functions with the wrong key.
--
-- Rollback: re-run sourcing_required_secret() from 20261013000000_cron_vault_url_fix.sql
-- Idempotent.
-- =============================================================================

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
    -- NEW: a JWT key must be the service_role one. The anon key has the same
    -- shape and length, and was what the Vault held (found 2026-10-13).
    IF sourcing_jwt_claims(v)->>'role' IS NOT NULL AND sourcing_jwt_claims(v)->>'role' <> 'service_role' THEN
      RAISE EXCEPTION
        'sourcing cron: vault secret "service_role_key" holds the % key, not the service_role key. Copy service_role from Dashboard > Settings > API Keys > Legacy API keys.',
        sourcing_jwt_claims(v)->>'role';
    END IF;
  END IF;

  RETURN v;
END;
$$;
