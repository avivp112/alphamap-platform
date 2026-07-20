-- =============================================================================
-- Migration: investors_enrichment
-- Created:   2026-07-20
-- Description: Scaffolding for the investor-profile enrichment pipeline
--              (scripts/enrich_investors.ts) — the investors-table counterpart
--              of the startups pipeline, covering BOTH VC and PE firms since
--              they share this table (differentiated by firm_type).
--
--   1. investors.thesis                — the firm's official investment
--      thesis/focus (1-3 sentences), sourced preferentially from the firm's
--      own website. Kept separate from `description` (what the firm IS)
--      so the tearsheet can label it distinctly.
--   2. investors.last_enriched_at     — self-advancing queue stamp, same
--      mechanism as startups.last_enriched_at: never-enriched rows sort
--      first, so repeated identical runs walk the whole table batch by
--      batch with OFFSET always 0.
--   3. investors.enrichment_confidence — the model's self-assessed 0-100
--      confidence from the last enrichment pass, for later review queries.
--   4. pe_firms_directory() rebuilt to also return `thesis` (adding a
--      column to RETURNS TABLE changes the return type, which requires
--      DROP + CREATE rather than CREATE OR REPLACE).
--
-- Idempotent; safe to run more than once in the SQL Editor.
-- =============================================================================

ALTER TABLE investors ADD COLUMN IF NOT EXISTS thesis text;
COMMENT ON COLUMN investors.thesis IS
  'The firm''s stated investment thesis/focus (1-3 sentences), sourced preferentially from the firm''s own website. Distinct from description (what the firm is).';

ALTER TABLE investors ADD COLUMN IF NOT EXISTS last_enriched_at timestamptz;
COMMENT ON COLUMN investors.last_enriched_at IS
  'When the enrichment pipeline last processed this row. NULL = never — such rows are picked up first, making repeated identical runs walk the whole table without OFFSET arithmetic.';

ALTER TABLE investors ADD COLUMN IF NOT EXISTS enrichment_confidence integer
  CHECK (enrichment_confidence BETWEEN 0 AND 100);
COMMENT ON COLUMN investors.enrichment_confidence IS
  'Model''s self-assessed confidence (0-100) from the last enrichment pass.';

-- -----------------------------------------------------------------------------
-- Rebuild pe_firms_directory to expose thesis (return-type change ⇒ DROP first)
-- -----------------------------------------------------------------------------
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
    i.thesis,
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
