-- Rollback for 20261002000000_notifications_dedupe_key.sql
DROP INDEX IF EXISTS idx_notifications_user_dedupe;
ALTER TABLE notifications DROP COLUMN IF EXISTS dedupe_key;
