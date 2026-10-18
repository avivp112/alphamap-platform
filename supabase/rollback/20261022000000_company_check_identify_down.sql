-- Rollback of 20261022000000_company_check_identify.sql. Checks still in the
-- identify phase are cancelled first: the stage 1 status list does not know
-- awaiting_confirmation.
UPDATE company_checks SET status = 'cancelled', finished_at = now()
 WHERE phase = 'identify' OR status = 'awaiting_confirmation';

DROP FUNCTION IF EXISTS cancel_company_check(uuid);
DROP FUNCTION IF EXISTS confirm_company_check(uuid, uuid, jsonb, jsonb, uuid);
DROP FUNCTION IF EXISTS release_company_check(uuid, text, integer, text, jsonb);

-- finish_company_check as in 20261021010000.
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
REVOKE ALL ON FUNCTION finish_company_check(uuid, text, text, jsonb, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finish_company_check(uuid, text, text, jsonb, text, integer) TO service_role;

ALTER TABLE company_checks DROP CONSTRAINT IF EXISTS company_checks_status_check;
ALTER TABLE company_checks ADD CONSTRAINT company_checks_status_check CHECK (status IN (
  'matched', 'queued', 'running', 'ready', 'stealth',
  'rejected_public', 'rejected_non_tech', 'done', 'failed', 'cancelled'));
ALTER TABLE company_checks DROP CONSTRAINT IF EXISTS company_checks_phase_check;
ALTER TABLE company_checks DROP COLUMN IF EXISTS identity;
ALTER TABLE company_checks DROP COLUMN IF EXISTS candidates;
ALTER TABLE company_checks DROP COLUMN IF EXISTS phase;
