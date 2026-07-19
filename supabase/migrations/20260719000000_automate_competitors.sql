-- =============================================================================
-- Migration: automate_competitors
-- Created:   2026-07-19
-- Description: Supersedes the "manually curated, never inferred" rule set by
--              20260712000000_add_startups_competitors.sql. scripts/bulk_enrich_all.ts
--              now auto-populates this field (4-5 direct competitors per company,
--              each with an explanation of how they compete) using the same
--              fill-null-only write policy as every other profile field — so
--              any row a human already curated is left untouched, and only
--              empty ones get auto-filled.
--
--              Column type stays jsonb (no ALTER needed); only the documented
--              shape changes, from a flat array of name/URL strings to an
--              array of objects:
--                { name, website, how_it_competes, startup_id }
--              startup_id is set when the competitor could be domain-matched
--              to another row in this table, enabling a clickable
--              cross-reference in the UI; null otherwise. The UI (see
--              CompetitorsMarketTab in src/app/pages/Startups.tsx) also
--              accepts the legacy plain-string shape for any rows written
--              before this format landed.
-- =============================================================================

COMMENT ON COLUMN startups.competitors IS
  'JSONB array of competitor objects: {name, website, how_it_competes, startup_id}. Auto-populated by scripts/bulk_enrich_all.ts (fill-null only — never overwrites pre-existing curated data). startup_id is set when domain-matched to another tracked startup.';
