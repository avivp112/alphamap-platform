-- Rollback of 20261020000000_deal_feed.sql.
-- Drops the feed, puts the archived funds back, un-hides the legacy deals and
-- restores record_fund_filing without the gate. The backfill days added for
-- June-July stay (they only make the worker read more filings).

DROP FUNCTION IF EXISTS deal_feed_stats(text);
DROP VIEW IF EXISTS deal_feed;
DROP FUNCTION IF EXISTS sec_filing_url(text, text);

INSERT INTO vc_fund_filings
SELECT (a).* FROM (
  SELECT ROW(r.id, r.source, r.accession_number, r.cik, r.form_type, r.fund_name, r.firm_name, r.fund_series,
             r.fund_type, r.industry_group, r.filing_date, r.year_of_inc, r.jurisdiction, r.total_offering,
             r.total_sold, r.managers, r.raw_payload, r.investor_id, r.ingested_at)::vc_fund_filings AS a
    FROM vc_fund_filings_rejected_archive r) s
ON CONFLICT DO NOTHING;
DELETE FROM vc_fund_filings_rejected_archive;

UPDATE deals SET hidden_reason = NULL
 WHERE hidden_reason = 'legacy SEC script import (no quality gate) — replaced by deal_feed 2026-10-20';

-- From 20260726130000_gov_sources_expansion.sql:
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

DROP FUNCTION IF EXISTS fund_filing_gate(text, text);
