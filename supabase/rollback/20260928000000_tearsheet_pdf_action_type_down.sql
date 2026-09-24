-- Rollback for 20260928000000_tearsheet_pdf_action_type.sql
-- Reverts the CHECK constraint to its pre-Phase-8 vocabulary. Any rows
-- already written with action_type = 'tearsheet_pdf' would violate this
-- constraint on the next write validation, so only run this if no such rows
-- exist yet (they are append-only and never expected to need cleanup).

ALTER TABLE user_interactions DROP CONSTRAINT IF EXISTS user_interactions_action_type_check;
ALTER TABLE user_interactions ADD CONSTRAINT user_interactions_action_type_check
  CHECK (action_type IN ('pass', 'save', 'tearsheet_summary', 'crm_sync', 'lookalikes_view'));
