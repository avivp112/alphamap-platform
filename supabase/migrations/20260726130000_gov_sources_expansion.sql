-- =============================================================================
-- Migration: expand the government layer — funds, UK, patents
-- Created:   2026-07-26
-- Description:
--   Three additions on top of the Form D inception layer:
--
--     1. vc_fund_filings   — the fund filings the ingester currently discards.
--                            On the live 24 July run that was 150 of 200
--                            documents: the single largest category, thrown
--                            away because funds are not startups. They are,
--                            however, exactly the LP/GP intelligence the VC
--                            directory wants.
--
--     2. raw_gov_filings   — generalised beyond SEC: three more sources, plus
--                            the columns UK and USPTO need.
--
--     3. ingest_gov_entity_filing() — one source-aware RPC replacing the
--                            Form D-specific one, which stays as a delegating
--                            wrapper so a half-finished rollout cannot break
--                            the function already in production.
--
-- ── WHY FUNDS GET THEIR OWN TABLE ───────────────────────────────────────────
--   Both options in the brief work; this one is better for a reason worth
--   writing down. A fund filing and a company filing answer different
--   questions. raw_gov_filings exists to justify a startups row — its FK, its
--   indexes and its consumers all assume "this document is evidence about a
--   company we might source". A fund has no startups row and never will, so it
--   would sit in that table permanently NULL on the column the table is
--   organised around, and every consumer would need a filter that is easy to
--   forget. board_discovery_candidates already has an EXISTS against
--   raw_gov_filings; a fund landing there is one linking bug away from putting
--   "Northstar Ventures IV, L.P." into the ATS probe queue.
--
--   The fund-specific fields also have nowhere sensible to live in a shared
--   table: fund type, vintage number, the GP list. Splitting them out means the
--   directory queries columns rather than digging through jsonb.
--
-- ── VEHICLES VERSUS FIRMS, WHICH IS THE WHOLE POINT ─────────────────────────
--   A Form D fund filing names a VEHICLE — "Northstar Ventures IV, L.P.". The
--   directory tracks FIRMS — "Northstar Ventures". One firm files once per
--   fund, so the filings are a time series of that firm's raising history, and
--   the series number is its vintage. Storing only the vehicle name would leave
--   four unrelated-looking rows where there is really one firm raising its
--   fourth fund.
--
--   So firm_name and fund_series are derived at ingest and stored. investor_id
--   links to the existing investors table when the firm is already known.
--
--   Deliberately NOT auto-creating investors rows: investors.slug is a 2-3
--   character avatar label chosen by a human, and a directory that fills itself
--   with machine-guessed firms is worse than one with gaps. vc_fund_firms
--   surfaces the unlinked ones for promotion.
--
-- Rollback: supabase/rollback/20260726130000_gov_sources_expansion_down.sql
--
-- Idempotent.
-- =============================================================================

-- ── 1. Generalise raw_gov_filings ───────────────────────────────────────────

ALTER TABLE raw_gov_filings DROP CONSTRAINT IF EXISTS raw_gov_filings_source_check;
ALTER TABLE raw_gov_filings
  ADD CONSTRAINT raw_gov_filings_source_check
  CHECK (source IN ('sec_form_d', 'uk_companies_house', 'uspto_patent'));

-- accession_number is SEC vocabulary. For the other sources this holds their
-- own document id — a Companies House company number, a USPTO publication
-- number — and (source, accession_number) stays the natural key throughout.
COMMENT ON COLUMN raw_gov_filings.accession_number IS
  'The source registry''s own immutable document id: SEC accession number, Companies House company number, or USPTO publication number. Unique per source.';

ALTER TABLE raw_gov_filings
  ADD COLUMN IF NOT EXISTS entity_number        text,
  ADD COLUMN IF NOT EXISTS classification_codes text[],
  ADD COLUMN IF NOT EXISTS title                text,
  ADD COLUMN IF NOT EXISTS abstract             text,
  ADD COLUMN IF NOT EXISTS country              text;

COMMENT ON COLUMN raw_gov_filings.entity_number IS
  'Registry entity identifier — Companies House company number, or the USPTO application number. SEC''s equivalent is the cik column.';
