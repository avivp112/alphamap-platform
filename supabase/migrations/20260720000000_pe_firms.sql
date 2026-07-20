-- =============================================================================
-- Migration: pe_firms
-- Created:   2026-07-20
-- Description: Data layer for the Private Equity Firms page. There is no
--              dedicated PE-firms table — and deliberately so: the real PE
--              signal already lives in funding_rounds, where 'PE Buyout' and
--              'Secondary' rounds carry firm names in lead_investor /
--              investors[] (e.g. Hellman & Friedman and Bain Capital on
--              athenahealth's buyout). The directory is therefore DERIVED
--              from actual transaction data, enriched by the `investors`
--              table when a profile row exists for the same name.
--
--   1. investors.firm_type ('vc' default | 'pe' | 'growth') — lets curated
--      PE firms appear in the directory even before any of their deals are
--      in funding_rounds. Firms already named on PE Buyout/Secondary rounds
--      are auto-tagged 'pe'.
--   2. investors.leadership — same jsonb shape as startups.leadership
--      ({name, role, linkedin_url}), so the PE tearsheet's Leadership
--      section renders with the same LinkedIn chip component as startups.
--   3. pe_firms_directory()      — one row per PE firm: profile fields +
--      deal aggregates (buyouts, secondaries, portfolio size, latest deal,
--      total disclosed deal value).
--   4. pe_firm_portfolio(name)   — the companies a firm holds via PE
--      Buyout/Secondary rounds, with MATURE-track metrics precomputed
--      (headcount, years active, stability, outbound-acquisition count)
--      and each company's archetype from classify_company_archetype().
--   5. pe_firm_transactions(name)— the firm's latest PE Buyout/Secondary
--      deals, newest first.
--
-- Name matching uses lower(trim(name)) — the same convention as the
-- AlphaMap ecosystem-signal investor join, so the two stay consistent.
-- Idempotent; safe to run more than once in the SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) investors.firm_type + leadership
-- -----------------------------------------------------------------------------
ALTER TABLE investors ADD COLUMN IF NOT EXISTS firm_type text NOT NULL DEFAULT 'vc';
ALTER TABLE investors DROP CONSTRAINT IF EXISTS investors_firm_type_check;
ALTER TABLE investors ADD CONSTRAINT investors_firm_type_check
  CHECK (firm_type IN ('vc', 'pe', 'growth'));

COMMENT ON COLUMN investors.firm_type IS
  'vc (default) | pe | growth. PE-tagged rows surface in the Private Equity directory alongside firms derived from PE Buyout/Secondary transaction data.';

ALTER TABLE investors ADD COLUMN IF NOT EXISTS leadership jsonb;
COMMENT ON COLUMN investors.leadership IS
  'JSONB array of {name, role, linkedin_url} — same shape as startups.leadership, so firm tearsheets reuse the same Leadership UI (including LinkedIn chips).';

-- Auto-tag: any investors row whose name appears (as lead or participant) on
-- a PE Buyout / Secondary round is by definition a PE actor.
UPDATE investors i
SET    firm_type = 'pe'
WHERE  i.firm_type = 'vc'
  AND EXISTS (
    SELECT 1
    FROM funding_rounds fr
    WHERE fr.round_type IN ('PE Buyout', 'Secondary')
      AND (
        lower(trim(COALESCE(fr.lead_investor, ''))) = lower(trim(i.name))
        OR EXISTS (
          SELECT 1 FROM unnest(COALESCE(fr.investors, '{}'::text[])) AS t(nm)
          WHERE lower(trim(t.nm)) = lower(trim(i.name))
        )
      )
  );

