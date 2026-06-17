-- Migration: add is_manually_verified to investors
-- Protects human-curated rows from being overwritten by automated scrapers.
-- When TRUE, the scraper's ON CONFLICT path is skipped entirely for that row.

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS is_manually_verified BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN investors.is_manually_verified IS
  'Scraper safety gate. When TRUE, agent_vcs_scraper.ts skips this row on conflict,
   preserving any human edits made via the Supabase Dashboard or admin UI.
   Set to TRUE manually after reviewing and editing a profile.';

-- Index useful for queries like: WHERE is_manually_verified = FALSE
CREATE INDEX IF NOT EXISTS idx_investors_not_verified
  ON investors (is_manually_verified)
  WHERE is_manually_verified = FALSE;