COMMENT ON COLUMN raw_gov_filings.classification_codes IS
  'Source classification codes verbatim: UK SIC codes, or USPTO CPC symbols. Array because a filing usually carries several, and the FIRST is not necessarily the most informative.';
COMMENT ON COLUMN raw_gov_filings.title IS
  'Patent title. NULL for company registrations, which have no equivalent.';
COMMENT ON COLUMN raw_gov_filings.abstract IS
  'Patent abstract. The one field in this whole layer that describes what a company actually DOES, which is why it is stored rather than summarised away.';

-- Classification filtering is the main query shape for UK and USPTO.
CREATE INDEX IF NOT EXISTS idx_raw_gov_filings_classification
  ON raw_gov_filings USING gin (classification_codes)
  WHERE classification_codes IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_raw_gov_filings_entity_number
  ON raw_gov_filings (source, entity_number)
  WHERE entity_number IS NOT NULL;

-- ── 2. Fund vehicles ────────────────────────────────────────────────────────

/**
 * "Northstar Ventures IV, L.P." -> "northstar ventures"
 *
 * Strips the partnership suffix and then the vintage marker. Roman numerals are
 * matched from a fixed list rather than a general pattern, because a general
 * one eats real words: "MIX Ventures" and "DIX Capital" are both valid roman
 * numerals, and "Innovation Capital I" is a different fund from "Innovation
 * Capital II" only because of the numeral.
 */
CREATE OR REPLACE FUNCTION fund_firm_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH base AS (
    SELECT lower(btrim(coalesce(p_name, ''))) AS n
  ), no_partnership AS (
    SELECT regexp_replace(n,
      '[[:space:],\.]+(l\.?p\.?|llp|llc|l\.?l\.?c\.?|ltd|limited partnership|limited|inc|incorporated|corp|corporation|fund|trust)\.?$',
      '', 'g') AS n FROM base
  ), no_partnership2 AS (
    SELECT regexp_replace(n,
      '[[:space:],\.]+(l\.?p\.?|llp|llc|l\.?l\.?c\.?|ltd|limited partnership|limited|inc|incorporated|corp|corporation|fund|trust)\.?$',
      '', 'g') AS n FROM no_partnership
  ), no_vintage AS (
    SELECT regexp_replace(n,
      '[[:space:],-]+(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|[0-9]{1,2})$',
      '') AS n FROM no_partnership2
  ), no_partnership3 AS (
    -- A THIRD suffix pass, after the vintage is gone. "Acme Capital Fund III
    -- LLC" strips to "acme capital fund iii", and only once the numeral is
    -- removed is "fund" exposed at the end where the suffix rule can see it.
    -- Without this the firm reads "acme capital fund" and never matches the
    -- "Acme Capital" already in the investors directory.
    SELECT regexp_replace(n,
      '[[:space:],\.]+(l\.?p\.?|llp|llc|l\.?l\.?c\.?|ltd|limited partnership|limited|inc|incorporated|corp|corporation|fund|trust)\.?$',
      '', 'g') AS n FROM no_vintage
  ), tidy AS (
    SELECT btrim(regexp_replace(n, '[[:space:],]+$', '')) AS n FROM no_partnership3
  )
  SELECT nullif(btrim(n), '') FROM tidy;
$$;

COMMENT ON FUNCTION fund_firm_name(text) IS
  'Fund vehicle name -> firm name. "Northstar Ventures IV, L.P." becomes "northstar ventures", so a firm''s successive funds group into one series instead of looking like four unrelated managers.';

