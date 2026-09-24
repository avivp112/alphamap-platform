-- =============================================================================
-- Migration: tearsheet_pdf_action_type
-- Created:   2026-09-28
-- Description:
--   Phase 8 of the preference engine: generating a Tear Sheet PDF is a
--   high-intent signal (IC prep) worth recording alongside pass/save/etc.
--   Extends user_interactions.action_type's CHECK constraint with
--   'tearsheet_pdf' -- same append-only table from Phase 1, no new column.
--
--   action_type is a plain `text CHECK (... IN (...))`, not a native enum,
--   so widening it is just a drop-and-recreate of that one constraint.
--   Postgres auto-names an inline column CHECK as
--   "<table>_<column>_check" when the original migration didn't give it an
--   explicit name (20260924000000 didn't), so that's the name dropped below.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS before recreating.
-- Safe to paste into the Supabase SQL Editor and run more than once.
-- Rollback: supabase/rollback/20260928000000_tearsheet_pdf_action_type_down.sql
-- =============================================================================

ALTER TABLE user_interactions DROP CONSTRAINT IF EXISTS user_interactions_action_type_check;
ALTER TABLE user_interactions ADD CONSTRAINT user_interactions_action_type_check
  CHECK (action_type IN ('pass', 'save', 'tearsheet_summary', 'crm_sync', 'lookalikes_view', 'tearsheet_pdf'));
