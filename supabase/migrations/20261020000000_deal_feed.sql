-- =============================================================================
-- Migration: deal feed — gated SEC deals for the Deal Flow page
-- Created:   2026-10-20
-- Description:
--   The Deal Flow page read `deals`, filled only by a hand-run script
--   (scripts/fetch_sec_deals.ts, last run 2026-07-21) that took almost every
--   Form D — real estate, banks, oil & gas included. Now the page reads
--   deal_feed, a view over the filings the nightly SEC worker gathers, under
--   the same rules as the opportunity engine:
--
--   COMPANIES (raw_gov_filings, already industry-scoped by the worker):
--     shown when the filing belongs to a company in the database, to a
--     candidate an admin approved, or to a pending candidate the gate put in
--     the "alert" tier. Review-only candidates (energy / health / hardware
--     names, companies over five years old) appear once approved; rejecting
--     a candidate removes its deals. One row per offering: a D/A amendment
--     updates the amounts of the D it amends instead of adding a row.
--
--   FUNDS (vc_fund_filings): venture capital funds only (no PE, hedge, real
--     estate or "other" funds) and not the SPV, feeder, parallel, blocker,
--     co-invest or "a series of" vehicles around them — fund_filing_gate().
--     record_fund_filing() now stores only what passes; what is already
--     stored and does not pass is moved to vc_fund_filings_rejected_archive.
--
--   LEGACY: the 392 script rows in `deals` are hidden (hidden_reason), not
--     deleted. The SEC backfill is extended to 2026-06-01 so their period is
--     re-read through the gate. `deals` stays for hand-entered rounds.
--
--   deal_feed_stats() — the page's headline numbers, computed over the whole
--     feed rather than the page of rows on screen.
--
-- Rollback: supabase/rollback/20261020000000_deal_feed_down.sql
-- Idempotent.
-- =============================================================================

-- ── 1. Fund gate ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fund_filing_gate(p_name text, p_fund_type text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN coalesce(p_fund_type, '') <> 'Venture Capital Fund'
         THEN 'fund_type:' || coalesce(nullif(p_fund_type, ''), 'none') END,
    CASE WHEN lower(p_name) ~ '\y(spv|a series of|feeder|parallel|blocker|aiv|co-?invest\w*|sidecar|annex)\y'
         THEN 'vehicle_name:' || substring(lower(p_name) FROM '\y(spv|a series of|feeder|parallel|blocker|aiv|co-?invest\w*|sidecar|annex)\y') END
  ], NULL);
$$;

COMMENT ON FUNCTION fund_filing_gate(text, text) IS
  'Why a fund Form D is out of scope (empty = in scope): not a Venture Capital Fund (SEC investmentFundType), or a deal-by-deal / technical vehicle (SPV, a series of, feeder, parallel, blocker, AIV, co-invest, sidecar, annex).';

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
  v_reasons  text[] := fund_filing_gate(p_fund_name, p_fund_type);
  v_firm     text;
  v_series   integer;
  v_investor uuid;
  v_id       uuid;
BEGIN
  IF p_fund_name IS NULL OR btrim(p_fund_name) = '' THEN
    RAISE EXCEPTION 'record_fund_filing: fund_name is required';
  END IF;

  -- NEW (20261020000000): only venture capital funds, and not the SPV /
  -- feeder / parallel vehicles around them, are stored at all.
  IF cardinality(v_reasons) > 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reasons', to_jsonb(v_reasons));
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

-- ── 2. Funds already stored that do not pass ────────────────────────────────
CREATE TABLE IF NOT EXISTS vc_fund_filings_rejected_archive (
  LIKE vc_fund_filings INCLUDING DEFAULTS,
  archived_at  timestamptz NOT NULL DEFAULT now(),
  gate_reasons text[]
);
ALTER TABLE vc_fund_filings_rejected_archive ENABLE ROW LEVEL SECURITY;   -- service role only

WITH moved AS (
  DELETE FROM vc_fund_filings v
   WHERE cardinality(fund_filing_gate(v.fund_name, v.fund_type)) > 0
  RETURNING v.*
)
INSERT INTO vc_fund_filings_rejected_archive
SELECT m.*, now(), fund_filing_gate(m.fund_name, m.fund_type) FROM moved m;

-- ── 3. Legacy script rows ────────────────────────────────────────────────────
ALTER TABLE deals ADD COLUMN IF NOT EXISTS hidden_reason text;
COMMENT ON COLUMN deals.hidden_reason IS
  'Set = not shown. The Form D rows scripts/fetch_sec_deals.ts wrote until 2026-07-21 are hidden: every industry, no quality gate. deal_feed replaces them.';
