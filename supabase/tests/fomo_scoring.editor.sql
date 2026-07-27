-- =============================================================================
-- Tests for sourcing_fomo_scores — SUPABASE SQL EDITOR VERSION.
--
-- Paste the whole file into the SQL Editor and press Run. Results come back as
-- a TABLE you can read, with a PASS/FAIL column.
--
-- ── WHY THIS EXISTS SEPARATELY FROM fomo_scoring.test.sql ───────────────────
--   That file is written for psql and this one cannot be, for two reasons:
--
--   1. It opens with \set ON_ERROR_STOP on. Backslash commands are psql
--      CLIENT-side directives, never sent to Postgres, so the editor sees them
--      as SQL and errors on line 1.
--
--   2. It reports through RAISE NOTICE. psql prints notices; the SQL Editor
--      shows a results grid and may put notices somewhere you never look — so
--      a FAIL could pass silently, which is worse than not running the test.
--
--   This version collects every assertion into a table and SELECTs it last.
--
-- ── HOW CLEANUP WORKS HERE, AND WHY IT IS WEAKER ────────────────────────────
--   The psql version wraps everything in BEGIN ... ROLLBACK, which cannot leave
--   anything behind. That is not usable here: the editor shows the LAST
--   statement's output, and if ROLLBACK is last there is nothing to show.
--
--   So this version DELETEs its fixtures explicitly, and the DO block has an
--   exception handler that cleans up before re-raising. Cleanup is still
--   guaranteed on a normal failure — but if the connection drops mid-run,
--   fixtures survive. Every one is prefixed, so this removes them:
--
--     DELETE FROM raw_gov_filings   WHERE accession_number LIKE 'ZZ-%';
--     DELETE FROM sourcing_companies WHERE ats_board_token LIKE 'zz-test-%';
--     DELETE FROM startups          WHERE name LIKE 'ZZ Test %';
--
--   In that order — the FKs point that way.
--
--   Prefer the psql version when you have the choice. This one is for when you
--   do not.
-- =============================================================================

DROP TABLE IF EXISTS fomo_test_results;
CREATE TEMP TABLE fomo_test_results (
  seq serial, check_name text, got text, want text, ok boolean
);

-- ── Fixtures (identical to the psql version) ────────────────────────────────
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
-- Collected into a table rather than raised as notices, so nothing is lost.

