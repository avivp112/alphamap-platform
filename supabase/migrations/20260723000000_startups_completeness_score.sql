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
-- Idempotent; safe to run more than once in the SQL Editor.
-- =============================================================================

CREATE OR REPLACE VIEW startups_search AS
SELECT
  s.*,
  classify_sector_parent(s.industry) AS sector_parent,
  stage_group(latest.round_type)     AS stage_group_val,
  latest.round_type                  AS latest_round_type,
  latest.valuation                   AS latest_valuation,
  latest.announcement_date           AS latest_round_date,
  latest.is_valuation_estimated      AS latest_round_is_estimated,
  COALESCE(totals.total_raised, 0)   AS total_raised,
  (latest.announcement_date IS NOT NULL
    AND latest.announcement_date >= (CURRENT_DATE - INTERVAL '6 months')) AS has_recent_round,
  COUNT(*) OVER (
    PARTITION BY classify_sector_parent(s.industry), stage_group(latest.round_type)
  ) AS peer_count,
  (classify_sector_parent(s.industry) <> 'Uncategorized'
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
    (CASE WHEN s.founders    IS NOT NULL AND jsonb_array_length(s.founders)    > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN s.leadership  IS NOT NULL AND jsonb_array_length(s.leadership)  > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN s.competitors IS NOT NULL AND jsonb_array_length(s.competitors) > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN latest.round_type          IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN latest.valuation           IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN latest.announcement_date   IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN COALESCE(totals.total_raised, 0) > 0 THEN 1 ELSE 0 END)
  ) AS completeness_score
FROM startups s
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
  'Read-optimized view for the Private Market page''s sidebar/search: precomputes latest funding round, total raised, sector bucket, a scalable peer_count, and a 0-15 completeness_score (so the list can default-sort best-documented companies first) — all server-side so the page can filter+paginate without downloading the full dataset.';
