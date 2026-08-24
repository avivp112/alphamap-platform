-- =============================================================================
-- Migration: social links, news, and AlphaMap score history
-- Created:   2026-08-24
-- Description:
--   Three additions to the company tearsheet, all wired into
--   scripts/bulk_enrich_all.ts so they populate on the existing enrichment
--   cadence rather than needing a separate pipeline:
--
--   1) startups.linkedin_url / facebook_url / instagram_url — the company's
--      own social profiles (distinct from founders'/leadership's personal
--      LinkedIn URLs, which already exist inside the founders/leadership
--      JSONB arrays). Fill-null only, same convention as website/industry.
--
--   2) startups.news — recent press coverage, an array of
--      { title, url, source, published_date }. Same fill-null-only-when-
--      empty convention as competitors/acquisitions (the pipeline never
--      overwrites a curated list, only fills a currently-empty one).
--
--   3) alphamap_score_history — one AlphaMap Score snapshot per startup per
--      calendar day, mirroring headcount_history's exact shape/constraints
--      (see 20260712000001_create_headcount_history.sql) so the tearsheet
--      can plot the score over time the same way it already plots
--      headcount. calculate_alphamap_score() is a live RPC with no memory
--      of its own — this table is what gives it a timeline. Snapshotted by
--      bulk_enrich_all.ts once per company per run, not by the RPC itself.
-- =============================================================================

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS linkedin_url  text,
  ADD COLUMN IF NOT EXISTS facebook_url  text,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS news          jsonb;

COMMENT ON COLUMN startups.linkedin_url  IS 'Company LinkedIn page (not a person''s profile — see founders/leadership for those).';
COMMENT ON COLUMN startups.facebook_url  IS 'Company Facebook page.';
COMMENT ON COLUMN startups.instagram_url IS 'Company Instagram profile.';
COMMENT ON COLUMN startups.news          IS 'Array of { title, url, source, published_date }. Fill-null-when-empty, same policy as competitors/acquisitions — never overwrites a non-empty array.';

CREATE TABLE IF NOT EXISTS alphamap_score_history (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id     uuid        NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  recorded_date  timestamptz NOT NULL DEFAULT now(),
  score          integer     NOT NULL CHECK (score >= 0 AND score <= 100),
  tier           text,
  snapshot_date  date        NOT NULL DEFAULT CURRENT_DATE,

  CONSTRAINT uq_alphamap_score_history_startup_day UNIQUE (startup_id, snapshot_date)
);

COMMENT ON TABLE alphamap_score_history
  IS 'One AlphaMap Score snapshot per startup per calendar day, written by bulk_enrich_all.ts after each enrichment pass — powers the score-over-time chart on the Overview tab.';

CREATE INDEX IF NOT EXISTS idx_alphamap_score_history_startup_recorded
  ON alphamap_score_history(startup_id, recorded_date DESC);

-- RLS: same public-read / service-write pattern as every other pipeline-
-- written table in this schema (headcount_history, startup_changes, etc.)
ALTER TABLE alphamap_score_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alphamap_score_history_public_read" ON alphamap_score_history;
CREATE POLICY "alphamap_score_history_public_read"
  ON alphamap_score_history FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "alphamap_score_history_service_write" ON alphamap_score_history;
CREATE POLICY "alphamap_score_history_service_write"
  ON alphamap_score_history FOR ALL
  USING (auth.role() = 'service_role');
