-- =============================================================================
-- Migration: startups created_at index
-- Created:   2026-08-11
-- Description:
--   fetchStartups() (src/lib/supabase.ts) — the full-table fetch backing the
--   Market Map page — orders by created_at DESC with no matching index, so
--   every page of every paginated request (1000 rows at a time, the whole
--   table) forces a full sort. At 10,000+ rows that sort cost is paid on
--   every single Market Map page load. A plain descending index lets it
--   satisfy the ORDER BY directly instead.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_startups_created_at ON startups(created_at DESC);
