-- =============================================================================
-- Migration: private-market boundary for the patent layer
-- Created:   2026-07-26
-- Description:
--   Patents are the one source in this pipeline that skews CORPORATE. Two weeks
--   of deep-tech CPC across US+GB returned 2,960 publications, and that
--   population is led by IBM, Samsung, Qualcomm, Huawei and a long tail of
--   universities. Ro5 Inc. is the exception, not the shape.
--
--   Worse, nothing already in the pipeline catches them, and for reasons that
--   were correct decisions elsewhere:
--
--     * classify_company_archetype() FAILS OPEN — no funding rows means
--       venture_backed. Samsung Electronics has no funding_rounds in this
--       database, so it classifies as venture-backed. That fail-open was
--       deliberate and right for sparse stealth startups; it is exactly wrong
--       for a company that has been listed for decades.
--
--     * startups.industry is NULL for patent-sourced rows, so the sector
--       escape hatch passes them too.
--
--   Net effect without this migration: Samsung enters board_discovery_candidates
--   and burns ATS probe budget, and `startups` fills with companies that went
--   public before the founders of our actual targets were born.
--
-- ── TWO FILTERS, BECAUSE NEITHER IS SUFFICIENT ALONE ────────────────────────
--   1. A NAME denylist (this table). High precision, zero recall for the
--      incumbent nobody thought to list. Catches the obvious immediately.
--
--   2. A PUBLICATION-FREQUENCY cap (in ingest-epo-ops). Lower precision,
--      excellent recall, and self-maintaining: an applicant filing forty
--      publications a fortnight is not a startup whether or not anybody added
--      them to a list. This is the half that keeps working as new incumbents
--      appear, which a hand-maintained list never does.
--
-- ── WHY WORD-BOUNDARY MATCHING AND NOT SUBSTRINGS ──────────────────────────
--   'apple' as a naive substring excludes "Applecart Labs". Patterns are
--   matched with \y...\y against a normalised name, so 'apple' matches
--   "Apple Inc." and not "Applecart". Patterns are stored already lowercased
--   and space-normalised, and must contain NO regex metacharacters — they are
--   interpolated into a pattern, so a stray '(' would break every lookup.
--
-- ── FINDING WHAT ALREADY LANDED ─────────────────────────────────────────────
--   patent_excluded_already_ingested lists rows that would be rejected now.
--   Deleting is deliberately NOT done here — see the view's comment for the
--   statement, and read it before running it.
--
-- Rollback: supabase/rollback/20260726160000_patent_excluded_applicants_down.sql
--
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS patent_excluded_applicants (
  pattern   text PRIMARY KEY,
  category  text NOT NULL CHECK (category IN ('multinational', 'academic', 'government', 'other')),
  note      text,
  added_at  timestamptz NOT NULL DEFAULT now(),
  -- Patterns are interpolated into a regex. A metacharacter here breaks every
  -- lookup for every applicant, not just this one, so it is rejected at write
  -- time rather than discovered as a silently empty denylist.
  CONSTRAINT patent_excluded_pattern_is_plain
    CHECK (pattern ~ '^[a-z0-9]+( [a-z0-9]+)*$')
);

COMMENT ON TABLE patent_excluded_applicants IS
  'Applicant name patterns that mark a PUBLIC or ACADEMIC filer, i.e. outside the private-market boundary. Matched with word boundaries against a normalised name, so "apple" excludes Apple Inc. but not Applecart Labs. Data rather than a code constant so the list is tunable without a redeploy.';

/** Lowercase, strip EPO's "[US]" country tag and punctuation, collapse spaces. */
CREATE OR REPLACE FUNCTION normalize_applicant_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(p_name, '')), '\[[a-z]{2}\]', ' ', 'g'),
             '[^a-z0-9]+', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;

COMMENT ON FUNCTION normalize_applicant_name(text) IS
  'Applicant name -> lowercase space-separated tokens. Strips EPO''s trailing country tag ("[US]") and all punctuation, so "SAMSUNG ELECTRONICS CO., LTD. [KR]" and "Samsung Electronics Co Ltd" normalise identically.';

CREATE OR REPLACE FUNCTION is_excluded_applicant(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM patent_excluded_applicants e
     WHERE normalize_applicant_name(p_name) ~ ('\y' || e.pattern || '\y')
  );
