-- Rollback for 20261001010000_watchlist_notes_and_tags.sql
-- Drops the update policy/grant and the two columns. Any notes/tags data is lost.

REVOKE UPDATE (notes, tags) ON watchlist_items FROM authenticated;
DROP POLICY IF EXISTS "watchlist_update_own" ON watchlist_items;
ALTER TABLE watchlist_items
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS tags;