/** Vintage number. "Fund IV" -> 4, "Fund 3" -> 3, no marker -> NULL (first fund). */
CREATE OR REPLACE FUNCTION fund_series_number(p_name text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  WITH m AS (
    SELECT (regexp_match(
      regexp_replace(lower(btrim(coalesce(p_name, ''))),
        '[[:space:],\.]+(l\.?p\.?|llp|llc|l\.?l\.?c\.?|ltd|limited|inc|corp|corporation|fund|trust)\.?$', '', 'g'),
      '[[:space:],-]+(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|[0-9]{1,2})$'))[1] AS tok
  )
  SELECT CASE tok
    WHEN 'i' THEN 1 WHEN 'ii' THEN 2 WHEN 'iii' THEN 3 WHEN 'iv' THEN 4 WHEN 'v' THEN 5
    WHEN 'vi' THEN 6 WHEN 'vii' THEN 7 WHEN 'viii' THEN 8 WHEN 'ix' THEN 9 WHEN 'x' THEN 10
    WHEN 'xi' THEN 11 WHEN 'xii' THEN 12 WHEN 'xiii' THEN 13 WHEN 'xiv' THEN 14 WHEN 'xv' THEN 15
    WHEN NULL THEN NULL
    ELSE nullif(regexp_replace(tok, '[^0-9]', '', 'g'), '')::integer
  END FROM m;
$$;

CREATE TABLE IF NOT EXISTS vc_fund_filings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  source           text        NOT NULL DEFAULT 'sec_form_d'
                               CHECK (source IN ('sec_form_d')),
  accession_number text        NOT NULL,
  cik              text,
  form_type        text,                        -- 'D' or 'D/A'

  -- The vehicle, verbatim as filed.
  fund_name        text        NOT NULL CHECK (btrim(fund_name) <> ''),
  -- The manager, derived. Grouping key for the directory.
  firm_name        text,
  -- Vintage. NULL means no numeral, which usually means a first fund.
  fund_series      integer,

  -- SEC's investmentFundType: 'Venture Capital Fund', 'Private Equity Fund',
  -- 'Hedge Fund', 'Other Investment Fund'. The VC/PE split the directory needs.
  fund_type        text,
  industry_group   text,

  filing_date      date        NOT NULL,
  year_of_inc      integer,
  jurisdiction     text,

  -- What they are raising versus what has actually closed. Both matter and
  -- they are frequently very different: a first close on a $250M target is a
  -- different story from a fund that is full.
  total_offering   numeric,
  total_sold       numeric,

  -- Related persons: general partners, managing members, directors, as
  -- [{"name": "...", "relationships": ["Executive Officer"]}]. Form D's
  -- relatedPersonsList is the closest thing to a public GP roster that exists.
  managers         jsonb       NOT NULL DEFAULT '[]'::jsonb,

  raw_payload      jsonb,

  -- Linked when firm_name matches a known investor. NOT auto-created — see the
  -- header. NULL means "a firm we have not curated yet", which vc_fund_firms
  -- exposes as a worklist rather than hiding.
  investor_id      uuid        REFERENCES investors (id) ON DELETE SET NULL,

  ingested_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vc_fund_filings_unique_document UNIQUE (source, accession_number),
  CONSTRAINT vc_fund_filings_plausible_date CHECK (filing_date >= DATE '1993-01-01'),
  CONSTRAINT vc_fund_filings_managers_is_array CHECK (jsonb_typeof(managers) = 'array')
);

COMMENT ON TABLE vc_fund_filings IS
  'Investment-fund Form D filings — the ~75% of Form D documents that are fund vehicles rather than operating companies. One row per filing, so a firm''s successive funds form a raising history. Separate from raw_gov_filings because a fund has no startups row and never will.';

CREATE INDEX IF NOT EXISTS idx_vc_fund_filings_firm
  ON vc_fund_filings (firm_name, filing_date DESC)
  WHERE firm_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vc_fund_filings_date
  ON vc_fund_filings (filing_date DESC);
CREATE INDEX IF NOT EXISTS idx_vc_fund_filings_investor
  ON vc_fund_filings (investor_id)
  WHERE investor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vc_fund_filings_unlinked
  ON vc_fund_filings (firm_name)
  WHERE investor_id IS NULL;

ALTER TABLE vc_fund_filings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vc_fund_filings_read ON vc_fund_filings;
CREATE POLICY vc_fund_filings_read ON vc_fund_filings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS vc_fund_filings_service_all ON vc_fund_filings;
CREATE POLICY vc_fund_filings_service_all ON vc_fund_filings FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON vc_fund_filings TO authenticated;
GRANT ALL    ON vc_fund_filings TO service_role;
REVOKE ALL   ON vc_fund_filings FROM anon;

