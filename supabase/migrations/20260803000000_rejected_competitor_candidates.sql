-- =============================================================================
-- Migration: rejected_competitor_candidates
-- Created:   2026-08-03
-- Description:
--   Backs the competitor-discovery pipeline (scripts/discover_competitors.ts).
--   Every startup's `competitors` JSONB array can name companies that are not
--   yet tracked in `startups`. The discovery script extracts those, runs them
--   through the ingest-startup edge function's tech/public classification
--   gates, and inserts the ones that pass. Candidates that FAIL a gate
--   (public company, or not a tech company) are recorded here so future runs
--   skip them instead of re-spending research budget on a known rejection.
--
--   Internal/ops table only — no legitimate anon or authenticated use case,
--   so RLS is enabled with zero policies (service_role bypasses RLS and is
--   the only writer/reader, matching how the discovery script and other
--   maintenance scripts already authenticate).
-- =============================================================================

CREATE TABLE IF NOT EXISTS rejected_competitor_candidates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  website       text,
  domain        text,
  reason        text        NOT NULL, -- 'public_company' | 'not_tech' | 'error'
  detail        text,
  mention_count integer     NOT NULL DEFAULT 1,
  rejected_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rejected_candidates_domain
  ON rejected_competitor_candidates (domain) WHERE domain IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rejected_candidates_name
  ON rejected_competitor_candidates (lower(name)) WHERE domain IS NULL;

ALTER TABLE rejected_competitor_candidates ENABLE ROW LEVEL SECURITY;
