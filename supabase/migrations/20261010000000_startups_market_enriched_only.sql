-- The Private Market page lists only companies with real data on them —
-- enriched by v1 (scripts/bulk_enrich_all.ts) or v2 (bulk_enrich_v2.ts).
-- Companies with no data or only a few imported basics stay in the
-- database untouched; they are only left off the page, and each one
-- appears there as soon as an enrichment run fills it in.
--
-- "Real data" = a description AND at least 7 of the 15 fields counted by
-- startups_search.completeness_score (website, description, industry,
-- founded year, headcount, growth trend, country, city, founders,
-- leadership, competitors, latest round type / valuation / date, total
-- raised) — or v2 wrote data for it (startups.enriched_v2_at). To move the
-- bar, re-run the CREATE OR REPLACE VIEW below with another number.
--
--   startups.enriched_v2_at — set by scripts/bulk_enrich_v2.ts when a run
--   writes data for the company (not on a rejection, error or empty run,
--   which only stamp last_enriched_at to move the queue along).
--
--   startups_market — a plain view over the startups_search materialized
--   view, joined to startups on the primary key. startups_search itself is
--   not rebuilt: its column list and the functions that return SETOF
--   startups_search stay exactly as they are, and lookups by id
--   (watchlist, linked competitors) still see every row.

ALTER TABLE startups ADD COLUMN IF NOT EXISTS enriched_v2_at timestamptz;

COMMENT ON COLUMN startups.enriched_v2_at IS
  'When scripts/bulk_enrich_v2.ts last wrote data for this company. NULL = not written by v2 (it may still have data from v1 or an import).';

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
WHERE s.enriched_v2_at IS NOT NULL
   OR (ss.completeness_score >= 7 AND coalesce(trim(ss.description), '') <> '');

COMMENT ON VIEW startups_market IS
  'startups_search limited to companies with real data: a description and completeness_score >= 7, or written by v2 (startups.enriched_v2_at). Read by the Private Market page list, count and export.';

GRANT SELECT ON startups_market TO anon, authenticated;
