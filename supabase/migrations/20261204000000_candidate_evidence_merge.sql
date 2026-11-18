-- =============================================================================
-- Migration: merge_candidate_evidence — extra facts on a pending candidate
-- Created:   2026-12-04
-- Description:
--   The ingesters now read more of what the registers publish (a registered
--   office, an issuer address, investors, exemptions...). ingest_gov_entity_filing
--   builds company_candidates.evidence from its named parameters only, and its
--   signature stays as it is: this function adds keys to a candidate's
--   evidence afterwards. Additive and idempotent (same keys, same values).
--
--   * Only a PENDING candidate changes: a decided one keeps what the reviewer saw.
--   * It never overwrites what the ingest itself wrote (officers, codes, summary,
--     amounts, title, abstract...): those keys are stripped from p_extra.
--   * Null values are dropped, so a field the register left empty adds nothing.
--   * Service role only.
--
-- Rollback: supabase/rollback/20261204000000_candidate_evidence_merge_down.sql
-- =============================================================================

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
   WHERE id = p_candidate_id AND status = 'pending';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION merge_candidate_evidence(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION merge_candidate_evidence(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION merge_candidate_evidence IS
  'Adds keys to a PENDING company_candidates.evidence (never the keys ingest_gov_entity_filing writes). Service role only.';
