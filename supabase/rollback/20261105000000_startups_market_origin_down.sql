-- Rollback of 20261105000000_startups_market_origin.sql: startups_market as
-- 20261010000000 defined it. A view cannot lose columns through CREATE OR
-- REPLACE, so it is dropped and recreated. Deploy a site build that does not
-- read the origin columns first.
DROP VIEW IF EXISTS startups_market;

CREATE VIEW startups_market
WITH (security_invoker = on) AS
SELECT ss.*
FROM startups_search ss
JOIN startups s ON s.id = ss.id
WHERE s.enriched_v2_at IS NOT NULL
   OR (ss.completeness_score >= 7 AND coalesce(trim(ss.description), '') <> '');

COMMENT ON VIEW startups_market IS
  'startups_search limited to companies with real data: a description and completeness_score >= 7, or written by v2 (startups.enriched_v2_at). Read by the Private Market page list, count and export.';

GRANT SELECT ON startups_market TO anon, authenticated;
