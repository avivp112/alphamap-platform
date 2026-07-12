-- =============================================================================
-- Migration: add_startups_competitors
-- Created:   2026-07-12
-- Description: Adds a competitors jsonb column to startups, storing an array
--              of competitor names or URLs, e.g. ["wiz.io", "orca.security"].
--              Populated manually by the research team — never inferred from
--              sector/stage similarity (see Startups.tsx CompetitorsMarketTab).
-- =============================================================================

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS competitors jsonb;

COMMENT ON COLUMN startups.competitors
  IS 'JSONB array of competitor names or URLs, e.g. ["wiz.io", "orca.security"]. Manually curated.';