DO $$
DECLARE r record;
BEGIN

  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'formd_fresh_patent_old';
  INSERT INTO fomo_test_results (check_name, got, want, ok) VALUES
    ('regression: inception reads the Form D, not the patent', r.pts_inception::text, '25', r.pts_inception = 25),
    ('regression: first_filing_date is the Form D date', r.first_filing_date::text, (current_date - 90)::text, r.first_filing_date = current_date - 90),
    ('regression: the patent scores separately (700d -> 6)', r.pts_ip::text, '6', r.pts_ip = 6),
    ('regression: patent_count', r.patent_count::text, '1', r.patent_count = 1),
    ('regression: gov_filings counts only day-zero sources', r.gov_filings::text, '1', r.gov_filings = 1);

  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'patent_only_recent';
  INSERT INTO fomo_test_results (check_name, got, want, ok) VALUES
    ('patents alone never claim inception', r.pts_inception::text, '0', r.pts_inception = 0),
    ('patent-only: first_filing_date is NULL', coalesce(r.first_filing_date::text,'<null>'), '<null>', r.first_filing_date IS NULL),
    ('patent-only: pts_ip fires instead (30d, one subclass)', r.pts_ip::text, '10', r.pts_ip = 10),
    ('patent-only: latest_patent_date exposed', r.latest_patent_date::text, (current_date - 30)::text, r.latest_patent_date = current_date - 30);

  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'patent_only_stale';
  INSERT INTO fomo_test_results (check_name, got, want, ok) VALUES
    ('a 1500-day-old publication scores 0, never negative', r.pts_ip::text, '0', r.pts_ip = 0);

  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'uk_incorporation_fresh';
  INSERT INTO fomo_test_results (check_name, got, want, ok) VALUES
    ('a UK incorporation drives inception', r.pts_inception::text, '25', r.pts_inception = 25),
    ('a UK incorporation contributes no IP', r.pts_ip::text, '0', r.pts_ip = 0);

  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'formd_stale';
  INSERT INTO fomo_test_results (check_name, got, want, ok) VALUES
    ('a 1200-day-old Form D scores 0', r.pts_inception::text, '0', r.pts_inception = 0);

  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'no_filings';
  INSERT INTO fomo_test_results (check_name, got, want, ok) VALUES
    ('no filings: inception 0', r.pts_inception::text, '0', r.pts_inception = 0),
    ('no filings: ip 0 — absence is never a penalty', r.pts_ip::text, '0', r.pts_ip = 0),
    ('no filings: score stays bounded at or above 0', (r.fomo_score >= 0)::text, 'true', r.fomo_score >= 0);

  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'patent_broad_cpc';
  INSERT INTO fomo_test_results (check_name, got, want, ok) VALUES
    ('two subclasses: 10 recency + 5 breadth', r.pts_ip::text, '15', r.pts_ip = 15),
    ('distinct_cpc', r.distinct_cpc::text, '2', r.distinct_cpc = 2),
    ('pts_ip ceiling is 15, below inception''s 25', (r.pts_ip <= 15)::text, 'true', r.pts_ip <= 15);

  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'patent_narrow_many';
  INSERT INTO fomo_test_results (check_name, got, want, ok) VALUES
    ('four publications in ONE subclass score the same as one', r.pts_ip::text, '10', r.pts_ip = 10),
    ('though the count is still visible', r.patent_count::text, '4', r.patent_count = 4),
    ('distinct_cpc stays 1', r.distinct_cpc::text, '1', r.distinct_cpc = 1);

  SELECT f.* INTO r FROM sourcing_fomo_scores f
    JOIN t_ids t ON t.company_id = f.company_id WHERE t.label = 'formd_fresh_patent_old';
  INSERT INTO fomo_test_results (check_name, got, want, ok) VALUES
    ('the two terms are independent — both can score at once',
     (r.pts_inception > 0 AND r.pts_ip > 0)::text, 'true', r.pts_inception > 0 AND r.pts_ip > 0);

  INSERT INTO fomo_test_results (check_name, got, want, ok)
  SELECT 'every scored row has a bounded fomo_score',
         bool_and(fomo_score BETWEEN 0 AND 100)::text, 'true',
         bool_and(fomo_score BETWEEN 0 AND 100)
    FROM sourcing_fomo_scores;

EXCEPTION WHEN others THEN
  -- Clean up before re-raising, so a mid-run failure does not strand fixtures.
  DELETE FROM raw_gov_filings    WHERE accession_number LIKE 'ZZ-%';
  DELETE FROM sourcing_companies WHERE ats_board_token  LIKE 'zz-test-%';
  DELETE FROM startups           WHERE name             LIKE 'ZZ Test %';
  RAISE;
END $$;

-- ── Cleanup, before the final SELECT so the results grid shows the results ──
-- FK order: filings reference startups, sourcing_companies references startups.
DELETE FROM raw_gov_filings    WHERE accession_number LIKE 'ZZ-%';
DELETE FROM sourcing_companies WHERE ats_board_token  LIKE 'zz-test-%';
DELETE FROM startups           WHERE name             LIKE 'ZZ Test %';

-- ── Results ─────────────────────────────────────────────────────────────────
-- Sort failures to the top: if there are 24 rows and you only read the first
-- screen, the first screen is the one that matters.
SELECT
  CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result,
  check_name,
  got,
  want
FROM fomo_test_results
ORDER BY ok, seq;
