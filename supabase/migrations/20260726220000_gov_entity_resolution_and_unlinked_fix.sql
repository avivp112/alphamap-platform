-- =============================================================================
-- Migration: ingest_gov_entity_filing — identifier resolution + safe unlinked mode
-- Created:   2026-07-26
-- Description:
--   Sourcing Engine audit, Phase 2. Two fixes to the one function all four
--   government ingesters (SEC, UK Companies House, USPTO, EPO) call through.
--
-- ── FIX 1: RESOLVE BY IDENTIFIER BEFORE FALLING BACK TO NAME/SLUG ───────────
--   Entity resolution's whole premise (20260726180000) is "stop matching
--   names, start collecting identifiers" — but the ingest path never actually
--   consulted company_identifiers. A second Form D filing for a company
--   already on file under a slightly different name spelling, or a UK filing
--   for a company already linked by domain, would fall straight to exact
--   name/slug equality and could create a duplicate startups row — the exact
--   failure mode this whole layer exists to prevent, reintroduced at the one
--   place it would matter most.
--
--   Lookup order, strongest first: CIK -> Companies House number -> domain
--   (when a website is supplied) -> exact name -> slug -> create. Every
--   strong identifier the filing carries is also RECORDED after resolution,
--   so the NEXT filing for this company — from any source — resolves on the
--   first check instead of falling through to the weaker fallback again.
--
--   p_website is new and optional. None of the four current call sites have
--   a website to pass today (Form D, Companies House's advanced-search, and
--   patent records don't carry one) — it exists so a future source or a
--   manual backfill can use the domain path without a further signature
--   change. Until then this branch is reachable but effectively dormant.
--
-- ── FIX 2: A SAFE PATH FOR INVENTOR-HELD (UNLINKED) FILINGS ─────────────────
--   USPTO and EPO both have a no-organisation-assignee case that must NOT
--   create a startups row (see 20260726130000's header on why). They
--   currently reach that outcome by calling a raw PostgREST .upsert() on
--   raw_gov_filings directly — which bypasses this function's ON CONFLICT
--   entirely, including the rule that an EMPTY officers/inventors array must
--   never overwrite a previously-recorded one. A degraded re-parse silently
--   destroys real data through that path today.
--
--   p_unlinked => true skips the startup lookup/creation block completely
--   (startup_id stays whatever it already was, via the same COALESCE the
--   linked path uses) and reuses every other line of this function verbatim
--   — the gap-fill-only ON CONFLICT, the officer-preservation rule, all of
--   it. The two Edge Functions are updated in this change to call this
--   instead of upserting directly.
--
-- Rollback: supabase/rollback/20260726220000_gov_entity_resolution_and_unlinked_fix_down.sql
-- Idempotent.
-- =============================================================================

DROP FUNCTION IF EXISTS ingest_gov_entity_filing(
  text,text,text,date,text,text,text,integer,text,text,text,text[],text,text,jsonb,text,numeric,numeric,jsonb
);

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
  -- NEW. See header.
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

  -- startups.founded_year CHECK is (> 1900 AND <= current year). Drop an
  -- implausible value rather than lose the whole filing to a constraint
  -- violation; the raw value survives in raw_gov_filings.year_of_inc.
  v_year := p_year_of_inc;
  IF v_year IS NOT NULL AND (v_year <= 1900 OR v_year > EXTRACT(YEAR FROM now())::integer) THEN
    v_year := NULL;
  END IF;

  IF NOT p_unlinked THEN
    v_slug := gov_company_slug(p_entity_name);

    -- ── Strong-identifier resolution, strongest first ───────────────────────
    -- This is company_identifiers.UNIQUE(kind,value) doing exactly what it
    -- was built for, at the one point it was previously skipped.
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

    -- Fallback: exact name, then slug — unchanged from before this migration.
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

    -- Record every strong identifier this filing carries, now that we know
    -- which startup it belongs to. ON CONFLICT DO NOTHING: if the (kind,
    -- value) pair is already claimed by a DIFFERENT startup, that collision
    -- is a duplicate-company signal for the resolver to pick up separately —
    -- this function does not adjudicate it, only avoids creating a second
    -- claim that would shadow the real one.
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
    SET -- Unchanged from before: an already-linked row (linked or backfilled
        -- by hand) is never unlinked by a later unlinked-mode re-ingest, and
        -- an unlinked row picks up a link the moment one is found.
        startup_id           = COALESCE(raw_gov_filings.startup_id, EXCLUDED.startup_id),
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

-- ingest_form_d_filing (the SEC-specific wrapper) calls this by NAME with
-- neither p_unlinked nor p_website supplied — both have defaults, so the
-- wrapper keeps working unchanged and needs no redefinition here.
