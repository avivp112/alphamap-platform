-- =============================================================================
-- Migration: alpha_notes
-- Description:
--   "Your Alpha" → Journal: free-form notes that can link companies. The body
--   keeps the link as a token, `@[Name](type:uuid)`; alpha_note_links is the
--   index of those tokens, so "every note about this company" is one query.
--   Private (RLS). The older single-text notes on watchlist_items and
--   crm_companies stay where they are and are shown read-only in the Journal.
-- Rollback: supabase/rollback/20261203000100_alpha_notes_down.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS alpha_notes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  body       text        NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alpha_notes_user ON alpha_notes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS alpha_note_links (
  note_id     uuid NOT NULL REFERENCES alpha_notes (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('startup', 'investor', 'crm')),
  entity_id   uuid NOT NULL,
  PRIMARY KEY (note_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_alpha_note_links_entity ON alpha_note_links (user_id, entity_type, entity_id);

DROP TRIGGER IF EXISTS trg_alpha_notes_touch ON alpha_notes;
CREATE TRIGGER trg_alpha_notes_touch BEFORE UPDATE ON alpha_notes FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at();

ALTER TABLE alpha_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_note_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alpha_notes_own ON alpha_notes;
CREATE POLICY alpha_notes_own ON alpha_notes FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS alpha_note_links_own ON alpha_note_links;
CREATE POLICY alpha_note_links_own ON alpha_note_links FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM alpha_notes n WHERE n.id = note_id AND n.user_id = auth.uid()));

REVOKE ALL ON alpha_notes, alpha_note_links FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON alpha_notes, alpha_note_links TO authenticated;
GRANT UPDATE (body) ON alpha_notes TO authenticated;
