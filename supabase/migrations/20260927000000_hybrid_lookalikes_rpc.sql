-- =============================================================================
-- Migration: hybrid_lookalikes_rpc
-- Created:   2026-09-27
-- Description:
--   Phase 7 of the preference engine: "find companies like this one" for the
--   new Lookalikes Drawer. Hybrid retrieval, same two-stage shape as a
--   production vector search:
--
--     1. Candidate generation (cheap): pre-filter startups_search down to a
--        small set via idx_startups_search_sub_sector_names (GIN) — a
--        sub_sector_names array-overlap check, same index the Private
--        Market page's own sub-sector filter already relies on. Falls back
--        to an exact sector_parent match (already indexed) for a company
--        with zero sub-sector tags, so an empty tag array (which can never
--        overlap anything) doesn't leave that company with zero lookalikes
--        forever.
--     2. Re-ranking (the expensive part): only THAT narrowed candidate set
--        gets ordered by real cosine distance on startups.embedding (via
--        startups_search's `s.*`, from 20260721000000_semantic_search_pgvector),
--        never the whole table.
--
--   No RLS/security concerns beyond what startups_search already exposes
--   (public company data, same as suggested_startup_peers) -- no explicit
--   GRANT/REVOKE needed, same convention as that function.
-- =============================================================================

CREATE OR REPLACE FUNCTION hybrid_lookalikes(
  p_startup_id uuid,
  p_limit      int DEFAULT 6
)
RETURNS TABLE(peer startups_search, similarity_pct int)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH target AS (
    SELECT id, sub_sector_names, sector_parent, embedding
    FROM startups_search
    WHERE id = p_startup_id
  )
  SELECT
    peer,
    GREATEST(0, LEAST(100, round((1 - (peer.embedding <=> target.embedding)) * 100)))::int
  FROM startups_search peer, target
  WHERE peer.id <> target.id
    AND peer.embedding   IS NOT NULL
    AND target.embedding IS NOT NULL
    AND (
      peer.sub_sector_names && target.sub_sector_names
      OR peer.sector_parent = target.sector_parent
    )
  ORDER BY peer.embedding <=> target.embedding
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION hybrid_lookalikes(uuid, int) IS
  'Phase 7: "companies like this one" for the Lookalikes Drawer. Pre-filters startups_search via the GIN-indexed sub_sector_names overlap (falling back to an exact sector_parent match for untagged companies), then re-ranks only that candidate set by real cosine distance on startups.embedding. Returns each peer as the full startups_search composite plus a 0-100 similarity_pct.';