$$;

COMMENT ON FUNCTION is_excluded_applicant(text) IS
  'True when an applicant matches the public/academic denylist. Word-boundary matched, so it never fires on a startup whose name merely contains an incumbent''s as a substring.';

-- ── Seed ────────────────────────────────────────────────────────────────────
-- The top of the global patent-filing table, plus the academic patterns that
-- cover thousands of institutions without naming any of them.
--
-- Multinationals are listed by the token that identifies them unambiguously.
-- Short tokens that are also ordinary words ('dow', 'total', 'shell') are
-- omitted deliberately: at two or three characters the word-boundary guard is
-- not enough, and a false exclusion here is invisible and permanent while a
-- false inclusion costs one row.
INSERT INTO patent_excluded_applicants (pattern, category, note) VALUES
  -- Semiconductors, hardware, consumer electronics
  ('samsung','multinational',NULL), ('lg electronics','multinational',NULL),
  ('sk hynix','multinational',NULL), ('taiwan semiconductor','multinational',NULL),
  ('tsmc','multinational',NULL), ('intel','multinational',NULL),
  ('qualcomm','multinational',NULL), ('broadcom','multinational',NULL),
  ('micron technology','multinational',NULL), ('nvidia','multinational',NULL),
  ('advanced micro devices','multinational',NULL), ('texas instruments','multinational',NULL),
  ('nxp','multinational',NULL), ('infineon','multinational',NULL),
  ('stmicroelectronics','multinational',NULL), ('applied materials','multinational',NULL),
  ('asml','multinational',NULL), ('murata','multinational',NULL), ('kyocera','multinational',NULL),
  ('renesas','multinational',NULL), ('analog devices','multinational',NULL),
  ('marvell','multinational',NULL), ('arm limited','multinational',NULL),
  -- Big tech / platforms
  ('international business machines','multinational',NULL), ('microsoft','multinational',NULL),
  ('google','multinational',NULL), ('alphabet','multinational',NULL),
  ('apple','multinational',NULL), ('amazon','multinational',NULL),
  ('meta platforms','multinational',NULL), ('facebook','multinational',NULL),
  ('oracle','multinational',NULL), ('salesforce','multinational',NULL),
  ('adobe','multinational',NULL), ('cisco','multinational',NULL),
  ('hewlett packard','multinational',NULL), ('dell','multinational',NULL),
  ('lenovo','multinational',NULL), ('fujitsu','multinational',NULL),
  ('nec corporation','multinational',NULL), ('sap','multinational',NULL),
  ('vmware','multinational',NULL), ('paypal','multinational',NULL),
  ('visa international','multinational',NULL), ('mastercard','multinational',NULL),
  -- Asia-Pacific
  ('huawei','multinational',NULL), ('zte','multinational',NULL),
  ('xiaomi','multinational',NULL), ('oppo','multinational',NULL),
  ('vivo mobile','multinational',NULL), ('baidu','multinational',NULL),
  ('alibaba','multinational',NULL), ('tencent','multinational',NULL),
  ('bytedance','multinational',NULL), ('sony','multinational',NULL),
  ('canon','multinational',NULL), ('toshiba','multinational',NULL),
  ('panasonic','multinational',NULL), ('mitsubishi','multinational',NULL),
  ('hitachi','multinational',NULL), ('sharp corporation','multinational',NULL),
  ('seiko epson','multinational',NULL), ('ricoh','multinational',NULL),
  ('olympus','multinational',NULL), ('nikon','multinational',NULL),
  -- Automotive & industrial
  ('toyota','multinational',NULL), ('honda','multinational',NULL),
  ('nissan','multinational',NULL), ('denso','multinational',NULL),
  ('hyundai','multinational',NULL), ('kia','multinational',NULL),
  ('robert bosch','multinational',NULL), ('siemens','multinational',NULL),
  ('koninklijke philips','multinational',NULL), ('philips','multinational',NULL),
  ('ericsson','multinational',NULL), ('nokia','multinational',NULL),
  ('general electric','multinational',NULL), ('general motors','multinational',NULL),
  ('ford global','multinational',NULL), ('volkswagen','multinational',NULL),
  ('bayerische motoren werke','multinational',NULL), ('mercedes benz','multinational',NULL),
  ('daimler','multinational',NULL), ('continental automotive','multinational',NULL),
  ('zf friedrichshafen','multinational',NULL), ('valeo','multinational',NULL),
  ('schneider electric','multinational',NULL), ('honeywell','multinational',NULL),
  ('caterpillar','multinational',NULL), ('deere','multinational',NULL),
  ('boeing','multinational',NULL), ('airbus','multinational',NULL),
  ('raytheon','multinational',NULL), ('lockheed martin','multinational',NULL),
  ('northrop grumman','multinational',NULL), ('safran','multinational',NULL),
  -- Chemicals, materials, pharma
  ('basf','multinational',NULL), ('bayer','multinational',NULL),
  ('dupont','multinational',NULL), ('3m company','multinational',NULL),
  ('pfizer','multinational',NULL), ('hoffmann la roche','multinational',NULL),
  ('genentech','multinational',NULL), ('novartis','multinational',NULL),
  ('merck','multinational',NULL), ('johnson johnson','multinational',NULL),
  ('astrazeneca','multinational',NULL), ('glaxosmithkline','multinational',NULL),
  ('sanofi','multinational',NULL), ('abbvie','multinational',NULL),
  ('amgen','multinational',NULL), ('eli lilly','multinational',NULL),
  ('bristol myers squibb','multinational',NULL), ('boehringer ingelheim','multinational',NULL),
  ('medtronic','multinational',NULL), ('abbott','multinational',NULL),
  ('becton dickinson','multinational',NULL), ('siemens healthineers','multinational',NULL),
  -- Energy
  ('exxonmobil','multinational',NULL), ('chevron','multinational',NULL),
  ('saudi arabian oil','multinational',NULL), ('halliburton','multinational',NULL),
  ('schlumberger','multinational',NULL), ('petrochina','multinational',NULL),
  ('sinopec','multinational',NULL),
  -- Academic and public research: patterns, not names. These cover thousands
  -- of institutions worldwide without enumerating any of them.
  ('universit','academic','matches university/université/universität/universiteit'),
  ('college','academic',NULL),
  ('polytechnic','academic',NULL),
  ('hochschule','academic',NULL),
  ('academy of sciences','academic',NULL),
  ('regents of the','academic','the standard US state-university assignee form'),
  ('board of trustees','academic',NULL),
  ('board of regents','academic',NULL),
  ('school of medicine','academic',NULL),
  ('research foundation','academic',NULL),
  ('research council','academic',NULL),
  ('institute of technology','academic',NULL),
  ('fraunhofer','academic',NULL),
  ('max planck','academic',NULL),
  ('cnrs','academic',NULL),
  ('inserm','academic',NULL),
  ('helmholtz','academic',NULL),
  ('leibniz','academic',NULL),
  ('csic','academic',NULL),
  ('riken','academic',NULL),
  ('national laboratory','government',NULL),
  ('national institutes of health','government',NULL),
  ('department of energy','government',NULL),
  ('united states of america as represented','government','the US federal assignee form'),
  ('secretary of the navy','government',NULL),
  ('secretary of the army','government',NULL),
  ('hospital','academic','teaching hospitals file heavily and are not startups'),
  ('nhs','academic',NULL)
