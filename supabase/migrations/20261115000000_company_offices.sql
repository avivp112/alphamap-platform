-- =============================================================================
-- 20261115000000_company_offices.sql
--
-- A company's offices beside its headquarters (owner, 2026-11-01). Port, Aidoc
-- and SSI list offices — New York and Tel Aviv, Palo Alto and Tel Aviv — and
-- declare no headquarters: city / country stay empty then, and the offices
-- show instead ("Offices: New York, Tel Aviv").
--
--   offices          [{ "city", "country", "source_url" }] — the offices the
--                    company's own site lists (enrichment v2)
--   office_countries the countries of those offices, for the country filter:
--                    a country filter lists companies with the country as HQ,
--                    an office or the founding country
--
-- startups_market keeps every column it had, in the same order; office_countries
-- is appended. is_israel_related() also counts an office in Israel.
-- Additive only. Rollback: supabase/rollback/20261115000000_company_offices_down.sql
-- =============================================================================

ALTER TABLE startups ADD COLUMN IF NOT EXISTS offices jsonb;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS office_countries text[];

COMMENT ON COLUMN startups.offices IS
  'Offices the company''s own site lists: [{city, country, source_url}]. Separate from the headquarters (city/country), which is set only when the company declares one.';
COMMENT ON COLUMN startups.office_countries IS
  'The countries of startups.offices, for the country filter.';

CREATE OR REPLACE FUNCTION is_israel_related(s startups)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(coalesce(s.country, '')) = 'israel'
      OR lower(coalesce(s.founding_country, '')) = 'israel'
      OR coalesce(s.israel_rnd_center, false)
      OR 'israel' = ANY (SELECT lower(c) FROM unnest(coalesce(s.office_countries, '{}'::text[])) c);
$$;

CREATE OR REPLACE VIEW startups_market
WITH (security_invoker = on) AS
SELECT ss.*,
       s.founding_country,
       s.israel_rnd_center,
       is_israel_related(s) AS israel_related,
       s.office_countries
FROM startups_search ss
JOIN startups s ON s.id = ss.id
WHERE s.enriched_v2_at IS NOT NULL
   OR (ss.completeness_score >= 7 AND coalesce(trim(ss.description), '') <> '');

GRANT SELECT ON startups_market TO anon, authenticated;

-- Confirm: the two columns exist.
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'startups' AND column_name IN ('offices', 'office_countries');
