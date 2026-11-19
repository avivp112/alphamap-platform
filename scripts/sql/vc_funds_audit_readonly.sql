-- vc_funds_audit_readonly.sql — stage-0 inventory of every investor / fund / LP table (SELECT only).
-- Paste into the Supabase SQL Editor and send back the result of each block; or give the session a read-only way in.
-- Nothing here writes, alters or drops.

-- 1. Which relations exist (tables, views, functions) that look like investors / funds / LPs.
SELECT c.relkind, n.nspname, c.relname, c.reltuples::bigint AS approx_rows
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m')
   AND c.relname ~* '(investor|fund|vc_|lp|limited|pe_|deal|gov_filing|round|provenance)'
 ORDER BY c.relkind, c.relname;
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname ~* '(investor|fund|pe_firm|form_d)' ORDER BY 1;

-- 2. Columns of those tables.
SELECT table_name, ordinal_position, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name IN ('investors','vc_fund_filings','raw_gov_filings','deals','funding_rounds','field_provenance')
 ORDER BY table_name, ordinal_position;

-- 3. Row counts.
SELECT 'investors' t, count(*) FROM investors UNION ALL
SELECT 'vc_fund_filings', count(*) FROM vc_fund_filings UNION ALL
SELECT 'raw_gov_filings', count(*) FROM raw_gov_filings UNION ALL
SELECT 'deals', count(*) FROM deals UNION ALL
SELECT 'funding_rounds', count(*) FROM funding_rounds UNION ALL
SELECT 'funding_rounds with lead_investor', count(*) FROM funding_rounds WHERE lead_investor IS NOT NULL UNION ALL
SELECT 'funding_rounds with investors[]', count(*) FROM funding_rounds WHERE cardinality(investors) > 0 UNION ALL
SELECT 'funding_rounds with investor_amounts', count(*) FROM funding_rounds WHERE investor_amounts IS NOT NULL UNION ALL
SELECT 'field_provenance rows on funding_rounds.*.lead_investor', count(*) FROM field_provenance WHERE field LIKE 'funding_rounds.%lead_investor%';

-- 4. Fill % per column: investors.
SELECT count(*) AS n,
  round(100.0*count(description)/count(*),1)        AS description,
  round(100.0*count(thesis)/count(*),1)             AS thesis,
  round(100.0*count(founded_year)/count(*),1)       AS founded_year,
  round(100.0*count(headquarters)/count(*),1)       AS headquarters,
  round(100.0*count(fund_size)/count(*),1)          AS fund_size,
  round(100.0*count(typical_check_size)/count(*),1) AS typical_check_size,
  round(100.0*count(portfolio_size)/count(*),1)     AS portfolio_size,
  round(100.0*count(*) FILTER (WHERE cardinality(stages)>0)/count(*),1)              AS stages,
  round(100.0*count(*) FILTER (WHERE sector_allocation <> '{}'::jsonb)/count(*),1)   AS sector_allocation,
  round(100.0*count(*) FILTER (WHERE cardinality(notable_investments)>0)/count(*),1) AS notable_investments,
  round(100.0*count(website)/count(*),1)            AS website,
  round(100.0*count(leadership)/count(*),1)         AS leadership,
  round(100.0*count(last_enriched_at)/count(*),1)   AS last_enriched_at,
  round(100.0*count(enrichment_confidence)/count(*),1) AS enrichment_confidence,
  count(*) FILTER (WHERE is_manually_verified)      AS manually_verified,
  count(*) FILTER (WHERE firm_type='vc') AS firm_vc, count(*) FILTER (WHERE firm_type='pe') AS firm_pe, count(*) FILTER (WHERE firm_type='growth') AS firm_growth
FROM investors;

-- 5. Fill % per column: vc_fund_filings (Form D fund vehicles) and how many link to investors.
SELECT count(*) AS n,
  round(100.0*count(firm_name)/count(*),1) AS firm_name, round(100.0*count(fund_series)/count(*),1) AS fund_series,
  round(100.0*count(fund_type)/count(*),1) AS fund_type, round(100.0*count(year_of_inc)/count(*),1) AS year_of_inc,
  round(100.0*count(total_offering)/count(*),1) AS total_offering, round(100.0*count(total_sold)/count(*),1) AS total_sold,
  round(100.0*count(*) FILTER (WHERE jsonb_array_length(managers)>0)/count(*),1) AS managers,
  round(100.0*count(investor_id)/count(*),1) AS linked_to_investors,
  min(filing_date) AS first_filing, max(filing_date) AS last_filing
FROM vc_fund_filings;

-- 6. Fill % per column: funding_rounds investor columns, and deals.investors.
SELECT count(*) AS rounds,
  round(100.0*count(lead_investor)/count(*),1) AS lead_investor,
  round(100.0*count(*) FILTER (WHERE cardinality(investors)>0)/count(*),1) AS investors_array,
  round(100.0*count(investor_amounts)/count(*),1) AS investor_amounts,
  round(100.0*count(announcement_date)/count(*),1) AS announcement_date,
  round(100.0*count(source_url)/count(*),1) AS source_url
FROM funding_rounds;
SELECT count(*) AS deals, round(100.0*count(*) FILTER (WHERE cardinality(investors)>0)/count(*),1) AS investors_array,
       round(100.0*count(startup_id)/count(*),1) AS linked_to_startup FROM deals;

-- 7. Provenance on investor values in rounds (does the lead investor have a source + quote?).
SELECT count(*) AS rows, count(source_url) AS with_source, count(evidence_quote) AS with_quote,
       count(*) FILTER (WHERE source_type='legacy') AS legacy
  FROM field_provenance WHERE field LIKE 'funding_rounds.%lead_investor%' OR field LIKE 'funding_rounds.%investors%';
SELECT source_type, count(*) FROM field_provenance WHERE field LIKE 'funding_rounds.%lead_investor%' GROUP BY 1 ORDER BY 2 DESC;
-- NOTE: field_provenance.source_type has a CHECK without 'legacy' (migration 20261007…); 'legacy' needs the proposed widening.

-- 8. Links to startups: investors have NO startup_id; the join is by NAME against funding_rounds.
--    How many investors rows match a name used in rounds, case/space-insensitively (the existing convention)?
SELECT count(*) AS investors_rows,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM funding_rounds fr WHERE lower(btrim(fr.lead_investor)) = lower(btrim(i.name))
                                        OR EXISTS (SELECT 1 FROM unnest(fr.investors) n WHERE lower(btrim(n)) = lower(btrim(i.name))))) AS named_in_rounds
  FROM investors i;

-- 9. Five sample rows of each (columns that are not free text bulk).
SELECT id, name, slug, website, firm_type, founded_year, headquarters, fund_size, portfolio_size, tier, is_manually_verified, last_enriched_at FROM investors ORDER BY random() LIMIT 5;
SELECT fund_name, firm_name, fund_series, fund_type, filing_date, total_offering, total_sold, investor_id IS NOT NULL AS linked FROM vc_fund_filings ORDER BY random() LIMIT 5;
SELECT startup_id, round_type, announcement_date, lead_investor, investors, source_url FROM funding_rounds WHERE lead_investor IS NOT NULL ORDER BY random() LIMIT 5;
SELECT company_name, deal_date, deal_type, investors, source_url FROM deals WHERE cardinality(investors) > 0 ORDER BY random() LIMIT 5;
SELECT * FROM pe_firms_directory() LIMIT 5;
