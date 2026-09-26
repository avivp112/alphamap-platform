-- =============================================================================
-- Migration: top_thesis_matches_rpc
-- Created:   2026-10-01
-- Description:
--   My Area / "Thesis Matches & Recommendations" section. Sibling to
--   match_scores_for_startups (20260926000000), which only ANNOTATES a
--   caller-supplied list of ids -- there was no way to ask "what are my top
--   N matches across the whole corpus", which is exactly what a
--   recommendations feed needs.
--
--   Same security shape as match_scores_for_startups: SECURITY DEFINER with
--   an explicit auth.uid() join means the function can only ever read and
--   rank against the CALLING user's own preference vector. Same signal_count
--   >= 3 gate -- a user with too few saved companies gets zero rows, not a
--   noisy ranking, so the client can show the same "still calibrating" state
--   the match badge already uses.
--
--   Two exclusions beyond match_scores_for_startups, because this is a
--   discovery feed rather than an annotation of results the user is already
--   looking at:
--     - Already-watchlisted startups are excluded -- they belong in the
--       Curated Watchlist section, not duplicated here as a "recommendation".
--     - Passed startups are excluded, same as the Private Market page's
--       permanent exclusion (fetchPassedStartupIds) -- an explicit pass is a
--       stronger, more specific signal than a raised eyebrow at a repeat
--       recommendation.
--
--   is_new flags startups created within p_new_within_days, so the client can
--   badge "just discovered, matches your thesis" separately from a
--   longstanding high match the user simply hadn't seen surfaced before.
--
-- Rollback: supabase/rollback/20261001000000_top_thesis_matches_rpc_down.sql
-- Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION top_thesis_matches(
  p_limit           integer DEFAULT 20,
  p_new_within_days integer DEFAULT 14
)
RETURNS TABLE(
  startup_id   uuid,
  match_pct    integer,
  signal_count integer,
  is_new       boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    s.id,
    GREATEST(0, LEAST(100, round((1 - (s.embedding <=> pv.embedding)) * 100)))::integer,
    pv.signal_count,
    (s.created_at >= now() - make_interval(days => p_new_within_days))
  FROM startups s
  JOIN user_preference_vectors pv ON pv.user_id = auth.uid()
  WHERE s.embedding IS NOT NULL
    AND pv.signal_count >= 3
    AND NOT EXISTS (
      SELECT 1 FROM watchlist_items wi
       WHERE wi.user_id = auth.uid() AND wi.entity_type = 'startup' AND wi.entity_id = s.id)
    AND NOT EXISTS (
      SELECT 1 FROM user_interactions ui
       WHERE ui.user_id = auth.uid() AND ui.startup_id = s.id AND ui.action_type = 'pass')
  ORDER BY s.embedding <=> pv.embedding ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION top_thesis_matches(integer, integer) IS
  'My Area recommendations feed: the CALLING user''s top-N startups by cosine similarity to their preference-vector centroid, excluding anything already watchlisted or explicitly passed on. Empty below signal_count 3 -- the client shows "still calibrating", not zero results as a dead end. is_new flags startups created within p_new_within_days.';

REVOKE ALL ON FUNCTION top_thesis_matches(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION top_thesis_matches(integer, integer) TO authenticated;