ON CONFLICT (pattern) DO NOTHING;

GRANT SELECT ON patent_excluded_applicants TO authenticated;
GRANT ALL    ON patent_excluded_applicants TO service_role;
REVOKE ALL   ON patent_excluded_applicants FROM anon;

ALTER TABLE patent_excluded_applicants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS patent_excluded_read ON patent_excluded_applicants;
CREATE POLICY patent_excluded_read ON patent_excluded_applicants FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS patent_excluded_service ON patent_excluded_applicants;
CREATE POLICY patent_excluded_service ON patent_excluded_applicants FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Batch lookups for the ingester ──────────────────────────────────────────
-- Both take an ARRAY. The ingester sees a few hundred distinct applicants per
-- run, and one round trip per name would dominate its wall clock — the whole
-- fetch is only a handful of requests.

/** Which of these names are outside the private-market boundary. */
CREATE OR REPLACE FUNCTION filter_excluded_applicants(p_names text[])
RETURNS TABLE (name text, category text, pattern text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (n.name) n.name, e.category, e.pattern
    FROM unnest(coalesce(p_names, '{}')) AS n(name)
    JOIN patent_excluded_applicants e
      ON normalize_applicant_name(n.name) ~ ('\y' || e.pattern || '\y')
   ORDER BY n.name, e.category;
$$;

COMMENT ON FUNCTION filter_excluded_applicants(text[]) IS
  'Batch denylist lookup. Returns only the names that MATCH, so the caller treats an absent name as in scope — the safe default when the denylist is the thing that removes companies.';

/**
 * Publications already recorded per applicant, for the frequency cap.
 *
 * Grouped on the NORMALISED name so "Samsung Electronics Co., Ltd." and
 * "SAMSUNG ELECTRONICS CO LTD" count as one filer rather than two modest ones.
 */
CREATE OR REPLACE FUNCTION count_patent_publications(p_names text[], p_since date DEFAULT NULL)
RETURNS TABLE (normalized text, publications bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH wanted AS (
    SELECT DISTINCT normalize_applicant_name(n.name) AS norm
      FROM unnest(coalesce(p_names, '{}')) AS n(name)
  )
  SELECT w.norm, count(f.id)
    FROM wanted w
    LEFT JOIN raw_gov_filings f
      ON f.source IN ('epo_ops', 'uspto_patent')
     AND normalize_applicant_name(f.entity_name) = w.norm
     AND (p_since IS NULL OR f.filing_date >= p_since)
   GROUP BY w.norm;
$$;

REVOKE ALL ON FUNCTION filter_excluded_applicants(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION count_patent_publications(text[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION filter_excluded_applicants(text[]) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION count_patent_publications(text[], date) TO service_role;

-- Normalised-name lookups are the hot path for the frequency cap.
CREATE INDEX IF NOT EXISTS idx_raw_gov_filings_applicant_norm
  ON raw_gov_filings (normalize_applicant_name(entity_name))
  WHERE source IN ('epo_ops', 'uspto_patent');

-- ── What already landed before the boundary existed ─────────────────────────
CREATE OR REPLACE VIEW patent_excluded_already_ingested AS
SELECT
  f.id            AS filing_id,
  f.entity_name,
  f.startup_id,
  f.accession_number,
  f.filing_date,
  (SELECT e.category FROM patent_excluded_applicants e
    WHERE normalize_applicant_name(f.entity_name) ~ ('\y' || e.pattern || '\y')
    LIMIT 1)      AS matched_category,
  (SELECT e.pattern FROM patent_excluded_applicants e
    WHERE normalize_applicant_name(f.entity_name) ~ ('\y' || e.pattern || '\y')
    LIMIT 1)      AS matched_pattern,
  -- Whether removing it would also strand a startups row that has no other
  -- evidence behind it. A company reached by Form D AND a patent should keep
  -- its startups row; one reached only by an excluded patent should not.
  (SELECT count(*) FROM raw_gov_filings o
    WHERE o.startup_id = f.startup_id AND o.id <> f.id) AS other_filings
FROM raw_gov_filings f
WHERE f.source IN ('epo_ops', 'uspto_patent')
  AND f.entity_name IS NOT NULL
  AND is_excluded_applicant(f.entity_name);

COMMENT ON VIEW patent_excluded_already_ingested IS
$$Patent rows that the private-market boundary would now reject. Deleting is deliberately not automatic — inspect first, then, if you want them gone:

  DELETE FROM startups s
   WHERE EXISTS (SELECT 1 FROM patent_excluded_already_ingested v
                  WHERE v.startup_id = s.id AND v.other_filings = 0)
     AND NOT EXISTS (SELECT 1 FROM sourcing_companies c WHERE c.startup_id = s.id);
  DELETE FROM raw_gov_filings f
   WHERE f.id IN (SELECT filing_id FROM patent_excluded_already_ingested);

Run them in that order: the startups cleanup reads the view, which reads raw_gov_filings. The NOT EXISTS guard keeps any company that has since been linked to a real ATS board, because that is evidence the exclusion was wrong.$$;

GRANT SELECT ON patent_excluded_already_ingested TO authenticated;
GRANT ALL    ON patent_excluded_already_ingested TO service_role;
REVOKE ALL   ON patent_excluded_already_ingested FROM anon;
