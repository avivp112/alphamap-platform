-- Stage 7c (owner, 2026-11-12): the weekly HF snapshot and the GitHub / HF collection scheduled, and the certain link from the company's own
-- site to its GitHub organization (the HF direction is link_hf_orgs, site_link).
--
-- Jobs (all through sourcing_required_secret, like 20260726250000):
--   ingest-github-velocity   daily 00:40   GitHub counters (only scheduled here if missing; 20260726250000 already does it)
--   ingest-huggingface       daily 00:55   HF trending (only scheduled here if missing)
--   snapshot-huggingface-new weekly Mon 01:30   reads the 300 newest models: finds orgs never seen (10 orgs)
--   snapshot-huggingface     Mon 02:00–06:50 every 10 minutes: 30 orgs per call, the ones listed longest ago first (about 900 orgs a week)
--   link-site-dev-orgs       weekly Mon 07:30   the certain links only (link_hf_orgs, link_github_orgs); no candidates are proposed here
-- The candidate proposals (propose_oss_candidates, propose_hf_candidates) are NOT scheduled: they stay a manual dry run first.
--
-- Pause one job:   SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'snapshot-huggingface'), active => false);
-- Rollback: supabase/rollback/20261129000000_oss_weekly_cron_and_github_link_down.sql
-- Idempotent: unschedules these names before scheduling.

-- ── The certain link from a company's site to its GitHub organization ───────────
CREATE OR REPLACE VIEW github_link_candidates AS
WITH from_site AS (
  SELECT lower(substring(s.github_url FROM '^(?:https?://)?(?:www\.)?github\.com/([^/?#\s]+)')) AS org, s.id AS startup_id, s.github_url AS evidence
    FROM startups s
   WHERE s.github_url IS NOT NULL
)
SELECT f.org, f.startup_id, f.evidence
  FROM from_site f
 WHERE f.org IS NOT NULL
   AND f.org NOT IN ('features', 'about', 'pricing', 'topics', 'marketplace', 'sponsors', 'login', 'join', 'enterprise', 'orgs', 'settings', 'explore', 'collections', 'trending', 'readme', 'security', 'github')
   AND (SELECT count(DISTINCT f2.startup_id) FROM from_site f2 WHERE f2.org = f.org) = 1;   -- an organization two companies claim is not certain

CREATE OR REPLACE FUNCTION link_github_orgs(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record; n_pairs int := 0; n_ident int := 0; n_proj int := 0; k int; v_detail jsonb := '[]'::jsonb;
BEGIN
  FOR r IN SELECT * FROM github_link_candidates ORDER BY org LOOP
    n_pairs := n_pairs + 1;
    v_detail := v_detail || jsonb_build_array(jsonb_build_object('org', r.org, 'startup_id', r.startup_id, 'evidence', r.evidence));
    CONTINUE WHEN p_dry_run;
    INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
    VALUES (r.startup_id, 'github_org', r.org, 'github_link_candidates via site_link', 1.00)
    ON CONFLICT (kind, value) DO NOTHING;
    GET DIAGNOSTICS k = ROW_COUNT; n_ident := n_ident + k;
    UPDATE oss_projects SET startup_id = r.startup_id
     WHERE source = 'github_repo' AND lower(owner_login) = r.org AND startup_id IS NULL;
    GET DIAGNOSTICS k = ROW_COUNT; n_proj := n_proj + k;
  END LOOP;
  RETURN jsonb_build_object('dry_run', p_dry_run, 'pairs', n_pairs,
    'identifiers_added', CASE WHEN p_dry_run THEN NULL ELSE n_ident END,
    'projects_linked', CASE WHEN p_dry_run THEN NULL ELSE n_proj END, 'detail', v_detail);
END;
$$;
REVOKE ALL ON FUNCTION link_github_orgs(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION link_github_orgs(boolean) TO service_role;

-- ── The schedules ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  j text;
  call_fn text := $f$
    SELECT net.http_post(
      url     := sourcing_required_secret('project_url') || '/functions/v1/%s',
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
      body    := '%s'::jsonb,
      timeout_milliseconds := 300000
    );$f$;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('sourcing_required_secret(text)') IS NULL THEN
    RAISE NOTICE 'pg_cron or sourcing_required_secret() is missing: the link function was created, nothing was scheduled (run 20260726250000 first).';
    RETURN;
  END IF;
  FOREACH j IN ARRAY ARRAY['snapshot-huggingface', 'snapshot-huggingface-new', 'link-site-dev-orgs'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN PERFORM cron.unschedule(j); END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ingest-github-velocity') THEN
    PERFORM cron.schedule('ingest-github-velocity', '40 0 * * *', format(call_fn, 'ingest-github-velocity', '{}'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ingest-huggingface') THEN
    PERFORM cron.schedule('ingest-huggingface', '55 0 * * *', format(call_fn, 'ingest-huggingface', '{}'));
  END IF;
  PERFORM cron.schedule('snapshot-huggingface-new', '30 1 * * 1', format(call_fn, 'snapshot-huggingface', '{"batch": 10, "discover": 300}'));
  PERFORM cron.schedule('snapshot-huggingface', '*/10 2-6 * * 1', format(call_fn, 'snapshot-huggingface', '{"batch": 30}'));
  PERFORM cron.schedule('link-site-dev-orgs', '30 7 * * 1', 'SELECT link_hf_orgs(false); SELECT link_github_orgs(false);');
END;
$$;
