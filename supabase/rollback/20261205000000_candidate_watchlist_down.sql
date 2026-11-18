-- Rollback of 20261205000000_candidate_watchlist.sql.
-- Watching candidates go back to pending (their tier restored) so none is lost, and
-- expired ones become pending too; then the constraint and columns are removed.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('uk-watchlist-check', 'uk-watchlist-expire');
  END IF;
END $$;

UPDATE company_candidates
   SET status = 'pending', gate_tier = coalesce(watch_tier, gate_tier)
 WHERE status IN ('watching', 'expired');

DROP FUNCTION IF EXISTS candidate_cross_source_matches(uuid);
DROP FUNCTION IF EXISTS expire_watching(integer);
DROP FUNCTION IF EXISTS promote_candidate(uuid, text);
DROP FUNCTION IF EXISTS watch_candidate(uuid);

-- merge_candidate_evidence goes back to pending-only (20261204000000).
CREATE OR REPLACE FUNCTION merge_candidate_evidence(p_candidate_id uuid, p_extra jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_candidate_id IS NULL OR p_extra IS NULL OR jsonb_typeof(p_extra) <> 'object' THEN RETURN false; END IF;
  UPDATE company_candidates
     SET evidence = evidence || (jsonb_strip_nulls(p_extra) - ARRAY[
           'form_type', 'jurisdiction', 'industry_group', 'codes', 'officers', 'summary',
           'total_offering', 'total_sold', 'title', 'abstract', 'filing_date'])
   WHERE id = p_candidate_id AND status = 'pending';
  RETURN FOUND;
END;
$$;

DROP INDEX IF EXISTS idx_company_candidates_watching;
ALTER TABLE company_candidates
  DROP COLUMN IF EXISTS watch_started_at, DROP COLUMN IF EXISTS watch_checked_at,
  DROP COLUMN IF EXISTS watch_tier, DROP COLUMN IF EXISTS promoted_at, DROP COLUMN IF EXISTS promoted_reason;
ALTER TABLE company_candidates DROP CONSTRAINT IF EXISTS company_candidates_status_check;
ALTER TABLE company_candidates
  ADD CONSTRAINT company_candidates_status_check CHECK (status IN ('pending', 'approved', 'rejected'));
