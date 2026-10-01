-- Rollback for 20261004010000_harden_gov_filing_name_match.sql
-- Restores the prior ingest_gov_entity_filing() body (exact-name fallback
-- with no country corroboration). Does not touch any startups or
-- raw_gov_filings rows already written under either version.

CREATE OR REPLACE FUNCTION ingest_gov_entity_filing(
  p_source         text,
  p_accession      text,
  p_entity_name    text,
  p_filing_date    date,
  p_cik            text            DEFAULT NULL,
  p_entity_number  text            DEFAULT NULL,
  p_form_type      text            DEFAULT NULL,
  p_year_of_inc    integer         DEFAULT NULL,
  p_jurisdiction   text            DEFAULT NULL,
  p_country        text            DEFAULT NULL,
  p_industry_group text            DEFAULT NULL,
  p_codes          text[]          DEFAULT NULL,
  p_title          text            DEFAULT NULL,
  p_abstract       text            DEFAULT NULL,
  p_officers       jsonb           DEFAULT '[]'::jsonb,
  p_tech_summary   text            DEFAULT NULL,
  p_total_offering numeric         DEFAULT NULL,
  p_total_sold     numeric         DEFAULT NULL,
  p_raw            jsonb           DEFAULT NULL,
  p_unlinked       boolean         DEFAULT false,
  p_website        text            DEFAULT NULL
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
  v_domain     text;
BEGIN
  IF p_entity_name IS NULL OR btrim(p_entity_name) = '' THEN
    RAISE EXCEPTION 'ingest_gov_entity_filing: entity_name is required';
  END IF;
  IF p_accession IS NULL OR btrim(p_accession) = '' THEN
    RAISE EXCEPTION 'ingest_gov_entity_filing: accession/document id is required (it is the dedupe key)';
  END IF;

  v_year := p_year_of_inc;
  IF v_year IS NOT NULL AND (v_year <= 1900 OR v_year > EXTRACT(YEAR FROM now())::integer) THEN
    v_year := NULL;
  END IF;

  IF NOT p_unlinked THEN
    v_slug := gov_company_slug(p_entity_name);

    IF p_cik IS NOT NULL AND btrim(p_cik) <> '' THEN
      SELECT startup_id INTO v_startup_id
        FROM company_identifiers
       WHERE kind = 'cik' AND value = btrim(p_cik)
       LIMIT 1;
    END IF;

    IF v_startup_id IS NULL AND p_source = 'uk_companies_house'
       AND p_entity_number IS NOT NULL AND btrim(p_entity_number) <> '' THEN
      SELECT startup_id INTO v_startup_id
        FROM company_identifiers
       WHERE kind = 'ch_number' AND value = btrim(p_entity_number)
       LIMIT 1;
    END IF;

    IF v_startup_id IS NULL AND p_website IS NOT NULL THEN
      v_domain := registrable_domain(p_website);
      IF v_domain IS NOT NULL THEN
        SELECT startup_id INTO v_startup_id
          FROM company_identifiers
         WHERE kind = 'domain' AND value = v_domain
         LIMIT 1;
      END IF;
    END IF;

    IF v_startup_id IS NULL THEN
      SELECT id INTO v_startup_id
        FROM startups
       WHERE lower(btrim(name)) = lower(btrim(p_entity_name))
       ORDER BY created_at
       LIMIT 1;
    END IF;

    IF v_startup_id IS NULL AND v_slug IS NOT NULL THEN
      SELECT id INTO v_startup_id FROM startups WHERE slug = v_slug LIMIT 1;
    END IF;

    IF v_startup_id IS NULL THEN
      INSERT INTO startups (name, slug, founded_year, country)
      VALUES (
        btrim(p_entity_name),
        CASE WHEN v_slug IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM startups s WHERE s.slug = v_slug)
             THEN v_slug END,
        v_year,
        p_country
      )
      RETURNING id INTO v_startup_id;
      v_created := true;
    ELSE
      UPDATE startups
         SET founded_year = COALESCE(founded_year, v_year),
             country      = COALESCE(country, p_country),
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

    IF p_cik IS NOT NULL AND btrim(p_cik) <> '' THEN
      INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
      VALUES (v_startup_id, 'cik', btrim(p_cik), 'raw_gov_filings.cik', 1.00)
      ON CONFLICT (kind, value) DO NOTHING;
    END IF;
    IF p_source = 'uk_companies_house' AND p_entity_number IS NOT NULL AND btrim(p_entity_number) <> '' THEN
      INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
      VALUES (v_startup_id, 'ch_number', btrim(p_entity_number), 'raw_gov_filings.entity_number', 1.00)
      ON CONFLICT (kind, value) DO NOTHING;
    END IF;
    IF v_domain IS NOT NULL THEN
      INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
      VALUES (v_startup_id, 'domain', v_domain, 'raw_gov_filings.website', 0.80)
      ON CONFLICT (kind, value) DO NOTHING;
    END IF;
  END IF;

  INSERT INTO raw_gov_filings (
    source, accession_number, cik, entity_number, form_type, entity_name, filing_date,
    year_of_inc, jurisdiction, country, industry_group, classification_codes,
    title, abstract, officers, tech_summary, total_offering, total_sold,
    raw_payload, startup_id
  ) VALUES (
    p_source, btrim(p_accession), p_cik, p_entity_number, p_form_type, btrim(p_entity_name), p_filing_date,
    p_year_of_inc, p_jurisdiction, p_country, p_industry_group, p_codes,
    p_title, p_abstract, COALESCE(p_officers, '[]'::jsonb), p_tech_summary, p_total_offering, p_total_sold,
    p_raw, v_startup_id
  )
  ON CONFLICT (source, accession_number) DO UPDATE
    SET startup_id           = COALESCE(raw_gov_filings.startup_id, EXCLUDED.startup_id),
        officers             = CASE WHEN jsonb_array_length(EXCLUDED.officers) > 0
                                    THEN EXCLUDED.officers ELSE raw_gov_filings.officers END,
        tech_summary         = COALESCE(EXCLUDED.tech_summary, raw_gov_filings.tech_summary),
        classification_codes = EXCLUDED.classification_codes,
        title                = EXCLUDED.title,
        abstract             = EXCLUDED.abstract,
        raw_payload          = EXCLUDED.raw_payload
  RETURNING id INTO v_filing_id;

  RETURN jsonb_build_object(
    'filing_id',       v_filing_id,
    'startup_id',      v_startup_id,
    'created_startup', v_created,
    'slug',            v_slug,
    'founded_year',    v_year,
    'unlinked',        p_unlinked
  );
END;
$$;

COMMENT ON FUNCTION ingest_gov_entity_filing IS
  'Resolves an incoming filing to a startups row by strong identifier first (CIK, UK Companies House number, then domain if a website was supplied), falling back to exact name/slug match only when no identifier resolves it, then records any strong identifiers the filing carries for next time. p_unlinked => true skips entity resolution entirely for inventor-held/no-assignee filings, reusing the same gap-fill-only, officer-preserving ON CONFLICT as the linked path instead of a raw upsert.';

REVOKE ALL ON FUNCTION ingest_gov_entity_filing(
  text,text,text,date,text,text,text,integer,text,text,text,text[],text,text,jsonb,text,numeric,numeric,jsonb,boolean,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_gov_entity_filing(
  text,text,text,date,text,text,text,integer,text,text,text,text[],text,text,jsonb,text,numeric,numeric,jsonb,boolean,text
) TO service_role;
