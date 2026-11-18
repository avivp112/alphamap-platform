-- =============================================================================
-- Migration: candidate watchlist — a UK company with no strong signal waits,
--            and comes to review when something happens at the register
-- Created:   2026-12-05
-- Description:
--   A UK incorporation is often a day old when it is found: no website, no
--   raise, no filings. Review has nothing to judge it on. From here a UK
--   candidate whose registry signals are all weak is set to 'watching' instead
--   of waiting in the review queue, and surfaces ('pending') when an event
--   happens: a share allotment (SH01), a new share class or articles, a third
--   director, or a match in another source (patent, GitHub, Hugging Face).
--   One that sees no event for 12 months leaves the watchlist as 'expired' —
--   quietly, not rejected (a rejection is permanent; an expired candidate was
--   simply never heard from).
--
--   1. company_candidates.status gains 'watching' and 'expired'; new columns
--      watch_started_at, watch_checked_at, watch_tier, promoted_at,
--      promoted_reason.
--   2. watch_candidate(): pending UK candidate -> watching. Its gate tier is
--      kept in watch_tier and the row is set to 'queue' meanwhile: the new-
--      company alert (generate_live_alerts) fires on gate_tier = 'alert', so a
--      watched candidate stays silent until it surfaces.
--   3. promote_candidate(): watching -> pending with the reason, the original
--      tier restored and last_seen_at = now(), so a tier-'alert' candidate is
--      announced when it surfaces, not when it was found.
--   4. expire_watching(): the 12-month exit (months configurable).
--   5. candidate_cross_source_matches(): other-source candidates that carry the
--      same normalised name — by NAME ONLY, so the reviewer sees why it surfaced.
--   6. merge_candidate_evidence() also serves a watching candidate.
--   7. Schedules (pg_cron, if installed): the watch check daily 05:20 UTC, the
--      expiry weekly Monday 05:50 UTC.
--
--   Review actions are unchanged: reject_company_candidate already accepts any
--   status except 'approved', so a watched candidate can be rejected by hand.
--
-- Rollback: supabase/rollback/20261205000000_candidate_watchlist_down.sql
-- Idempotent.
-- =============================================================================

-- ── 1. Status and columns ────────────────────────────────────────────────────
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'company_candidates'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%' AND pg_get_constraintdef(oid) ILIKE '%pending%'
  LOOP
    EXECUTE format('ALTER TABLE company_candidates DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE company_candidates
  ADD CONSTRAINT company_candidates_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'watching', 'expired'));

ALTER TABLE company_candidates
  ADD COLUMN IF NOT EXISTS watch_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS watch_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS watch_tier       text CHECK (watch_tier IN ('queue', 'alert')),
  ADD COLUMN IF NOT EXISTS promoted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_reason  text;

CREATE INDEX IF NOT EXISTS idx_company_candidates_watching
  ON company_candidates (watch_checked_at NULLS FIRST) WHERE status = 'watching';

-- ── 2. pending -> watching ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION watch_candidate(p_candidate_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH moved AS (
    UPDATE company_candidates
       SET status = 'watching', watch_tier = gate_tier, gate_tier = 'queue',
           watch_started_at = now(), watch_checked_at = now()
     WHERE id = p_candidate_id AND status = 'pending' AND source = 'uk_companies_house'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM moved);
$$;

-- ── 3. watching -> pending ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION promote_candidate(p_candidate_id uuid, p_reason text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH moved AS (
    UPDATE company_candidates
       SET status = 'pending', gate_tier = coalesce(watch_tier, gate_tier),
           promoted_at = now(), promoted_reason = left(p_reason, 500), last_seen_at = now()
     WHERE id = p_candidate_id AND status = 'watching'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM moved);
$$;

-- ── 4. The 12-month exit ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION expire_watching(p_months integer DEFAULT 12)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH gone AS (
    UPDATE company_candidates
       SET status = 'expired'
     WHERE status = 'watching' AND watch_started_at < now() - make_interval(months => p_months)
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone;
$$;

-- ── 5. The same name in another source ───────────────────────────────────────
CREATE OR REPLACE FUNCTION candidate_cross_source_matches(p_candidate_id uuid)
RETURNS TABLE (source text, name text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.source, o.name, o.status
    FROM company_candidates c
    JOIN company_candidates o
      ON o.id <> c.id AND o.source <> c.source
     AND normalize_applicant_name(o.name) = normalize_applicant_name(c.name)
   WHERE c.id = p_candidate_id
     AND o.status IN ('pending', 'approved', 'watching')
     AND length(normalize_applicant_name(c.name)) >= 4
   LIMIT 5;
$$;

-- ── 6. Evidence merges also reach a watching candidate ───────────────────────
CREATE OR REPLACE FUNCTION merge_candidate_evidence(p_candidate_id uuid, p_extra jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_candidate_id IS NULL OR p_extra IS NULL OR jsonb_typeof(p_extra) <> 'object' THEN
    RETURN false;
  END IF;
  UPDATE company_candidates
     SET evidence = evidence || (jsonb_strip_nulls(p_extra) - ARRAY[
           'form_type', 'jurisdiction', 'industry_group', 'codes', 'officers', 'summary',
           'total_offering', 'total_sold', 'title', 'abstract', 'filing_date'])
   WHERE id = p_candidate_id AND status IN ('pending', 'watching');
  RETURN FOUND;
END;
$$;

-- Service role only, all of them.
REVOKE ALL ON FUNCTION watch_candidate(uuid)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION promote_candidate(uuid, text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION expire_watching(integer)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION candidate_cross_source_matches(uuid)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION merge_candidate_evidence(uuid, jsonb)    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION watch_candidate(uuid)                 TO service_role;
GRANT EXECUTE ON FUNCTION promote_candidate(uuid, text)         TO service_role;
GRANT EXECUTE ON FUNCTION expire_watching(integer)              TO service_role;
GRANT EXECUTE ON FUNCTION candidate_cross_source_matches(uuid)  TO service_role;
GRANT EXECUTE ON FUNCTION merge_candidate_evidence(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION watch_candidate IS
  'pending UK candidate -> watching; keeps its gate tier in watch_tier and sets tier queue meanwhile so no new-company alert fires. Service role only.';
COMMENT ON FUNCTION promote_candidate IS
  'watching -> pending with the reason; restores the tier and bumps last_seen_at so an alert-tier candidate is announced when it surfaces. Service role only.';

-- ── 7. Schedules ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  call_fn text := $f$
    SELECT net.http_post(
      url     := sourcing_required_secret('project_url') || '/functions/v1/%s',
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
      body    := '%s'::jsonb,
      timeout_milliseconds := 300000
    );$f$;
  j text;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('sourcing_required_secret(text)') IS NULL THEN
    RAISE NOTICE 'pg_cron or sourcing_required_secret() is missing: the watchlist functions were created, nothing was scheduled (run 20260726250000 first).';
    RETURN;
  END IF;
  FOREACH j IN ARRAY ARRAY['uk-watchlist-check', 'uk-watchlist-expire'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN PERFORM cron.unschedule(j); END IF;
  END LOOP;
  PERFORM cron.schedule('uk-watchlist-check', '20 5 * * *',
    format(call_fn, 'ingest-uk-companies-house', '{"watchCheck": true, "limit": 40, "minAgeDays": 7}'));
  PERFORM cron.schedule('uk-watchlist-expire', '50 5 * * 1', 'SELECT expire_watching(12);');
END;
$$;
