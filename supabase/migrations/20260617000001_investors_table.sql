-- Migration: investors table
-- Institutional-grade VC / investor profiles powering the VC Screener page.
-- sector_allocation stores radar-chart scores (0–100) per domain.
-- Ingested and kept fresh by scripts/agent_vcs.ts.

CREATE TABLE investors (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  slug                text        NOT NULL,           -- 2-3 char avatar label, e.g. 'SEQ'
  description         text,
  founded_year        integer,
  headquarters        text,
  fund_size           text,                           -- free-form AUM string, e.g. '$85B+'
  typical_check_size  text,                           -- e.g. '$500K – $10M'
  portfolio_size      integer,                        -- approximate active portfolio count
  stages              text[]      NOT NULL DEFAULT '{}',
  sector_allocation   jsonb       NOT NULL DEFAULT '{}',  -- { AI: 85, FinTech: 70, … }
  notable_investments text[]      NOT NULL DEFAULT '{}',
  website             text,
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_investors_name UNIQUE (name)
);

-- Slug should also be unique per investor
CREATE UNIQUE INDEX uq_investors_slug ON investors (slug);

-- Performance: screener typically filters/sorts by stage or HQ
CREATE INDEX idx_investors_stages ON investors USING GIN (stages);
CREATE INDEX idx_investors_hq     ON investors (headquarters);

-- RLS: public read, service_role write (same pattern as deals table)
ALTER TABLE investors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "investors_public_read"
  ON investors FOR SELECT
  USING (true);

CREATE POLICY "investors_service_write"
  ON investors FOR ALL
  USING (auth.role() = 'service_role');
