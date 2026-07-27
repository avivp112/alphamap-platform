-- =============================================================================
-- DOWN migration for 20260726130000_gov_sources_expansion.sql
--
-- Restores the Form D-only state from 20260726120000.
--
-- THIS DESTROYS DATA: vc_fund_filings is dropped, and with it every fund
-- filing captured since. Those cost one SEC request each to re-fetch and the
-- daily index only goes back so far conveniently — take a copy first if the
-- raising history matters:
--
--   CREATE TABLE vc_fund_filings_backup AS SELECT * FROM vc_fund_filings;
--
-- raw_gov_filings rows from uk_companies_house and uspto_patent are DELETED
-- before the source CHECK is narrowed, because the constraint cannot be added
-- while they exist. Same warning applies. startups rows created from those
-- sources are left alone — they are real companies regardless of which
-- registry found them.
--
-- Deliberately NOT in supabase/migrations/ — the CLI would run it as a forward
-- migration.
-- =============================================================================

DROP VIEW IF EXISTS vc_fund_firms;
DROP TABLE IF EXISTS vc_fund_filings;

DROP FUNCTION IF EXISTS record_fund_filing(text,text,text,text,date,text,text,integer,text,numeric,numeric,jsonb,jsonb);
DROP FUNCTION IF EXISTS fund_series_number(text);
DROP FUNCTION IF EXISTS fund_firm_name(text);

-- The wrapper must go before the general function it delegates to.
DROP FUNCTION IF EXISTS ingest_form_d_filing(text,text,text,text,date,integer,text,text,jsonb,text,numeric,numeric,jsonb);
DROP FUNCTION IF EXISTS ingest_gov_entity_filing(text,text,text,date,text,text,text,integer,text,text,text,text[],text,text,jsonb,text,numeric,numeric,jsonb);

-- Non-SEC filings cannot survive the narrowed CHECK.
DELETE FROM raw_gov_filings WHERE source <> 'sec_form_d';

DROP INDEX IF EXISTS idx_raw_gov_filings_classification;
DROP INDEX IF EXISTS idx_raw_gov_filings_entity_number;

ALTER TABLE raw_gov_filings
  DROP COLUMN IF EXISTS entity_number,
  DROP COLUMN IF EXISTS classification_codes,
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS abstract,
  DROP COLUMN IF EXISTS country;

ALTER TABLE raw_gov_filings DROP CONSTRAINT IF EXISTS raw_gov_filings_source_check;
ALTER TABLE raw_gov_filings
  ADD CONSTRAINT raw_gov_filings_source_check CHECK (source IN ('sec_form_d'));

