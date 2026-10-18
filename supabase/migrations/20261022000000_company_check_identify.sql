-- =============================================================================
-- "Check a company", stage 2: confirm the company's identity before the run.
--
-- A check now has two phases, both run by the check worker:
--
--   identify  queued -> running -> awaiting_confirmation
--             one short search; `candidates` holds what it found (name,
--             website, location, description, and the AlphaMap company when
--             one of them is already in the database). Never charged.
--   check     queued -> running -> ready / stealth / rejected_* / failed
--             starts when the user confirms a candidate (or "none of these")
--             through the company-check Edge Function, which also enforces
--             the plan's allowance at that moment.
--
-- Also:
--   * release_company_check(): a run that failed because one of OUR provider
--     keys was rejected goes back to the queue without using up an attempt —
--     our misconfiguration must never fail a user's check (2026-10-18: two
--     test checks failed on a revoked Anthropic key).
--   * cancel_company_check(): the user abandons a check that has not started.
--
-- Rollback: supabase/rollback/20261022000000_company_check_identify_down.sql
-- =============================================================================

ALTER TABLE company_checks ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'check';
ALTER TABLE company_checks ADD COLUMN IF NOT EXISTS candidates jsonb;
ALTER TABLE company_checks ADD COLUMN IF NOT EXISTS identity jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_checks_phase_check') THEN
    ALTER TABLE company_checks ADD CONSTRAINT company_checks_phase_check CHECK (phase IN ('identify', 'check'));
  END IF;
END;
$$;

ALTER TABLE company_checks DROP CONSTRAINT IF EXISTS company_checks_status_check;
ALTER TABLE company_checks ADD CONSTRAINT company_checks_status_check CHECK (status IN (
  'matched',                -- already in AlphaMap: shown at once, nothing run
  'queued', 'running',      -- waiting for / held by the worker (either phase)
  'awaiting_confirmation',  -- identify phase done: the user picks the company
  'ready',                  -- passed the threshold checks; enrichment comes next
  'stealth',                -- too little public information: watched privately
  'rejected_public', 'rejected_non_tech',
  'done', 'failed', 'cancelled'));

COMMENT ON COLUMN company_checks.phase IS
  'identify = the short search for the company (never charged); check = the threshold checks and, from stage 3, the enrichment.';
COMMENT ON COLUMN company_checks.candidates IS
  'Identify phase result: [{name, website, domain, description, location, source, evidence_url, startup_id, startup_name}]. Location only when a source states it.';
COMMENT ON COLUMN company_checks.identity IS
  'The candidate the user confirmed ({} = "none of these": the run uses what the user typed).';

-- ── Finishing a run: the identify phase ends awaiting the user ───────────────
CREATE OR REPLACE FUNCTION finish_company_check(
  p_id uuid, p_worker text, p_status text, p_patch jsonb DEFAULT '{}'::jsonb,
  p_error text DEFAULT NULL, p_retry_in_seconds integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phase text;
BEGIN
  SELECT phase INTO v_phase FROM company_checks WHERE id = p_id;
  IF p_retry_in_seconds IS NULL AND NOT (
       (v_phase = 'identify' AND p_status IN ('awaiting_confirmation', 'failed'))
    OR (v_phase = 'check' AND p_status IN ('ready', 'stealth', 'rejected_public', 'rejected_non_tech', 'done', 'failed'))) THEN
    RAISE EXCEPTION 'finish_company_check: % is not a final status of the % phase', p_status, coalesce(v_phase, '?')
      USING ERRCODE = '22023';
  END IF;
  UPDATE company_checks
     SET status            = CASE WHEN p_retry_in_seconds IS NOT NULL THEN 'queued' ELSE p_status END,
         next_attempt_at   = CASE WHEN p_retry_in_seconds IS NOT NULL THEN now() + make_interval(secs => p_retry_in_seconds) ELSE next_attempt_at END,
         -- awaiting_confirmation is a pause, not the end of the check
         finished_at       = CASE WHEN p_retry_in_seconds IS NOT NULL OR p_status = 'awaiting_confirmation' THEN NULL ELSE now() END,
         locked_by = NULL, locked_until = NULL,
         error             = coalesce(p_error, CASE WHEN p_retry_in_seconds IS NULL THEN NULL ELSE error END),
         gate              = coalesce(p_patch->'gate', gate),
         candidates        = coalesce(p_patch->'candidates', candidates),
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

-- ── Back to the queue without using up an attempt ────────────────────────────
-- For failures that are ours, not the check's: a provider rejected one of the
-- worker's keys. The usage already spent is still recorded.
CREATE OR REPLACE FUNCTION release_company_check(
  p_id uuid, p_worker text, p_retry_in_seconds integer, p_note text, p_usage jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE company_checks
     SET status = 'queued', attempts = greatest(attempts - 1, 0),
         next_attempt_at = now() + make_interval(secs => greatest(p_retry_in_seconds, 1)),
         locked_by = NULL, locked_until = NULL, error = p_note,
         duration_ms       = coalesce(duration_ms, 0) + coalesce((p_usage->>'duration_ms')::integer, 0),
         cost_usd          = cost_usd + coalesce((p_usage->>'cost_usd')::numeric, 0),
         search_calls      = search_calls + coalesce((p_usage->>'search_calls')::integer, 0),
         llm_input_tokens  = llm_input_tokens + coalesce((p_usage->>'llm_input_tokens')::bigint, 0),
         llm_output_tokens = llm_output_tokens + coalesce((p_usage->>'llm_output_tokens')::bigint, 0),
         updated_at = now()
   WHERE id = p_id AND locked_by = p_worker AND status = 'running';
  RETURN FOUND;
END;
$$;

-- ── The user's choice (the company-check Edge Function, after the allowance) ─
-- p_startup_id set: the chosen candidate is already in AlphaMap -> 'matched',
-- nothing runs. Otherwise the check phase is queued with the confirmed
-- identity; attempts start over (the identify run's attempt is not the
-- check's).
CREATE OR REPLACE FUNCTION confirm_company_check(
  p_id uuid, p_user uuid, p_identity jsonb, p_input jsonb, p_startup_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE company_checks
     SET phase = 'check',
         identity = coalesce(p_identity, '{}'::jsonb),
         input = coalesce(p_input, input),
         status = CASE WHEN p_startup_id IS NOT NULL THEN 'matched' ELSE 'queued' END,
         matched_startup_id = p_startup_id,
         finished_at = CASE WHEN p_startup_id IS NOT NULL THEN now() END,
         attempts = 0, error = NULL, next_attempt_at = now(),
         updated_at = now()
   WHERE id = p_id AND user_id = p_user AND status = 'awaiting_confirmation';
  RETURN FOUND;
END;
$$;

-- ── The user abandons a check that has not started (from the browser) ────────
CREATE OR REPLACE FUNCTION cancel_company_check(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE company_checks
     SET status = 'cancelled', finished_at = now(), updated_at = now()
   WHERE id = p_id AND user_id = auth.uid()
     AND (status = 'awaiting_confirmation' OR (status = 'queued' AND phase = 'identify'));
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION finish_company_check(uuid, text, text, jsonb, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_company_check(uuid, text, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION confirm_company_check(uuid, uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION cancel_company_check(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finish_company_check(uuid, text, text, jsonb, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION release_company_check(uuid, text, integer, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION confirm_company_check(uuid, uuid, jsonb, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION cancel_company_check(uuid) TO authenticated, service_role;
