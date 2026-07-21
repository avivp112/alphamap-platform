-- =============================================================================
-- Migration: pe_directory_debt
-- Created:   2026-07-20
-- Description: The PE page's new side-panel filters include a 'Debt' deal-type
--              toggle, but pe_firms_directory() only aggregated 'PE Buyout'
--              and 'Secondary' rounds — a Debt filter would have had nothing
--              to filter on. This widens the directory to also count 'Debt'
--              rounds per firm (private credit is a core PE-adjacent
--              strategy — Apollo/Ares-style lenders belong in this
--              directory), and widens pe_firm_transactions() to include Debt
--              deals so a firm surfaced via lending activity doesn't show an
--              empty Transactions tab.
--
--              pe_firm_portfolio() intentionally stays Buyout/Secondary-only:
--              lending against a company is not holding it.
--
--   - pe_firms_directory(): DROP + CREATE (adds debt_count to the return
--     type, which cannot be done via CREATE OR REPLACE)
--   - pe_firm_transactions(): CREATE OR REPLACE (return type unchanged)
--
-- Idempotent; safe to run more than once in the SQL Editor.
-- =============================================================================

DROP FUNCTION IF EXISTS pe_firms_directory();

CREATE FUNCTION pe_firms_directory()
RETURNS TABLE (
  firm_name        text,
  investor_id      uuid,
  slug             text,
  description      text,
  thesis           text,
  founded_year     integer,
  headquarters     text,
  fund_size        text,
  website          text,
  tier             smallint,
  leadership       jsonb,
  buyout_count     bigint,
  secondary_count  bigint,
  debt_count       bigint,
  portfolio_count  bigint,
  latest_deal_date date,
  total_deal_value numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH deal_names AS (
    SELECT trim(t.nm)          AS raw_name,
           fr.startup_id,
           fr.round_type,
           fr.announcement_date,
           fr.amount_raised
    FROM funding_rounds fr,
         LATERAL unnest(
           COALESCE(fr.investors, '{}'::text[]) ||
           CASE WHEN fr.lead_investor IS NOT NULL THEN ARRAY[fr.lead_investor] ELSE '{}'::text[] END
         ) AS t(nm)
    WHERE fr.round_type IN ('PE Buyout', 'Secondary', 'Debt')
      AND t.nm IS NOT NULL
      AND trim(t.nm) <> ''
  ),
  agg AS (
    SELECT lower(raw_name)                                        AS key,
           min(raw_name)                                          AS derived_name,
           COUNT(*) FILTER (WHERE round_type = 'PE Buyout')       AS buyout_count,
           COUNT(*) FILTER (WHERE round_type = 'Secondary')       AS secondary_count,
           COUNT(*) FILTER (WHERE round_type = 'Debt')            AS debt_count,
           COUNT(DISTINCT startup_id) FILTER (WHERE round_type IN ('PE Buyout', 'Secondary'))
                                                                  AS portfolio_count,
           MAX(announcement_date)                                 AS latest_deal_date,
           COALESCE(SUM(amount_raised), 0)                        AS total_deal_value
    FROM deal_names
    GROUP BY lower(raw_name)
  )
  SELECT
    COALESCE(i.name, a.derived_name)      AS firm_name,
    i.id                                  AS investor_id,
    i.slug,
    i.description,
    i.thesis,
    i.founded_year,
    i.headquarters,
    i.fund_size,
    i.website,
    i.tier,
    i.leadership,
    COALESCE(a.buyout_count,     0)       AS buyout_count,
    COALESCE(a.secondary_count,  0)       AS secondary_count,
    COALESCE(a.debt_count,       0)       AS debt_count,
    COALESCE(a.portfolio_count,  0)       AS portfolio_count,
    a.latest_deal_date,
    COALESCE(a.total_deal_value, 0)       AS total_deal_value
  FROM agg a
  FULL OUTER JOIN investors i
    ON lower(trim(i.name)) = a.key AND i.firm_type = 'pe'
  WHERE a.key IS NOT NULL OR i.firm_type = 'pe'
  ORDER BY COALESCE(a.buyout_count, 0) + COALESCE(a.secondary_count, 0) + COALESCE(a.debt_count, 0) DESC,
           COALESCE(i.name, a.derived_name);
$$;

GRANT EXECUTE ON FUNCTION pe_firms_directory() TO anon, authenticated;

-- Transactions feed: include Debt so lender-surfaced firms have a non-empty tab
CREATE OR REPLACE FUNCTION pe_firm_transactions(p_firm_name text)
RETURNS TABLE (
  round_id          uuid,
  startup_id        uuid,
  company_name      text,
  industry          text,
  round_type        text,
  amount_raised     numeric,
  valuation         numeric,
  announcement_date date,
  is_lead           boolean,
  source_url        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fr.id                AS round_id,
    s.id                 AS startup_id,
    s.name               AS company_name,
    s.industry,
    fr.round_type,
    fr.amount_raised,
    fr.valuation,
    fr.announcement_date,
    lower(trim(COALESCE(fr.lead_investor, ''))) = lower(trim(p_firm_name)) AS is_lead,
    fr.source_url
  FROM funding_rounds fr
  JOIN startups s ON s.id = fr.startup_id
  WHERE fr.round_type IN ('PE Buyout', 'Secondary', 'Debt')
    AND (
      lower(trim(COALESCE(fr.lead_investor, ''))) = lower(trim(p_firm_name))
      OR EXISTS (
        SELECT 1 FROM unnest(COALESCE(fr.investors, '{}'::text[])) AS t(nm)
        WHERE lower(trim(t.nm)) = lower(trim(p_firm_name))
      )
    )
  ORDER BY fr.announcement_date DESC NULLS LAST, fr.created_at DESC
  LIMIT 30;
$$;

GRANT EXECUTE ON FUNCTION pe_firm_transactions(text) TO anon, authenticated;
