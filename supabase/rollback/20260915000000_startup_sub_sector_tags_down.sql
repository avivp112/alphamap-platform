-- Rollback for 20260915000000_startup_sub_sector_tags.sql
-- Restores the single sub_sector_id column (best-effort: picks one tag per
-- startup — deliberately lossy, since the whole point of the migration was
-- that one value can't represent several tags) and drops the tag table.

DROP FUNCTION IF EXISTS suggested_startup_peers(uuid, uuid[], int);
DROP MATERIALIZED VIEW IF EXISTS startups_search CASCADE;

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS sub_sector_id uuid REFERENCES sectors(id) ON DELETE SET NULL;

UPDATE startups s
SET sub_sector_id = pick.sector_id
FROM (
  SELECT DISTINCT ON (startup_id) startup_id, sector_id
  FROM startup_sub_sectors
  ORDER BY startup_id, created_at ASC
) pick
WHERE pick.startup_id = s.id
  AND s.sub_sector_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_startups_sub_sector ON startups (sub_sector_id);

DROP TABLE IF EXISTS startup_sub_sectors;

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

CREATE UNIQUE INDEX idx_startups_search_id ON startups_search(id);
CREATE INDEX idx_startups_search_sector_parent  ON startups_search(sector_parent);
CREATE INDEX idx_startups_search_country        ON startups_search(country);
CREATE INDEX idx_startups_search_city           ON startups_search(city);
CREATE INDEX idx_startups_search_round_type     ON startups_search(latest_round_type);
CREATE INDEX idx_startups_search_employee_count ON startups_search(employee_count);
CREATE INDEX idx_startups_search_peer_count     ON startups_search(peer_count) WHERE peer_count_valid;
CREATE INDEX idx_startups_search_momentum       ON startups_search(has_recent_round, growth_trend);
CREATE INDEX idx_startups_search_completeness   ON startups_search(completeness_score DESC);

GRANT SELECT ON startups_search TO anon, authenticated;

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
