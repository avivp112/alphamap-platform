-- Migration: headcount_history
-- Tracks one headcount snapshot per company per calendar day.
-- The pipeline (bulk_enrich_all.ts) upserts here whenever employee_count is refreshed.
-- The frontend falls back to a simulated curve until ≥ 2 real points exist.

CREATE TABLE headcount_history (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  headcount     integer     NOT NULL CHECK (headcount > 0),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  snapshot_date date        NOT NULL DEFAULT CURRENT_DATE,

  -- One snapshot per company per calendar day (pipeline dedup key)
  CONSTRAINT uq_headcount_company_day UNIQUE (company_id, snapshot_date)
);

-- Fast per-company time-series lookups
CREATE INDEX idx_headcount_history_company_time
  ON headcount_history(company_id, snapshot_date DESC);

-- RLS: anyone can read; only service_role (pipeline / edge functions) can write
ALTER TABLE headcount_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "headcount_history_public_read"
  ON headcount_history FOR SELECT
  USING (true);

CREATE POLICY "headcount_history_service_write"
  ON headcount_history FOR ALL
  USING (auth.role() = 'service_role');
