-- =============================================================================
-- Migration: watchlist_notes_and_tags
-- Created:   2026-10-01
-- Description:
--   My Area / Curated Watchlist section needs per-item personal notes and
--   tags ("quick actions: remove, add personal notes/tags, view status
--   updates"). watchlist_items (20260722000000) has neither column, and --
--   more fundamentally -- has NO UPDATE POLICY AT ALL: the table was built
--   for a pure add/remove list, so editing a row in place has been
--   structurally impossible since it was created, not just unimplemented in
--   the UI.
--
--   Column-level GRANT (not just the row-level RLS policy) restricts an
--   UPDATE to notes/tags only -- the same defensive pattern
--   entity_match_candidates uses for decide_match_candidate's reviewer
--   columns. Without it, RLS alone would still let an authenticated user
--   UPDATE their own row's entity_type/entity_id/user_id, which makes no
--   sense for a watchlist entry (an item's identity should never change
--   after creation -- remove and re-add is the correct way to "change" what
--   a row points at).
--
-- Rollback: supabase/rollback/20261001010000_watchlist_notes_and_tags_down.sql
-- Idempotent.
-- =============================================================================

ALTER TABLE watchlist_items
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS tags  text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN watchlist_items.notes IS
  'Free-text personal note the user attached to this watchlist entry. NULL = none.';
COMMENT ON COLUMN watchlist_items.tags IS
  'User-defined tags for organizing their own watchlist (e.g. "Series A", "follow up"). Personal to this row, not a shared taxonomy.';

DROP POLICY IF EXISTS "watchlist_update_own" ON watchlist_items;
CREATE POLICY "watchlist_update_own" ON watchlist_items
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Column-level grant: RLS controls WHICH ROWS, this controls WHICH COLUMNS.
-- entity_type/entity_id/user_id must stay immutable after insert.
GRANT UPDATE (notes, tags) ON watchlist_items TO authenticated;
