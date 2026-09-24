-- =============================================================================
-- Migration: preference_vector_recompute
-- Created:   2026-09-25
-- Description:
--   Phase 4 of the preference engine: the batch job that actually populates
--   user_preference_vectors.embedding (added schema-only in
--   20260924000000_preference_engine_phase1.sql).
--
--   Scope, deliberately narrow for v1:
--     - Positive signal only. embedding = avg(startups.embedding) over the
--       user's CURRENT watchlist_items (not the user_interactions save log —
--       watchlist is the live source of truth, since un-saving something
--       doesn't log a removal event and shouldn't keep influencing the
--       vector after it's gone).
--     - No negative weighting from Pass here. Passed companies are already
--       permanently excluded from the Private Market page's results
--       (startups.sub_sector_tags... see excludeStartupIds in
--       src/lib/supabase.ts, Phase 3), so the vector doesn't also need to
--       push away from them for ranking the remaining candidates. This is
--       also a real constraint, not just a simplicity choice: the installed
--       pgvector (0.6.0) has no scalar * vector operator, so a weighted
--       "pos - 0.35*neg" subtraction needs an array_fill() workaround this
--       version doesn't cleanly support — not worth it for a v1 that's
--       already covered by the exclusion filter.
--     - Zero saves -> no row written (not a zero vector) -- Phase 5's "still
--       calibrating" UI can key off row-absence rather than a magic value.
--     - Full recompute every run, not incremental -- same philosophy as
--       refresh_startups_search(): simple and correct beats clever here,
--       and this is cheap (only users with >=1 watchlist item are touched).
--
-- Idempotent: CREATE OR REPLACE / unschedule-then-reschedule throughout.
-- Safe to paste into the Supabase SQL Editor and run more than once.
-- =============================================================================

CREATE OR REPLACE FUNCTION recompute_user_preference_vectors()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  INSERT INTO user_preference_vectors (user_id, embedding, signal_count, updated_at)
  SELECT
    wi.user_id,
    avg(s.embedding),
    count(*),
    now()
  FROM watchlist_items wi
  JOIN startups s
    ON s.id = wi.entity_id
   AND wi.entity_type = 'startup'
   AND s.embedding IS NOT NULL
  GROUP BY wi.user_id
  HAVING count(*) > 0
  ON CONFLICT (user_id) DO UPDATE
    SET embedding    = EXCLUDED.embedding,
        signal_count = EXCLUDED.signal_count,
        updated_at   = EXCLUDED.updated_at;
$$;

COMMENT ON FUNCTION recompute_user_preference_vectors() IS
  'Phase 4 batch job: rewrites every user''s preference-vector centroid from their CURRENT watchlist (positive signal only -- see migration header for why negative/Pass weighting is deliberately out of scope for v1). Full recompute, not incremental. Runs every 30 min via pg_cron (see below) and can be called directly by the service-role client for an immediate refresh.';

REVOKE ALL ON FUNCTION recompute_user_preference_vectors() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recompute-preference-vectors') THEN
    PERFORM cron.unschedule('recompute-preference-vectors');
  END IF;
END;
$$;

-- Every 30 minutes. Cheaper than the 15-min startups_search refresh (only
-- users with at least one watchlist item are touched, and it's a single
-- GROUP BY + avg(), not a per-row window function over the whole table), and
-- a preference vector doesn't need to be as fresh as the search results
-- themselves -- a save made 20 minutes ago doesn't need to affect ranking
-- this second.
SELECT cron.schedule(
  'recompute-preference-vectors',
  '*/30 * * * *',
  $cron$ SELECT recompute_user_preference_vectors(); $cron$
);

SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'recompute-preference-vectors';
