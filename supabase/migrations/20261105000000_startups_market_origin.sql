-- =============================================================================
-- 20261105000000_startups_market_origin.sql
--
-- The Private Market list gets the origin fields of 20261104000000, read live
-- from startups (not materialized, so a value enrichment writes shows at once):
--
--   founding_country, israel_rnd_center — as on startups
--   israel_related — HQ, founding country or R&D centre in Israel
--                    (is_israel_related()), for the "Israel-related" filter
--
-- startups_market keeps every column it had, in the same order; the three
-- are appended. startups_search is not touched.
-- Requires 20261104000000_company_origin.sql.
-- Rollback: supabase/rollback/20261105000000_startups_market_origin_down.sql
-- =============================================================================

CREATE OR REPLACE VIEW startups_market
WITH (security_invoker = on) AS
SELECT ss.*,
       s.founding_country,
       s.israel_rnd_center,
       is_israel_related(s) AS israel_related
FROM startups_search ss
JOIN startups s ON s.id = ss.id
WHERE s.enriched_v2_at IS NOT NULL
   OR (ss.completeness_score >= 7 AND coalesce(trim(ss.description), '') <> '');

COMMENT ON VIEW startups_market IS
  'startups_search limited to companies with real data: a description and completeness_score >= 7, or written by v2 (startups.enriched_v2_at). Plus the origin fields (founding_country, israel_rnd_center, israel_related). Read by the Private Market page list, count and export.';

GRANT SELECT ON startups_market TO anon, authenticated;

-- Confirm: how many listed companies are Israel-related, and through what.
SELECT count(*) FILTER (WHERE israel_related)                                        AS israel_related,
       count(*) FILTER (WHERE lower(coalesce(country, '')) = 'israel')               AS hq_in_israel,
       count(*) FILTER (WHERE lower(coalesce(founding_country, '')) = 'israel')      AS founded_in_israel,
       count(*) FILTER (WHERE israel_rnd_center)                                     AS rnd_in_israel
FROM startups_market;
