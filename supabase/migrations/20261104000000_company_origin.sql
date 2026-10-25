-- =============================================================================
-- 20261104000000_company_origin.sql
--
-- Where a company comes from, beside where it is headquartered (owner's
-- decision, 2026-10-25 — the Dealroom model):
--
--   country            the HQ today, unchanged (Wiz → United States)
--   founding_country   where the company was founded (Wiz → Israel)
--   israel_rnd_center  a source states an R&D / development centre in Israel
--
-- Both are written by enrichment v2 with a field_provenance row (quote + URL),
-- filled once like founded_year. A company is Israel-related when its HQ,
-- its founding country or its R&D centre is in Israel (is_israel_related).
--
-- Additive only. RUN THIS BEFORE deploying the worker or running the bulk
-- enrichment: both now read these columns.
-- Rollback: supabase/rollback/20261104000000_company_origin_down.sql
-- =============================================================================

ALTER TABLE startups ADD COLUMN IF NOT EXISTS founding_country text;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS israel_rnd_center boolean;

COMMENT ON COLUMN startups.founding_country IS
  'Where the company was founded (may differ from the HQ in country). Enrichment v2, evidence in field_provenance.';
COMMENT ON COLUMN startups.israel_rnd_center IS
  'true = a source states an R&D / development centre in Israel. null = not known (never false by default).';

CREATE OR REPLACE FUNCTION is_israel_related(s startups)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(coalesce(s.country, '')) = 'israel'
      OR lower(coalesce(s.founding_country, '')) = 'israel'
      OR coalesce(s.israel_rnd_center, false);
$$;

-- Confirm: two columns.
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'startups' AND column_name IN ('founding_country', 'israel_rnd_center');
