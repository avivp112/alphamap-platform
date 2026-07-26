-- =============================================================================
-- Migration: board-discovery candidate pool
-- Created:   2026-07-26
-- Description:
--   Everything discover-boards needs to pick which companies to probe.
--
--   1. startups.board_discovery_at — when we last attempted slug discovery for
--      this company. NULL = never attempted. Without it, every invocation
--      would re-probe the same first N rows forever and never reach row N+1.
--      Set it back to NULL to force a retry after the slug heuristics improve.
--
--   2. board_discovery_candidates — the candidate pool, as a view so the
--      selection rule lives in SQL where it can be inspected and queried
--      directly rather than being buried in TypeScript.
--
-- ── THE FILTER: TWO PREDICATES, BOTH FAILING OPEN ───────────────────────────
--   1. archetype <> 'mature_private'
--      classify_company_archetype() is the existing venture_backed /
--      mature_private split. Strictly it is a MATURITY axis, not tech vs
--      non-tech — a twenty-year-old PE-owned software firm is mature_private
--      and still very much a tech company. But maturity is the right axis for
--      this engine anyway: mature_private means "demonstrably not an
--      early-stage startup", which is exactly who should not be in a FOMO
--      leaderboard.
--
--      Critically it FAILS OPEN. mature_private requires positive evidence —
--      a buyout/acquisition on record, 15+ years active with no recent early
--      round, or 750+ headcount with no recent VC round. A company with no
--      funding history, no founded_year and no headcount falls through to
--      venture_backed and stays in the pool. That is the stealth profile, and
--      it is preserved.
--
--   2. a recognised tech sector OR no industry data at all
--      sector_parent yields ten tech buckets plus 'Uncategorized'.
--      'Uncategorized' does NOT mean "not tech" — it means the industry string
--      could not be classified, which is overwhelmingly what a blank industry
--      field looks like. Filtering it out would silently delete the sparse-data
--      companies this engine exists to find, so unknown-industry rows are kept.
--
--   Both predicates therefore exclude only on POSITIVE evidence of being out
--   of scope. Absence of data never removes a company. That is deliberate: in
--   a discovery tool, a false exclusion is invisible and permanent, while a
--   false inclusion costs one keyless GET that 404s.
--
--   NOTE ON COST: classify_company_archetype() runs three EXISTS subqueries
--   against funding_rounds per row. It is STABLE and funding_rounds is indexed
--   on startup_id, and the cheap predicates (website present, not yet
--   attempted, not already registered) cut the row count first — but if this
--   view ever feels slow at scale, materialising the archetype onto startups
--   is the fix.
--
-- Rollback: supabase/rollback/20260726090000_board_discovery_candidates_down.sql
--
-- Idempotent.
-- =============================================================================

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS board_discovery_at timestamptz;

COMMENT ON COLUMN startups.board_discovery_at IS
  'When ATS board-slug discovery was last attempted. NULL = never attempted. Reset to NULL to re-run discovery after improving the slug heuristics.';

-- The work queue: pending rows only, so the index stays small as startups grows.
CREATE INDEX IF NOT EXISTS idx_startups_board_discovery_pending
  ON startups (created_at)
  WHERE board_discovery_at IS NULL;

DROP VIEW IF EXISTS board_discovery_candidates;

CREATE VIEW board_discovery_candidates AS
SELECT
  s.id                                                       AS startup_id,
  s.name,
  s.website,
  s.industry,
  COALESCE(sec.name, classify_sector_parent(s.industry))     AS sector_parent,
  classify_company_archetype(s.id)->>'archetype'             AS archetype,
  s.founded_year,
  s.created_at
FROM startups s
LEFT JOIN sectors sec ON sec.id = s.sector_id
WHERE
  -- A website is the only source of a candidate slug. No site, no guess.
  s.website IS NOT NULL
  AND btrim(s.website) <> ''
  -- Not yet attempted.
  AND s.board_discovery_at IS NULL
  -- Not a demonstrably mature company. Fails open: no funding/age/headcount
  -- data classifies as venture_backed, so stealth companies stay in.
  AND classify_company_archetype(s.id)->>'archetype' <> 'mature_private'
  -- Tech sectors, PLUS companies whose industry we simply do not know.
  -- 'Uncategorized' conflates "non-tech" with "no data"; dropping the no-data
  -- rows would drop the stealth companies.
  AND (
        COALESCE(sec.name, classify_sector_parent(s.industry)) <> 'Uncategorized'
     OR s.industry IS NULL
     OR btrim(s.industry) = ''
  )
  -- Already-registered boards are not candidates. Matched on the startup link
  -- first, falling back to an exact name match for boards registered by hand
  -- before startup_id existed.
  AND NOT EXISTS (
    SELECT 1 FROM sourcing_companies sc
     WHERE sc.startup_id = s.id
        OR (sc.inferred_name IS NOT NULL
            AND lower(btrim(sc.inferred_name)) = lower(btrim(s.name)))
  );

COMMENT ON VIEW board_discovery_candidates IS
  'Companies eligible for ATS board-slug discovery: has a website, not yet attempted, not already registered, archetype is not mature_private, and either a recognised tech sector or unknown industry. Both exclusions require POSITIVE evidence of being out of scope — missing funding/industry data never removes a company, because in a discovery tool a false exclusion is invisible and permanent while a false inclusion costs one keyless GET.';

GRANT SELECT ON board_discovery_candidates TO authenticated;
GRANT ALL    ON board_discovery_candidates TO service_role;
REVOKE ALL   ON board_discovery_candidates FROM anon;
