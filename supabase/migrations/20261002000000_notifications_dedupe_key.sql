-- =============================================================================
-- Migration: notifications_dedupe_key
-- Created:   2026-10-02
-- Description:
--   Phase E prerequisite. generate_live_alerts() (next migration) is meant to
--   be safe to run every 30 minutes forever, re-scanning a rolling lookback
--   window rather than tracking a "last processed" watermark -- the same
--   convention as every recompute/resolver job already in this codebase
--   (recompute_user_preference_vectors, resolve_tier1, link_oss_projects).
--   That convention only works if repeat runs can't create repeat
--   notifications for the same underlying event, and notifications had
--   nothing to dedupe on -- no reference back to the filing/observation/
--   match that produced a row.
--
--   dedupe_key is a free-text tag naming the specific event ("filing:<id>",
--   "velocity:<project_id>:<observed_at>", "thesis_match:<startup_id>") --
--   different per alert TYPE by construction, so no cross-type collision is
--   possible. Paired with user_id in a partial unique index: NULL stays
--   ungoverned (the existing one-time welcome notification, and anything
--   else that will never repeat, needs no key at all), but once a job
--   supplies a key, "this user already got this exact alert" becomes a
--   constraint the database enforces, not a promise the job has to keep by
--   being careful.
--
-- Rollback: supabase/rollback/20261002000000_notifications_dedupe_key_down.sql
-- Idempotent.
-- =============================================================================

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text;

COMMENT ON COLUMN notifications.dedupe_key IS
  'Stable identifier for the specific event that produced this notification (e.g. "filing:<raw_gov_filings.id>"), so a re-run of the job that writes it can never create a duplicate. NULL for notifications with no natural repeat to guard against (e.g. the one-time onboarding welcome message).';

-- Partial: a NULL dedupe_key is not considered equal to any other NULL under
-- a plain UNIQUE constraint anyway, but the WHERE clause makes that intent
-- explicit rather than incidental, and is what ON CONFLICT below targets.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
  ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
