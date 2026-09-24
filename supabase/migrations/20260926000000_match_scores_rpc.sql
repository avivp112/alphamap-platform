-- =============================================================================
-- Migration: match_scores_rpc
-- Created:   2026-09-26
-- Description:
--   Phase 5 of the preference engine: the read path that turns Phase 4's
--   per-user preference-vector centroid into a personalized "Match Score %"
--   the client can render next to each startup.
--
--   Batch, not per-card: the client calls this once per page of results
--   (grid or table) with every visible startup id, instead of the N-RPC-
--   calls-per-page pattern the existing calculate_alphamap_score badge uses.
--
--   Gating lives here, not in the client: a row is only returned once the
--   caller's user_preference_vectors.signal_count >= 3 (too few saves and a
--   cosine similarity is noise, not signal -- see the Phase 5 UI's "still
--   calibrating" state). An id absent from the result set means "calibrating
--   or no personalization data yet", never "0% match" -- the client must not
--   treat a missing row as a zero score.
--
--   SECURITY DEFINER + explicit auth.uid() join (same shape as
--   calculate_alphamap_score / recompute_user_preference_vectors): the
--   function can only ever read the CALLING user's own preference vector,
--   regardless of what ids are passed in, so there's no way to probe another
--   user's centroid or its similarity to an arbitrary company.
-- =============================================================================

CREATE OR REPLACE FUNCTION match_scores_for_startups(p_startup_ids uuid[])
RETURNS TABLE(startup_id uuid, match_pct integer, signal_count integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    s.id,
    GREATEST(0, LEAST(100, round((1 - (s.embedding <=> pv.embedding)) * 100)))::integer,
    pv.signal_count
  FROM startups s
  JOIN user_preference_vectors pv ON pv.user_id = auth.uid()
  WHERE s.id = ANY(p_startup_ids)
    AND s.embedding IS NOT NULL
    AND pv.signal_count >= 3;
$$;

COMMENT ON FUNCTION match_scores_for_startups(uuid[]) IS
  'Phase 5: batch personalized match score for a page of startup ids. cosine similarity between each startup''s embedding and the CALLING user''s preference-vector centroid (Phase 4), scaled to 0-100. Rows are withheld below signal_count 3 -- the client treats an absent id as "still calibrating", never as a 0% match.';

REVOKE ALL ON FUNCTION match_scores_for_startups(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION match_scores_for_startups(uuid[]) TO authenticated;
