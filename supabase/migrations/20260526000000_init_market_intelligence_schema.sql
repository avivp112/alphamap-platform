-- =============================================================================
-- Migration: init_market_intelligence_schema
-- Created:   2026-05-26
-- Description: Creates the core startups + funding_rounds tables with trigger,
--              indexes, and RLS for AlphaMap Market Intelligence platform.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Shared helper: updated_at trigger function (created once, reused by any
--    table that needs automatic timestamp maintenance)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 1. Drop existing tables if present (safe for a fresh start; CASCADE removes
--    any dependent objects such as foreign keys and triggers automatically)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS funding_rounds CASCADE;
DROP TABLE IF EXISTS startups      CASCADE;

-- ---------------------------------------------------------------------------
-- 2. startups
-- ---------------------------------------------------------------------------
CREATE TABLE startups (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL CHECK (trim(name) <> ''),
  website        text        UNIQUE,
  description    text,
  industry       text,
  founded_year   integer     CHECK (founded_year > 1900 AND founded_year <= EXTRACT(YEAR FROM now())::integer),
  employee_count integer     CHECK (employee_count >= 0),
  country        text,
  city           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  startups              IS 'Private companies tracked by AlphaMap';
COMMENT ON COLUMN startups.website      IS 'Canonical website URL — must be unique per company';
COMMENT ON COLUMN startups.founded_year IS 'Four-digit founding year';

-- ---------------------------------------------------------------------------
-- 3. funding_rounds  (one-to-many: many rounds → one startup)
-- ---------------------------------------------------------------------------
CREATE TABLE funding_rounds (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id        uuid        NOT NULL
                                REFERENCES startups (id) ON DELETE CASCADE,
  round_type        text        CHECK (round_type IN (
                                  'Pre-Seed', 'Seed',
                                  'Series A', 'Series B', 'Series C', 'Series D', 'Series E+',
                                  'Growth', 'Bridge', 'Convertible Note',
                                  'Bootstrapped', 'Grant', 'Acquired', 'IPO', 'Other'
                                )),
  amount_raised     numeric     CHECK (amount_raised >= 0),
  valuation         numeric     CHECK (valuation >= 0),
  announcement_date date,
  source_url        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  funding_rounds                  IS 'Individual financing events for each startup';
COMMENT ON COLUMN funding_rounds.amount_raised    IS 'Capital raised in this round (USD)';
COMMENT ON COLUMN funding_rounds.valuation        IS 'Post-money valuation at time of round (USD)';
COMMENT ON COLUMN funding_rounds.source_url       IS 'Primary source (press release, Crunchbase, etc.)';

-- ---------------------------------------------------------------------------
-- 4. Trigger: keep startups.updated_at current on every row update
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_startups_updated_at
  BEFORE UPDATE ON startups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 5. Indexes for common query patterns
-- ---------------------------------------------------------------------------

-- Full-text / prefix search on company name
CREATE INDEX idx_startups_name        ON startups (name);

-- Filter / group by sector
CREATE INDEX idx_startups_industry    ON startups (industry);

-- JOIN from funding_rounds → startups (also speeds up cascade deletes)
CREATE INDEX idx_funding_rounds_startup_id ON funding_rounds (startup_id);

-- Time-series queries on announcement date (e.g. "rounds in last 6 months")
CREATE INDEX idx_funding_rounds_date  ON funding_rounds (announcement_date DESC);

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
--    Reads are public; writes require the service_role key (used by the
--    ingest-startup Edge Function). This prevents the old sync button from
--    ever re-populating the table via the anon key.
-- ---------------------------------------------------------------------------
ALTER TABLE startups       ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_rounds ENABLE ROW LEVEL SECURITY;

-- Anyone (anon) can read
CREATE POLICY "Public read startups"
  ON startups FOR SELECT USING (true);

CREATE POLICY "Public read funding_rounds"
  ON funding_rounds FOR SELECT USING (true);

-- Only service_role (Edge Function) can write
-- No INSERT / UPDATE / DELETE policies for anon → writes silently rejected