-- Restore the original 20260726120000 definition, verbatim.
CREATE OR REPLACE FUNCTION ingest_form_d_filing(
  p_accession      text,
  p_cik            text,
  p_form_type      text,
  p_entity_name    text,
  p_filing_date    date,
  p_year_of_inc    integer,
  p_jurisdiction   text,
  p_industry_group text,
  p_officers       jsonb,
  p_tech_summary   text,
  p_total_offering numeric,
  p_total_sold     numeric,
  p_raw            jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug       text;
  v_startup_id uuid;
  v_created    boolean := false;
  v_year       integer;
  v_filing_id  uuid;
BEGIN
  IF p_entity_name IS NULL OR btrim(p_entity_name) = '' THEN
    RAISE EXCEPTION 'ingest_form_d_filing: entity_name is required';
  END IF;
  IF p_accession IS NULL OR btrim(p_accession) = '' THEN
    RAISE EXCEPTION 'ingest_form_d_filing: accession_number is required (it is the dedupe key)';
  END IF;

  v_slug := gov_company_slug(p_entity_name);

  -- startups.founded_year carries CHECK (> 1900 AND <= current year). An
  -- issuer typo — 20024, or a year in the future — would abort the whole
  -- filing. Drop the value instead: a missing founding year costs 0 points in
  -- the FOMO score, while a lost filing costs the entire company. The raw
  -- value is preserved unclamped in raw_gov_filings.year_of_inc.
  v_year := p_year_of_inc;
  IF v_year IS NOT NULL AND (v_year <= 1900 OR v_year > EXTRACT(YEAR FROM now())::integer) THEN
    v_year := NULL;
  END IF;

  -- Match an existing entity. Exact case-insensitive name first — the highest
  -- precision signal we have — then the derived slug, which catches
  -- "Acme Robotics" vs "ACME ROBOTICS, INC.".
  SELECT id INTO v_startup_id
    FROM startups
   WHERE lower(btrim(name)) = lower(btrim(p_entity_name))
   ORDER BY created_at
   LIMIT 1;

  IF v_startup_id IS NULL AND v_slug IS NOT NULL THEN
    SELECT id INTO v_startup_id FROM startups WHERE slug = v_slug LIMIT 1;
  END IF;

  IF v_startup_id IS NULL THEN
    INSERT INTO startups (name, slug, founded_year, country)
    VALUES (
      btrim(p_entity_name),
      -- Claim the slug only if free. Two unrelated issuers can normalise to
      -- the same string; losing the slug is survivable, violating the unique
      -- index would abort the filing.
      CASE WHEN v_slug IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM startups s WHERE s.slug = v_slug)
           THEN v_slug END,
      v_year,
      'United States'   -- Form D is a US federal filing by definition
    )
    RETURNING id INTO v_startup_id;
    v_created := true;
  ELSE
    -- COALESCE, never overwrite. An enriched row may already hold a founding
    -- year from a better source; the issuer's own filing is good evidence but
    -- it is not a reason to clobber what is already there.
    UPDATE startups
       SET founded_year = COALESCE(founded_year, v_year),
           slug         = COALESCE(
                            slug,
                            CASE WHEN v_slug IS NOT NULL
                                  AND NOT EXISTS (
                                        SELECT 1 FROM startups s
                                         WHERE s.slug = v_slug AND s.id <> v_startup_id)
                                 THEN v_slug END),
           updated_at   = now()
     WHERE id = v_startup_id;
  END IF;

  INSERT INTO raw_gov_filings (
    source, accession_number, cik, form_type, entity_name, filing_date,
    year_of_inc, jurisdiction, industry_group, officers, tech_summary,
    total_offering, total_sold, raw_payload, startup_id
  ) VALUES (
    'sec_form_d', btrim(p_accession), p_cik, p_form_type, btrim(p_entity_name), p_filing_date,
    p_year_of_inc, p_jurisdiction, p_industry_group, COALESCE(p_officers, '[]'::jsonb), p_tech_summary,
    p_total_offering, p_total_sold, p_raw, v_startup_id
  )
  ON CONFLICT (source, accession_number) DO UPDATE
    SET startup_id   = COALESCE(raw_gov_filings.startup_id, EXCLUDED.startup_id),
        officers     = EXCLUDED.officers,
        tech_summary = EXCLUDED.tech_summary,
        raw_payload  = EXCLUDED.raw_payload
  RETURNING id INTO v_filing_id;

  RETURN jsonb_build_object(
    'filing_id',       v_filing_id,
    'startup_id',      v_startup_id,
    'created_startup', v_created,
    'slug',            v_slug,
    'founded_year',    v_year
  );
END;
$$;

COMMENT ON FUNCTION ingest_form_d_filing IS
  'Transactionally records one Form D filing and upserts its issuer into startups. Exists as an RPC because startups.slug is covered by a PARTIAL unique index that PostgREST cannot target with onConflict, and because a startups row must never exist without the filing that justifies it.';

-- Ingestion is a service-role job. Never expose an entity-creating function
-- to client roles.
REVOKE ALL ON FUNCTION ingest_form_d_filing(text,text,text,text,date,integer,text,text,jsonb,text,numeric,numeric,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_form_d_filing(text,text,text,text,date,integer,text,text,jsonb,text,numeric,numeric,jsonb) TO service_role;

