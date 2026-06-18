-- Migration: unique partial index on investors.website
-- Enforces the domain-as-primary-key model used by agent_vcs_scraper.ts.
--
-- A partial index (WHERE website IS NOT NULL) allows multiple rows to have
-- website = NULL (firms without a known site) while ensuring every non-null
-- website is unique — matching Postgres standard behaviour for UNIQUE columns.
--
-- The scraper resolves entities by normalizeDomain(website) at the application
-- layer before reaching this constraint; the index is a last-resort safety net.

CREATE UNIQUE INDEX IF NOT EXISTS uq_investors_website
  ON investors (lower(website))
  WHERE website IS NOT NULL;

COMMENT ON INDEX uq_investors_website IS
  'Prevents duplicate VC profiles for the same domain. The scraper resolves
   entities by domain first; this index enforces it at the DB level.';
