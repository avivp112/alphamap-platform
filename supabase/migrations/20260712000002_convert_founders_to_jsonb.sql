-- =============================================================================
-- Migration: convert_founders_to_jsonb
-- Created:   2026-07-12
-- Description: Converts startups.founders from a plain text[] of names to a
--              jsonb array of { name: text, linkedin_url: text | null }
--              objects, matching the shape already used by `leadership`.
--
--              Postgres does not allow a subquery inside the USING clause of
--              ALTER COLUMN ... TYPE ("cannot use subquery in transform
--              expression"), so this uses the standard workaround instead:
--              add a new jsonb column, backfill it with an UPDATE (which can
--              use subqueries freely), then drop the old column and rename.
--
--              Existing string values are migrated in place, e.g.
--                ARRAY['Patrick Collison', 'John Collison']
--              becomes
--                [{"name": "Patrick Collison", "linkedin_url": null},
--                 {"name": "John Collison",    "linkedin_url": null}]
--              linkedin_url is left null for pre-existing rows since no
--              scraper has ever extracted it; new ingestion/enrichment code
--              (bulk_enrich_all.ts, autopilot.ts, ingest-startup edge fn) is
--              updated in the same change to write the new object shape.
-- =============================================================================

ALTER TABLE startups ADD COLUMN IF NOT EXISTS founders_jsonb jsonb;

UPDATE startups
SET founders_jsonb = (
  CASE
    WHEN founders IS NULL THEN NULL
    ELSE (
      SELECT jsonb_agg(jsonb_build_object('name', f, 'linkedin_url', NULL))
      FROM unnest(founders) AS f
    )
  END
)
WHERE founders_jsonb IS NULL;

ALTER TABLE startups DROP COLUMN founders;
ALTER TABLE startups RENAME COLUMN founders_jsonb TO founders;

COMMENT ON COLUMN startups.founders
  IS 'JSONB array of { name: text, linkedin_url: text | null }, e.g. [{"name": "Patrick Collison", "linkedin_url": null}]';

-- Also document the sibling `leadership` column's extended shape now that
-- linkedin_url is a recognized field there too (added alongside role, not
-- replacing it — see src/lib/supabase.ts Leader interface).
COMMENT ON COLUMN startups.leadership
  IS 'JSONB array of { name: text, role: text, linkedin_url?: text | null }';
