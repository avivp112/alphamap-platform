-- =============================================================================
-- Migration: record the analyst's recommendation at decision time
-- Created:   2026-12-06
-- Description:
--   The review screen shows a recommendation (approve / borderline / reject) with
--   its reasons, computed in the browser from the card's evidence
--   (src/lib/candidateRecommendation.ts). Just before the owner approves or
--   rejects, the screen calls record_candidate_recommendation() so the verdict
--   shown (and the rules that produced it) are kept on the candidate. Comparing
--   recommendation with decision is how the rules are tuned — and the basis for
--   any later, softer step than a recommendation.
--
--   Admins (or the service role) only. Pending and watching candidates only: a
--   decided candidate's record is not rewritten. Additive and idempotent.
--
-- Rollback: supabase/rollback/20261206000000_candidate_recommendation_log_down.sql
-- =============================================================================

ALTER TABLE company_candidates
  ADD COLUMN IF NOT EXISTS recommendation       text CHECK (recommendation IN ('approve', 'borderline', 'reject')),
  ADD COLUMN IF NOT EXISTS recommendation_rules text[],
  ADD COLUMN IF NOT EXISTS recommended_at       timestamptz;

CREATE OR REPLACE FUNCTION record_candidate_recommendation(p_candidate_id uuid, p_verdict text, p_rules text[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (is_app_admin() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'record_candidate_recommendation: admins only' USING ERRCODE = '42501';
  END IF;
  IF p_verdict NOT IN ('approve', 'borderline', 'reject') THEN
    RETURN false;
  END IF;
  UPDATE company_candidates
     SET recommendation = p_verdict, recommendation_rules = p_rules, recommended_at = now()
   WHERE id = p_candidate_id AND status IN ('pending', 'watching');
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION record_candidate_recommendation(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_candidate_recommendation(uuid, text, text[]) TO authenticated, service_role;

COMMENT ON FUNCTION record_candidate_recommendation IS
  'Keeps the recommendation shown on the review card at the moment of the decision. Admins and the service role only.';
