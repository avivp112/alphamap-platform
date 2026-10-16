-- =============================================================================
-- Migration: company_checks — the on-demand "check a company" service
-- Created:   2026-10-21
-- Description:
--   Stage 1 of the "check a company" feature: the shared service both entry
--   points (My Area CRM, Private Market search) use, the threshold checks,
--   and the job queue the check worker (worker/, on Railway or Fly.io)
--   drains.
--
--   PRIVACY. A check — what was asked, what was found, even that it
--   happened — belongs to the user who ran it:
--     - company_checks is readable only by its owner (RLS) and written only
--       by the company-check Edge Function and the worker (service role);
--     - nothing here feeds the shared database, the opportunity engine, the
--       candidates queue, notifications of other users or any statistic;
--     - there is no cache between users: two users checking the same private
--       company each run their own check (no "someone already asked" signal).
--   Until enrichment v2 passes Phase 1 nothing is promoted to the shared
--   database at all; afterwards promotion runs in weekly batches (a later
--   stage), so a newly listed company cannot be tied to the user who checked it.
--
--   QUEUE. The worker claims one check at a time with a lease
--   (claim_company_check: FOR UPDATE SKIP LOCKED, so two workers never take
--   the same row), keeps the lease alive (heartbeat_company_check) and
--   closes it (finish_company_check) — only while it still holds the lease,
--   so a run that timed out cannot overwrite a newer one. A lease that
--   expires puts the check back in the queue; after max_attempts it fails.
--
--   enrichment_runs gains per-run cost columns for on-demand runs, and RLS
--   (it had none, so the public API could read it; now it is service-only).
--
-- Rollback: supabase/rollback/20261021010000_company_checks_down.sql
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS company_checks (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- What the user typed: {name, website, domain, country, founder, linkedin, sector}.
  input              jsonb       NOT NULL,
  status             text        NOT NULL DEFAULT 'queued' CHECK (status IN (
                       'matched',            -- already in AlphaMap: shown at once, nothing run
                       'queued', 'running',  -- waiting for / held by the worker
                       'ready',              -- passed the threshold checks; enrichment comes next
                       'stealth',            -- too little public information: watched privately
                       'rejected_public', 'rejected_non_tech',
                       'done', 'failed', 'cancelled')),
  matched_startup_id uuid        REFERENCES startups (id) ON DELETE SET NULL,
  -- Threshold-check verdicts with their evidence (quote + URL).
  gate               jsonb,
  -- Enrichment output by section, each value with source and confidence (stage 3).
  result             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  progress           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error              text,
  attempts           integer     NOT NULL DEFAULT 0,
  max_attempts       integer     NOT NULL DEFAULT 3,
  locked_by          text,
  locked_until       timestamptz,
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  duration_ms        integer,
  cost_usd           numeric     NOT NULL DEFAULT 0,
  search_calls       integer     NOT NULL DEFAULT 0,
  llm_input_tokens   bigint      NOT NULL DEFAULT 0,
  llm_output_tokens  bigint      NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_checks IS
  'One "check a company" request. Private to its owner (RLS); written only by the company-check Edge Function and the check worker. Never read by anything shared (opportunity engine, candidates, statistics, other users'' notifications).';

CREATE INDEX IF NOT EXISTS idx_company_checks_user ON company_checks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_checks_queue ON company_checks (next_attempt_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_company_checks_running ON company_checks (locked_until) WHERE status = 'running';

ALTER TABLE company_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_checks_select_own ON company_checks;
CREATE POLICY company_checks_select_own ON company_checks FOR SELECT USING (user_id = auth.uid());
REVOKE ALL ON company_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON company_checks TO authenticated;

-- ── Existing company lookup (the Edge Function, service role) ────────────────
-- By the strong identifiers only: the website's registrable domain, or the
-- company's LinkedIn URL. A bare name is never enough.
CREATE OR REPLACE FUNCTION find_existing_startup(p_website text, p_linkedin text DEFAULT NULL)
RETURNS TABLE (id uuid, name text, website text, last_enriched_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- registrable_domain() is what company_identifiers' domain values were built with.
  WITH d AS (SELECT nullif(registrable_domain(p_website), '') AS domain)
  SELECT s.id, s.name, s.website, s.last_enriched_at
    FROM startups s, d
   WHERE (d.domain IS NOT NULL AND (
            s.id IN (SELECT ci.startup_id FROM company_identifiers ci WHERE ci.kind = 'domain' AND ci.value = d.domain)
            OR registrable_domain(s.website) = d.domain))
      OR (nullif(p_linkedin, '') IS NOT NULL
            AND rtrim(lower(s.linkedin_url), '/') = rtrim(lower(p_linkedin), '/'))
   ORDER BY s.last_enriched_at DESC NULLS LAST
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION find_existing_startup(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION find_existing_startup(text, text) TO service_role;

-- ── Worker queue ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION claim_company_check(p_worker text, p_lease_seconds integer DEFAULT 120)
RETURNS company_checks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r company_checks;
BEGIN
  LOOP
    SELECT * INTO r FROM company_checks
     WHERE (status = 'queued' AND next_attempt_at <= now())
        OR (status = 'running' AND locked_until < now())      -- a worker died or timed out
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    IF r.attempts >= r.max_attempts THEN
      UPDATE company_checks
         SET status = 'failed', locked_by = NULL, locked_until = NULL, finished_at = now(), updated_at = now(),
             error = coalesce(error || ' · ', '') || 'gave up after ' || attempts || ' attempts'
       WHERE id = r.id;
      CONTINUE;
    END IF;
    UPDATE company_checks
       SET status = 'running', attempts = attempts + 1, locked_by = p_worker,
           locked_until = now() + make_interval(secs => p_lease_seconds),
           started_at = coalesce(started_at, now()), updated_at = now()
     WHERE id = r.id
    RETURNING * INTO r;
    RETURN r;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION heartbeat_company_check(p_id uuid, p_worker text, p_lease_seconds integer DEFAULT 120)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE company_checks
     SET locked_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   WHERE id = p_id AND locked_by = p_worker AND status = 'running';
  RETURN FOUND;
END;
$$;

-- Progress while running (partial results); same lease rule as finishing.
CREATE OR REPLACE FUNCTION patch_company_check(p_id uuid, p_worker text, p_patch jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE company_checks
     SET gate     = coalesce(p_patch->'gate', gate),
         result   = result   || coalesce(p_patch->'result', '{}'::jsonb),
         progress = progress || coalesce(p_patch->'progress', '{}'::jsonb),
         updated_at = now()
   WHERE id = p_id AND locked_by = p_worker AND status = 'running';
  RETURN FOUND;
END;
$$;

-- Close a run: a final status, or back to the queue after p_retry_in_seconds.
-- Usage numbers are ADDED, so a retried check reports what all attempts cost.
CREATE OR REPLACE FUNCTION finish_company_check(
  p_id uuid, p_worker text, p_status text, p_patch jsonb DEFAULT '{}'::jsonb,
  p_error text DEFAULT NULL, p_retry_in_seconds integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_retry_in_seconds IS NULL AND p_status NOT IN
     ('ready', 'stealth', 'rejected_public', 'rejected_non_tech', 'done', 'failed') THEN
    RAISE EXCEPTION 'finish_company_check: % is not a final status', p_status USING ERRCODE = '22023';
  END IF;
  UPDATE company_checks
     SET status            = CASE WHEN p_retry_in_seconds IS NOT NULL THEN 'queued' ELSE p_status END,
         next_attempt_at   = CASE WHEN p_retry_in_seconds IS NOT NULL THEN now() + make_interval(secs => p_retry_in_seconds) ELSE next_attempt_at END,
         finished_at       = CASE WHEN p_retry_in_seconds IS NOT NULL THEN NULL ELSE now() END,
         locked_by = NULL, locked_until = NULL,
         error             = coalesce(p_error, CASE WHEN p_retry_in_seconds IS NULL THEN NULL ELSE error END),
         gate              = coalesce(p_patch->'gate', gate),
         result            = result   || coalesce(p_patch->'result', '{}'::jsonb),
         progress          = progress || coalesce(p_patch->'progress', '{}'::jsonb),
         duration_ms       = coalesce(duration_ms, 0) + coalesce((p_patch->>'duration_ms')::integer, 0),
         cost_usd          = cost_usd + coalesce((p_patch->>'cost_usd')::numeric, 0),
         search_calls      = search_calls + coalesce((p_patch->>'search_calls')::integer, 0),
         llm_input_tokens  = llm_input_tokens + coalesce((p_patch->>'llm_input_tokens')::bigint, 0),
         llm_output_tokens = llm_output_tokens + coalesce((p_patch->>'llm_output_tokens')::bigint, 0),
         updated_at = now()
   WHERE id = p_id AND locked_by = p_worker AND status = 'running';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION claim_company_check(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION heartbeat_company_check(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION patch_company_check(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finish_company_check(uuid, text, text, jsonb, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_company_check(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION heartbeat_company_check(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION patch_company_check(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION finish_company_check(uuid, text, text, jsonb, text, integer) TO service_role;

-- ── Per-run cost log ─────────────────────────────────────────────────────────
ALTER TABLE enrichment_runs ADD COLUMN IF NOT EXISTS run_kind text NOT NULL DEFAULT 'bulk';
ALTER TABLE enrichment_runs ADD COLUMN IF NOT EXISTS check_id uuid REFERENCES company_checks (id) ON DELETE SET NULL;
ALTER TABLE enrichment_runs ADD COLUMN IF NOT EXISTS duration_ms integer;
ALTER TABLE enrichment_runs ADD COLUMN IF NOT EXISTS search_calls integer;
ALTER TABLE enrichment_runs ADD COLUMN IF NOT EXISTS llm_input_tokens bigint;
ALTER TABLE enrichment_runs ADD COLUMN IF NOT EXISTS llm_output_tokens bigint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enrichment_runs_run_kind_check') THEN
    ALTER TABLE enrichment_runs ADD CONSTRAINT enrichment_runs_run_kind_check CHECK (run_kind IN ('bulk', 'on_demand'));
  END IF;
END;
$$;
COMMENT ON COLUMN enrichment_runs.check_id IS
  'The company_checks row an on-demand run served. Private: enrichment_runs is service-role only.';

ALTER TABLE enrichment_runs ENABLE ROW LEVEL SECURITY;   -- service role only (it had no RLS)
