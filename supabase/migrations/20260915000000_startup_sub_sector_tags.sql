-- =============================================================================
-- Migration: startup_sub_sector_tags
-- Created:   2026-09-15
-- Description:
--   A company is often more than one thing — a biotech company building an
--   AI diagnostic agent, a payments company that is also an AI infra vendor.
--   Until now `startups.sub_sector_id` was a single FK, so only one of those
--   fields could ever be recorded. This migration replaces it with a proper
--   many-to-many tag table:
--
--     startups.sector_id      — UNCHANGED. Still the one main/primary field
--                                the company is best known for.
--     startup_sub_sectors     — NEW. Every OTHER field it meaningfully
--                                operates in (typically 1-4 rows), each a
--                                normal row in the existing `sectors`
--                                taxonomy — free to come from a different
--                                parent tree than sector_id (e.g. sector_id
--                                = "Health & Life Sciences" while a tag
--                                points at "AI Agents", under "AI & ML").
--     startups.sub_sector_id  — DROPPED. Its single value per startup is
--                                migrated into startup_sub_sectors first, so
--                                no data is lost, then the column (and its
--                                index) is removed — a startup can now only
--                                ever have ONE list of tags, not a scalar
--                                that quietly disagreed with it.
--
--   startups_search is rebuilt to expose the aggregated tag names as
--   sub_sector_names text[] (replacing the old single sub_sector_name text
--   column) so the Private Market page can filter "show me every other
--   company also tagged X" with a plain array-containment query instead of
--   a keyword guess.
--
-- Idempotent: IF NOT EXISTS / ON CONFLICT / DROP ... IF EXISTS throughout.
-- Safe to paste into the Supabase SQL Editor and run more than once.
-- Frontend impact: src/lib/supabase.ts and src/app/pages/Startups.tsx are
-- updated in the same change — see that commit for the read/write side.
-- Rollback: supabase/rollback/20260915000000_startup_sub_sector_tags_down.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) startup_sub_sectors — many-to-many tag table (mirrors startup_people's
--    join-table shape from 20260717000000_startups_schema_expansion.sql)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS startup_sub_sectors (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id uuid        NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  sector_id  uuid        NOT NULL REFERENCES sectors(id)  ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_startup_sub_sectors UNIQUE (startup_id, sector_id)
);

COMMENT ON TABLE startup_sub_sectors IS
  'Every OTHER field a startup meaningfully operates in, beyond its single primary startups.sector_id. Each row references the same two-tier `sectors` taxonomy as sector_id/the old sub_sector_id, but a startup can now have several (typically 1-4), from any parent tree.';

CREATE INDEX IF NOT EXISTS idx_startup_sub_sectors_startup ON startup_sub_sectors (startup_id);
CREATE INDEX IF NOT EXISTS idx_startup_sub_sectors_sector  ON startup_sub_sectors (sector_id);

ALTER TABLE startup_sub_sectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "startup_sub_sectors_public_read" ON startup_sub_sectors;
CREATE POLICY "startup_sub_sectors_public_read" ON startup_sub_sectors FOR SELECT USING (true);
DROP POLICY IF EXISTS "startup_sub_sectors_service_write" ON startup_sub_sectors;
CREATE POLICY "startup_sub_sectors_service_write" ON startup_sub_sectors FOR ALL USING (auth.role() = 'service_role');

-- -----------------------------------------------------------------------------
-- 2) Migrate existing single sub_sector_id values in, then drop the column.
--    Guarded on the column still existing so this section is a no-op (and
--    therefore safe) on a re-run after the first successful pass.
-- -----------------------------------------------------------------------------
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'startups' AND column_name = 'sub_sector_id'
  ) THEN
    INSERT INTO startup_sub_sectors (startup_id, sector_id)
    SELECT s.id, s.sub_sector_id
    FROM startups s
    WHERE s.sub_sector_id IS NOT NULL
    ON CONFLICT (startup_id, sector_id) DO NOTHING;

    -- Dependents first — same reasoning as 20260717000000's legacy-column
    -- dance: the materialized view's underlying definition (and the
    -- suggested_startup_peers() function, whose return type depends on it)
    -- must go before a column they reference can be dropped.
    DROP FUNCTION IF EXISTS suggested_startup_peers(uuid, uuid[], int);
    DROP MATERIALIZED VIEW IF EXISTS startups_search CASCADE;

    DROP INDEX IF EXISTS idx_startups_sub_sector;
    ALTER TABLE startups DROP COLUMN sub_sector_id;
  END IF;
END
$do$;

-- -----------------------------------------------------------------------------
-- 3) Rebuild startups_search — same shape as 20260811000000, minus the single
--    sub_sec join/sub_sector_name column, plus an aggregated
--    sub_sector_names text[] from the new join table.
--    (DROP...CASCADE may already have run above if step 2 ran; IF EXISTS
--    below makes this section safe standalone too, e.g. on a partial re-run.)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS suggested_startup_peers(uuid, uuid[], int);
DROP MATERIALIZED VIEW IF EXISTS startups_search CASCADE;

CREATE MATERIALIZED VIEW startups_search AS
SELECT
  s.*,
  COALESCE(sec.name, classify_sector_parent(s.industry)) AS sector_parent,
  COALESCE(sub_tags.names, ARRAY[]::text[]) AS sub_sector_names,
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
LEFT JOIN sectors sec ON sec.id = s.sector_id
LEFT JOIN LATERAL (
  SELECT array_agg(tag_sec.name ORDER BY tag_sec.name) AS names
  FROM startup_sub_sectors sss
  JOIN sectors tag_sec ON tag_sec.id = sss.sector_id
  WHERE sss.startup_id = s.id
) sub_tags ON true
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
  'Read-optimized snapshot for the Private Market page''s sidebar/search: precomputes latest funding round, total raised, sector bucket (stored sector first, keyword fallback), the full sub_sector_names tag array, a scalable peer_count, and a 0-15 completeness_score. Refreshed by pg_cron every 15 min (refresh_startups_search) and on-demand by the import/enrich/discover scripts after they write.';

CREATE UNIQUE INDEX idx_startups_search_id ON startups_search(id);
CREATE INDEX idx_startups_search_sector_parent    ON startups_search(sector_parent);
CREATE INDEX idx_startups_search_sub_sector_names ON startups_search USING gin (sub_sector_names);
CREATE INDEX idx_startups_search_country          ON startups_search(country);
CREATE INDEX idx_startups_search_city             ON startups_search(city);
CREATE INDEX idx_startups_search_round_type       ON startups_search(latest_round_type);
CREATE INDEX idx_startups_search_employee_count   ON startups_search(employee_count);
CREATE INDEX idx_startups_search_peer_count       ON startups_search(peer_count) WHERE peer_count_valid;
CREATE INDEX idx_startups_search_momentum         ON startups_search(has_recent_round, growth_trend);
CREATE INDEX idx_startups_search_completeness     ON startups_search(completeness_score DESC);

-- Materialized views don't inherit RLS — see 20260811000000 for why this
-- public grant reproduces (not widens) the source tables' own public read.
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

-- refresh_startups_search() and the 'refresh-startups-search' pg_cron job
-- (both from 20260811000000) are untouched: neither has a hard dependency
-- on the view's column list, only its name, so nothing above invalidated
-- them. The view above was already populated WITH DATA at creation, so no
-- explicit REFRESH is needed here.
