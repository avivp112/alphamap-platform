-- =============================================================================
-- Tests for sourcing_fomo_scores.
--
-- Run:  psql "$SUPABASE_DB_URL" -f supabase/tests/fomo_scoring.test.sql
--
-- SAFE ON A LIVE DATABASE. Everything runs inside a transaction that ends in
-- ROLLBACK, so the fixtures below never persist. Read the last line before
-- trusting that sentence.
--
-- This exists because the scoring view has been revised five times — scaled-org
-- penalty, company age, inception, and now the IP split — each time by DROP and
-- CREATE, each time with the arithmetic checked by hand.
--
-- The bug that prompted this file was invisible to inspection: pts_inception
-- took min(filing_date) across ALL government sources, so a company with an old
-- patent and a fresh Form D was scored on the PATENT date. Measured against the
-- old view with a Form D 90 days old, correct answer 25:
--
--     patent  200d -> 15      patent  700d -> 5
--     patent  400d ->  5      patent 1200d -> 0
--
-- Graded, not all-or-nothing — 10 to 25 points lost depending on the patent's
-- age. Nothing errored. The leaderboard was just quietly wrong, which is the
-- entire argument for this file existing.
-- =============================================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.ck(label text, got text, want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM want THEN
    RAISE NOTICE 'PASS  % = %', label, coalesce(got, '<null>');
  ELSE
    RAISE NOTICE 'FAIL  %  got % want %', label, coalesce(got, '<null>'), coalesce(want, '<null>');
  END IF;
END $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Named so a failure says which scenario broke.

CREATE TEMP TABLE t_ids (label text PRIMARY KEY, startup_id uuid, company_id uuid);

DO $$
DECLARE
  s uuid; c uuid;
  scenarios text[] := ARRAY[
    'formd_fresh_patent_old',   -- the regression this migration fixes
    'patent_only_recent',
    'patent_only_stale',
    'uk_incorporation_fresh',
    'formd_stale',
    'no_filings',
    'patent_broad_cpc',
    'patent_narrow_many'
  ];
  n text;
BEGIN
  FOREACH n IN ARRAY scenarios LOOP
    INSERT INTO startups (name) VALUES ('ZZ Test ' || n) RETURNING id INTO s;
    INSERT INTO sourcing_companies (ats_provider, ats_board_token, inferred_name, startup_id)
    VALUES ('greenhouse', 'zz-test-' || n, 'ZZ Test ' || n, s)
    RETURNING id INTO c;
    INSERT INTO t_ids VALUES (n, s, c);
  END LOOP;
END $$;

-- A company that raised three months ago and published a patent ~two years ago.
-- Before the split this scored pts_inception = 5 rather than 25: min() took the
-- 700-day-old patent date, which landed in the old view's <=730d tier.
INSERT INTO raw_gov_filings (source, accession_number, entity_name, filing_date, startup_id, classification_codes)
SELECT 'sec_form_d', 'ZZ-FD-1', 'ZZ Test formd_fresh_patent_old', current_date - 90, startup_id, NULL
  FROM t_ids WHERE label = 'formd_fresh_patent_old';
INSERT INTO raw_gov_filings (source, accession_number, entity_name, filing_date, startup_id, classification_codes)
SELECT 'epo_ops', 'ZZ-EP-1', 'ZZ Test formd_fresh_patent_old', current_date - 700, startup_id, ARRAY['G06N3/08']
  FROM t_ids WHERE label = 'formd_fresh_patent_old';

INSERT INTO raw_gov_filings (source, accession_number, entity_name, filing_date, startup_id, classification_codes)
SELECT 'epo_ops', 'ZZ-EP-2', 'ZZ Test patent_only_recent', current_date - 30, startup_id, ARRAY['G06N3/08']
  FROM t_ids WHERE label = 'patent_only_recent';

INSERT INTO raw_gov_filings (source, accession_number, entity_name, filing_date, startup_id, classification_codes)
SELECT 'epo_ops', 'ZZ-EP-3', 'ZZ Test patent_only_stale', current_date - 1500, startup_id, ARRAY['G06N3/08']
  FROM t_ids WHERE label = 'patent_only_stale';

INSERT INTO raw_gov_filings (source, accession_number, entity_name, filing_date, startup_id, classification_codes)
SELECT 'uk_companies_house', 'ZZ-UK-1', 'ZZ Test uk_incorporation_fresh', current_date - 10, startup_id, ARRAY['62012']
  FROM t_ids WHERE label = 'uk_incorporation_fresh';

INSERT INTO raw_gov_filings (source, accession_number, entity_name, filing_date, startup_id, classification_codes)
SELECT 'sec_form_d', 'ZZ-FD-2', 'ZZ Test formd_stale', current_date - 1200, startup_id, NULL
  FROM t_ids WHERE label = 'formd_stale';

-- Two subclasses (G06N, G16B) -> breadth bonus.
INSERT INTO raw_gov_filings (source, accession_number, entity_name, filing_date, startup_id, classification_codes)
SELECT 'epo_ops', 'ZZ-EP-4', 'ZZ Test patent_broad_cpc', current_date - 60, startup_id, ARRAY['G06N3/08','G16B40/00']
  FROM t_ids WHERE label = 'patent_broad_cpc';

-- Four publications, all one subclass -> volume must NOT be rewarded.
INSERT INTO raw_gov_filings (source, accession_number, entity_name, filing_date, startup_id, classification_codes)
SELECT 'epo_ops', 'ZZ-EP-5' || g::text, 'ZZ Test patent_narrow_many', current_date - 60, startup_id, ARRAY['G06N3/08']
  FROM t_ids, generate_series(1, 4) g WHERE label = 'patent_narrow_many';

-- ── Assertions ──────────────────────────────────────────────────────────────

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '── the regression: a stale patent must not suppress a fresh Form D ──';
  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'formd_fresh_patent_old';
  PERFORM pg_temp.ck('inception reads the Form D, not the patent', r.pts_inception::text, '25');
  PERFORM pg_temp.ck('first_filing_date is the Form D date',
    (r.first_filing_date = current_date - 90)::text, 'true');
  PERFORM pg_temp.ck('the patent scores separately (700d -> 6)', r.pts_ip::text, '6');
  PERFORM pg_temp.ck('patent_count', r.patent_count::text, '1');
  PERFORM pg_temp.ck('gov_filings counts only day-zero sources', r.gov_filings::text, '1');

  RAISE NOTICE '';
  RAISE NOTICE '── patents alone never claim inception ──';
  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'patent_only_recent';
  PERFORM pg_temp.ck('pts_inception is 0 with no day-zero filing', r.pts_inception::text, '0');
  PERFORM pg_temp.ck('first_filing_date is NULL', coalesce(r.first_filing_date::text, '<null>'), '<null>');
  PERFORM pg_temp.ck('pts_ip fires instead (30d, one subclass)', r.pts_ip::text, '10');
  PERFORM pg_temp.ck('latest_patent_date exposed',
    (r.latest_patent_date = current_date - 30)::text, 'true');

  RAISE NOTICE '';
  RAISE NOTICE '── recency tiers ──';
  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'patent_only_stale';
  PERFORM pg_temp.ck('a 1500-day-old publication scores 0, never negative', r.pts_ip::text, '0');

  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'uk_incorporation_fresh';
  PERFORM pg_temp.ck('a UK incorporation drives inception', r.pts_inception::text, '25');
  PERFORM pg_temp.ck('and contributes no IP', r.pts_ip::text, '0');

  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'formd_stale';
  PERFORM pg_temp.ck('a 1200-day-old Form D scores 0', r.pts_inception::text, '0');

  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'no_filings';
  PERFORM pg_temp.ck('no filings: inception 0', r.pts_inception::text, '0');
  PERFORM pg_temp.ck('no filings: ip 0 — absence is never a penalty', r.pts_ip::text, '0');
  PERFORM pg_temp.ck('no filings: score does not go negative from these terms',
    (r.fomo_score >= 0)::text, 'true');

  RAISE NOTICE '';
  RAISE NOTICE '── breadth is rewarded, volume is not ──';
  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'patent_broad_cpc';
  PERFORM pg_temp.ck('two subclasses: 10 recency + 5 breadth', r.pts_ip::text, '15');
  PERFORM pg_temp.ck('distinct_cpc', r.distinct_cpc::text, '2');
  PERFORM pg_temp.ck('pts_ip ceiling is 15, below inception''s 25',
    (r.pts_ip <= 15)::text, 'true');

  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'patent_narrow_many';
  PERFORM pg_temp.ck('four publications in ONE subclass score the same as one',
    r.pts_ip::text, '10');
  PERFORM pg_temp.ck('though the count is still visible', r.patent_count::text, '4');
  PERFORM pg_temp.ck('distinct_cpc stays 1', r.distinct_cpc::text, '1');

  RAISE NOTICE '';
  RAISE NOTICE '── the two terms are independent ──';
  PERFORM pg_temp.ck('a company can score on both at once',
    (SELECT (pts_inception > 0 AND pts_ip > 0)::text FROM sourcing_fomo_scores f
      JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'formd_fresh_patent_old'), 'true');
  PERFORM pg_temp.ck('every scored row still has a bounded fomo_score',
    (SELECT bool_and(fomo_score BETWEEN 0 AND 100)::text FROM sourcing_fomo_scores), 'true');
END $$;

-- Nothing above is kept. Remove this line and the fixtures become real rows.
ROLLBACK;
