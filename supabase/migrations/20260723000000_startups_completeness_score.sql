-- =============================================================================
-- Migration: startups_completeness_score
-- Created:   2026-07-23
-- Description: Adds a `completeness_score` column to the startups_search view
--              so the Private Market page can list the best-documented
--              companies first (and the thinnest records last), server-side
--              across the full dataset rather than just within one loaded
--              page.
--
--              Score is 0-15, one point per populated field: website,
--              description, industry, founded_year, employee_count,
--              growth_trend, country, city, founders, leadership,
--              competitors, latest funding round type/valuation/date, and
--              total capital raised.
--
--              A view's `s.*` is expanded (frozen) at CREATE VIEW time, and
--              `startups` has grown new columns (e.g. `acquisitions`) since
--              this view was last created — so CREATE OR REPLACE VIEW fails
--              with "cannot change name of view column" (Postgres won't let
--              a replace shift existing column positions). Same fix as
--              20260717000000: drop the view and its dependent function,
--              then recreate both.
--
--              jsonb_array_length() throws (rather than returning null) when
--              given a non-array JSONB value, and some rows have malformed
--              scalars in founders/leadership/competitors instead of arrays
--              — guarded with jsonb_typeof(...) = 'array' first, same
--              pattern already used for startups.acquisitions elsewhere in
--              this schema (20260720000000_pe_firms.sql).
--
-- Idempotent; safe to run more than once in the SQL Editor.
-- =============================================================================

DROP FUNCTION IF EXISTS suggested_startup_peers(uuid, uuid[], int);
DROP VIEW IF EXISTS startups_search;

CREATE VIEW startups_search AS
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
) totals ON true;

COMMENT ON VIEW startups_search IS
  'Read-optimized view for the Private Market page''s sidebar/search: precomputes latest funding round, total raised, sector bucket (stored sector first, keyword fallback), a scalable peer_count, and a 0-15 completeness_score (so the list can default-sort best-documented companies first) — all server-side so the page can filter+paginate without downloading the full dataset.';

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
