-- Rollback of 20261115000000_company_offices.sql
CREATE OR REPLACE FUNCTION is_israel_related(s startups)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(coalesce(s.country, '')) = 'israel'
      OR lower(coalesce(s.founding_country, '')) = 'israel'
      OR coalesce(s.israel_rnd_center, false);
$$;
DROP VIEW IF EXISTS startups_market;
CREATE VIEW startups_market
WITH (security_invoker = on) AS
SELECT ss.*,
       s.founding_country,
       s.israel_rnd_center,
       is_israel_related(s) AS israel_related
FROM startups_search ss
JOIN startups s ON s.id = ss.id
WHERE s.enriched_v2_at IS NOT NULL
   OR (ss.completeness_score >= 7 AND coalesce(trim(ss.description), '') <> '');
GRANT SELECT ON startups_market TO anon, authenticated;
ALTER TABLE startups DROP COLUMN IF EXISTS office_countries;
ALTER TABLE startups DROP COLUMN IF EXISTS offices;
