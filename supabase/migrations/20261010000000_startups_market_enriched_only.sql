-- The Private Market page lists only companies the v2 enrichment script has
-- actually enriched. Companies not yet enriched (and ones v2 rejected as
-- non-tech) stay in the database untouched; they are only left off the
-- page, and each one appears there as soon as v2 writes data for it.
--
--   startups.enriched_v2_at — set by scripts/bulk_enrich_v2.ts when a run
--   writes data for the company (not on a rejection, error or empty run,
--   which only stamp last_enriched_at to move the queue along).
--
--   startups_market — a plain view over the startups_search materialized
--   view, joined to startups on the primary key and filtered on the marker.
--   startups_search itself is not rebuilt: its column list and the
--   functions that return SETOF startups_search stay exactly as they are,
--   and lookups by id (watchlist, linked competitors) still see every row.

ALTER TABLE startups ADD COLUMN IF NOT EXISTS enriched_v2_at timestamptz;

COMMENT ON COLUMN startups.enriched_v2_at IS
  'When scripts/bulk_enrich_v2.ts last wrote data for this company. NULL = not enriched by v2 yet; such companies are left off the Private Market page (startups_market).';

CREATE INDEX IF NOT EXISTS idx_startups_enriched_v2 ON startups (id) WHERE enriched_v2_at IS NOT NULL;

-- Backfill: every company v2 has already written provenance for.
UPDATE startups s
SET enriched_v2_at = p.last_write
FROM (SELECT startup_id, max(created_at) AS last_write FROM field_provenance GROUP BY startup_id) p
WHERE p.startup_id = s.id AND s.enriched_v2_at IS NULL;

CREATE OR REPLACE VIEW startups_market
WITH (security_invoker = on) AS
SELECT ss.*
FROM startups_search ss
JOIN startups s ON s.id = ss.id
WHERE s.enriched_v2_at IS NOT NULL;

COMMENT ON VIEW startups_market IS
  'startups_search limited to companies enriched by v2 (startups.enriched_v2_at). Read by the Private Market page list, count and export.';

GRANT SELECT ON startups_market TO anon, authenticated;
