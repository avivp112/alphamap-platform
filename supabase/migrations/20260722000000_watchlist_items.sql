-- =============================================================================
-- Migration: watchlist_items
-- Created:   2026-07-22
-- Description: Per-user "My Watchlist" — lets a signed-in user track specific
--              startups and investors. entity_id is polymorphic (points into
--              either `startups` or `investors` depending on entity_type), so
--              there's no direct FK; the app fetches the two tables separately
--              by id list and joins client-side. RLS keeps every row scoped to
--              its owner — a user can only ever see, add, or remove their own
--              watchlist entries.
--
-- Idempotent; safe to run more than once in the SQL Editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS watchlist_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('startup', 'investor')),
  entity_id   uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entity_type, entity_id)
);

COMMENT ON TABLE watchlist_items IS
  'A signed-in user''s tracked companies/investors. entity_id points into startups.id or investors.id depending on entity_type — resolved by the app, not a DB-level FK, since one column can''t reference two different tables.';

CREATE INDEX IF NOT EXISTS idx_watchlist_items_user ON watchlist_items (user_id, created_at DESC);

ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watchlist_select_own" ON watchlist_items;
CREATE POLICY "watchlist_select_own" ON watchlist_items
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "watchlist_insert_own" ON watchlist_items;
CREATE POLICY "watchlist_insert_own" ON watchlist_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "watchlist_delete_own" ON watchlist_items;
CREATE POLICY "watchlist_delete_own" ON watchlist_items
  FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, DELETE ON watchlist_items TO authenticated;
