-- Migration: deals table
-- Live transactional ledger for private-market deals (funding rounds, M&A,
-- and SEC Form D unannounced filings).  Powers the Deal Flow page (/deals).
--
-- Dedup strategy:
--   source_url UNIQUE  — one row per SEC filing / news article URL
--   (company_name, deal_date, deal_type) UNIQUE  — fallback for manually-
--   entered rows that have no source URL (SQL allows multiple NULLs in a
--   UNIQUE column, so these two constraints work independently).

CREATE TABLE deals (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name           text        NOT NULL,
  startup_id             uuid        REFERENCES startups(id) ON DELETE SET NULL,
  deal_date              date        NOT NULL,
  amount_raised          bigint,                        -- USD, actual amount closed so far
  target_amount          bigint,                        -- USD, total offering size (Form D: totalOfferingAmount)
  deal_type              text        NOT NULL DEFAULT 'Other',  -- 'Series A', 'Form D (Equity)', 'M&A', …
  investors              text[],                        -- named lead investors (null for Form D filings)
  source_url             text,                          -- SEC EDGAR filing URL or news source
  sector                 text,                          -- e.g. 'AI & ML', 'Fintech'
  country                text,                          -- e.g. 'USA', 'UNITED KINGDOM'
  valuation              bigint,                        -- post-money or acquisition price (USD)
  is_valuation_estimated boolean     NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),

  -- Primary dedup key: one row per unique source URL
  CONSTRAINT uq_deals_source_url UNIQUE (source_url)
);

-- Secondary dedup: prevents manual-entry duplicates when source_url is null
CREATE UNIQUE INDEX uq_deals_company_date_type
  ON deals (company_name, deal_date, deal_type)
  WHERE source_url IS NULL;

-- Performance indexes for the Deal Flow table (default: deal_date DESC)
CREATE INDEX idx_deals_date        ON deals (deal_date DESC);
CREATE INDEX idx_deals_company     ON deals (company_name);
CREATE INDEX idx_deals_startup_id  ON deals (startup_id) WHERE startup_id IS NOT NULL;
CREATE INDEX idx_deals_deal_type   ON deals (deal_type);
CREATE INDEX idx_deals_sector      ON deals (sector)     WHERE sector IS NOT NULL;

-- RLS: anyone can read; only service_role (pipeline / edge functions) can write
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deals_public_read"
  ON deals FOR SELECT
  USING (true);

CREATE POLICY "deals_service_write"
  ON deals FOR ALL
  USING (auth.role() = 'service_role');
