-- =============================================================================
-- Migration: user_webhooks_unique_per_user
-- Created:   2026-09-29
-- Description:
--   Phase 9 of the preference engine: the Settings UI being built now treats
--   user_webhooks as "one CRM target per user" (matching the original spec:
--   "a single outbound Webhook engine... one HMAC-signed POST endpoint per
--   user"), but the Phase-1 table never actually enforced that -- only
--   `id` is unique, `user_id` is merely indexed. Without a UNIQUE
--   constraint, a client-side upsert(..., { onConflict: "user_id" }) has
--   nothing to conflict against and a double-click on Save could silently
--   create two rows for the same user.
--
--   Safe to add now: this table has had no writers until this Settings UI,
--   so there's no existing-duplicate cleanup to worry about.
--
-- Idempotent: guarded by a pg_constraint existence check.
-- Safe to paste into the Supabase SQL Editor and run more than once.
-- Rollback: supabase/rollback/20260929000000_user_webhooks_unique_per_user_down.sql
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_webhooks_user_id'
  ) THEN
    ALTER TABLE user_webhooks ADD CONSTRAINT uq_user_webhooks_user_id UNIQUE (user_id);
  END IF;
END
$$;
