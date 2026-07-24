-- =============================================================================
-- Migration: public_companies_search
-- Created:   2026-07-26
-- Description: Widens public_companies to support on-demand search-and-sync of
--              ANY NASDAQ/NYSE ticker (not just the 4 curated sectors):
--
--   1. sector CHECK widened to add 'other' — a ticker the user searches for
--      that doesn't map to Cyber/SaaS/Fintech/AI still gets stored and shown
--      in the companies directory, just excluded from the Sector Multiples
--      Matrix and Sentiment Barometer (which stay scoped to the 4 curated
--      sectors on purpose — see sync-public-markets' sector-mapping keywords).
--   2. exchange column (NASDAQ / NYSE / other) — captured from FMP's ticker
--      search endpoint, shown in the directory and search dropdown.
--   3. idx_public_companies_name — the companies directory sorts/searches by
--      name client-side today, but this keeps a future server-side paginated
--      query (ORDER BY name) fast as the table grows past the curated 19 rows.
--
-- Idempotent; safe to run more than once.
-- =============================================================================

ALTER TABLE public_companies DROP CONSTRAINT IF EXISTS public_companies_sector_check;
ALTER TABLE public_companies ADD CONSTRAINT public_companies_sector_check
  CHECK (sector IN ('cyber', 'saas', 'fintech', 'ai', 'other'));

ALTER TABLE public_companies ADD COLUMN IF NOT EXISTS exchange text;

CREATE INDEX IF NOT EXISTS idx_public_companies_name ON public_companies (name);
