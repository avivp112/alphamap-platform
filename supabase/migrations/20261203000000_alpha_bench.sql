-- =============================================================================
-- Migration: alpha_bench
-- Description:
--   "Your Alpha" → Bench: the (at most) seven companies a user would actually
--   act on, each with a conviction score the user sets. Private (RLS).
--   entity_type 'crm' points at the user's own crm_companies row (a company
--   they checked that is not in AlphaMap); 'startup' / 'investor' point into
--   startups.id / investors.id like watchlist_items (no DB-level FK for the
--   same reason: one column cannot reference two tables).
-- Rollback: supabase/rollback/20261203000000_alpha_bench_down.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS alpha_bench (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  entity_type text        NOT NULL CHECK (entity_type IN ('startup', 'investor', 'crm')),
  entity_id   uuid        NOT NULL,
  conviction  smallint    CHECK (conviction IS NULL OR conviction BETWEEN 1 AND 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entity_type, entity_id)
);

COMMENT ON TABLE alpha_bench IS
  'A user''s Bench: at most 7 companies they would act on. Private (RLS). The cap is enforced by trigger alpha_bench_cap.';
COMMENT ON COLUMN alpha_bench.conviction IS 'User-set, 1 (low) to 5 (high). NULL = not rated yet.';

CREATE INDEX IF NOT EXISTS idx_alpha_bench_user ON alpha_bench (user_id, created_at);

-- Seven seats, whatever the client does. The advisory lock keeps two parallel
-- inserts from both seeing six rows.
CREATE OR REPLACE FUNCTION alpha_bench_cap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('alpha_bench:' || NEW.user_id::text));
  IF (SELECT count(*) FROM alpha_bench WHERE user_id = NEW.user_id) >= 7 THEN
    RAISE EXCEPTION 'The bench holds at most 7 companies' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS alpha_bench_cap ON alpha_bench;
CREATE TRIGGER alpha_bench_cap BEFORE INSERT ON alpha_bench FOR EACH ROW EXECUTE FUNCTION alpha_bench_cap();

-- crm_touch_updated_at() comes from 20261024000000_crm.sql.
DROP TRIGGER IF EXISTS trg_alpha_bench_touch ON alpha_bench;
CREATE TRIGGER trg_alpha_bench_touch BEFORE UPDATE ON alpha_bench FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at();

ALTER TABLE alpha_bench ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alpha_bench_own ON alpha_bench;
CREATE POLICY alpha_bench_own ON alpha_bench FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (entity_type <> 'crm' OR EXISTS (SELECT 1 FROM crm_companies c WHERE c.id = entity_id AND c.user_id = auth.uid()))
  );

REVOKE ALL ON alpha_bench FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON alpha_bench TO authenticated;
GRANT UPDATE (conviction) ON alpha_bench TO authenticated;
