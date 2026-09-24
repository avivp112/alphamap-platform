-- =============================================================================
-- Migration: preference_engine_phase1
-- Created:   2026-09-24
-- Description:
--   Phase 1 of the behavioral preference engine (onboarding mandate, explicit
--   + implicit interaction logging, the derived preference vector, CRM
--   webhooks, and in-app notifications). Schema + RLS only — no UI, no
--   compute job yet; those are later phases. watchlist_items (existing,
--   20260722000000) is reused as-is for "Save" and needs no change here.
--
--   Five new tables:
--     user_mandates            — one current row per user, their onboarding
--                                 answers (stage/sector/geo mandate, pain
--                                 point, signal triggers, delivery prefs).
--                                 Client-owned (select/insert/update own).
--     user_interactions        — append-only log of explicit (pass/save) and
--                                 implicit (tearsheet_summary) signals. The
--                                 first CLIENT-WRITABLE table in this schema
--                                 (every other public-read table so far is
--                                 service-role-write-only) — INSERT + SELECT
--                                 only, no UPDATE/DELETE policy at all, so a
--                                 row can never be altered or removed once
--                                 logged.
--     user_preference_vectors  — the DERIVED artifact: a centroid in the same
--                                 1536-dim space as startups.embedding
--                                 (20260721000000_semantic_search_pgvector),
--                                 computed by a later batch job from
--                                 user_interactions + watchlist_items. Client
--                                 can only ever SELECT its own row (to show
--                                 signal_count / a "still calibrating" UI
--                                 state) — writes are service-role only,
--                                 mirroring how `sectors` restricts writes.
--     user_webhooks             — per-user generic outbound webhook config
--                                 (Zapier/Make-compatible), fully owner-CRUD.
--     notifications             — in-app alerts backing TopNav's bell. Client
--                                 can read its own and mark read, but cannot
--                                 create one — only a later alert-matching
--                                 job (service-role) inserts rows.
--
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS throughout.
-- Safe to paste into the Supabase SQL Editor and run more than once.
-- Rollback: supabase/rollback/20260924000000_preference_engine_phase1_down.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) user_mandates — onboarding cold-start answers, one current row per user
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_mandates (
  user_id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Free-text arrays validated app-side against the app's own stage/sector/
  -- geography vocabularies (STAGE_STEPS / the `sectors` table / country
  -- list) — same convention as startups.tags, which has no DB-level enum
  -- either, so this can't drift out of sync with those vocabularies as they
  -- grow.
  stages            text[]      NOT NULL DEFAULT '{}',
  sectors           text[]      NOT NULL DEFAULT '{}',
  geographies       text[]      NOT NULL DEFAULT '{}',
  pain_point_focus  text        CHECK (pain_point_focus IN ('origination', 'deck_processing', 'comps_dd', 'ic_prep')),
  -- Fixed enum (unlike stages/sectors/geographies above) since this list is
  -- short, product-defined, and not sourced from a growing taxonomy table.
  signal_triggers   text[]      NOT NULL DEFAULT '{}'
                                CHECK (signal_triggers <@ ARRAY['founder_pedigree', 'traction_spikes', 'company_registrations', 'pre_public_funding']::text[]),
  delivery_prefs    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_mandates IS
  'One current row per user: onboarding cold-start answers (investment mandate, pain point, signal triggers, delivery prefs). Drives the deterministic hard-filter side of personalization — kept separate from user_preference_vectors, which is the soft/continuous side.';

DROP TRIGGER IF EXISTS trg_user_mandates_updated_at ON user_mandates;
CREATE TRIGGER trg_user_mandates_updated_at
  BEFORE UPDATE ON user_mandates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE user_mandates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_mandates_select_own" ON user_mandates;
CREATE POLICY "user_mandates_select_own" ON user_mandates FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_mandates_insert_own" ON user_mandates;
CREATE POLICY "user_mandates_insert_own" ON user_mandates FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_mandates_update_own" ON user_mandates;
CREATE POLICY "user_mandates_update_own" ON user_mandates FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON user_mandates TO authenticated;

-- -----------------------------------------------------------------------------
-- 2) user_interactions — append-only explicit + implicit signal log
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_interactions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  startup_id            uuid        NOT NULL REFERENCES startups(id)   ON DELETE CASCADE,
  action_type           text        NOT NULL CHECK (action_type IN ('pass', 'save', 'tearsheet_summary', 'crm_sync', 'lookalikes_view')),
  -- Only set when action_type = 'pass'.
  pass_reason           text        CHECK (pass_reason IN ('sector', 'stage', 'valuation', 'team')),
  -- Only set when action_type = 'tearsheet_summary' — one summary row per
  -- tearsheet close (flushed client-side), never one row per hover/section,
  -- so this table's write volume stays proportional to tearsheet opens, not
  -- to scroll/hover events.
  tabs_visited          text[]      CHECK (tabs_visited <@ ARRAY['overview', 'funding', 'captable', 'talent', 'competitors', 'acquisitions', 'news']::text[]),
  total_active_seconds  integer     CHECK (total_active_seconds >= 0),
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_interactions IS
  'Append-only log of every explicit (pass/save) and implicit (tearsheet_summary) preference signal. Source data for the user_preference_vectors batch recompute — never updated or deleted once written, and never read back to reconstruct a UI state, only to train the vector.';