-- -----------------------------------------------------------------------------
-- 2) pe_firms_directory — transaction-derived firms ∪ curated pe-tagged firms
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pe_firms_directory()
RETURNS TABLE (
  firm_name        text,
  investor_id      uuid,
  slug             text,
  description      text,
  founded_year     integer,
  headquarters     text,
  fund_size        text,
  website          text,
  tier             smallint,
  leadership       jsonb,
  buyout_count     bigint,
  secondary_count  bigint,
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
    WHERE fr.round_type IN ('PE Buyout', 'Secondary')
      AND t.nm IS NOT NULL
      AND trim(t.nm) <> ''
  ),
  agg AS (
    SELECT lower(raw_name)                                        AS key,
           min(raw_name)                                          AS derived_name,
           COUNT(*) FILTER (WHERE round_type = 'PE Buyout')       AS buyout_count,
           COUNT(*) FILTER (WHERE round_type = 'Secondary')       AS secondary_count,
           COUNT(DISTINCT startup_id)                             AS portfolio_count,
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
    i.founded_year,
    i.headquarters,
    i.fund_size,
    i.website,
    i.tier,
    i.leadership,
    COALESCE(a.buyout_count,     0)       AS buyout_count,
    COALESCE(a.secondary_count,  0)       AS secondary_count,
    COALESCE(a.portfolio_count,  0)       AS portfolio_count,
    a.latest_deal_date,
    COALESCE(a.total_deal_value, 0)       AS total_deal_value
  FROM agg a
  FULL OUTER JOIN investors i
    ON lower(trim(i.name)) = a.key AND i.firm_type = 'pe'
  WHERE a.key IS NOT NULL OR i.firm_type = 'pe'
  ORDER BY COALESCE(a.buyout_count, 0) + COALESCE(a.secondary_count, 0) DESC,
           COALESCE(i.name, a.derived_name);
$$;

GRANT EXECUTE ON FUNCTION pe_firms_directory() TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) pe_firm_portfolio — held companies with mature-track metrics precomputed
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pe_firm_portfolio(p_firm_name text)
RETURNS TABLE (
  startup_id      uuid,
  name            text,
  industry        text,
  country         text,
  city            text,
  employee_count  integer,
  founded_year    integer,
  years_active    integer,
  growth_trend    text,
  n_acquisitions  integer,
  archetype       text,
  first_deal_date date,
  deal_types      text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH firm_rounds AS (
    SELECT fr.startup_id, fr.round_type, fr.announcement_date
    FROM funding_rounds fr
    WHERE fr.round_type IN ('PE Buyout', 'Secondary')
      AND (
        lower(trim(COALESCE(fr.lead_investor, ''))) = lower(trim(p_firm_name))
        OR EXISTS (
          SELECT 1 FROM unnest(COALESCE(fr.investors, '{}'::text[])) AS t(nm)
          WHERE lower(trim(t.nm)) = lower(trim(p_firm_name))
        )
      )
  )
  SELECT
    s.id                                   AS startup_id,
    s.name,
    s.industry,
    s.country,
    s.city,
    s.employee_count,
    s.founded_year,
    CASE
      WHEN s.founded_year IS NOT NULL AND s.founded_year > 1800
        THEN GREATEST(0, EXTRACT(YEAR FROM CURRENT_DATE)::integer - s.founded_year)
    END                                    AS years_active,
    s.growth_trend,
    CASE
      WHEN jsonb_typeof(s.acquisitions) = 'array' THEN jsonb_array_length(s.acquisitions)
      ELSE 0
    END                                    AS n_acquisitions,
    classify_company_archetype(s.id)->>'archetype' AS archetype,
    MIN(fr.announcement_date)              AS first_deal_date,
    ARRAY(
      SELECT DISTINCT fr2.round_type FROM firm_rounds fr2 WHERE fr2.startup_id = s.id
    )                                      AS deal_types
  FROM startups s
  JOIN firm_rounds fr ON fr.startup_id = s.id
  GROUP BY s.id, s.name, s.industry, s.country, s.city,
           s.employee_count, s.founded_year, s.growth_trend, s.acquisitions
  ORDER BY s.employee_count DESC NULLS LAST, s.name;
$$;

GRANT EXECUTE ON FUNCTION pe_firm_portfolio(text) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) pe_firm_transactions — latest PE Buyout / Secondary deals for a firm
-- -----------------------------------------------------------------------------
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
  WHERE fr.round_type IN ('PE Buyout', 'Secondary')
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
