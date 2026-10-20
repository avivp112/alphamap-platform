-- =============================================================================
-- "Deepen this profile": a user runs enrichment v2 on a company already in
-- AlphaMap (decision of 2026-10-20).
--
--   * company_checks.kind = 'deepen' — the company is known
--     (matched_startup_id), so there is no identify phase and no threshold
--     checks: queued -> running -> done / no_new_data / failed. The user sees
--     the research at once on their own check, labelled pending verification.
--   * free_of_charge — set by the company-check function when the profile is
--     thin (completeness below DEEPEN_FREE_BELOW, _shared/check-limits.ts):
--     the rate limit applies, the monthly allowance does not.
--   * What reaches the shared database (worker/deepen.ts):
--       - an EMPTY field filled from an official source (registry) with high
--         confidence is written at once;
--       - everything else (rounds, a change to a value on file, weaker
--         sources) waits for the admin as an "update" proposal in
--         check_promotions, with the differences (diff).
--   * startup_completeness() — the same 0-15 score as startups_search, for
--     any company (the search view leaves out the thinnest ones).
--
-- Rollback: supabase/rollback/20261026000000_deepen_profile_down.sql
-- =============================================================================

ALTER TABLE company_checks ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'new';
ALTER TABLE company_checks ADD COLUMN IF NOT EXISTS free_of_charge boolean NOT NULL DEFAULT false;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_checks_kind_check') THEN
    ALTER TABLE company_checks ADD CONSTRAINT company_checks_kind_check CHECK (kind IN ('new', 'deepen'));
  END IF;
END;
$$;
COMMENT ON COLUMN company_checks.kind IS
  'new = a company not in AlphaMap (identify, checks, research); deepen = more research on the AlphaMap company in matched_startup_id.';
COMMENT ON COLUMN company_checks.free_of_charge IS
  'Not counted in the monthly allowance (a deepen of a thin profile). The rate limit still applies.';

ALTER TABLE company_checks DROP CONSTRAINT IF EXISTS company_checks_status_check;
ALTER TABLE company_checks ADD CONSTRAINT company_checks_status_check CHECK (status IN (
  'matched',                -- already in AlphaMap: shown at once, nothing run
  'queued', 'running',      -- waiting for / held by the worker (either phase)
  'awaiting_confirmation',  -- identify phase done: the user picks the company
  'ready',                  -- passed the threshold checks; enrichment comes next
  'stealth',                -- too little public information: watched privately
  'rejected_public', 'rejected_non_tech',
  'no_new_data',            -- deepen: the research found nothing to add
  'done', 'failed', 'cancelled'));

-- One deepen of a company per user at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_checks_deepen_in_flight
  ON company_checks (user_id, matched_startup_id)
  WHERE kind = 'deepen' AND status IN ('queued', 'running');

-- Same as 20261022000000, plus no_new_data among the check phase's final statuses.
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
    OR (v_phase = 'check' AND p_status IN ('ready', 'stealth', 'rejected_public', 'rejected_non_tech', 'no_new_data', 'done', 'failed'))) THEN
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

-- ── Completeness: the startups_search score, for any company ─────────────────
CREATE OR REPLACE FUNCTION startup_completeness(p_startup_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (CASE WHEN s.website     IS NOT NULL AND trim(s.website)     <> '' THEN 1 ELSE 0 END) +
    (CASE WHEN s.description IS NOT NULL AND trim(s.description) <> '' THEN 1 ELSE 0 END) +
    (CASE WHEN s.industry    IS NOT NULL AND trim(s.industry)    <> '' THEN 1 ELSE 0 END) +
    (CASE WHEN s.founded_year   IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN s.employee_count IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN s.growth_trend   IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN s.country IS NOT NULL AND trim(s.country) <> '' THEN 1 ELSE 0 END) +
    (CASE WHEN s.city    IS NOT NULL AND trim(s.city)    <> '' THEN 1 ELSE 0 END) +
    (CASE WHEN jsonb_typeof(s.founders)    = 'array' AND jsonb_array_length(s.founders)    > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN jsonb_typeof(s.leadership)  = 'array' AND jsonb_array_length(s.leadership)  > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN jsonb_typeof(s.competitors) = 'array' AND jsonb_array_length(s.competitors) > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN latest.round_type        IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN latest.valuation         IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN latest.announcement_date IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN COALESCE(totals.total_raised, 0) > 0 THEN 1 ELSE 0 END)
  FROM startups s
  LEFT JOIN LATERAL (
    SELECT fr.round_type, fr.valuation, fr.announcement_date
    FROM funding_rounds fr WHERE fr.startup_id = s.id
    ORDER BY fr.announcement_date DESC NULLS LAST, fr.created_at DESC
    LIMIT 1
  ) latest ON true
  LEFT JOIN LATERAL (SELECT SUM(fr.amount_raised) AS total_raised FROM funding_rounds fr WHERE fr.startup_id = s.id) totals ON true
  WHERE s.id = p_startup_id;
$$;
REVOKE ALL ON FUNCTION startup_completeness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION startup_completeness(uuid) TO authenticated, service_role;

-- ── Update proposals ─────────────────────────────────────────────────────────
ALTER TABLE check_promotions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'new';
ALTER TABLE check_promotions ADD COLUMN IF NOT EXISTS diff jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_promotions_kind_check') THEN
    ALTER TABLE check_promotions ADD CONSTRAINT check_promotions_kind_check CHECK (kind IN ('new', 'update'));
  END IF;
END;
$$;
COMMENT ON COLUMN check_promotions.kind IS
  'new = a company to add to AlphaMap; update = additions/changes to the AlphaMap company in startup_id, listed in diff.';

-- An update is proposed with its company already set (startup_id). It can be
-- rejected until the worker takes it.
CREATE OR REPLACE FUNCTION reject_check_promotion(p_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (is_app_admin() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'reject_check_promotion: admins only' USING ERRCODE = '42501';
  END IF;
  UPDATE check_promotions
     SET status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(),
         review_note = coalesce(p_note, review_note), updated_at = now()
   WHERE id = p_id AND status IN ('pending', 'approved', 'failed')
     AND (startup_id IS NULL OR (kind = 'update' AND status <> 'failed'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reject_check_promotion: % can no longer be rejected', p_id;
  END IF;
END;
$$;

-- Same as 20261025000000, plus the proposal's kind and company.
CREATE OR REPLACE FUNCTION claim_check_promotion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p check_promotions%ROWTYPE;
  c company_checks%ROWTYPE;
BEGIN
  SELECT * INTO p FROM check_promotions
   WHERE status = 'approved'
      OR (status = 'writing' AND startup_id IS NULL AND claimed_at < now() - interval '15 minutes')
   ORDER BY reviewed_at NULLS LAST, created_at
   LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE check_promotions SET status = 'writing', claimed_at = now(), updated_at = now() WHERE id = p.id;
  SELECT * INTO c FROM company_checks WHERE id = p.check_id;
  RETURN jsonb_build_object(
    'id', p.id, 'check_id', p.check_id, 'user_id', c.user_id, 'kind', p.kind, 'startup_id', p.startup_id,
    'name', coalesce(nullif(c.identity->>'name', ''), c.input->>'name'),
    'website', coalesce(nullif(c.identity->>'website', ''), c.input->>'website'),
    'collected', p.collected);
END;
$$;