UPDATE deals
   SET hidden_reason = 'legacy SEC script import (no quality gate) — replaced by deal_feed 2026-10-20'
 WHERE hidden_reason IS NULL AND deal_type LIKE 'Form D%' AND created_at < timestamptz '2026-10-20';

-- ── 4. Backfill the legacy period through the gate ──────────────────────────
INSERT INTO sec_form_d_days (index_date, status, note)
SELECT d::date, 'pending', 'backfill 2026-10-20 (legacy deals period)'
  FROM generate_series(date '2026-06-01', date '2026-07-20', interval '1 day') d
 WHERE extract(isodow FROM d) < 6
ON CONFLICT (index_date) DO NOTHING;

-- ── 5. The feed ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_raw_gov_filings_sec_cik
  ON raw_gov_filings (cik, filing_date) WHERE source = 'sec_form_d';
CREATE INDEX IF NOT EXISTS idx_vc_fund_filings_cik
  ON vc_fund_filings (cik, filing_date);

CREATE OR REPLACE FUNCTION sec_filing_url(p_cik text, p_accession text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_cik ~ '^[0-9]+$' AND p_accession ~ '^[0-9-]+$'
    THEN 'https://www.sec.gov/Archives/edgar/data/' || ltrim(p_cik, '0') || '/' || replace(p_accession, '-', '') || '/'
  END;
$$;

DROP VIEW IF EXISTS deal_feed;
CREATE VIEW deal_feed AS
WITH co AS (
  SELECT g.id, g.accession_number, coalesce(g.cik, g.accession_number) AS grp, g.cik, g.form_type,
         g.entity_name, g.filing_date, g.industry_group, g.country, g.total_offering, g.total_sold,
         g.officers, g.startup_id, g.candidate_id, c.name AS cand_name, c.status AS cand_status
    FROM raw_gov_filings g
    LEFT JOIN company_candidates c ON c.id = g.candidate_id
   WHERE g.source = 'sec_form_d'
     AND (g.startup_id IS NOT NULL
          OR c.status = 'approved'
          OR (c.status = 'pending' AND c.gate_tier = 'alert'))
), fu AS (
  SELECT v.id, v.accession_number, coalesce(v.cik, v.accession_number) AS grp, v.cik, v.form_type,
         -- firm_name is a lowercase grouping key; show the directory's spelling when linked
         v.fund_name, coalesce(i.name, initcap(v.firm_name)) AS firm_name, v.fund_series, v.filing_date,
         v.total_offering, v.total_sold, v.managers, v.investor_id
    FROM vc_fund_filings v
    LEFT JOIN investors i ON i.id = v.investor_id
   WHERE cardinality(fund_filing_gate(v.fund_name, v.fund_type)) = 0
)
-- Companies: one row per offering — the D, or a D/A whose D predates the data.
SELECT f.id, 'company'::text AS kind,
       coalesce(s.name, f.cand_name, f.entity_name) AS name,
       f.startup_id, f.candidate_id, NULL::uuid AS investor_id, NULL::text AS firm_name, NULL::integer AS fund_series,
       f.filing_date AS deal_date, l.filing_date AS updated_date,
       l.total_offering AS target_amount, l.total_sold AS amount_raised,
       'Form D'::text AS deal_type,
       CASE WHEN s.id IS NOT NULL AND classify_sector_parent(s.industry) <> 'Uncategorized'
              THEN classify_sector_parent(s.industry)
            ELSE coalesce(
              candidate_sector('sec_form_d', coalesce(s.name, f.entity_name), jsonb_build_object('industry_group', f.industry_group)),
              CASE lower(f.industry_group)
                WHEN 'pharmaceuticals'       THEN 'Health & Life Sciences'
                WHEN 'other health care'     THEN 'Health & Life Sciences'
                WHEN 'energy conservation'   THEN 'Climate & Energy'
                WHEN 'environmental services' THEN 'Climate & Energy'
                WHEN 'other energy'          THEN 'Climate & Energy'
                ELSE 'Technology' END)
       END AS sector,
       f.industry_group,
       coalesce(s.country, f.country) AS country,
       CASE WHEN f.startup_id IS NOT NULL THEN 'verified' ELSE 'unreviewed' END AS review_status,
       coalesce(f.officers, '[]'::jsonb) AS people,
       sec_filing_url(f.cik, f.accession_number) AS source_url
  FROM co f
  LEFT JOIN startups s ON s.id = f.startup_id
  LEFT JOIN LATERAL (
    SELECT x.total_offering, x.total_sold, x.filing_date
      FROM co x
     WHERE x.grp = f.grp AND x.filing_date >= f.filing_date AND x.filing_date < f.filing_date + 400
       AND NOT EXISTS (SELECT 1 FROM co d WHERE d.grp = f.grp AND d.form_type = 'D'
                         AND d.filing_date > f.filing_date AND d.filing_date <= x.filing_date AND d.id <> f.id)
     ORDER BY x.filing_date DESC, x.form_type DESC
     LIMIT 1) l ON true
 WHERE f.form_type = 'D'
    OR NOT EXISTS (SELECT 1 FROM co p WHERE p.grp = f.grp AND p.filing_date < f.filing_date
                     AND p.filing_date >= f.filing_date - 400)
UNION ALL
-- Venture funds, same one-row-per-offering rule.
SELECT f.id, 'fund',
       f.fund_name, NULL, NULL, f.investor_id, f.firm_name, f.fund_series,
       f.filing_date, l.filing_date,
       l.total_offering, l.total_sold,
       'VC Fund', 'Venture Capital', NULL, NULL,
       CASE WHEN f.investor_id IS NOT NULL THEN 'verified' ELSE 'unreviewed' END,
       coalesce(f.managers, '[]'::jsonb),
       sec_filing_url(f.cik, f.accession_number)
  FROM fu f
  LEFT JOIN LATERAL (
    SELECT x.total_offering, x.total_sold, x.filing_date
      FROM fu x
     WHERE x.grp = f.grp AND x.filing_date >= f.filing_date AND x.filing_date < f.filing_date + 400
       AND NOT EXISTS (SELECT 1 FROM fu d WHERE d.grp = f.grp AND d.form_type = 'D'
                         AND d.filing_date > f.filing_date AND d.filing_date <= x.filing_date AND d.id <> f.id)
     ORDER BY x.filing_date DESC, x.form_type DESC
     LIMIT 1) l ON true
 WHERE f.form_type = 'D'
    OR NOT EXISTS (SELECT 1 FROM fu p WHERE p.grp = f.grp AND p.filing_date < f.filing_date
                     AND p.filing_date >= f.filing_date - 400)
UNION ALL
-- Rounds entered by hand into `deals` (none today; legacy script rows are hidden).
SELECT d.id, 'company', d.company_name, d.startup_id, NULL, NULL, NULL, NULL,
       d.deal_date, d.deal_date, d.target_amount, d.amount_raised, d.deal_type,
       coalesce(d.sector, 'Technology'), NULL, d.country, 'verified', '[]'::jsonb, d.source_url
  FROM deals d
 WHERE d.hidden_reason IS NULL;

COMMENT ON VIEW deal_feed IS
  'The Deal Flow page: gated SEC Form D company rounds (kind = company), venture fund raises (kind = fund) and hand-entered deals. review_status: verified = company/firm in the database; unreviewed = an alert-tier candidate / unlinked VC firm. Reads tables users cannot (candidates), exposing only these columns.';

REVOKE ALL ON deal_feed FROM PUBLIC, anon;
GRANT SELECT ON deal_feed TO authenticated, service_role;

-- ── 6. Headline numbers over the whole feed ─────────────────────────────────
CREATE OR REPLACE FUNCTION deal_feed_stats(p_kind text DEFAULT 'company')
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH f AS (SELECT * FROM deal_feed WHERE kind = p_kind),
  top AS (
    SELECT CASE WHEN p_kind = 'fund' THEN coalesce(firm_name, name) ELSE sector END AS k, count(*) n
      FROM f GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1),
  big AS (SELECT name, amount_raised FROM f WHERE amount_raised IS NOT NULL ORDER BY amount_raised DESC LIMIT 1)
  SELECT jsonb_build_object(
    'count',          (SELECT count(*) FROM f),
    'total_raised',   (SELECT coalesce(sum(amount_raised), 0) FROM f),
    'largest_name',   (SELECT name FROM big),
    'largest_amount', (SELECT amount_raised FROM big),
    'top_key',        (SELECT k FROM top),
    'top_count',      (SELECT n FROM top),
    'month_count',    (SELECT count(*) FROM f WHERE deal_date >= date_trunc('month', current_date)),
    'month_raised',   (SELECT coalesce(sum(amount_raised), 0) FROM f WHERE deal_date >= date_trunc('month', current_date)),
    'latest_date',    (SELECT max(deal_date) FROM f)
  );
$$;

REVOKE ALL ON FUNCTION deal_feed_stats(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION deal_feed_stats(text) TO authenticated, service_role;