CREATE INDEX IF NOT EXISTS idx_user_interactions_user    ON user_interactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_interactions_startup ON user_interactions (startup_id);

ALTER TABLE user_interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_interactions_select_own" ON user_interactions;
CREATE POLICY "user_interactions_select_own" ON user_interactions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_interactions_insert_own" ON user_interactions;
CREATE POLICY "user_interactions_insert_own" ON user_interactions FOR INSERT WITH CHECK (auth.uid() = user_id);
-- Deliberately no UPDATE or DELETE policy — this log is immutable by design.

GRANT SELECT, INSERT ON user_interactions TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) user_preference_vectors — derived centroid, service-role write only
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_preference_vectors (
  user_id      uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Same 1536-dim space as startups.embedding/investors.embedding
  -- (20260721000000_semantic_search_pgvector) — a meaningful centroid of
  -- real company embeddings the user has engaged with, never a hand-rolled
  -- weighted-tag vector. No HNSW index here: queries always go
  -- startups.embedding <=> (this one user's vector), which uses the
  -- existing index on startups, not one on this table.
  embedding    extensions.vector(1536),
  -- Gates the UI: below some minimum (e.g. 5), the app should show "still
  -- calibrating" rather than a misleadingly confident match percentage.
  signal_count integer     NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_preference_vectors IS
  'One derived preference-embedding row per user, recomputed periodically by a batch job (later phase) from user_interactions + watchlist_items — never written directly by the client. signal_count lets the UI distinguish "confidently calibrated" from "not enough data yet".';

ALTER TABLE user_preference_vectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_preference_vectors_select_own" ON user_preference_vectors;
CREATE POLICY "user_preference_vectors_select_own" ON user_preference_vectors FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_preference_vectors_service_write" ON user_preference_vectors;
CREATE POLICY "user_preference_vectors_service_write" ON user_preference_vectors FOR ALL USING (auth.role() = 'service_role');

GRANT SELECT ON user_preference_vectors TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) user_webhooks — generic outbound CRM sync (Zapier/Make-compatible)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_webhooks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_url text        NOT NULL CHECK (target_url ~ '^https://'),
  -- HMAC-signs the outbound payload so the receiving endpoint can verify the
  -- request actually came from AlphaMap.
  secret     text        NOT NULL,
  enabled    boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_webhooks IS
  'Per-user generic outbound webhook target (v1 CRM sync — one HMAC-signed POST endpoint per user, Zapier/Make-compatible, instead of bespoke Affinity/HubSpot/Salesforce OAuth integrations).';

CREATE INDEX IF NOT EXISTS idx_user_webhooks_user ON user_webhooks (user_id);

ALTER TABLE user_webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_webhooks_select_own" ON user_webhooks;
CREATE POLICY "user_webhooks_select_own" ON user_webhooks FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_webhooks_insert_own" ON user_webhooks;
CREATE POLICY "user_webhooks_insert_own" ON user_webhooks FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_webhooks_update_own" ON user_webhooks;
CREATE POLICY "user_webhooks_update_own" ON user_webhooks FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_webhooks_delete_own" ON user_webhooks;
CREATE POLICY "user_webhooks_delete_own" ON user_webhooks FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_webhooks TO authenticated;

-- -----------------------------------------------------------------------------
-- 5) notifications — backs TopNav's (currently decorative) bell
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text        NOT NULL,
  title      text        NOT NULL,
  body       text        NOT NULL,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE notifications IS
  'In-app alerts (real-time push matches, digest summaries, etc.) backing TopNav''s bell icon, which today only renders a static unread dot with no data behind it. Client can read its own rows and mark them read; only a later alert-matching batch job (service-role) creates rows.';

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
CREATE POLICY "notifications_select_own" ON notifications FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "notifications_update_own" ON notifications;
CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "notifications_service_insert" ON notifications;
CREATE POLICY "notifications_service_insert" ON notifications FOR INSERT WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, UPDATE ON notifications TO authenticated;