-- ── 3. Firm-level rollup ────────────────────────────────────────────────────
-- The directory view: one row per manager, with their raising history folded
-- up. total_raised sums total_sold and not total_offering on purpose — a target
-- is an intention, a sale is a fact, and summing targets would overstate every
-- firm that has only had a first close.
CREATE OR REPLACE VIEW vc_fund_firms AS
SELECT
  f.firm_name,
  min(f.fund_name)                                       AS example_fund_name,
  count(*)                                               AS fund_filings,
  max(f.fund_series)                                     AS latest_series,
  min(f.filing_date)                                     AS first_filing_date,
  max(f.filing_date)                                     AS latest_filing_date,
  sum(f.total_sold)                                      AS total_raised,
  max(f.total_offering)                                  AS largest_target,
  (array_agg(DISTINCT f.fund_type) FILTER (WHERE f.fund_type IS NOT NULL)) AS fund_types,
  -- Every distinct related person across the firm's funds: the closest thing
  -- to a GP roster this data supports.
  (SELECT array_agg(DISTINCT m->>'name')
     FROM vc_fund_filings f2, jsonb_array_elements(f2.managers) m
    WHERE f2.firm_name = f.firm_name AND m->>'name' IS NOT NULL) AS managers,
  max(f.investor_id::text)::uuid                         AS investor_id,
  bool_or(f.investor_id IS NOT NULL)                     AS is_linked
FROM vc_fund_filings f
WHERE f.firm_name IS NOT NULL
GROUP BY f.firm_name;

COMMENT ON VIEW vc_fund_firms IS
  'One row per fund manager, folding their filings into a raising history. total_raised sums total_sold rather than total_offering: a target is an intention, a sale is a fact. is_linked = false is the curation worklist for the investors directory.';

GRANT SELECT ON vc_fund_firms TO authenticated;
GRANT ALL    ON vc_fund_firms TO service_role;
REVOKE ALL   ON vc_fund_firms FROM anon;

