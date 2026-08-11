-- =============================================================================
-- Migration: materialize startups_search
-- Created:   2026-08-11
-- Description:
--   startups_search (last redefined in 20260723000000_startups_completeness_
--   score.sql — this migration reproduces that exact definition, not the
--   original 20260713000000 one) was designed to make the Startups Hub scale
--   past client-side filtering, but it is a plain VIEW: every single query
--   against it — every page load, every filter change, every pagination
--   click, from every visitor — re-runs its full definition live:
--     - classify_sector_parent(industry): a ~30-branch ILIKE CASE, evaluated
--       per row as a COALESCE fallback (twice per row: once in the SELECT
--       list, once again inside the window function's PARTITION BY).
--     - TWO correlated LEFT JOIN LATERAL subqueries against funding_rounds
--       per row (latest round, total raised), plus two more LEFT JOINs
--       against sectors.
--     - A COUNT(*) OVER (PARTITION BY sector_parent, stage_group) window
--       function, which needs the full partition materialized to produce a
--       correct count — not something a WHERE/LIMIT applied on top of the
--       view can prune away.
--     - A 12-branch completeness_score CASE expression, per row.
--   At the ~5,600 rows this was built against that was fine. At 10,000+ rows
--   (current count after this session's CSV imports) that same live
--   recomputation, on every request, is the direct cause of "the Private
--   Market page is slow."
--
--   Fix: make it a MATERIALIZED VIEW. All of the above still happens, but
--   only once per refresh instead of once per query — every page load then
--   becomes a plain indexed SELECT against a physical, pre-computed table.
--   Freshness trade-off: results can lag real inserts/enrichment by up to
--   the refresh interval (15 min via pg_cron below), which is a reasonable
--   trade for a dataset that changes via periodic batch scripts, not live
--   user writes. Scripts that mutate startups/funding_rounds/sectors can
--   also call refresh_startups_search() directly for an immediate refresh
--   instead of waiting for the next scheduled tick (already wired into
--   import_startups_list.ts, bulk_enrich_all.ts, discover_competitors.ts).
--
--   No UI/component changes needed — same view name, same columns, same
--   query shape from PostgREST's point of view.
--
-- Rollback: supabase/rollback/20260811000000_materialize_startups_search_down.sql
-- =============================================================================

-- DROP...CASCADE also drops suggested_startup_peers() (RETURNS SETOF
-- startups_search) — recreated verbatim at the bottom of this migration.
DROP VIEW IF EXISTS startups_search CASCADE;

CREATE MATERIALIZED VIEW startups_search AS
SELECT
  s.*,
  COALESCE(sec.name, classify_sector_parent(s.industry)) AS sector_parent,
  sub_sec.name                       AS sub_sector_name,
  stage_group(latest.round_type)     AS stage_group_val,
  latest.round_type                  AS latest_round_type,
  latest.valuation                   AS latest_valuation,
  latest.announcement_date           AS latest_round_date,
  latest.is_valuation_estimated      AS latest_round_is_estimated,
  COALESCE(totals.total_raised, 0)   AS total_raised,
  (latest.announcement_date IS NOT NULL
    AND latest.announcement_date >= (CURRENT_DATE - INTERVAL '6 months')) AS has_recent_round,
  COUNT(*) OVER (
    PARTITION BY COALESCE(sec.name, classify_sector_parent(s.industry)),
                 stage_group(latest.round_type)
  ) AS peer_count,
  (COALESCE(sec.name, classify_sector_parent(s.industry)) <> 'Uncategorized'
    AND stage_group(latest.round_type) <> 'unknown') AS peer_count_valid,
  (
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
    (CASE WHEN latest.round_type          IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN latest.valuation           IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN latest.announcement_date   IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN COALESCE(totals.total_raised, 0) > 0 THEN 1 ELSE 0 END)
  ) AS completeness_score
FROM startups s
LEFT JOIN sectors sec     ON sec.id     = s.sector_id
LEFT JOIN sectors sub_sec ON sub_sec.id = s.sub_sector_id
LEFT JOIN LATERAL (
  SELECT fr.round_type, fr.valuation, fr.announcement_date, fr.is_valuation_estimated
  FROM funding_rounds fr
  WHERE fr.startup_id = s.id
  ORDER BY fr.announcement_date DESC NULLS LAST, fr.created_at DESC
  LIMIT 1
) latest ON true
LEFT JOIN LATERAL (
  SELECT SUM(fr.amount_raised) AS total_raised
  FROM funding_rounds fr
  WHERE fr.startup_id = s.id
) totals ON true
WITH DATA;

COMMENT ON MATERIALIZED VIEW startups_search IS
  'Read-optimized snapshot for the Private Market page''s sidebar/search: precomputes latest funding round, total raised, sector bucket (stored sector first, keyword fallback), a scalable peer_count, and a 0-15 completeness_score. Refreshed by pg_cron every 15 min (see refresh_startups_search below) and on-demand by the import/enrich/discover scripts after they write.';

-- REQUIRED for REFRESH ... CONCURRENTLY (lets refreshes run without blocking
-- readers — otherwise every refresh would briefly lock the view for queries).
CREATE UNIQUE INDEX idx_startups_search_id ON startups_search(id);

-- Indexes matching the actual filter/sort columns in
-- applyStartupSearchFilters + fetchStartupsPage's default sort
-- (src/lib/supabase.ts).
CREATE INDEX idx_startups_search_sector_parent  ON startups_search(sector_parent);
CREATE INDEX idx_startups_search_country        ON startups_search(country);
CREATE INDEX idx_startups_search_city           ON startups_search(city);
CREATE INDEX idx_startups_search_round_type     ON startups_search(latest_round_type);
CREATE INDEX idx_startups_search_employee_count ON startups_search(employee_count);
CREATE INDEX idx_startups_search_peer_count     ON startups_search(peer_count) WHERE peer_count_valid;
CREATE INDEX idx_startups_search_momentum       ON startups_search(has_recent_round, growth_trend);
CREATE INDEX idx_startups_search_completeness   ON startups_search(completeness_score DESC);

-- Materialized views are physical relations — they do NOT inherit RLS from
-- their source tables the way a plain view does. That is not a new exposure
-- here: startups' own RLS policy is a public "USING (true)" read (every row
-- was already visible to anon/authenticated through the old view), so this
-- grant reproduces the exact same access, just against the new relation kind.
GRANT SELECT ON startups_search TO anon, authenticated;

-- Recreate verbatim (dropped by the CASCADE above).
CREATE OR REPLACE FUNCTION suggested_startup_peers(
  p_startup_id  uuid,
  p_exclude_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_limit       int DEFAULT 5
)
RETURNS SETOF startups_search
LANGUAGE sql
STABLE
AS $$
  SELECT peer.*
  FROM startups_search target
  JOIN startups_search peer
    ON peer.sector_parent    = target.sector_parent
   AND peer.stage_group_val  = target.stage_group_val
   AND target.peer_count_valid
   AND peer.id <> target.id
   AND peer.id <> ALL (p_exclude_ids)
  WHERE target.id = p_startup_id
  ORDER BY peer.total_raised DESC NULLS LAST
  LIMIT p_limit;
$$;

-- ── Refresh ─────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so anon/authenticated callers (RPC) can't run it — refresh
-- is a maintenance operation, not a public API. Scripts refresh via the
-- service-role client, which bypasses the REVOKE below same as everywhere
-- else in this schema.
CREATE OR REPLACE FUNCTION refresh_startups_search()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY startups_search;
$$;

REVOKE ALL ON FUNCTION refresh_startups_search() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-startups-search') THEN
    PERFORM cron.unschedule('refresh-startups-search');
  END IF;
END;
$$;

-- Every 15 minutes. The dataset changes via periodic batch scripts (CSV
-- import, bulk enrichment, competitor discovery), not continuous live
-- writes, so a 15-minute-worst-case staleness window is a good trade against
-- refreshing (and re-paying the window-function cost) more often than the
-- data actually changes. Those scripts also call refresh_startups_search()
-- directly when they want results visible sooner than the next tick.
SELECT cron.schedule(
  'refresh-startups-search',
  '*/15 * * * *',
  $cron$ SELECT refresh_startups_search(); $cron$
);

SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'refresh-startups-search';