-- ── 4. Fund ingest RPC ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_fund_filing(
  p_accession      text,
  p_cik            text,
  p_form_type      text,
  p_fund_name      text,
  p_filing_date    date,
  p_fund_type      text,
  p_industry_group text,
  p_year_of_inc    integer,
  p_jurisdiction   text,
  p_total_offering numeric,
  p_total_sold     numeric,
  p_managers       jsonb,
  p_raw            jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_firm     text;
  v_series   integer;
  v_investor uuid;
  v_id       uuid;
BEGIN
  IF p_fund_name IS NULL OR btrim(p_fund_name) = '' THEN
    RAISE EXCEPTION 'record_fund_filing: fund_name is required';
  END IF;

  v_firm   := fund_firm_name(p_fund_name);
  v_series := fund_series_number(p_fund_name);

  -- Link to a curated investor when the derived firm name matches one. Never
  -- create: see the header on why a self-populating directory is worse than a
  -- sparse one.
  IF v_firm IS NOT NULL THEN
    SELECT id INTO v_investor FROM investors
     WHERE lower(btrim(name)) = v_firm
     LIMIT 1;
  END IF;

  INSERT INTO vc_fund_filings (
    source, accession_number, cik, form_type, fund_name, firm_name, fund_series,
    fund_type, industry_group, filing_date, year_of_inc, jurisdiction,
    total_offering, total_sold, managers, raw_payload, investor_id
  ) VALUES (
    'sec_form_d', btrim(p_accession), p_cik, p_form_type, btrim(p_fund_name), v_firm, v_series,
    p_fund_type, p_industry_group, p_filing_date, p_year_of_inc, p_jurisdiction,
    p_total_offering, p_total_sold, COALESCE(p_managers, '[]'::jsonb), p_raw, v_investor
  )
  ON CONFLICT (source, accession_number) DO UPDATE
    -- Never let an empty roster overwrite a populated one. Extraction is
    -- lossy — a schema tweak or a parse failure yields zero related persons —
    -- and a re-ingest that silently wipes a firm's GP list is unrecoverable
    -- without re-fetching. New people are welcome; "no people" is not news.
    SET managers    = CASE WHEN jsonb_array_length(EXCLUDED.managers) > 0
                           THEN EXCLUDED.managers ELSE vc_fund_filings.managers END,
        total_sold  = EXCLUDED.total_sold,
        raw_payload = EXCLUDED.raw_payload,
        -- Keep a hand-made link if one was set later by a curator.
        investor_id = COALESCE(vc_fund_filings.investor_id, EXCLUDED.investor_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'filing_id',   v_id,
    'firm_name',   v_firm,
    'fund_series', v_series,
    'investor_id', v_investor
  );
END;
$$;

REVOKE ALL ON FUNCTION record_fund_filing(text,text,text,text,date,text,text,integer,text,numeric,numeric,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_fund_filing(text,text,text,text,date,text,text,integer,text,numeric,numeric,jsonb,jsonb) TO service_role;

-- ── 5. Source-aware entity ingest ───────────────────────────────────────────
-- Generalises ingest_form_d_filing across all three registries. The Form D
-- version is kept below as a delegating wrapper: the deployed Edge Function
-- calls it by name, and a migration that lands before the redeploy must not
-- break the ingester that is currently working.
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
  p_raw            jsonb           DEFAULT NULL
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
    RAISE EXCEPTION 'ingest_gov_entity_filing: entity_name is required';
  END IF;
  IF p_accession IS NULL OR btrim(p_accession) = '' THEN
    RAISE EXCEPTION 'ingest_gov_entity_filing: accession/document id is required (it is the dedupe key)';
  END IF;

  v_slug := gov_company_slug(p_entity_name);

  -- startups.founded_year CHECK is (> 1900 AND <= current year). Drop an
  -- implausible value rather than lose the whole filing to a constraint
  -- violation; the raw value survives in raw_gov_filings.year_of_inc.
  v_year := p_year_of_inc;
  IF v_year IS NOT NULL AND (v_year <= 1900 OR v_year > EXTRACT(YEAR FROM now())::integer) THEN
    v_year := NULL;
  END IF;

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
        -- Same rule as vc_fund_filings.managers: an empty officer list is a
        -- failed extraction, not a fact, and must not overwrite a real one.
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
    'founded_year',    v_year
  );
END;
$$;

REVOKE ALL ON FUNCTION ingest_gov_entity_filing(text,text,text,date,text,text,text,integer,text,text,text,text[],text,text,jsonb,text,numeric,numeric,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_gov_entity_filing(text,text,text,date,text,text,text,integer,text,text,text,text[],text,text,jsonb,text,numeric,numeric,jsonb) TO service_role;

-- Backwards-compatible wrapper. The currently-deployed ingest-sec-form-d calls
-- this signature; keeping it means the migration can land before the redeploy
-- without a window where ingestion is broken.
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ingest_gov_entity_filing(
    p_source         => 'sec_form_d',
    p_accession      => p_accession,
    p_entity_name    => p_entity_name,
    p_filing_date    => p_filing_date,
    p_cik            => p_cik,
    p_form_type      => p_form_type,
    p_year_of_inc    => p_year_of_inc,
    p_jurisdiction   => p_jurisdiction,
    p_country        => 'United States',
    p_industry_group => p_industry_group,
    p_officers       => p_officers,
    p_tech_summary   => p_tech_summary,
    p_total_offering => p_total_offering,
    p_total_sold     => p_total_sold,
    p_raw            => p_raw
  );
$$;

COMMENT ON FUNCTION ingest_form_d_filing IS
  'Backwards-compatible wrapper over ingest_gov_entity_filing, kept so a migration landing before the Edge Function redeploy cannot break ingestion mid-rollout.';

REVOKE ALL ON FUNCTION ingest_form_d_filing(text,text,text,text,date,integer,text,text,jsonb,text,numeric,numeric,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_form_d_filing(text,text,text,text,date,integer,text,text,jsonb,text,numeric,numeric,jsonb) TO service_role;
